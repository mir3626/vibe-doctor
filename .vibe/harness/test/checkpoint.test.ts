import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const checkpointScriptPath = path.resolve('.vibe', 'harness', 'scripts', 'vibe-checkpoint.mjs');
const tempDirs: string[] = [];
type CheckpointRecord = { id: string; ok: boolean; detail: string };

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

function getRecord(stdout: string, id: string): CheckpointRecord {
  const records = JSON.parse(stdout) as CheckpointRecord[];
  const record = records.find((entry) => entry.id === id);
  assert.ok(record, `missing checkpoint record: ${id}`);
  return record;
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
  it('uses the Claude Code PreCompact output contract in hook mode', async () => {
    const root = await makeTempDir('checkpoint-precompact-success-');
    const strayCwd = await makeTempDir('checkpoint-precompact-stray-cwd-');
    await writeCheckpointState(root, new Date().toISOString());

    const result = spawnSync(process.execPath, [checkpointScriptPath, '--auto-refresh', '--precompact-hook'], {
      cwd: strayCwd,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });

  it('auto-detects PreCompact from stdin for legacy hook commands and uses the input cwd', async () => {
    const root = await makeTempDir('checkpoint-precompact-stdin-success-');
    const strayCwd = await makeTempDir('checkpoint-precompact-stdin-stray-cwd-');
    await writeCheckpointState(root, new Date().toISOString());

    const result = spawnSync(process.execPath, [checkpointScriptPath, '--auto-refresh'], {
      cwd: strayCwd,
      encoding: 'utf8',
      input: JSON.stringify({ hook_event_name: 'PreCompact', cwd: root, trigger: 'manual' }),
    });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });

  it('auto-detected PreCompact failures use exit 2 and stderr only', async () => {
    const root = await makeTempDir('checkpoint-precompact-stdin-failure-');

    const result = spawnSync(process.execPath, [checkpointScriptPath], {
      cwd: root,
      encoding: 'utf8',
      input: JSON.stringify({ hook_event_name: 'PreCompact', cwd: root, trigger: 'auto' }),
    });

    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /\[FAIL\] handoff\.exists/);
    assert.match(result.stderr, /Checkpoint blocked/);
  });

  it('keeps manual output when stdin is not a PreCompact event', async () => {
    const root = await makeTempDir('checkpoint-non-precompact-stdin-');
    await writeCheckpointState(root, new Date().toISOString());

    const result = spawnSync(process.execPath, [checkpointScriptPath], {
      cwd: root,
      encoding: 'utf8',
      input: JSON.stringify({ hook_event_name: 'Stop', cwd: root }),
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /\[OK \] handoff\.exists/);
    assert.equal(result.stderr, '');
  });

  it('blocks PreCompact with exit 2 and stderr only when checkpoint validation fails', async () => {
    const root = await makeTempDir('checkpoint-precompact-failure-');

    const result = spawnSync(process.execPath, [checkpointScriptPath, '--precompact-hook'], {
      cwd: root,
      encoding: 'utf8',
    });

    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /\[FAIL\] handoff\.exists/);
    assert.match(result.stderr, /Checkpoint blocked/);
  });

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

  it('exits successfully before state checks when harness hooks are disabled', async () => {
    const root = await makeTempDir('checkpoint-hooks-disabled-');

    const result = spawnSync(process.execPath, [checkpointScriptPath], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, VIBE_HARNESS_HOOKS: 'off' },
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /harness hooks disabled/);
    assert.equal(result.stderr, '');

    const hookResult = spawnSync(process.execPath, [checkpointScriptPath, '--precompact-hook'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, VIBE_HARNESS_HOOKS: 'off' },
    });

    assert.equal(hookResult.status, 0);
    assert.equal(hookResult.stdout, '');
    assert.equal(hookResult.stderr, '');
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

  describe('docs.integrity', () => {
    it('passes for tracked healthy boot docs and ignores missing GEMINI.md', async () => {
      const root = await makeTempDir('checkpoint-docs-healthy-');
      await writeCheckpointState(root, new Date().toISOString());
      await writeText(path.join(root, 'CLAUDE.md'), `# Claude\n\n${'healthy boot document content. '.repeat(4)}\n`);
      await writeText(path.join(root, 'docs', 'context', 'product.md'), `# Product\n\n${'healthy context shard content. '.repeat(4)}\n`);
      runGit(root, ['init']);
      runGit(root, ['config', 'user.email', 'checkpoint@example.test']);
      runGit(root, ['config', 'user.name', 'Checkpoint Test']);
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-m', 'initial docs']);

      const result = spawnSync(process.execPath, [checkpointScriptPath, '--json'], {
        cwd: root,
        encoding: 'utf8',
      });
      const docs = getRecord(result.stdout, 'docs.integrity');

      assert.equal(result.status, 0);
      assert.equal(docs.ok, true);
      assert.match(docs.detail, /checked=2 file\(s\)/);
      assert.doesNotMatch(docs.detail, /GEMINI\.md/);
    });

    it('fails when a tracked CLAUDE.md is truncated after commit', async () => {
      const root = await makeTempDir('checkpoint-docs-truncated-');
      await writeCheckpointState(root, new Date().toISOString());
      await writeText(path.join(root, 'CLAUDE.md'), `# Claude\n\n${'healthy boot document content. '.repeat(4)}\n`);
      runGit(root, ['init']);
      runGit(root, ['config', 'user.email', 'checkpoint@example.test']);
      runGit(root, ['config', 'user.name', 'Checkpoint Test']);
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-m', 'initial docs']);
      await writeText(path.join(root, 'CLAUDE.md'), '');

      const result = spawnSync(process.execPath, [checkpointScriptPath, '--json'], {
        cwd: root,
        encoding: 'utf8',
      });
      const docs = getRecord(result.stdout, 'docs.integrity');

      assert.equal(result.status, 1);
      assert.equal(docs.ok, false);
      assert.match(docs.detail, /CLAUDE\.md/);
    });

    it('passes when GEMINI.md is untracked even if present and empty', async () => {
      const root = await makeTempDir('checkpoint-docs-untracked-');
      await writeCheckpointState(root, new Date().toISOString());
      await writeText(path.join(root, 'CLAUDE.md'), `# Claude\n\n${'healthy boot document content. '.repeat(4)}\n`);
      runGit(root, ['init']);
      runGit(root, ['config', 'user.email', 'checkpoint@example.test']);
      runGit(root, ['config', 'user.name', 'Checkpoint Test']);
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-m', 'initial docs']);
      await writeText(path.join(root, 'GEMINI.md'), '');

      const result = spawnSync(process.execPath, [checkpointScriptPath, '--json'], {
        cwd: root,
        encoding: 'utf8',
      });
      const docs = getRecord(result.stdout, 'docs.integrity');

      assert.equal(result.status, 0);
      assert.equal(docs.ok, true);
      assert.doesNotMatch(docs.detail, /GEMINI\.md/);
    });

    it('fails when a tracked docs/context/product.md contains only whitespace', async () => {
      const root = await makeTempDir('checkpoint-docs-whitespace-');
      await writeCheckpointState(root, new Date().toISOString());
      await writeText(path.join(root, 'docs', 'context', 'product.md'), '  \n\t\n');
      runGit(root, ['init']);
      runGit(root, ['config', 'user.email', 'checkpoint@example.test']);
      runGit(root, ['config', 'user.name', 'Checkpoint Test']);
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-m', 'initial docs']);

      const result = spawnSync(process.execPath, [checkpointScriptPath, '--json'], {
        cwd: root,
        encoding: 'utf8',
      });
      const docs = getRecord(result.stdout, 'docs.integrity');

      assert.equal(result.status, 1);
      assert.equal(docs.ok, false);
      assert.match(docs.detail, /docs\/context\/product\.md/);
    });
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
