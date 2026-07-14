import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  findViolations,
  forbiddenPatterns,
} from '../src/commands/audit-config.js';
import { selectQaScripts, QA_SCRIPT_ORDER, isHarnessQaScript } from '../src/commands/qa.js';
import { renderReport } from '../src/lib/report.js';

// ---------- audit-config.findViolations ----------

test('findViolations flags .env but leaves .env.example alone', () => {
  const tracked = ['.env', '.env.example', '.env.local', 'README.md'];
  assert.deepEqual(findViolations(tracked), ['.env', '.env.local']);
});

test('findViolations treats slash-terminated patterns as directory prefixes', () => {
  const tracked = [
    'secrets/key.pem',
    'secrets/nested/also.key',
    'secretsfile.txt',
  ];
  assert.deepEqual(findViolations(tracked, ['secrets/']), [
    'secrets/key.pem',
    'secrets/nested/also.key',
  ]);
});

test('findViolations requires exact match for file patterns', () => {
  // `.env` must not match `.envrc` or `dotenv` — this is the regression
  // we introduced and fixed in Sprint A.
  const tracked = ['.envrc', 'dotenv', 'fake.env', '.env'];
  assert.deepEqual(findViolations(tracked, ['.env']), ['.env']);
});

test('findViolations returns empty array for a clean tree', () => {
  const tracked = ['README.md', '.env.example', 'src/index.ts', 'docs/a.md'];
  assert.deepEqual(findViolations(tracked, forbiddenPatterns), []);
});

test('findViolations handles empty input', () => {
  assert.deepEqual(findViolations([], forbiddenPatterns), []);
});

test('config-audit hook binds to CLAUDE_PROJECT_DIR and emits only valid hook output', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'config-audit-hook-root-'));
  const strayCwd = await mkdtemp(path.join(tmpdir(), 'config-audit-hook-stray-'));
  const auditPath = path.resolve('.vibe/harness/src/commands/audit-config.ts');
  const tsxPath = path.resolve('node_modules/tsx/dist/cli.mjs');
  const run = (explicitHook = true) => {
    const env = { ...process.env };
    if (explicitHook) {
      env.CLAUDE_PROJECT_DIR = root;
    } else {
      delete env.CLAUDE_PROJECT_DIR;
    }
    const hookArgs = explicitHook ? ' -- --hook' : '';
    return spawnSync(`npm --prefix "${root}" run --silent vibe:config-audit${hookArgs}`, {
      cwd: strayCwd,
      encoding: 'utf8',
      env,
      input: JSON.stringify({ hook_event_name: 'PostToolUse', cwd: root, tool_name: 'Edit' }),
      shell: true,
    });
  };

  try {
    assert.equal(spawnSync('git', ['init'], { cwd: root }).status, 0);
    await writeFile(path.join(root, 'package.json'), `${JSON.stringify({
      scripts: {
        'vibe:config-audit': `node "${tsxPath}" "${auditPath}"`,
      },
    })}\n`, 'utf8');
    const clean = run();
    assert.equal(clean.status, 0, JSON.stringify({
      error: clean.error?.message,
      stdout: clean.stdout,
      stderr: clean.stderr,
    }));
    assert.equal(clean.stdout, '');
    assert.equal(clean.stderr, '');

    const auditLog = path.join(root, '.vibe', 'runs', new Date().toISOString().slice(0, 10), 'audit.jsonl');
    assert.deepEqual(JSON.parse((await readFile(auditLog, 'utf8')).trim()).violations, []);

    const detectedClean = run(false);
    assert.equal(detectedClean.status, 0, detectedClean.stderr);
    assert.equal(detectedClean.stdout, '');
    assert.equal(detectedClean.stderr, '');

    await writeFile(path.join(root, '.env'), 'SECRET=fixture\n', 'utf8');
    assert.equal(spawnSync('git', ['add', '-f', '.env'], { cwd: root }).status, 0);
    const violation = run();
    assert.equal(violation.status, 0, violation.stderr);
    assert.equal(violation.stderr, '');
    assert.match((JSON.parse(violation.stdout) as { systemMessage?: string }).systemMessage ?? '', /\.env/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(strayCwd, { recursive: true, force: true });
  }
});

