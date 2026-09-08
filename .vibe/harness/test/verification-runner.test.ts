import assert from 'node:assert/strict';
import { execFile as execFileCallback, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { promisify } from 'node:util';
import {
  computeGroupInputHash,
  listHarnessTestFiles,
  matchesPathPattern,
  readSuccessfulReceipt,
  selectVerificationGroups,
  validateVerificationManifest,
  type VerificationGroup,
  type VerificationManifest,
  type VerificationReceipt,
} from '../src/commands/verify.js';

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

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'vibe-verify-'));
  tempDirs.push(directory);
  return directory;
}

function group(
  id: string,
  runner: 'command' | 'node-test',
  overrides: Partial<VerificationGroup> = {},
): VerificationGroup {
  return {
    id,
    description: id,
    tier: runner === 'command' ? 'fast' : 'workflow',
    runner,
    ...(runner === 'command'
      ? { command: ['{node}', '-e', 'process.exit(0)'] }
      : { testFiles: [`.vibe/harness/test/${id}.test.ts`] }),
    inputPatterns: [`.vibe/harness/src/${id}/**`],
    impactPatterns: [`.vibe/harness/src/${id}/**`],
    ...overrides,
  };
}

function manifest(groups: VerificationGroup[]): VerificationManifest {
  return {
    schemaVersion: 'vibe-test-groups-v1',
    globalInputPatterns: ['package.json'],
    globalInvalidatorPatterns: ['package.json'],
    sharedInputPatterns: ['.vibe/harness/src/lib/**'],
    sharedImpactPatterns: ['.vibe/harness/src/lib/**'],
    environmentKeys: [],
    groups,
  };
}

