import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertSafePayloadPath, toPosixPath } from './contract.js';
import {
  BRIDGE_BRANCH,
  fetchBridge,
  prepareBridgeWorktree,
  runGit,
  type WorktreeContext,
} from './worktree.js';

export interface PublishResult {
  bridgeCommitSha: string;
  paths: string[];
  attempts: number;
}

export interface AppendOnlyAuditResult {
  ok: boolean;
  changes: Array<{ status: string; path: string }>;
  violations: Array<{ status: string; path: string }>;
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await stat(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function orderedFiles(files: ReadonlyMap<string, string>): Array<[string, string]> {
  const normalized = [...files.entries()].map(([filePath, content]) => [
    assertSafePayloadPath(filePath),
    content,
  ] as [string, string]);
  for (const [filePath] of normalized) {
    if (!filePath.startsWith('flows/') && !filePath.startsWith('protocol/')) {
      throw new Error(`bridge publish path is outside flows/ or protocol/: ${filePath}`);
    }
  }
  const completionIndex = normalized.findIndex(([filePath]) => filePath.endsWith('/COMPLETE.json'));
  if (completionIndex !== -1 && completionIndex !== normalized.length - 1) {
    throw new Error('COMPLETE.json must be the final published path');
  }
  return normalized;
}

async function assertPathsAbsent(context: WorktreeContext, paths: string[]): Promise<void> {
  for (const relativePath of paths) {
    if (await exists(path.join(context.worktreePath, ...relativePath.split('/')))) {
      throw new Error(`append-only collision: ${relativePath}`);
    }
  }
}

async function assertPathsAbsentAtRemote(
  context: WorktreeContext,
  paths: string[],
): Promise<void> {
  for (const relativePath of paths) {
    const result = await runGit(
      context.worktreePath,
      [
        'cat-file',
        '-e',
        `refs/remotes/origin/${BRIDGE_BRANCH}:${toPosixPath(relativePath)}`,
      ],
      true,
    );
    if (result.exitCode === 0) {
      throw new Error(`append-only collision after concurrent push: ${relativePath}`);
    }
  }
}

function isNonFastForward(output: string): boolean {
  return /non-fast-forward|fetch first|\[rejected\]/i.test(output);
}

export async function publishAdditions(
  files: ReadonlyMap<string, string>,
  commitMessage: string,
  options: {
    cwd?: string;
    context?: WorktreeContext;
    maxAttempts?: number;
  } = {},
): Promise<PublishResult> {
  if (files.size === 0) {
    throw new Error('publish requires at least one file');
  }
  const entries = orderedFiles(files);
  const relativePaths = entries.map(([filePath]) => filePath);
  const context = options.context ?? await prepareBridgeWorktree(options.cwd);
  await assertPathsAbsent(context, relativePaths);

  for (const [relativePath, content] of entries) {
    const target = path.join(context.worktreePath, ...relativePath.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
    if ((await readFile(target, 'utf8')) !== content) {
      throw new Error(`write verification failed: ${relativePath}`);
    }
  }

  await runGit(context.worktreePath, ['add', '--', ...relativePaths]);
  const staged = await runGit(context.worktreePath, [
    'diff',
    '--cached',
    '--name-status',
    '--find-renames',
  ]);
  const stagedChanges = staged.stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split(/\t+/));
  if (
    stagedChanges.length !== relativePaths.length ||
    stagedChanges.some(([status]) => status !== 'A')
  ) {
    throw new Error(`publish staging is not append-only:\n${staged.stdout}`);
  }

  await runGit(context.worktreePath, ['commit', '-m', commitMessage]);
  const maxAttempts = options.maxAttempts ?? 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const pushed = await runGit(
      context.worktreePath,
      ['push', 'origin', `HEAD:refs/heads/${BRIDGE_BRANCH}`],
      true,
    );
    if (pushed.exitCode === 0) {
      const bridgeCommitSha = (
        await runGit(context.worktreePath, ['rev-parse', 'HEAD^{commit}'])
      ).stdout.trim();
      context.remoteTip = bridgeCommitSha;
      return { bridgeCommitSha, paths: relativePaths, attempts: attempt };
    }
    const output = `${pushed.stdout}\n${pushed.stderr}`;
    if (!isNonFastForward(output) || attempt === maxAttempts) {
      throw new Error(`bridge push failed after ${attempt} attempt(s): ${output.trim()}`);
    }

    await fetchBridge(context.repoRoot);
    await assertPathsAbsentAtRemote(context, relativePaths);
    const rebased = await runGit(
      context.worktreePath,
      ['rebase', `refs/remotes/origin/${BRIDGE_BRANCH}`],
      true,
    );
    if (rebased.exitCode !== 0) {
      await runGit(context.worktreePath, ['rebase', '--abort'], true);
      throw new Error(`bridge rebase failed; no force push attempted: ${rebased.stderr.trim()}`);
    }
  }
  throw new Error('unreachable bridge publish state');
}

export async function auditAppendOnlyRange(
  worktreePath: string,
  baseSha: string,
  headSha: string,
  flowPath?: string,
): Promise<AppendOnlyAuditResult> {
  const scopes = flowPath ? [toPosixPath(flowPath), 'protocol'] : ['flows', 'protocol'];
  const result = await runGit(worktreePath, [
    'diff',
    '--name-status',
    '--find-renames',
    `${baseSha}..${headSha}`,
    '--',
    ...scopes,
  ]);
  const changes = result.stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [status = '', ...paths] = line.split(/\t+/);
      return { status, path: paths.at(-1) ?? '' };
    });
  const violations = changes.filter(({ status }) => status !== 'A');
  return { ok: violations.length === 0, changes, violations };
}

export async function gitBlobSha(worktreePath: string, relativePath: string): Promise<string> {
  const result = await runGit(worktreePath, ['hash-object', '--', toPosixPath(relativePath)]);
  return result.stdout.trim();
}
