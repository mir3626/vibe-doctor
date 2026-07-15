import { execFile } from 'node:child_process';
import { readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  GoalSourceKind,
  GoalSourceManifest,
} from '../../lib/schemas/pro-bridge.js';
import { classifyScope } from './scope.js';

export interface GitPort {
  run(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }>;
}

export interface GoalSourceContext {
  repoRoot: string;
  git: GitPort;
  now?: () => Date;
}

export type ProviderOutcome =
  | { status: 'candidate'; manifest: GoalSourceManifest }
  | { status: 'no-goal'; reason: string }
  | { status: 'unavailable'; reason: string };

export interface GoalSourceProvider {
  readonly kind: GoalSourceKind;
  discover(ctx: GoalSourceContext): Promise<ProviderOutcome>;
}

export interface GitCommit {
  sha: string;
  parents: string[];
  committedAt: string;
  subject: string;
  body: string;
}

interface BuildManifestInput {
  source: GoalSourceManifest['source'];
  baseSha: string;
  headSha: string;
  commitShas: string[];
  designRefs: string[];
  implementationRefs: string[];
  unresolved: string[];
}

const execFileAsync = promisify(execFile);
export const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

function errorDetails(error: unknown): { stdout: string; stderr: string; code: number | null } {
  if (typeof error !== 'object' || error === null) {
    return { stdout: '', stderr: String(error), code: null };
  }
  const value = error as { stdout?: unknown; stderr?: unknown; code?: unknown; message?: unknown };
  return {
    stdout: typeof value.stdout === 'string' ? value.stdout : '',
    stderr:
      typeof value.stderr === 'string'
        ? value.stderr
        : typeof value.message === 'string'
          ? value.message
          : String(error),
    code: typeof value.code === 'number' ? value.code : null,
  };
}

export function createDefaultGitPort(repoRoot: string): GitPort {
  return {
    async run(args) {
      try {
        const result = await execFileAsync('git', args, {
          cwd: repoRoot,
          encoding: 'utf8',
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true,
        });
        return { ok: true, stdout: result.stdout, stderr: result.stderr, code: 0 };
      } catch (error) {
        return { ok: false, ...errorDetails(error) };
      }
    },
  };
}

