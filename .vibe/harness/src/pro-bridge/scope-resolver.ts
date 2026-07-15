import { createHash } from 'node:crypto';
import {
  compareStringsByCodePoint,
  isSafeRelativePath,
} from './contract.js';
import {
  readRepoText,
  type GitPort,
} from './goal-source/types.js';

export type VisibilityVerdict = 'remote' | 'absent' | 'unknown';

export interface PatchAttachment {
  diffText: string;
  byteLength: number;
  sha256: string;
  files: Array<{ path: string; kind: 'tracked' | 'untracked' }>;
  excluded: Array<{ path: string; reason: 'secret' | 'binary' }>;
}

export interface ScopeResolution {
  repository: {
    fullName: string | null;
    remoteUrl: string | null;
    defaultBranch: string | null;
  };
  git: {
    baseSha: string;
    headSha: string;
    branch: string | null;
    baseVisibility: VisibilityVerdict;
    headVisibility: VisibilityVerdict;
    headVisibleOnGitHub: boolean;
    compareUrlHint: string | null;
  };
  visibilityCase:
    | 'github-range'
    | 'github-base-plus-patch'
    | 'github-range-plus-patch'
    | 'blocked';
  blockedReasons: string[];
  patch: PatchAttachment | null;
  warnings: string[];
}

export const DEFAULT_SECRET_PATH_PATTERNS: readonly RegExp[] = Object.freeze([
  /(?:^|\/)\.env[^/]*(?:$|\/)/i,
  /(?:^|\/)[^/]*(?:credential|secret)[^/]*(?:$|\/)/i,
  /(?:^|\/)[^/]*token[^/]*(?:$|\/)/i,
  /(?:^|\/)(?:id_rsa[^/]*|id_ed25519[^/]*|[^/]+\.(?:pem|key|p12|pfx|jks))(?:$|\/)/i,
  /(?:^|\/)[^/]+\.(?:dump|sqlite|sqlite3|db|sql\.gz)(?:$|\/)/i,
  /(?:^|\/)node_modules(?:$|\/)/i,
  /(?:^|\/)(?:dist|build|out|coverage|target|\.next|\.output)(?:$|\/)/i,
  /(?:^|\/)[^/]+\.(?:zip|7z|tgz|tar[^/]*)(?:$|\/)/i,
]);

const DEFAULT_MAX_PATCH_BYTES = 1024 * 1024;
const GITHUB_REMOTE_PATTERNS = [
  /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i,
  /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i,
  /^ssh:\/\/git@github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i,
] as const;

