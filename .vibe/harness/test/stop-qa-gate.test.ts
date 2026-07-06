import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const scriptPath = path.resolve('.vibe', 'harness', 'scripts', 'vibe-stop-qa-gate.mjs');
const hookEntryPoints = [
  '.vibe/harness/scripts/vibe-stop-qa-gate.mjs',
  '.vibe/harness/scripts/vibe-agent-session-start.mjs',
  '.vibe/harness/scripts/vibe-attention-notify.mjs',
  '.vibe/harness/scripts/vibe-checkpoint.mjs',
  '.vibe/harness/src/commands/audit-config.ts',
];
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

function git(root: string, ...args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

async function writeText(filePath: string, value: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, 'utf8');
}

describe('vibe-stop-qa-gate', () => {
  it('skips QA work when harness hooks are disabled', async () => {
    const root = await makeTempDir('stop-qa-gate-disabled-');
    git(root, 'init');
    await writeText(
      path.join(root, 'package.json'),
      `${JSON.stringify({
        scripts: {
          'vibe:qa': 'node qa-fail.mjs',
        },
      }, null, 2)}\n`,
    );
    await writeText(path.join(root, 'node_modules', 'tsx', 'package.json'), '{"name":"tsx"}\n');
    await writeText(path.join(root, 'qa-fail.mjs'), "console.log('QA_SHOULD_NOT_RUN');\nprocess.exit(9);\n");
    await writeText(path.join(root, 'src', 'changed.ts'), 'export const changed = true;\n');

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, VIBE_HARNESS_HOOKS: 'off' },
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /harness hooks disabled/);
    assert.doesNotMatch(result.stdout, /QA_SHOULD_NOT_RUN/);
    assert.equal(result.stderr, '');
    assert.equal(existsSync(path.join(root, '.vibe', 'runs')), false);
  });

  it('keeps the harness hook kill-switch wired into every hook entrypoint', async () => {
    for (const hookEntryPoint of hookEntryPoints) {
      const content = await readFile(path.resolve(hookEntryPoint), 'utf8');
      assert.match(content, /VIBE_HARNESS_HOOKS/, hookEntryPoint);
    }
  });

  it('captures verbose QA output to a log and prints only a concise failure summary', async () => {
    const root = await makeTempDir('stop-qa-gate-');
    git(root, 'init');
    await writeText(
      path.join(root, 'package.json'),
      `${JSON.stringify({
        scripts: {
          'vibe:qa': 'node qa-fail.mjs',
        },
      }, null, 2)}\n`,
    );
    await writeText(path.join(root, 'node_modules', 'tsx', 'package.json'), '{"name":"tsx"}\n');
    await writeText(
      path.join(root, 'qa-fail.mjs'),
      [
        "console.log('LONG_STDOUT_LINE_SHOULD_ONLY_BE_IN_LOG');",
        "console.error('LONG_STDERR_LINE_SHOULD_ONLY_BE_IN_LOG');",
        'process.exit(7);',
        '',
      ].join('\n'),
    );
    await writeText(path.join(root, 'src', 'changed.ts'), 'export const changed = true;\n');

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, VIBE_HARNESS_HOOKS: 'on' },
    });

    assert.equal(result.status, 7);
    assert.match(result.stdout, /\[vibe-qa\] run: .*src\/changed\.ts/);
    assert.match(result.stderr, /\[vibe-qa\] fail: exit=7 log=\.vibe\/runs\/\d{4}-\d{2}-\d{2}\/stop-qa-/);
    assert.doesNotMatch(result.stdout, /LONG_STDOUT_LINE_SHOULD_ONLY_BE_IN_LOG/);
    assert.doesNotMatch(result.stderr, /LONG_STDERR_LINE_SHOULD_ONLY_BE_IN_LOG/);

    const logMatch = result.stderr.match(/log=([^\s]+)/);
    assert.ok(logMatch?.[1]);
    const log = await readFile(path.join(root, logMatch[1]), 'utf8');
    assert.match(log, /LONG_STDOUT_LINE_SHOULD_ONLY_BE_IN_LOG/);
    assert.match(log, /LONG_STDERR_LINE_SHOULD_ONLY_BE_IN_LOG/);
    assert.match(log, /exit: 7/);
  });

  it('prints a concise success summary and stores QA output in the same log location', async () => {
    const root = await makeTempDir('stop-qa-gate-ok-');
    git(root, 'init');
    await writeText(
      path.join(root, 'package.json'),
      `${JSON.stringify({
        scripts: {
          'vibe:qa': 'node qa-ok.mjs',
        },
      }, null, 2)}\n`,
    );
    await writeText(path.join(root, 'node_modules', 'tsx', 'package.json'), '{"name":"tsx"}\n');
    await writeText(path.join(root, 'qa-ok.mjs'), "console.log('QA_OK_LOG_ONLY');\n");
    await writeText(path.join(root, 'src', 'changed.ts'), 'export const changed = true;\n');

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: root,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /\[vibe-qa\] ok: log=\.vibe\/runs\/\d{4}-\d{2}-\d{2}\/stop-qa-/);
    assert.doesNotMatch(result.stdout, /QA_OK_LOG_ONLY/);

    const logMatch = result.stdout.match(/log=([^\s]+)/);
    assert.ok(logMatch?.[1]);
    const log = await readFile(path.join(root, logMatch[1]), 'utf8');
    assert.match(log, /QA_OK_LOG_ONLY/);
    assert.match(log, /exit: 0/);
  });
});