function pathIsWithin(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function safeExistingPath(repoRoot: string, relativePath: string): Promise<string | null> {
  const lexicalRoot = path.resolve(repoRoot);
  const lexicalTarget = path.resolve(lexicalRoot, relativePath);
  if (!pathIsWithin(lexicalRoot, lexicalTarget)) {
    throw new Error(`Repository path escapes repoRoot: ${relativePath}`);
  }

  try {
    const [resolvedRoot, resolvedTarget] = await Promise.all([realpath(lexicalRoot), realpath(lexicalTarget)]);
    if (!pathIsWithin(resolvedRoot, resolvedTarget)) {
      throw new Error(`Repository path resolves outside repoRoot: ${relativePath}`);
    }
    return resolvedTarget;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function readRepoText(ctx: GoalSourceContext, relativePath: string): Promise<string | null> {
  const resolved = await safeExistingPath(ctx.repoRoot, relativePath);
  return resolved === null ? null : readFile(resolved, 'utf8');
}

export async function listRepoFiles(ctx: GoalSourceContext, relativeDir: string): Promise<string[]> {
  const resolved = await safeExistingPath(ctx.repoRoot, relativeDir);
  if (resolved === null) {
    return [];
  }
  const entries = await readdir(resolved, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => `${relativeDir.replaceAll('\\', '/').replace(/\/$/, '')}/${entry.name}`)
    .sort((left, right) => left.localeCompare(right));
}

export async function readGitCommits(ctx: GoalSourceContext, maxCount = 50): Promise<GitCommit[]> {
  const result = await ctx.git.run([
    'log',
    `--max-count=${maxCount}`,
    '--format=%H%x1f%P%x1f%cI%x1f%s%x1f%b%x1e',
  ]);
  if (!result.ok) {
    return [];
  }

  return result.stdout
    .split('\x1e')
    .map((record) => record.replace(/^\r?\n/, '').trimEnd())
    .filter((record) => record.length > 0)
    .flatMap((record) => {
      const fields = record.split('\x1f');
      const sha = fields[0] ?? '';
      if (!GIT_SHA_PATTERN.test(sha)) {
        return [];
      }
      return [
        {
          sha,
          parents: (fields[1] ?? '').split(' ').filter((parent) => GIT_SHA_PATTERN.test(parent)),
          committedAt: fields[2] ?? '',
          subject: fields[3] ?? '',
          body: fields.slice(4).join('\x1f'),
        },
      ];
    });
}

export function extractReferencedPaths(text: string, prefix?: string): string[] {
  const matches = text.matchAll(/`([^`]+)`/g);
  const values = [...matches]
    .map((match) => match[1]!.replaceAll('\\', '/'))
    .filter((value) => value.length > 0 && (prefix === undefined || value.startsWith(prefix)));
  return uniqueSorted(values);
}

export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function parseRemoteFullName(remoteUrl: string | null): string | null {
  if (remoteUrl === null) {
    return null;
  }
  const match = /github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(remoteUrl.trim());
  return match ? `${match[1]}/${match[2]}` : null;
}

function porcelainPath(line: string): string {
  const rawPath = line.slice(3).trim();
  const renameIndex = rawPath.lastIndexOf(' -> ');
  return (renameIndex >= 0 ? rawPath.slice(renameIndex + 4) : rawPath).replaceAll('\\', '/');
}

async function collectDirtyState(ctx: GoalSourceContext): Promise<{
  changed: string[];
  dirtyState: GoalSourceManifest['dirtyState'];
}> {
  const result = await ctx.git.run(['status', '--porcelain=v1', '--untracked-files=all']);
  if (!result.ok) {
    return {
      changed: [],
      dirtyState: { staged: [], unstaged: [], untracked: [], patchSha256: null },
    };
  }

  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];
  for (const line of result.stdout.split(/\r?\n/).filter((entry) => entry.length >= 3)) {
    const filePath = porcelainPath(line);
    if (line.startsWith('??')) {
      untracked.push(filePath);
      continue;
    }
    if (line[0] !== ' ') {
      staged.push(filePath);
    }
    if (line[1] !== ' ') {
      unstaged.push(filePath);
    }
  }

  const normalizedStaged = uniqueSorted(staged);
  const normalizedUnstaged = uniqueSorted(unstaged);
  const normalizedUntracked = uniqueSorted(untracked);
  return {
    changed: uniqueSorted([...normalizedStaged, ...normalizedUnstaged, ...normalizedUntracked]),
    dirtyState: {
      staged: normalizedStaged,
      unstaged: normalizedUnstaged,
      untracked: normalizedUntracked,
      patchSha256: null,
    },
  };
}

async function collectUnpushedDiagnostics(ctx: GoalSourceContext): Promise<string[]> {
  const upstream = await ctx.git.run([
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}',
  ]);
  if (!upstream.ok || upstream.stdout.trim().length === 0) {
    return ['no-upstream-tracking-branch'];
  }
  const upstreamName = upstream.stdout.trim();
  const count = await ctx.git.run(['rev-list', '--count', `${upstreamName}..HEAD`]);
  if (!count.ok || !/^\d+$/.test(count.stdout.trim())) {
    return ['unpushed-state-unresolved'];
  }
  const value = Number(count.stdout.trim());
  return value > 0 ? [`unpushed-commits:${value}`] : [];
}

export async function resolveHeadSha(ctx: GoalSourceContext): Promise<string | null> {
  const result = await ctx.git.run(['rev-parse', 'HEAD']);
  const value = result.stdout.trim();
  return result.ok && GIT_SHA_PATTERN.test(value) ? value : null;
}

export async function buildGitBackedManifest(
  ctx: GoalSourceContext,
  input: BuildManifestInput,
): Promise<GoalSourceManifest> {
  if (!GIT_SHA_PATTERN.test(input.baseSha) || !GIT_SHA_PATTERN.test(input.headSha)) {
    throw new Error('Goal source base/head must resolve to full Git SHAs');
  }

  const unresolved = new Set(input.unresolved);
  const remote = await ctx.git.run(['config', '--get', 'remote.origin.url']);
  const remoteUrl = remote.ok && remote.stdout.trim().length > 0 ? remote.stdout.trim() : null;
  if (remoteUrl === null) {
    unresolved.add('repository-remote-unresolved');
  }

  const diffFiles =
    input.baseSha === input.headSha
      ? []
      : await ctx.git.run(['diff', '--name-only', input.baseSha, input.headSha]).then((result) => {
          if (!result.ok) {
            unresolved.add('changed-files-unavailable');
            return [];
          }
          return result.stdout
            .split(/\r?\n/)
            .map((filePath) => filePath.trim().replaceAll('\\', '/'))
            .filter((filePath) => filePath.length > 0);
        });
  const dirty = await collectDirtyState(ctx);
  for (const diagnostic of await collectUnpushedDiagnostics(ctx)) {
    unresolved.add(diagnostic);
  }

  return {
    schemaVersion: 'vibe-goal-source-v1',
    repository: {
      root: path.resolve(ctx.repoRoot),
      remoteUrl,
      fullName: parseRemoteFullName(remoteUrl),
    },
    source: input.source,
    designRefs: uniqueSorted(input.designRefs),
    implementationRefs: uniqueSorted(input.implementationRefs),
    baseSha: input.baseSha,
    headSha: input.headSha,
    commitShas: [...new Set(input.commitShas.filter((sha) => GIT_SHA_PATTERN.test(sha)))],
    scope: classifyScope([...diffFiles, ...dirty.changed]),
    dirtyState: dirty.dirtyState,
    unresolved: [...unresolved].sort((left, right) => left.localeCompare(right)),
    payloadSha256: '0'.repeat(64),
  };
}