// ---------- qa.selectQaScripts ----------

test('selectQaScripts returns matches in canonical order, not input order', () => {
  const scripts = {
    build: 'tsc',
    lint: 'eslint .',
    test: 'node --test',
    typecheck: 'tsc --noEmit',
  };
  assert.deepEqual(selectQaScripts(scripts), [
    'test',
    'typecheck',
    'lint',
    'build',
  ]);
});

test('selectQaScripts skips missing scripts silently', () => {
  assert.deepEqual(selectQaScripts({ test: 'jest' }), ['test']);
});

test('selectQaScripts returns empty when nothing matches', () => {
  assert.deepEqual(selectQaScripts({ 'custom:one': 'echo 1' }), []);
});

test('selectQaScripts handles undefined scripts map', () => {
  assert.deepEqual(selectQaScripts(undefined), []);
});

test('QA_SCRIPT_ORDER prioritises fast signals before full build', () => {
  // test:unit must come before test, and build must come last — any
  // reorder will silently change vibe:qa execution behaviour.
  assert.equal(QA_SCRIPT_ORDER[0], 'test:unit');
  assert.equal(QA_SCRIPT_ORDER.at(-1), 'build');
});

test('selectQaScripts can skip harness-owned aliases for initialized downstream projects', () => {
  const scripts = {
    build: 'npm run vibe:build',
    lint: 'eslint .',
    test: 'npm run vibe:self-test',
    'test:unit': 'vitest run src/foo.test.ts',
    typecheck: 'tsc --noEmit',
  };

  assert.deepEqual(selectQaScripts(scripts, { skipHarnessScripts: true }), [
    'test:unit',
    'typecheck',
    'lint',
  ]);
});

test('selectQaScripts keeps harness aliases when the caller does not request filtering', () => {
  assert.deepEqual(selectQaScripts({ test: 'npm run vibe:self-test' }), ['test']);
});

test('isHarnessQaScript identifies harness self-tests without blocking project smoke wrappers', () => {
  assert.equal(isHarnessQaScript('npm run vibe:self-test'), true);
  assert.equal(isHarnessQaScript('tsc -p .vibe/harness/tsconfig.harness.json --noEmit'), true);
  assert.equal(isHarnessQaScript('node --import tsx --test .vibe/harness/test/*.test.ts'), true);
  assert.equal(isHarnessQaScript('node .vibe/harness/scripts/vibe-playwright-test.mjs'), true);
  assert.equal(isHarnessQaScript('npm run vibe:browser-smoke'), false);
  assert.equal(isHarnessQaScript('vitest run'), false);
});

// ---------- report.renderReport ----------

test('renderReport emits every section with a trailing newline', () => {
  const md = renderReport({
    title: 'Sprint X',
    summary: 'did a thing',
    changed: ['a.ts', 'b.ts'],
    qa: ['typecheck', 'test'],
    risks: ['rollback risk'],
    context: ['updated conventions.md'],
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
  });

  assert.ok(md.startsWith('# Sprint X\n'));
  assert.ok(md.endsWith('\n'));
  assert.match(md, /## Summary\ndid a thing/);
  assert.match(md, /## Changed\n- a\.ts\n- b\.ts/);
  assert.match(md, /## QA\n- typecheck\n- test/);
  assert.match(md, /## Risks\n- rollback risk/);
  assert.match(md, /## Context updates\n- updated conventions\.md/);
  assert.match(md, /## Usage\n- input: 10, output: 20, total: 30/);
});

test('renderReport falls back to placeholders for missing fields', () => {
  const md = renderReport({ title: 't', summary: 's' });
  assert.match(md, /## Changed\n- n\/a/);
  assert.match(md, /## QA\n- n\/a/);
  assert.match(md, /## Risks\n- n\/a/);
  assert.match(md, /## Context updates\n- none/);
  assert.match(md, /## Usage\n- unavailable/);
});

test('renderReport treats empty arrays the same as missing fields', () => {
  const md = renderReport({
    title: 't',
    summary: 's',
    changed: [],
    qa: [],
    risks: [],
    context: [],
  });
  assert.match(md, /## Changed\n- n\/a/);
  assert.match(md, /## Context updates\n- none/);
});
