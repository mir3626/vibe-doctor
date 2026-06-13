import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const checkpointScriptPath = path.resolve('.vibe', 'harness', 'scripts', 'vibe-checkpoint.mjs');
const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeText(filePath: string, value: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, 'utf8');
}

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
}

async function writeCheckpointState(root: string, updatedAt: string, handoffContent = '# Handoff\n\nHuman narrative.\n'): Promise<void> {
  await writeText(
    path.join(root, '.vibe', 'agent', 'sprint-status.json'),
    `${JSON.stringify({
      handoff: {
        updatedAt,
        orchestratorContextBudget: 'low',
      },
    }, null, 2)}\n`,
  );
  await writeText(path.join(root, '.vibe', 'agent', 'session-log.md'), '# Session Log\n\n## Entries\n- 2026-04-16T00:00:00.000Z [decision] ok\n');
  await writeText(path.join(root, '.vibe', 'agent', 'handoff.md'), handoffContent);
}

describe('vibe-checkpoint', () => {
  it('uses provider-neutral checkpoint wording on failure', async () => {
    const root = await makeTempDir('checkpoint-missing-state-');

    const result = spawnSync(process.execPath, [checkpointScriptPath], {
      cwd: root,
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Checkpoint blocked/);
    assert.doesNotMatch(result.stderr, /PreCompact blocked/);
  });

  it('blocks oversized active handoff files', async () => {
    const root = await makeTempDir('checkpoint-handoff-budget-');
    const now = new Date().toISOString();
    await writeText(
      path.join(root, '.vibe', 'agent', 'sprint-status.json'),
      `${JSON.stringify({
        handoff: {
          updatedAt: now,
          orchestratorContextBudget: 'low',
        },
      })}\n`,
    );
    await writeText(path.join(root, '.vibe', 'agent', 'session-log.md'), '# Session Log\n\n## Entries\n- 2026-04-16T00:00:00.000Z [decision] ok\n');
    await writeText(path.join(root, '.vibe', 'agent', 'handoff.md'), `# Handoff\n\n${'x'.repeat(150_000)}\n`);

    const result = spawnSync(process.execPath, [checkpointScriptPath, '--json'], {
      cwd: root,
      encoding: 'utf8',
    });
    const records = JSON.parse(result.stdout) as Array<{ id: string; ok: boolean; detail: string }>;
    const budget = records.find((entry) => entry.id === 'handoff.budget');

    assert.equal(result.status, 1);
    assert.equal(budget?.ok, false);
    assert.match(budget?.detail ?? '', /handoff too large/);
  });

  describe('--auto-refresh', () => {
    it('injects an auto-state block and bumps handoff.updatedAt for stale git-backed state', async () => {
      const root = await makeTempDir('checkpoint-auto-refresh-');
      const originalUpdatedAt = '2000-01-01T00:00:00.000Z';
      await writeCheckpointState(root, originalUpdatedAt);
      runGit(root, ['init']);
      runGit(root, ['config', 'user.email', 'checkpoint@example.test']);
      runGit(root, ['config', 'user.name', 'Checkpoint Test']);
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-m', 'initial checkpoint state']);

      const result = spawnSync(process.execPath, [checkpointScriptPath, '--auto-refresh'], {
        cwd: root,
        encoding: 'utf8',
      });
      const handoff = await readFile(path.join(root, '.vibe', 'agent', 'handoff.md'), 'utf8');
      const status = JSON.parse(await readFile(path.join(root, '.vibe', 'agent', 'sprint-status.json'), 'utf8')) as {
        handoff: { updatedAt: string };
      };

      assert.equal(result.status, 0);
      assert.match(handoff, /vibe:auto-state:start/);
      assert.match(handoff, /vibe:auto-state:end/);
      assert.ok(Date.parse(status.handoff.updatedAt) > Date.parse(originalUpdatedAt));
    });

    it('replaces the managed block without duplicating markers', async () => {
      const root = await makeTempDir('checkpoint-auto-refresh-idempotent-');
      const originalUpdatedAt = '2000-01-01T00:00:00.000Z';
      await writeCheckpointState(root, originalUpdatedAt);
      runGit(root, ['init']);
      runGit(root, ['config', 'user.email', 'checkpoint@example.test']);
      runGit(root, ['config', 'user.name', 'Checkpoint Test']);
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-m', 'initial checkpoint state']);

      const first = spawnSync(process.execPath, [checkpointScriptPath, '--auto-refresh'], {
        cwd: root,
        encoding: 'utf8',
      });
      const second = spawnSync(process.execPath, [checkpointScriptPath, '--auto-refresh'], {
        cwd: root,
        encoding: 'utf8',
      });
      const handoff = await readFile(path.join(root, '.vibe', 'agent', 'handoff.md'), 'utf8');

      assert.equal(first.status, 0);
      assert.equal(second.status, 0);
      assert.equal((handoff.match(/vibe:auto-state:start/g) ?? []).length, 1);
      assert.equal((handoff.match(/vibe:auto-state:end/g) ?? []).length, 1);
    });

    it('leaves handoff.md unchanged without the opt-in flag', async () => {
      const root = await makeTempDir('checkpoint-auto-refresh-default-');
      const handoffContent = '# Handoff\n\nHuman narrative only.\n';
      await writeCheckpointState(root, new Date().toISOString(), handoffContent);

      const result = spawnSync(process.execPath, [checkpointScriptPath], {
        cwd: root,
        encoding: 'utf8',
      });
      const handoff = await readFile(path.join(root, '.vibe', 'agent', 'handoff.md'), 'utf8');

      assert.equal(result.status, 0);
      assert.equal(handoff, handoffContent);
    });
  });
});
