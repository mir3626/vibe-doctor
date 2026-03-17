import path from 'node:path';
import { paths } from './paths.js';
import { ensureDir } from './fs.js';
import { runCommand } from './shell.js';

export interface WorktreeInfo {
  branch: string;
  directory: string;
}

export async function createWorktree(branch: string): Promise<WorktreeInfo> {
  await ensureDir(paths.worktreesDir);
  const directory = path.join(paths.worktreesDir, branch.replaceAll('/', '-'));

  await runCommand('git', ['worktree', 'add', '-B', branch, directory, 'HEAD']);

  return {
    branch,
    directory,
  };
}
