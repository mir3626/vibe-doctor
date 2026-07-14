import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
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

type GateState = {
  schemaVersion?: number;
  fingerprint?: string;
  result?: 'success' | 'failure';
  exitCode?: number;
  logPath?: string;
  completedAt?: string;
  reportedAt?: string;
};

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

async function prepareFixture(root: string, selfTestSource: string): Promise<void> {
  git(root, 'init');
  await writeText(
    path.join(root, 'package.json'),
    `${JSON.stringify({
      scripts: {
        'vibe:typecheck': 'node qa-typecheck.mjs',
        'vibe:self-test': 'node qa-self-test.mjs',
        'vibe:qa': 'node product-qa-should-not-run.mjs',
      },
    }, null, 2)}\n`,
  );
  await writeText(path.join(root, '.gitignore'), 'node_modules/\n.vibe/runs/\nqa-count.txt\n');
  await writeText(path.join(root, 'node_modules', 'tsx', 'package.json'), '{"name":"tsx"}\n');
  await writeText(path.join(root, 'qa-typecheck.mjs'), "console.log('TYPECHECK_OK');\n");
  await writeText(path.join(root, 'qa-self-test.mjs'), selfTestSource);
  await writeText(
    path.join(root, 'product-qa-should-not-run.mjs'),
    [
      "import { writeFileSync } from 'node:fs';",
      "writeFileSync('product-qa-ran.txt', 'true');",
      'process.exit(9);',
      '',
    ].join('\n'),
  );
  await writeText(
    path.join(root, '.vibe', 'sync-manifest.json'),
    `${JSON.stringify({
      files: {
        harness: ['.vibe/harness/**', '.codex/agents/**'],
        hybrid: { '.claude/settings.json': { strategy: 'json-deep-merge' } },
      },
    }, null, 2)}\n`,
  );
  await writeText(path.join(root, '.vibe', 'harness', 'src', 'baseline.ts'), 'export const baseline = true;\n');
  git(root, 'add', '.');
  git(
    root,
    '-c',
    'user.name=Vibe Test',
    '-c',
    'user.email=vibe-test@example.invalid',
    'commit',
    '-m',
    'fixture baseline',
  );
}

function runHook(root: string, cwd = root): { elapsedMs: number; result: ReturnType<typeof spawnSync> } {
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [scriptPath, '--hook'], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, VIBE_HARNESS_HOOKS: 'on' },
  });
  return { elapsedMs: Date.now() - startedAt, result };
}

async function readState(root: string): Promise<GateState | null> {
  try {
    return JSON.parse(
      await readFile(path.join(root, '.vibe', 'runs', 'stop-harness-qa-state.json'), 'utf8'),
    ) as GateState;
  } catch {
    return null;
  }
}

async function waitForState(
  root: string,
  predicate: (state: GateState) => boolean,
  timeoutMs = 10_000,
): Promise<GateState> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await readState(root);
    if (state && predicate(state)) {
      return state;
    }
    await delay(50);
  }
  assert.fail(`timed out waiting for Stop QA state in ${root}`);
}

async function waitForLeaseRelease(root: string, timeoutMs = 5_000): Promise<void> {
  const target = path.join(root, '.vibe', 'runs', 'stop-harness-qa-worker.lock');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!existsSync(target)) {
      return;
    }
    await delay(25);
  }
  assert.fail(`timed out waiting for Stop QA worker lease release in ${root}`);
}

