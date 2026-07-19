import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const BRIDGE_BRANCH = 'vibe-pro-bridge';
const markerSchemaVersion = 'vibe-pro-worktree-owner-v1';

export interface GitResult {
  stdout: string;
  stderr: string;
}

export interface WorktreeContext {
  repoRoot: string;
  worktreePath: string;
  markerPath: string;
  remoteTip: string;
}

interface WorktreeMarker {
  schemaVersion: typeof markerSchemaVersion;
  repoRoot: string;
  worktreePath: string;
  branch: typeof BRIDGE_BRANCH;
}

export async function runGit(
  cwd: string,
  args: string[],
  allowFailure = false,
): Promise<GitResult & { exitCode: number }> {
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    const exitCode = typeof failure.code === 'number' ? failure.code : 1;
    if (allowFailure) {
      return {
        stdout: failure.stdout ?? '',
        stderr: failure.stderr ?? failure.message,
        exitCode,
      };
    }
    throw new Error(
      `git ${args.join(' ')} failed (${exitCode}): ${(failure.stderr ?? failure.message).trim()}`,
    );
  }
}

async function pathExists(candidate: string): Promise<boolean> {
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

function canonical(value: string): string {
  return path.resolve(value).toLowerCase();
}

async function readMarker(markerPath: string): Promise<WorktreeMarker> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(markerPath, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`invalid worktree owner marker: ${markerPath}: ${String(error)}`);
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('schemaVersion' in parsed) ||
    !('repoRoot' in parsed) ||
    !('worktreePath' in parsed) ||
    !('branch' in parsed)
  ) {
    throw new Error(`invalid worktree owner marker shape: ${markerPath}`);
  }
  const marker = parsed as WorktreeMarker;
  if (marker.schemaVersion !== markerSchemaVersion || marker.branch !== BRIDGE_BRANCH) {
    throw new Error(`unsupported worktree owner marker: ${markerPath}`);
  }
  return marker;
}

export async function resolveRepositoryRoot(cwd = process.cwd()): Promise<string> {
  const result = await runGit(cwd, ['rev-parse', '--show-toplevel']);
  return path.resolve(result.stdout.trim());
}

export async function bridgeBranchExists(repoRoot: string): Promise<boolean> {
  const result = await runGit(
    repoRoot,
    ['ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${BRIDGE_BRANCH}`],
    true,
  );
  return result.exitCode === 0 && result.stdout.trim().length > 0;
}

export async function fetchBridge(repoRoot: string): Promise<string> {
  if (!(await bridgeBranchExists(repoRoot))) {
    throw new Error(
      `origin/${BRIDGE_BRANCH} does not exist; branch creation requires separate user authorization`,
    );
  }
  await runGit(repoRoot, [
    'fetch',
    '--no-tags',
    'origin',
    `+refs/heads/${BRIDGE_BRANCH}:refs/remotes/origin/${BRIDGE_BRANCH}`,
  ]);
  const tip = await runGit(repoRoot, [
    'rev-parse',
    `refs/remotes/origin/${BRIDGE_BRANCH}^{commit}`,
  ]);
  return tip.stdout.trim();
}

export async function prepareBridgeWorktree(cwd = process.cwd()): Promise<WorktreeContext> {
  const repoRoot = await resolveRepositoryRoot(cwd);
  const remoteTip = await fetchBridge(repoRoot);
  const worktreesRoot = path.join(repoRoot, '.vibe', 'worktrees');
  const worktreePath = path.join(worktreesRoot, 'pro-roundtrip');
  const markerPath = path.join(worktreesRoot, 'pro-roundtrip.owner.json');
  const hasWorktree = await pathExists(worktreePath);
  const hasMarker = await pathExists(markerPath);

  if (hasWorktree !== hasMarker) {
    throw new Error(
      `refusing ambiguous worktree state; worktree=${hasWorktree} ownerMarker=${hasMarker}`,
    );
  }

  if (!hasWorktree) {
    await mkdir(worktreesRoot, { recursive: true });
    await runGit(repoRoot, [
      'worktree',
      'add',
      '--detach',
      worktreePath,
      `refs/remotes/origin/${BRIDGE_BRANCH}`,
    ]);
    const marker: WorktreeMarker = {
      schemaVersion: markerSchemaVersion,
      repoRoot,
      worktreePath,
      branch: BRIDGE_BRANCH,
    };
    await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
  } else {
    const marker = await readMarker(markerPath);
    if (
      canonical(marker.repoRoot) !== canonical(repoRoot) ||
      canonical(marker.worktreePath) !== canonical(worktreePath)
    ) {
      throw new Error('worktree owner marker belongs to another repository or path');
    }
    const status = await runGit(worktreePath, ['status', '--porcelain=v1']);
    if (status.stdout.trim().length > 0) {
      throw new Error('bridge worktree is dirty; refusing checkout or cleanup');
    }
    await runGit(worktreePath, [
      'checkout',
      '--detach',
      `refs/remotes/origin/${BRIDGE_BRANCH}`,
    ]);
  }

  const finalStatus = await runGit(worktreePath, ['status', '--porcelain=v1']);
  if (finalStatus.stdout.trim().length > 0) {
    throw new Error('bridge worktree is not clean after preparation');
  }
  return { repoRoot, worktreePath, markerPath, remoteTip };
}

export async function inspectBridgeWorktree(cwd = process.cwd()): Promise<{
  repoRoot: string;
  worktreePath: string;
  markerPath: string;
  branchExists: boolean;
  worktreeExists: boolean;
  markerExists: boolean;
  clean: boolean | null;
}> {
  const repoRoot = await resolveRepositoryRoot(cwd);
  const worktreePath = path.join(repoRoot, '.vibe', 'worktrees', 'pro-roundtrip');
  const markerPath = path.join(repoRoot, '.vibe', 'worktrees', 'pro-roundtrip.owner.json');
  const worktreeExists = await pathExists(worktreePath);
  const markerExists = await pathExists(markerPath);
  let clean: boolean | null = null;
  if (worktreeExists) {
    const result = await runGit(worktreePath, ['status', '--porcelain=v1'], true);
    clean = result.exitCode === 0 ? result.stdout.trim().length === 0 : false;
  }
  return {
    repoRoot,
    worktreePath,
    markerPath,
    branchExists: await bridgeBranchExists(repoRoot),
    worktreeExists,
    markerExists,
    clean,
  };
}