function normalizeRepoPath(filePath: string): string {
  return filePath.trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

function parseGitHubFullName(remoteUrl: string | null): string | null {
  if (remoteUrl === null) {
    return null;
  }
  const value = remoteUrl.trim();
  for (const pattern of GITHUB_REMOTE_PATTERNS) {
    const match = pattern.exec(value);
    if (match) {
      return `${match[1]!}/${match[2]!}`;
    }
  }
  return null;
}

export function isSecretPath(filePath: string): boolean {
  const normalized = normalizeRepoPath(filePath);
  return DEFAULT_SECRET_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function outputOrNull(result: Awaited<ReturnType<GitPort['run']>>): string | null {
  const value = result.stdout.trim();
  return result.ok && value.length > 0 ? value : null;
}

function parseDefaultBranch(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const normalized = value
    .replace(/^refs\/remotes\/origin\//, '')
    .replace(/^origin\//, '');
  return normalized.length > 0 ? normalized : null;
}

async function resolveVisibility(git: GitPort, sha: string): Promise<VisibilityVerdict> {
  const result = await git.run(['branch', '-r', '--contains', sha]);
  if (!result.ok) {
    return 'unknown';
  }
  return result.stdout
    .split(/\r?\n/)
    .some((line) => /(?:^|\s)origin\//.test(line))
    ? 'remote'
    : 'absent';
}

function parsePorcelainPath(line: string): string {
  const rawPath = line.slice(3).trim();
  const renameIndex = rawPath.lastIndexOf(' -> ');
  return normalizeRepoPath(renameIndex >= 0 ? rawPath.slice(renameIndex + 4) : rawPath);
}

function parseUntrackedPaths(statusText: string): string[] {
  return statusText
    .split(/\r?\n/)
    .filter((line) => line.startsWith('?? '))
    .map(parsePorcelainPath)
    .filter((filePath) => filePath.length > 0)
    .sort(compareStringsByCodePoint);
}

function hasUnsafeControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      return true;
    }
  }
  return false;
}

function synthesizeUntrackedDiff(filePath: string, content: string): string {
  const normalized = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const hasFinalNewline = normalized.endsWith('\n');
  const body = normalized.length === 0
    ? []
    : (hasFinalNewline ? normalized.slice(0, -1) : normalized).split('\n');
  const lines = [
    `diff --git a/${filePath} b/${filePath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${body.length} @@`,
    ...body.map((line) => `+${line}`),
  ];
  if (!hasFinalNewline && normalized.length > 0) {
    lines.push('\\ No newline at end of file');
  }
  return `${lines.join('\n')}\n`;
}

function comparePatchFiles(
  left: PatchAttachment['files'][number],
  right: PatchAttachment['files'][number],
): number {
  const byPath = compareStringsByCodePoint(left.path, right.path);
  return byPath === 0 ? compareStringsByCodePoint(left.kind, right.kind) : byPath;
}

function compareExcludedFiles(
  left: PatchAttachment['excluded'][number],
  right: PatchAttachment['excluded'][number],
): number {
  const byPath = compareStringsByCodePoint(left.path, right.path);
  return byPath === 0 ? compareStringsByCodePoint(left.reason, right.reason) : byPath;
}

function parseNumstatPath(line: string): string | null {
  const fields = line.split('\t');
  if (fields.length < 3) {
    return null;
  }
  const filePath = normalizeRepoPath(fields.slice(2).join('\t'));
  return filePath.length > 0 ? filePath : null;
}

function addExcluded(
  excluded: Map<string, 'secret' | 'binary'>,
  filePath: string,
  reason: 'secret' | 'binary',
): void {
  if (excluded.get(filePath) !== 'secret') {
    excluded.set(filePath, reason);
  }
}

async function createPatch(
  ctx: { repoRoot: string; git: GitPort },
  anchor: string,
  statusText: string,
  maxPatchBytes: number,
  warnings: string[],
): Promise<{ patch: PatchAttachment | null; oversized: boolean }> {
  const numstat = await ctx.git.run(['diff', '--no-renames', '--numstat', anchor]);
  const trackedPaths: string[] = [];
  const excluded = new Map<string, 'secret' | 'binary'>();

  if (!numstat.ok) {
    warnings.push('patch-numstat-unavailable');
  } else {
    for (const line of numstat.stdout.split(/\r?\n/).filter((entry) => entry.length > 0)) {
      const filePath = parseNumstatPath(line);
      if (filePath === null) {
        continue;
      }
      if (isSecretPath(filePath)) {
        addExcluded(excluded, filePath, 'secret');
      } else if (line.startsWith('-\t-\t') || !isSafeRelativePath(filePath)) {
        addExcluded(excluded, filePath, 'binary');
      } else {
        trackedPaths.push(filePath);
      }
    }
  }

  const diffParts: string[] = [];
  const files: PatchAttachment['files'] = [];
  for (const filePath of [...new Set(trackedPaths)].sort(compareStringsByCodePoint)) {
    const result = await ctx.git.run(['diff', '--no-renames', anchor, '--', filePath]);
    if (!result.ok) {
      warnings.push(`patch-diff-unavailable:${filePath}`);
      continue;
    }
    if (hasUnsafeControlCharacters(result.stdout)) {
      addExcluded(excluded, filePath, 'binary');
      continue;
    }
    if (result.stdout.length > 0) {
      diffParts.push(result.stdout.endsWith('\n') ? result.stdout : `${result.stdout}\n`);
      files.push({ path: filePath, kind: 'tracked' });
    }
  }

  for (const filePath of [...new Set(parseUntrackedPaths(statusText))]) {
    if (isSecretPath(filePath)) {
      addExcluded(excluded, filePath, 'secret');
      continue;
    }
    if (!isSafeRelativePath(filePath)) {
      addExcluded(excluded, filePath, 'binary');
      continue;
    }
    const content = await readRepoText({ repoRoot: ctx.repoRoot, git: ctx.git }, filePath);
    if (content === null) {
      warnings.push(`untracked-file-unavailable:${filePath}`);
      continue;
    }
    if (content.includes('\0') || hasUnsafeControlCharacters(content)) {
      addExcluded(excluded, filePath, 'binary');
      continue;
    }
    diffParts.push(synthesizeUntrackedDiff(filePath, content));
    files.push({ path: filePath, kind: 'untracked' });
  }

  const diffText = diffParts.join('');
  const byteLength = Buffer.byteLength(diffText, 'utf8');
  if (byteLength > maxPatchBytes) {
    warnings.push(`patch-bytes:${byteLength}`);
    return { patch: null, oversized: true };
  }

  return {
    patch: {
      diffText,
      byteLength,
      sha256: createHash('sha256').update(diffText, 'utf8').digest('hex'),
      files: files.sort(comparePatchFiles),
      excluded: [...excluded.entries()]
        .map(([path, reason]) => ({ path, reason }))
        .sort(compareExcludedFiles),
    },
    oversized: false,
  };
}

export async function resolveGitHubScope(
  ctx: { repoRoot: string; git: GitPort },
  input: { baseSha: string; headSha: string },
  options: { maxPatchBytes?: number } = {},
): Promise<ScopeResolution> {
  const warnings = ['visibility-from-local-remote-refs'];
  const [remote, defaultBranchResult, branchResult, baseVisibility, headVisibility, statusResult] =
    await Promise.all([
      ctx.git.run(['config', '--get', 'remote.origin.url']),
      ctx.git.run(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']),
      ctx.git.run(['rev-parse', '--abbrev-ref', 'HEAD']),
      resolveVisibility(ctx.git, input.baseSha),
      resolveVisibility(ctx.git, input.headSha),
      ctx.git.run(['status', '--porcelain=v1', '--untracked-files=all']),
    ]);

  const remoteUrl = outputOrNull(remote);
  const fullName = parseGitHubFullName(remoteUrl);
  const branchValue = outputOrNull(branchResult);
  const branch = branchValue === null || branchValue === 'HEAD' ? null : branchValue;
  const defaultBranch = parseDefaultBranch(outputOrNull(defaultBranchResult));
  const statusText = statusResult.ok ? statusResult.stdout : '';
  if (!statusResult.ok) {
    warnings.push('worktree-status-unavailable');
  }
  if (baseVisibility === 'unknown') {
    warnings.push('base-visibility-unknown');
  }
  if (headVisibility === 'unknown') {
    warnings.push('head-visibility-unknown');
  }

  const blockedReasons: string[] = [];
  if (fullName === null) {
    blockedReasons.push('repository-fullname-unresolved');
  }
  if (baseVisibility === 'absent') {
    blockedReasons.push('base-not-on-remote');
  }

  const compareUrlHint = fullName === null
    ? null
    : `https://github.com/${fullName}/compare/${input.baseSha}...${input.headSha}`;
  const dirty = statusText.trim().length > 0;
  let visibilityCase: ScopeResolution['visibilityCase'];
  let patch: PatchAttachment | null = null;

  if (blockedReasons.length > 0) {
    visibilityCase = 'blocked';
  } else if (headVisibility === 'remote' && !dirty) {
    visibilityCase = 'github-range';
  } else {
    visibilityCase = headVisibility === 'remote'
      ? 'github-range-plus-patch'
      : 'github-base-plus-patch';
    const requestedLimit = options.maxPatchBytes ?? DEFAULT_MAX_PATCH_BYTES;
    const maxPatchBytes = Number.isFinite(requestedLimit) && requestedLimit >= 0
      ? Math.floor(requestedLimit)
      : DEFAULT_MAX_PATCH_BYTES;
    const patchResult = await createPatch(
      ctx,
      headVisibility === 'remote' ? input.headSha : input.baseSha,
      statusText,
      maxPatchBytes,
      warnings,
    );
    patch = patchResult.patch;
    if (patchResult.oversized) {
      blockedReasons.push('patch-oversized');
      visibilityCase = 'blocked';
    }
  }

  return {
    repository: { fullName, remoteUrl, defaultBranch },
    git: {
      baseSha: input.baseSha,
      headSha: input.headSha,
      branch,
      baseVisibility,
      headVisibility,
      headVisibleOnGitHub: headVisibility === 'remote',
      compareUrlHint,
    },
    visibilityCase,
    blockedReasons,
    patch,
    warnings,
  };
}