describe('vibe-stop-qa-gate', () => {
  it('skips QA work when harness hooks are disabled', async () => {
    const root = await makeTempDir('stop-qa-gate-disabled-');
    await prepareFixture(root, 'process.exit(9);\n');
    await writeText(path.join(root, '.vibe', 'harness', 'src', 'changed.ts'), 'export const changed = true;\n');

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, VIBE_HARNESS_HOOKS: 'off' },
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /harness hooks disabled/);
    assert.equal(result.stderr, '');
    assert.equal(existsSync(path.join(root, '.vibe', 'runs')), false);

    const hookResult = spawnSync(process.execPath, [scriptPath, '--hook'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, VIBE_HARNESS_HOOKS: 'off' },
    });
    assert.equal(hookResult.status, 0);
    assert.equal(hookResult.stdout, '');
    assert.equal(hookResult.stderr, '');
  });

  it('keeps the harness hook kill-switch wired into every hook entrypoint', async () => {
    for (const hookEntryPoint of hookEntryPoints) {
      const content = await readFile(path.resolve(hookEntryPoint), 'utf8');
      assert.match(content, /VIBE_HARNESS_HOOKS/, hookEntryPoint);
    }
  });

  it('runs nested harness QA hidden, without a shell, and with lifecycle isolation', async () => {
    const source = await readFile(scriptPath, 'utf8');
    assert.match(source, /VIBE_SKIP_AGENT_SESSION_START:\s*'1'/);
    assert.match(source, /shell:\s*false/);
    assert.match(source, /windowsHide:\s*true/);
    assert.doesNotMatch(source, /shell:\s*true/);

    const root = await makeTempDir('stop-qa-gate-isolated-');
    await prepareFixture(
      root,
      [
        "if (process.env.VIBE_SKIP_AGENT_SESSION_START !== '1') process.exit(10);",
        'if (process.env.CLAUDE_PROJECT_DIR) process.exit(11);',
        "console.log('ISOLATED_HARNESS_QA');",
        '',
      ].join('\n'),
    );
    await writeText(path.join(root, '.vibe', 'harness', 'src', 'changed.ts'), 'export const changed = true;\n');

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: 'C:\\should-not-leak',
        VIBE_HARNESS_HOOKS: 'on',
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const logMatch = result.stdout.match(/log=([^\s]+)/);
    assert.ok(logMatch?.[1]);
    const log = await readFile(path.join(root, logMatch[1]), 'utf8');
    assert.match(log, /ISOLATED_HARNESS_QA/);
  });

  it('does not schedule harness QA for product-only changes', async () => {
    const root = await makeTempDir('stop-qa-gate-product-only-');
    await prepareFixture(root, 'process.exit(9);\n');
    await writeText(path.join(root, 'src', 'product.ts'), 'export const product = true;\n');

    const { result } = runHook(root);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    assert.equal(existsSync(path.join(root, '.vibe', 'runs')), false);
    assert.equal(existsSync(path.join(root, 'product-qa-ran.txt')), false);

    const manual = spawnSync(process.execPath, [scriptPath], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, VIBE_HARNESS_HOOKS: 'on' },
    });
    assert.equal(manual.status, 0);
    assert.match(manual.stdout, /skip: no harness-owned changes/);
  });

  it('captures verbose manual harness QA output and preserves the failing exit status', async () => {
    const root = await makeTempDir('stop-qa-gate-manual-fail-');
    await prepareFixture(
      root,
      [
        "import { existsSync, readFileSync, writeFileSync } from 'node:fs';",
        "const count = existsSync('qa-count.txt') ? Number(readFileSync('qa-count.txt', 'utf8')) : 0;",
        "writeFileSync('qa-count.txt', String(count + 1));",
        "console.log('LONG_STDOUT_LINE_SHOULD_ONLY_BE_IN_LOG');",
        "console.error('LONG_STDERR_LINE_SHOULD_ONLY_BE_IN_LOG');",
        'process.exit(7);',
        '',
      ].join('\n'),
    );
    await writeText(path.join(root, '.vibe', 'harness', 'src', 'changed.ts'), 'export const changed = true;\n');

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, VIBE_HARNESS_HOOKS: 'on' },
    });

    assert.equal(result.status, 7);
    assert.match(result.stdout, /\[vibe-harness-qa\] run: .*\.vibe\/harness\/src\/changed\.ts/);
    assert.match(
      result.stderr,
      /\[vibe-harness-qa\] fail: exit=7 log=\.vibe\/runs\/\d{4}-\d{2}-\d{2}\/stop-harness-qa-/,
    );
    assert.doesNotMatch(result.stdout, /LONG_STDOUT_LINE_SHOULD_ONLY_BE_IN_LOG/);
    assert.doesNotMatch(result.stderr, /LONG_STDERR_LINE_SHOULD_ONLY_BE_IN_LOG/);
    assert.equal(existsSync(path.join(root, 'product-qa-ran.txt')), false);

    const logMatch = result.stderr.match(/log=([^\s]+)/);
    assert.ok(logMatch?.[1]);
    const log = await readFile(path.join(root, logMatch[1]), 'utf8');
    assert.match(log, /LONG_STDOUT_LINE_SHOULD_ONLY_BE_IN_LOG/);
    assert.match(log, /LONG_STDERR_LINE_SHOULD_ONLY_BE_IN_LOG/);
    assert.match(log, /commands: npm run vibe:typecheck; npm run vibe:self-test/);
    assert.match(log, /exit: 7/);

    const retry = spawnSync(process.execPath, [scriptPath], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, VIBE_HARNESS_HOOKS: 'on' },
    });
    assert.equal(retry.status, 7);
    assert.equal(await readFile(path.join(root, 'qa-count.txt'), 'utf8'), '2');
    const state = await readState(root);
    assert.equal(state?.schemaVersion, 2);
    assert.equal(state?.result, 'failure');
  });

  it('returns before background failure and reports it once as valid Stop JSON', async () => {
    const root = await makeTempDir('stop-qa-gate-hook-fail-');
    const strayCwd = await makeTempDir('stop-qa-gate-hook-stray-');
    await prepareFixture(
      root,
      [
        "import { setTimeout as delay } from 'node:timers/promises';",
        "import { writeFileSync } from 'node:fs';",
        'await delay(1_500);',
        "writeFileSync('qa-count.txt', '1');",
        "console.error('BACKGROUND_FAILURE_LOG_ONLY');",
        'process.exit(7);',
        '',
      ].join('\n'),
    );
    await writeText(path.join(root, '.vibe', 'harness', 'src', 'changed.ts'), 'export const changed = true;\n');

    const first = runHook(root, strayCwd);
    assert.equal(first.result.status, 0);
    assert.equal(first.result.stdout, '');
    assert.equal(first.result.stderr, '');
    assert.equal(existsSync(path.join(root, 'qa-count.txt')), false);

    const failed = await waitForState(root, (state) => state.result === 'failure');
    assert.equal(failed.exitCode, 7);
    assert.match(failed.logPath ?? '', /^\.vibe\/runs\/\d{4}-\d{2}-\d{2}\/stop-harness-qa-/);
    assert.equal(await readFile(path.join(root, 'qa-count.txt'), 'utf8'), '1');
    assert.equal(existsSync(path.join(root, 'product-qa-ran.txt')), false);
    const log = await readFile(path.join(root, failed.logPath ?? ''), 'utf8');
    assert.match(log, /BACKGROUND_FAILURE_LOG_ONLY/);
    await waitForLeaseRelease(root);

    const detectedEnv: NodeJS.ProcessEnv = { ...process.env, VIBE_HARNESS_HOOKS: 'on' };
    delete detectedEnv.CLAUDE_PROJECT_DIR;
    const warning = spawnSync(process.execPath, [scriptPath], {
      cwd: strayCwd,
      encoding: 'utf8',
      env: detectedEnv,
      input: JSON.stringify({ hook_event_name: 'Stop', cwd: root, stop_hook_active: false }),
    });
    assert.equal(warning.status, 0);
    assert.equal(warning.stderr, '');
    const output = JSON.parse(warning.stdout) as { systemMessage?: string };
    assert.match(output.systemMessage ?? '', /background fail: exit=7 log=\.vibe\/runs\//);

    const duplicate = runHook(root);
    assert.equal(duplicate.result.status, 0);
    assert.equal(duplicate.result.stdout, '');
    assert.equal(duplicate.result.stderr, '');
    assert.equal(await readFile(path.join(root, 'qa-count.txt'), 'utf8'), '1');
    assert.equal(typeof (await readState(root))?.reportedAt, 'string');
  });

  it('deduplicates background work, caches success, and ignores product-only invalidation', async () => {
    const root = await makeTempDir('stop-qa-gate-hook-ok-');
    await prepareFixture(
      root,
      [
        "import { setTimeout as delay } from 'node:timers/promises';",
        "import { existsSync, readFileSync, writeFileSync } from 'node:fs';",
        "if (process.env.CLAUDE_PROJECT_DIR) { console.error('LEAKED_HOOK_PROJECT_ROOT'); process.exit(8); }",
        "if (process.env.VIBE_SKIP_AGENT_SESSION_START !== '1') { console.error('SESSION_START_NOT_ISOLATED'); process.exit(9); }",
        'await delay(1_500);',
        "const count = existsSync('qa-count.txt') ? Number(readFileSync('qa-count.txt', 'utf8')) : 0;",
        "writeFileSync('qa-count.txt', String(count + 1));",
        "console.log('BACKGROUND_SUCCESS_LOG_ONLY');",
        '',
      ].join('\n'),
    );
    const harnessFile = path.join(root, '.vibe', 'harness', 'src', 'changed.ts');
    await writeText(harnessFile, 'export const changed = true;\n');
    await writeText(
      path.join(root, '.vibe', 'runs', 'stop-harness-qa-worker.lock'),
      `${JSON.stringify({ fingerprint: 'stale', startedAt: '2000-01-01T00:00:00.000Z' })}\n`,
    );

    const first = runHook(root);
    assert.equal(existsSync(path.join(root, 'qa-count.txt')), false);
    const duplicate = runHook(root);
    for (const invocation of [first, duplicate]) {
      assert.equal(invocation.result.status, 0);
      assert.equal(invocation.result.stdout, '');
      assert.equal(invocation.result.stderr, '');
    }

    const firstState = await waitForState(root, (state) => state.result === 'success');
    assert.equal(firstState.schemaVersion, 2);
    assert.match(firstState.fingerprint ?? '', /^[a-f0-9]{64}$/);
    assert.equal(await readFile(path.join(root, 'qa-count.txt'), 'utf8'), '1');
    assert.equal(existsSync(path.join(root, 'product-qa-ran.txt')), false);
    await waitForLeaseRelease(root);

    const cacheHit = runHook(root);
    assert.equal(cacheHit.result.status, 0);
    assert.equal(cacheHit.result.stdout, '');
    assert.equal(cacheHit.result.stderr, '');
    await delay(200);
    assert.equal(await readFile(path.join(root, 'qa-count.txt'), 'utf8'), '1');

    await writeText(path.join(root, 'src', 'product.ts'), 'export const product = true;\n');
    const productChange = runHook(root);
    assert.equal(productChange.result.status, 0);
    assert.equal(productChange.result.stdout, '');
    assert.equal(productChange.result.stderr, '');
    await delay(200);
    assert.equal(await readFile(path.join(root, 'qa-count.txt'), 'utf8'), '1');

    await writeText(harnessFile, 'export const changed = false;\n');
    const harnessChange = runHook(root);
    assert.equal(harnessChange.result.status, 0);
    assert.equal(harnessChange.result.stdout, '');
    assert.equal(harnessChange.result.stderr, '');
    const secondState = await waitForState(
      root,
      (state) => state.result === 'success' && state.fingerprint !== firstState.fingerprint,
    );
    assert.notEqual(secondState.fingerprint, firstState.fingerprint);
    assert.equal(await readFile(path.join(root, 'qa-count.txt'), 'utf8'), '2');
    assert.equal(existsSync(path.join(root, 'product-qa-ran.txt')), false);
    await waitForLeaseRelease(root);
  });
});
