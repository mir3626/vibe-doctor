import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { promisify } from 'node:util';
import {
  computeGroupInputHash,
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
  it('matches exact, segment wildcard, and recursive path patterns', () => {
    assert.equal(matchesPathPattern('package.json', 'package.json'), true);
    assert.equal(matchesPathPattern('.vibe/harness/scripts/*.mjs', '.vibe/harness/scripts/a.mjs'), true);
    assert.equal(matchesPathPattern('.vibe/harness/scripts/*.mjs', '.vibe/harness/scripts/lib/a.mjs'), false);
    assert.equal(matchesPathPattern('.vibe/harness/src/**', '.vibe/harness/src/a/b.ts'), true);
    assert.equal(matchesPathPattern('.vibe/harness/src/?.ts', '.vibe/harness/src/a.ts'), true);
  });

  it('requires every root harness test to have exactly one owner', async () => {
    const actual = JSON.parse(
      await readFile(path.resolve('.vibe/harness/test/groups.json'), 'utf8'),
    ) as unknown;
    const rootTests = (await readdir(path.resolve('.vibe/harness/test'), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.test.ts'))
      .map((entry) => `.vibe/harness/test/${entry.name}`)
      .sort();

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

  it('keeps full self-test forced while exposing smart and release boundaries', async () => {
    const packageJson = JSON.parse(
      await readFile(path.resolve('package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };
    assert.match(packageJson.scripts?.['vibe:self-test'] ?? '', /--all --tests-only --force/);
    assert.match(packageJson.scripts?.['vibe:self-test:smart'] ?? '', /--changed --tests-only/);
    assert.match(packageJson.scripts?.['vibe:verify'] ?? '', /verify\.ts --changed$/);
    assert.match(packageJson.scripts?.['vibe:verify:release'] ?? '', /--all --force/);
  });
});
