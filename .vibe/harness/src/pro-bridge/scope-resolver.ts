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

export type RangeDiffExclusionReason = 'secret' | 'binary' | 'budget' | 'unavailable';

export interface RangeDiffFile {
  path: string;
  additions: number;
  deletions: number;
  byteLength: number;
  sha256: string;
}

export interface RangeDiffAttachment {
  diffText: string;
  byteLength: number;
  sha256: string;
  sourceByteLength: number;
  maxBytes: number;
  truncated: boolean;
  files: RangeDiffFile[];
  excluded: Array<{ path: string; reason: RangeDiffExclusionReason }>;
  statText: string;
  statByteLength: number;
  statSha256: string;
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
  rangeDiff: RangeDiffAttachment | null;
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
export const DEFAULT_MAX_RANGE_DIFF_BYTES = 2 * 1024 * 1024;
const GITHUB_REMOTE_PATTERNS = [
  /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i,
  /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i,
  /^ssh:\/\/git@github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i,
] as const;

function normalizeRepoPath(filePath: string): string {
  return filePath.trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

export function parseGitHubFullName(remoteUrl: string | null): string | null {
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

interface NumstatEntry {
  path: string;
  additions: number | null;
  deletions: number | null;
}

function parseNumstatEntry(line: string): NumstatEntry | null {
  const fields = line.split('\t');
  const filePath = parseNumstatPath(line);
  if (filePath === null || fields.length < 3) {
    return null;
  }
  const additions = /^(?:0|[1-9][0-9]*)$/.test(fields[0]!) ? Number(fields[0]) : null;
  const deletions = /^(?:0|[1-9][0-9]*)$/.test(fields[1]!) ? Number(fields[1]) : null;
  return { path: filePath, additions, deletions };
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

function normalizeByteLimit(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

function renderRangeStat(input: {
  baseSha: string;
  headSha: string;
  maxBytes: number;
  byteLength: number;
  sourceByteLength: number;
  diffSha256: string;
  files: RangeDiffFile[];
  excluded: RangeDiffAttachment['excluded'];
}): string {
  const truncated = input.excluded.some((entry) => entry.reason === 'budget');
  const diffstat = input.files.length === 0
    ? ['(no included text files)']
    : input.files.map(
        (file) => `${file.path}\t+${file.additions}\t-${file.deletions}\t${file.byteLength} bytes`,
      );
  const included = input.files.length === 0
    ? ['(none)']
    : input.files.map(
        (file) => `${file.path}\t${file.byteLength} bytes\tsha256:${file.sha256}`,
      );
  const excluded = input.excluded.length === 0
    ? ['(none)']
    : input.excluded.map((file) => `${file.path}\t${file.reason}`);
  return [
    `Range: ${input.baseSha}..${input.headSha}`,
    `Budget: ${input.maxBytes} UTF-8 bytes`,
    `Source text bytes: ${input.sourceByteLength}`,
    `Written bytes: ${input.byteLength}`,
    `Range diff SHA-256: ${input.diffSha256}`,
    `Truncated by budget: ${truncated ? 'yes' : 'no'}`,
    '',
    'Diffstat (included text files):',
    ...diffstat,
    '',
    'Included roster:',
    ...included,
    '',
    'Excluded roster:',
    ...excluded,
    '',
  ].join('\n');
}

export async function createRangeDiffArtifact(
  ctx: { repoRoot: string; git: GitPort },
  input: { baseSha: string; headSha: string },
  options: { maxBytes?: number } = {},
): Promise<{ rangeDiff: RangeDiffAttachment | null; warnings: string[] }> {
  const warnings: string[] = [];
  const maxBytes = normalizeByteLimit(options.maxBytes, DEFAULT_MAX_RANGE_DIFF_BYTES);
  const rangeSpec = `${input.baseSha}..${input.headSha}`;
  const numstat = await ctx.git.run([
    'diff',
    '--no-renames',
    '--numstat',
    rangeSpec,
  ]);
  if (!numstat.ok) {
    return { rangeDiff: null, warnings: ['range-diff-numstat-unavailable'] };
  }

  const candidates: Array<{ path: string; additions: number; deletions: number }> = [];
  const excluded = new Map<string, RangeDiffExclusionReason>();
  for (const line of numstat.stdout.split(/\r?\n/).filter((entry) => entry.length > 0)) {
    const entry = parseNumstatEntry(line);
    if (entry === null) {
      continue;
    }
    if (isSecretPath(entry.path)) {
      excluded.set(entry.path, 'secret');
    } else if (
      entry.additions === null
      || entry.deletions === null
      || !isSafeRelativePath(entry.path)
    ) {
      excluded.set(entry.path, 'binary');
    } else {
      candidates.push({
        path: entry.path,
        additions: entry.additions,
        deletions: entry.deletions,
      });
    }
  }

  const diffParts: string[] = [];
  const files: RangeDiffFile[] = [];
  let byteLength = 0;
  let sourceByteLength = 0;
  const uniqueCandidates = new Map(
    candidates.map((candidate) => [candidate.path, candidate] as const),
  );
  for (const candidate of [...uniqueCandidates.values()].sort((left, right) =>
    compareStringsByCodePoint(left.path, right.path))) {
    const result = await ctx.git.run([
      'diff',
      '--no-renames',
      rangeSpec,
      '--',
      candidate.path,
    ]);
    if (!result.ok || result.stdout.length === 0) {
      excluded.set(candidate.path, 'unavailable');
      warnings.push(`range-diff-unavailable:${candidate.path}`);
      continue;
    }
    if (hasUnsafeControlCharacters(result.stdout)) {
      excluded.set(candidate.path, 'binary');
      continue;
    }
    const diffText = result.stdout.endsWith('\n') ? result.stdout : `${result.stdout}\n`;
    const fileByteLength = Buffer.byteLength(diffText, 'utf8');
    sourceByteLength += fileByteLength;
    if (byteLength + fileByteLength > maxBytes) {
      excluded.set(candidate.path, 'budget');
      continue;
    }
    diffParts.push(diffText);
    byteLength += fileByteLength;
    files.push({
      ...candidate,
      byteLength: fileByteLength,
      sha256: createHash('sha256').update(diffText, 'utf8').digest('hex'),
    });
  }

  const diffText = diffParts.join('');
  const sha256 = createHash('sha256').update(diffText, 'utf8').digest('hex');
  const excludedFiles = [...excluded.entries()]
    .map(([path, reason]) => ({ path, reason }))
    .sort((left, right) => {
      const byPath = compareStringsByCodePoint(left.path, right.path);
      return byPath === 0 ? compareStringsByCodePoint(left.reason, right.reason) : byPath;
    });
  const statText = renderRangeStat({
    baseSha: input.baseSha,
    headSha: input.headSha,
    maxBytes,
    byteLength,
    sourceByteLength,
    diffSha256: sha256,
    files,
    excluded: excludedFiles,
  });
  return {
    rangeDiff: {
      diffText,
      byteLength,
      sha256,
      sourceByteLength,
      maxBytes,
      truncated: excludedFiles.some((entry) => entry.reason === 'budget'),
      files,
      excluded: excludedFiles,
      statText,
      statByteLength: Buffer.byteLength(statText, 'utf8'),
      statSha256: createHash('sha256').update(statText, 'utf8').digest('hex'),
    },
    warnings,
  };
}

export async function resolveGitHubScope(
  ctx: { repoRoot: string; git: GitPort },
  input: { baseSha: string; headSha: string },
  options: { maxPatchBytes?: number; maxRangeDiffBytes?: number } = {},
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

  const rangeResult = await createRangeDiffArtifact(ctx, input, {
    ...(options.maxRangeDiffBytes === undefined
      ? {}
      : { maxBytes: options.maxRangeDiffBytes }),
  });
  warnings.push(...rangeResult.warnings);
  const rangeDiff = rangeResult.rangeDiff;
  if (rangeDiff === null) {
    blockedReasons.push('range-diff-unavailable');
  } else if (rangeDiff.excluded.some((entry) => entry.reason === 'unavailable')) {
    blockedReasons.push('range-diff-incomplete');
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
    const maxPatchBytes = normalizeByteLimit(options.maxPatchBytes, DEFAULT_MAX_PATCH_BYTES);
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
    rangeDiff,
    warnings,
  };
}
