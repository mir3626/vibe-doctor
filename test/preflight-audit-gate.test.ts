import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const tempDirs: string[] = [];
const preflightPath = path.resolve('scripts', 'vibe-preflight.mjs');

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

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function scaffoldRepo(
  root: string,
  options: {
    sprintsSinceLastAudit?: number;
    pendingRisks?: Array<Record<string, unknown>>;
  } = {},
): Promise<void> {
  await mkdir(path.join(root, '.vibe', 'agent'), { recursive: true });
  await mkdir(path.join(root, 'docs', 'context'), { recursive: true });
  await writeJson(path.join(root, '.vibe', 'config.json'), {
    harnessVersion: '1.4.0',
    harnessVersionInstalled: '1.4.0',
    sprintRoles: {},
    providers: {},
    audit: {
      everyN: 5,
    },
  });
  await writeJson(path.join(root, '.vibe', 'agent', 'sprint-status.json'), {
    schemaVersion: '0.1',
    project: {
      name: 'test-project',
      createdAt: '2026-04-01T00:00:00.000Z',
    },
    sprints: [],
    verificationCommands: [],
    pendingRisks: options.pendingRisks ?? [],
    lastSprintScope: [],
    lastSprintScopeGlob: [],
    sprintsSinceLastAudit: options.sprintsSinceLastAudit ?? 0,
    stateUpdatedAt: new Date().toISOString(),
  });
  await writeFile(path.join(root, '.vibe', 'agent', 'handoff.md'), '# handoff\n', 'utf8');
  await writeFile(path.join(root, '.vibe', 'agent', 'session-log.md'), '# Session Log\n\n## Entries\n', 'utf8');
  await writeFile(
    path.join(root, 'docs', 'context', 'product.md'),
    'This stub product document is intentionally long enough to satisfy the phase zero gate in tests.\n',
    'utf8',
  );

  for (const args of [
    ['init'],
    ['config', 'user.name', 'Test User'],
    ['config', 'user.email', 'test@example.com'],
    ['add', '.'],
    ['commit', '-m', 'init'],
  ]) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
}

function runPreflight(root: string, args: string[] = []) {
  return spawnSync(process.execPath, [preflightPath, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

describe('vibe-preflight audit gate', () => {
  it('fails when sprintsSinceLastAudit reaches the configured threshold', async () => {
    const root = await makeTempDir('preflight-audit-count-');
    await scaffoldRepo(root, { sprintsSinceLastAudit: 10 });

    const result = runPreflight(root);

    assert.equal(result.status, 1);
    assert.match(result.stdout, /\[FAIL\] audit\.overdue/);
  });

  it('fails when open audit pendingRisks exist', async () => {
    const root = await makeTempDir('preflight-audit-risk-');
    await scaffoldRepo(root, {
      pendingRisks: [
        {
          id: 'audit-required',
          raisedBy: 'test',
          targetSprint: '*',
          text: 'audit required',
          status: 'open',
          createdAt: '2026-04-01T00:00:00.000Z',
        },
      ],
    });

    const result = runPreflight(root);

    assert.equal(result.status, 1);
    assert.match(result.stdout, /\[FAIL\] audit\.overdue/);
  });

  it('allows explicit audit acknowledgement and appends a decision log entry', async () => {
    const root = await makeTempDir('preflight-audit-ack-');
    await scaffoldRepo(root, { sprintsSinceLastAudit: 10 });

    const result = runPreflight(root, ['--ack-audit-overdue=sprint-test:manual-review']);
    const sessionLog = await readFile(path.join(root, '.vibe', 'agent', 'session-log.md'), 'utf8');

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /\[WARN\] audit\.overdue/);
    assert.match(sessionLog, /\[decision\]\[audit-ack\] sprint=sprint-test reason=manual-review/);
  });

  it('skips the audit gate in bootstrap mode', async () => {
    const root = await makeTempDir('preflight-audit-bootstrap-');
    await scaffoldRepo(root, { sprintsSinceLastAudit: 10 });

    const result = runPreflight(root, ['--bootstrap']);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /\[OK \] audit\.overdue - bootstrap mode/);
  });
});
