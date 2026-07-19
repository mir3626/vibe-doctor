import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { promisify } from 'node:util';
import {
  auditAppendOnlyRange,
  publishAdditions,
} from '../src/pro-roundtrip/git-branch-transport.js';
import { prepareBridgeWorktree, runGit } from '../src/pro-roundtrip/worktree.js';

const execFile = promisify(execFileCallback);
const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFile('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  return result.stdout.trim();
}

async function scaffoldRepository(): Promise<{
  remote: string;
  checkout: string;
  mainHead: string;
  bridgeHead: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'pro-roundtrip-transport-'));
  tempDirs.push(root);
  const remote = path.join(root, 'remote.git');
  const seed = path.join(root, 'seed');
  const checkout = path.join(root, 'checkout');
  await execFile('git', ['init', '--bare', remote], { windowsHide: true });
  await execFile('git', ['init', '--initial-branch=main', seed], { windowsHide: true });
  await git(seed, ['config', 'user.name', 'Roundtrip Test']);
  await git(seed, ['config', 'user.email', 'roundtrip@example.invalid']);
  await writeFile(path.join(seed, 'README.md'), '# Fixture\n', 'utf8');
  await git(seed, ['add', 'README.md']);
  await git(seed, ['commit', '-m', 'initial']);
  await git(seed, ['remote', 'add', 'origin', remote]);
  await git(seed, ['push', '-u', 'origin', 'main']);
  await git(seed, ['branch', 'vibe-pro-bridge']);
  await git(seed, ['push', 'origin', 'vibe-pro-bridge']);
  await execFile('git', ['clone', '--branch', 'main', remote, checkout], {
    windowsHide: true,
  });
  await git(checkout, ['config', 'user.name', 'Roundtrip Test']);
  await git(checkout, ['config', 'user.email', 'roundtrip@example.invalid']);
  return {
    remote,
    checkout,
    mainHead: await git(checkout, ['rev-parse', 'HEAD']),
    bridgeHead: await git(checkout, ['rev-parse', 'origin/vibe-pro-bridge']),
  };
}

describe('pro roundtrip Git transport', () => {
  it('publishes additions without switching or modifying the code branch', async () => {
    const fixture = await scaffoldRepository();
    const result = await publishAdditions(
      new Map([['flows/20260719/001-test/FLOW.json', '{}\n']]),
      'test: append flow',
      { cwd: fixture.checkout },
    );

    assert.match(result.bridgeCommitSha, /^[0-9a-f]{40}$/);
    assert.equal(await git(fixture.checkout, ['branch', '--show-current']), 'main');
    assert.equal(await git(fixture.checkout, ['rev-parse', 'HEAD']), fixture.mainHead);
    assert.equal(
      await git(fixture.checkout, [
        'show',
        'origin/vibe-pro-bridge:flows/20260719/001-test/FLOW.json',
      ]),
      '{}',
    );
    await assert.rejects(
      git(fixture.checkout, ['show', 'origin/main:flows/20260719/001-test/FLOW.json']),
    );
  });

  it('fails on an existing path and detects later modification as tamper', async () => {
    const fixture = await scaffoldRepository();
    const first = await publishAdditions(
      new Map([['flows/20260719/001-test/FLOW.json', '{}\n']]),
      'test: append flow',
      { cwd: fixture.checkout },
    );
    await assert.rejects(
      publishAdditions(
        new Map([['flows/20260719/001-test/FLOW.json', '{"changed":true}\n']]),
        'test: overwrite flow',
        { cwd: fixture.checkout },
      ),
      /append-only collision/,
    );

    const context = await prepareBridgeWorktree(fixture.checkout);
    await writeFile(
      path.join(context.worktreePath, 'flows', '20260719', '001-test', 'FLOW.json'),
      '{"changed":true}\n',
      'utf8',
    );
    await runGit(context.worktreePath, ['add', 'flows/20260719/001-test/FLOW.json']);
    await runGit(context.worktreePath, ['commit', '-m', 'test: tamper']);
    const tamperedHead = (await runGit(context.worktreePath, ['rev-parse', 'HEAD'])).stdout.trim();
    const audit = await auditAppendOnlyRange(
      context.worktreePath,
      first.bridgeCommitSha,
      tamperedHead,
      'flows/20260719/001-test',
    );

    assert.equal(audit.ok, false);
    assert.deepEqual(audit.violations, [
      { status: 'M', path: 'flows/20260719/001-test/FLOW.json' },
    ]);
  });

  it('refuses a worktree path without its tool-owned marker', async () => {
    const fixture = await scaffoldRepository();
    const context = await prepareBridgeWorktree(fixture.checkout);
    await rm(context.markerPath);

    await assert.rejects(
      prepareBridgeWorktree(fixture.checkout),
      /refusing ambiguous worktree state/,
    );
  });
});
