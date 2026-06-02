import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const tempDirs: string[] = [];
const scriptPath = path.resolve('.vibe', 'harness', 'scripts', 'vibe-init-ready.mjs');

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

async function writeText(root: string, relativePath: string, value: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, 'utf8');
}

async function writeJson(root: string, relativePath: string, value: unknown): Promise<void> {
  await writeText(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function runReady(root: string, json = true) {
  return spawnSync(process.execPath, [scriptPath, '--root', root, ...(json ? ['--json'] : [])], {
    cwd: root,
    encoding: 'utf8',
  });
}

async function scaffoldReadyProject(root: string): Promise<void> {
  spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });

  await writeJson(root, '.vibe/config.local.json', {
    sprintRoles: {
      planner: 'claude-opus',
      generator: 'codex',
      evaluator: 'claude-opus',
    },
  });
  await writeJson(root, '.vibe/agent/sprint-status.json', {
    project: {
      name: 'demo-project',
    },
  });
  await writeText(
    root,
    'docs/context/product.md',
    [
      '# Product context',
      '',
      'Demo project for verifying delegated initialization readiness.',
      '',
      '<!-- BEGIN:PROJECT:review-signals -->',
      'platforms = ["web"]',
      '<!-- END:PROJECT:review-signals -->',
      '',
    ].join('\n'),
  );
  await writeText(
    root,
    'docs/context/architecture.md',
    '# Architecture context\n\nUse TypeScript and a browser UI for the demo project.\n',
  );
  await writeText(
    root,
    'docs/context/conventions.md',
    '# Conventions\n\nKeep changes scoped and verify behavior with focused tests.\n',
  );
  await writeText(
    root,
    'docs/plans/sprint-roadmap.md',
    [
      '# Iteration 1 - demo-project',
      '',
      '## Sprint M1 - Build the first usable slice',
      '- id: sprint-M1-first-slice',
      '- goal: Create the initial app shell.',
      '',
    ].join('\n'),
  );
  await writeText(
    root,
    '.vibe/agent/session-log.md',
    '# Session Log\n\n- 2026-06-02T00:00:00.000Z [decision][sprint-roadmap-drafted] drafted roadmap\n',
  );
  await writeJson(root, '.vibe/interview-log/session.json', {
    phase: 'consensus',
    decision: 'proxy-unconfirmed',
  });
}

describe('vibe-init-ready', () => {
  it('fails an uninitialized delegated-agent checkout before Sprint/MVP work', async () => {
    const root = await makeTempDir('vibe-init-ready-uninitialized-');
    await writeText(root, 'docs/context/product.md', 'PROJECT NOT INITIALIZED.\n');

    const result = runReady(root);
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean;
      records: Array<{ id: string; ok: boolean; detail: string }>;
    };

    assert.equal(result.status, 1, result.stderr);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.records.find((record) => record.id === 'config.local')?.ok, false);
    assert.equal(parsed.records.find((record) => record.id === 'context.product')?.ok, false);
    assert.equal(parsed.records.find((record) => record.id === 'roadmap')?.ok, false);
    assert.equal(parsed.records.find((record) => record.id === 'git.repository')?.ok, false);
  });

  it('passes after Phase 2-4 initialization artifacts are project-owned', async () => {
    const root = await makeTempDir('vibe-init-ready-ready-');
    await scaffoldReadyProject(root);

    const result = runReady(root, false);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /\[vibe-init-ready] OK/);
  });

  it('rejects template-owned sprint status even when other artifacts exist', async () => {
    const root = await makeTempDir('vibe-init-ready-template-status-');
    await scaffoldReadyProject(root);
    await writeJson(root, '.vibe/agent/sprint-status.json', {
      project: {
        name: 'vibe-doctor',
      },
    });

    const result = runReady(root);
    const parsed = JSON.parse(result.stdout) as {
      records: Array<{ id: string; ok: boolean; detail: string }>;
    };

    assert.equal(result.status, 1);
    assert.equal(parsed.records.find((record) => record.id === 'sprint-status')?.ok, false);
  });
});