describe('verification group manifest and planner', () => {
  it('keeps passing groups after a later failure and rejects mutation of reused inputs', async () => {
    const root = await makeTempDir();
    const verifyPath = path.resolve('.vibe/harness/src/commands/verify.ts');
    await mkdir(path.join(root, '.vibe/harness/test'), { recursive: true });
    await mkdir(path.join(root, '.vibe/harness/src/early'), { recursive: true });
    await writeFile(path.join(root, 'package.json'), '{"type":"module"}\n');
    await writeFile(path.join(root, '.gitignore'), 'node_modules/\n.vibe/runs/\n');
    await symlink(path.resolve('node_modules'), path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const input = '.vibe/harness/src/early/value.txt';
    await writeFile(path.join(root, input), 'initial');
    await writeFile(path.join(root, '.vibe/harness/test/early.test.ts'), "import { appendFileSync } from 'node:fs'; appendFileSync('early-runs.txt', 'run\\n');\n");
    const late = path.join(root, '.vibe/harness/test/late.test.ts');
    await writeFile(late, "throw new Error('fixture failure');\n");
    await writeFile(path.join(root, '.vibe/harness/test/groups.json'), JSON.stringify(manifest([group('early', 'node-test'), group('late', 'node-test')])));
    await execFile('git', ['init'], { cwd: root, windowsHide: true });
    const run = (args: string[] = []) => spawnSync(process.execPath,
      ['--import', 'tsx', verifyPath, '--root', root, '--all', ...args],
      { env: { ...process.env, VIBE_VERIFY_BASE: '' }, encoding: 'utf8', windowsHide: true });
    const failed = run(['--force']);
    assert.notEqual(failed.status, 0, failed.stdout + failed.stderr);
    assert.match(failed.stderr, /verification group failed: late/);
    const planResult = run(['--plan', '--json']);
    assert.equal(planResult.status, 0, planResult.stderr);
    const plan = JSON.parse(planResult.stdout);
    assert.equal(plan.groups[0].action, 'reuse');
    assert.equal(plan.groups[1].action, 'run');
    const earlyReceipt = path.join(root, plan.groups[0].receiptPath);
    await writeFile(late, 'export {};\n');
    const repaired = run();
    assert.equal(repaired.status, 0, repaired.stderr);
    assert.equal(await readFile(path.join(root, 'early-runs.txt'), 'utf8'), 'run\n');
    await writeFile(late, `import { writeFileSync } from 'node:fs'; writeFileSync('${input}', 'mutated');\n`);
    const mutated = run();
    assert.notEqual(mutated.status, 0);
    assert.match(mutated.stderr, /verification inputs changed during execution: early/);
    await assert.rejects(readFile(earlyReceipt), { code: 'ENOENT' });
  });

  it('repairs corrupt receipts, ignores ambient Pro bases, and rejects changing inputs in both profiles', async () => {
    const verifyPath = path.resolve('.vibe/harness/src/commands/verify.ts');
    for (const model of ['gpt-5.5', 'gpt-6-astra']) {
      const root = await makeTempDir();
      await mkdir(path.join(root, '.vibe/harness/test'), { recursive: true });
      await mkdir(path.join(root, '.vibe/harness/src/probe'), { recursive: true });
      await mkdir(path.join(root, '.vibe/agent/pro-roundtrip'), { recursive: true });
      await writeFile(path.join(root, '.vibe/agent/pro-roundtrip/ACTIVE.json'), JSON.stringify({ baseSha: 'unrelated-invalid-base' }));
      const input = '.vibe/harness/src/probe/value.txt';
      await writeFile(path.join(root, input), 'initial');
      const sample = manifest([group('probe', 'command', {
        command: ['{node}', '-e', `const fs = require('node:fs'); fs.appendFileSync('executions.txt','run\\n'); if(process.env.VIBE_VERIFY_TEST_MUTATE === '1') fs.appendFileSync('${input}', 'changed');`],
      })]);
      await writeFile(path.join(root, '.vibe/harness/test/groups.json'), JSON.stringify(sample));
      await execFile('git', ['init'], { cwd: root, windowsHide: true });
      const env = { ...process.env, VIBE_ACTIVE_MODEL: model, VIBE_ACTIVE_PROVIDER: 'codex', VIBE_HARNESS_PROFILE: '', VIBE_VERIFY_BASE: '' };
      const run = (args: string[], mutate = false) => spawnSync(process.execPath,
        ['--import', 'tsx', verifyPath, '--root', root, '--group', 'probe', '--paths', input, ...args],
        { env: { ...env, VIBE_VERIFY_TEST_MUTATE: mutate ? '1' : '0' }, encoding: 'utf8', windowsHide: true });
      const plan = () => {
        const result = run(['--plan', '--json']);
        assert.equal(result.status, 0, result.stderr);
        const parsed = JSON.parse(result.stdout);
        assert.equal(parsed.baseSha, null);
        return parsed.groups[0] as { receiptPath: string; action: string };
      };
      assert.equal(run([]).status, 0);
      const passed = plan();
      assert.equal(passed.action, 'reuse', model);
      assert.equal(run([]).status, 0);
      assert.equal(await readFile(path.join(root, 'executions.txt'), 'utf8'), 'run\n');
      const receiptPath = path.join(root, passed.receiptPath);
      const malformed = JSON.parse(await readFile(receiptPath, 'utf8'));
      delete malformed.passedAt;
      await writeFile(receiptPath, JSON.stringify(malformed));
      assert.equal(plan().action, 'run');
      assert.equal(run([]).status, 0);
      assert.equal(plan().action, 'reuse');
      assert.equal(await readFile(path.join(root, 'executions.txt'), 'utf8'), 'run\nrun\n');
      const changed = run(['--force'], true);
      assert.notEqual(changed.status, 0);
      assert.match(changed.stderr, /verification inputs changed during execution/);
      await assert.rejects(readFile(receiptPath), { code: 'ENOENT' });
    }
  });

  it('matches exact, segment wildcard, and recursive path patterns', () => {
    assert.equal(matchesPathPattern('package.json', 'package.json'), true);
    assert.equal(matchesPathPattern('.vibe/harness/scripts/*.mjs', '.vibe/harness/scripts/a.mjs'), true);
    assert.equal(matchesPathPattern('.vibe/harness/scripts/*.mjs', '.vibe/harness/scripts/lib/a.mjs'), false);
    assert.equal(matchesPathPattern('.vibe/harness/src/**', '.vibe/harness/src/a/b.ts'), true);
    assert.equal(matchesPathPattern('.vibe/harness/src/?.ts', '.vibe/harness/src/a.ts'), true);
  });

  it('requires every discovered harness test to have exactly one owner', async () => {
    const actual = JSON.parse(
      await readFile(path.resolve('.vibe/harness/test/groups.json'), 'utf8'),
    ) as unknown;
    const rootTests = await listHarnessTestFiles(process.cwd());
    assert.ok(rootTests.includes('.vibe/harness/test/integration/meta-smoke.test.ts'));
    assert.ok(rootTests.every((file) => !file.includes('/playwright/') && !file.includes('/fixtures/')));

    const validated = validateVerificationManifest(actual, rootTests);
    assert.equal(validated.groups.some((entry) => entry.id === 'pro-roundtrip'), true);
    const actualOwnership = {
      harnessPatterns: ['.vibe/harness/**'],
      hybridPaths: new Set<string>(['package.json']),
    };
    assert.deepEqual(
      selectVerificationGroups(
        validated,
        ['.vibe/harness/src/commands/bundle-size.ts'],
        actualOwnership,
      ).selectedGroupIds,
      ['typecheck', 'reporting'],
    );
    assert.deepEqual(
      selectVerificationGroups(
        validated,
        ['.vibe/harness/src/commands/init.ts'],
        actualOwnership,
      ).selectedGroupIds,
      ['typecheck', 'orchestration'],
    );

    const incomplete = manifest([group('one', 'node-test')]);
    assert.throws(
      () => validateVerificationManifest(incomplete, [
        '.vibe/harness/test/one.test.ts',
        '.vibe/harness/test/two.test.ts',
      ]),
      /unowned root harness tests: .*two\.test\.ts/,
    );

    const duplicate = manifest([
      group('one', 'node-test'),
      group('two', 'node-test', { testFiles: ['.vibe/harness/test/one.test.ts'] }),
    ]);
    assert.throws(
      () => validateVerificationManifest(duplicate, ['.vibe/harness/test/one.test.ts']),
      /owned by both one and two/,
    );
  });

  it('selects known impacts, ignores product paths, and fails closed on unknown harness paths', () => {
    const sample = manifest([
      group('typecheck', 'command', {
        inputPatterns: ['.vibe/harness/src/**/*.ts'],
        impactPatterns: ['.vibe/harness/src/**/*.ts'],
      }),
      group('core', 'node-test'),
      group('pro', 'node-test'),
    ]);
    const ownership = {
      harnessPatterns: ['.vibe/harness/**'],
      hybridPaths: new Set<string>(['package.json']),
    };

    const known = selectVerificationGroups(
      sample,
      ['.vibe/harness/src/core/leaf.ts', 'src/product.ts'],
      ownership,
    );
    assert.deepEqual(known.selectedGroupIds, ['typecheck', 'core']);
    assert.deepEqual(known.ignoredPaths, ['src/product.ts']);
    assert.equal(known.forceSelectedGroups, false);

    const unknown = selectVerificationGroups(
      sample,
      ['.vibe/harness/scripts/new-runtime.mjs'],
      ownership,
    );
    assert.deepEqual(unknown.selectedGroupIds, ['typecheck', 'core', 'pro']);
    assert.deepEqual(unknown.unknownHarnessPaths, ['.vibe/harness/scripts/new-runtime.mjs']);
    assert.equal(unknown.forceSelectedGroups, false);

    const global = selectVerificationGroups(sample, ['package.json'], ownership);
    assert.deepEqual(global.selectedGroupIds, ['typecheck', 'core', 'pro']);
    assert.equal(global.forceSelectedGroups, false);
  });

  it('selects Pro for its dependencies but not unrelated shared helpers or documents', async () => {
    const actual = validateVerificationManifest(
      JSON.parse(await readFile('.vibe/harness/test/groups.json', 'utf8')),
      await listHarnessTestFiles(process.cwd()),
    );
    const ownership = {
      harnessPatterns: ['.vibe/harness/**', 'docs/context/**', '.claude/skills/**'],
      hybridPaths: new Set<string>(['package.json']),
    };
    for (const file of [
      '.vibe/harness/scripts/lib/dashboard-render.mjs',
      '.vibe/harness/scripts/lib/interview-engine.mjs',
      '.vibe/harness/src/lib/review-priority.ts',
      '.vibe/harness/schemas/sidecar-result.schema.json',
      'docs/context/qa.md',
      '.claude/skills/self-qa/SKILL.md',
    ]) {
      const selected = selectVerificationGroups(actual, [file], ownership);
      assert.ok(selected.selectedGroupIds.length > 0, file);
      assert.equal(selected.selectedGroupIds.includes('pro-roundtrip'), false, file);
      assert.deepEqual(selected.unknownHarnessPaths, [], file);
    }
    for (const file of [
      '.vibe/harness/src/commands/pro-roundtrip.ts',
      '.vibe/harness/scripts/vibe-pro-go.mjs',
      '.vibe/harness/src/pro-roundtrip/protocol.ts',
      '.vibe/harness/src/lib/args.ts',
      '.vibe/harness/src/lib/cli.ts',
      '.vibe/harness/src/lib/logger.ts',
      '.vibe/harness/src/lib/harness-profile.mjs',
      '.vibe/model-registry.json',
      '.vibe/harness/src/lib/schemas/pro-roundtrip.ts',
      '.vibe/harness/schemas/pro-roundtrip-flow.schema.json',
      '.vibe/harness/src/universal-integrity-core/index.ts',
      '.vibe/harness/test/pro-roundtrip-cli.test.ts',
      '.vibe/harness/test/fixtures/pro-roundtrip/CONTRACT.json',
      '.claude/skills/vibe-pro-go/references/WEB-RUNBOOK.md',
      'docs/context/workflow-integrity.md',
      'package-lock.json',
    ]) {
      const selected = selectVerificationGroups(actual, [file], ownership);
      assert.ok(selected.selectedGroupIds.includes('pro-roundtrip'), file);
      assert.deepEqual(selected.unknownHarnessPaths, [], file);
    }
    const invalid = manifest([group('pro', 'node-test')]);
    Object.assign(invalid.groups[0]!, { inheritSharedPatterns: 'false' });
    assert.throws(() => validateVerificationManifest(invalid, ['.vibe/harness/test/pro.test.ts']),
      /inheritSharedPatterns must be a boolean/);
  });

  it('keeps the Pro receipt stable for unrelated shared edits and invalidates real dependencies', async () => {
    const root = await makeTempDir();
    const actual = JSON.parse(await readFile('.vibe/harness/test/groups.json', 'utf8')) as VerificationManifest;
    const pro = actual.groups.find((entry) => entry.id === 'pro-roundtrip')!;
    const files = [
      '.vibe/harness/scripts/lib/dashboard-render.mjs',
      '.vibe/harness/src/lib/args.ts',
      '.vibe/harness/src/lib/logger.ts',
      '.vibe/harness/src/lib/schemas/pro-roundtrip.ts',
      '.vibe/harness/schemas/pro-roundtrip-flow.schema.json',
      '.vibe/harness/src/pro-roundtrip/protocol.ts',
    ];
    for (const file of files) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), 'initial');
    }
    let previous = await computeGroupInputHash(root, actual, pro, files);
    await writeFile(path.join(root, files[0]!), 'unrelated change');
    assert.equal(await computeGroupInputHash(root, actual, pro, files), previous);
    for (const file of files.slice(1)) {
      await writeFile(path.join(root, file), 'dependency change');
      const changed = await computeGroupInputHash(root, actual, pro, files);
      assert.notEqual(changed, previous, file);
      previous = changed;
    }
  });

  it('runs changed tests from a committed base without starting unrelated Pro fixtures', async () => {
    const root = await makeTempDir();
    const verifyPath = path.resolve('.vibe/harness/src/commands/verify.ts');
    await mkdir(path.join(root, '.vibe/harness/test'), { recursive: true });
    await mkdir(path.join(root, '.vibe/harness/src/lib'), { recursive: true });
    await writeFile(path.join(root, 'package.json'), '{"type":"module"}\n');
    await writeFile(path.join(root, '.gitignore'), 'node_modules/\n.vibe/runs/\n*-runs.txt\n');
    await symlink(path.resolve('node_modules'), path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    for (const id of ['core', 'pro']) {
      await writeFile(path.join(root, `.vibe/harness/test/${id}.test.ts`),
        `import { appendFileSync } from 'node:fs'; appendFileSync('${id}-runs.txt', 'run\\n');\n`);
    }
    const sample = manifest([
      group('core', 'node-test'),
      group('pro', 'node-test', { inheritSharedPatterns: false }),
    ]);
    await writeFile(path.join(root, '.vibe/harness/test/groups.json'), JSON.stringify(sample));
    const input = '.vibe/harness/src/lib/dashboard.ts';
    await writeFile(path.join(root, input), 'initial');
    const git = (args: string[]) => execFile('git', args, { cwd: root, windowsHide: true });
    await git(['init']);
    await git(['add', '.']);
    await git(['-c', 'user.name=Verification Test', '-c', 'user.email=verify@example.invalid', 'commit', '-m', 'baseline']);
    const { stdout: base } = await git(['rev-parse', 'HEAD']);
    await writeFile(path.join(root, input), 'changed');
    await git(['add', input]);
    await git(['-c', 'user.name=Verification Test', '-c', 'user.email=verify@example.invalid', 'commit', '-m', 'dashboard change']);
    const run = (args: string[]) => spawnSync(process.execPath,
      ['--import', 'tsx', verifyPath, '--root', root, '--changed', '--tests-only', '--force', ...args],
      { env: { ...process.env, VIBE_VERIFY_BASE: base.trim() }, encoding: 'utf8', windowsHide: true });
    const changed = run([]);
    assert.equal(changed.status, 0, changed.stdout + changed.stderr);
    assert.match(changed.stdout, /start group=core/);
    assert.doesNotMatch(changed.stdout, /start group=pro/);
    await assert.rejects(readFile(path.join(root, 'pro-runs.txt')), { code: 'ENOENT' });
    for (const args of [
      ['--paths', '.vibe/harness/src/pro/flow.ts'],
      ['--all'],
      ['--base', 'missing-verification-base'],
      ['--paths', '.vibe/harness/new-unknown-runtime.ts'],
    ]) {
      const result = run(args);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /start group=pro/);
    }
    assert.equal(await readFile(path.join(root, 'pro-runs.txt'), 'utf8'), 'run\n'.repeat(4));
  });

  it('changes a group hash only when one of its semantic inputs changes', async () => {
    const root = await makeTempDir();
    const sample = manifest([group('core', 'node-test')]);
    const core = sample.groups[0];
    assert.ok(core);
    const files = [
      'package.json',
      '.vibe/harness/src/core/value.ts',
      '.vibe/harness/src/pro/value.ts',
      '.vibe/harness/src/lib/shared.ts',
      '.vibe/harness/test/core.test.ts',
    ];
    for (const filePath of files) {
      const absolute = path.join(root, ...filePath.split('/'));
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, `${filePath}:v1\n`, 'utf8');
    }

    const first = await computeGroupInputHash(root, sample, core, files);
    await writeFile(path.join(root, '.vibe/harness/src/pro/value.ts'), 'unrelated:v2\n', 'utf8');
    const unrelated = await computeGroupInputHash(root, sample, core, files);
    assert.equal(unrelated, first);

    await writeFile(path.join(root, '.vibe/harness/src/core/value.ts'), 'core:v2\n', 'utf8');
    const relevant = await computeGroupInputHash(root, sample, core, files);
    assert.notEqual(relevant, first);
  });

  it('accepts only a content-addressed successful receipt with matching group and hash', async () => {
    const root = await makeTempDir();
    const receipt: VerificationReceipt = {
      schemaVersion: 'vibe-verification-receipt-v1',
      groupId: 'core',
      inputHash: 'a'.repeat(64),
      tier: 'fast',
      runner: 'node-test',
      passedAt: new Date(0).toISOString(),
      durationMs: 12,
      observedHead: null,
      baseSha: null,
      changedPaths: [],
    };
    const target = path.join(
      root,
      '.vibe',
      'runs',
      'verification-receipts',
      receipt.groupId,
      `${receipt.inputHash}.json`,
    );
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(receipt)}\n`, 'utf8');

    assert.deepEqual(
      await readSuccessfulReceipt(root, receipt.groupId, receipt.inputHash),
      receipt,
    );
    assert.equal(
      await readSuccessfulReceipt(root, receipt.groupId, 'b'.repeat(64)),
      null,
    );
  });

  it('renders a machine-readable fail-closed plan without executing tests', async () => {
    const verifyPath = path.resolve('.vibe/harness/src/commands/verify.ts');
    const { stdout: currentHead } = await execFile('git', ['rev-parse', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      windowsHide: true,
    });
    const { stdout } = await execFile(process.execPath, [
      '--import',
      'tsx',
      verifyPath,
      currentHead.trim(),
      '--plan',
      '--json',
      '--tests-only',
      '--paths',
      '.vibe/harness/src/commands/verify.ts',
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      windowsHide: true,
    });
    const plan = JSON.parse(stdout) as {
      mode: string;
      baseSha: string | null;
      groups: Array<{ id: string; action: string; reasons: string[] }>;
    };
    assert.equal(plan.mode, 'changed');
    assert.equal(plan.baseSha, currentHead.trim());
    assert.equal(plan.groups.length, 8); // +universal-integrity-core
    assert.equal(
      plan.groups.every((entry) =>
        entry.reasons.includes('global invalidator: .vibe/harness/src/commands/verify.ts')),
      true,
    );
  });

  it('defaults patch tests to changed groups while keeping explicit full and release checks forced', async () => {
    const packageJson = JSON.parse(
      await readFile(path.resolve('package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };
    assert.equal(packageJson.scripts?.test, 'npm run vibe:self-test');
    assert.match(packageJson.scripts?.['vibe:self-test'] ?? '', /--changed --tests-only$/);
    assert.match(packageJson.scripts?.['vibe:self-test:all'] ?? '', /--all --tests-only --force/);
    assert.match(packageJson.scripts?.['vibe:self-test:smart'] ?? '', /--changed --tests-only/);
    assert.match(packageJson.scripts?.['vibe:verify'] ?? '', /verify\.ts --changed$/);
    assert.match(packageJson.scripts?.['vibe:verify:release'] ?? '', /--all --force/);
  });
});
