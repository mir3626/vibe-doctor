#!/usr/bin/env node
// v1.16.0 — Playwright → Stagehand.
//
// The sync planner never emits delete actions, so the retired Playwright harness files would
// linger downstream (and `patterns-index.test.ts` / the old wrapper test would fail). Remove them
// only when their content is provably the shipped upstream version, and point customized
// `test:ui` scripts that invoked the old wrapper at the Stagehand wrapper. Project-owned
// devDependencies are reported, never edited.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const RETIRED_HARNESS_FILES = [
  '.vibe/harness/playwright.config.ts',
  '.vibe/harness/scripts/vibe-playwright-test.mjs',
  '.vibe/harness/test/playwright/dashboard-report.spec.ts',
  '.vibe/harness/test/playwright-wrapper.test.ts',
  '.claude/skills/test-patterns/typescript-playwright.md',
];

// Git blob ids of the retired files in every published release that shipped them
// (v1.6.10 .. v1.15.5), so a pristine checkout without .vibe/sync-hashes.json still migrates safely.
const KNOWN_RELEASE_BLOBS = new Set([
  '023a46bb3e86dadf44ded500ecb6e588aeb2185c',
  '2fbf5c0dcd1e7f028d485de832d18ae720466fd0',
  '485b48d61aebcb175001882d1c23d2533635a674',
  '67a19e3c0c0ea86f45b0c79f10ff5b070a2052da',
  '7aa10aeb864febffd23a3a15629fcfae2d331e13',
  'd7bd2aa9954bb0908ce0a586d8b426f4379746b4',
  'e08ce575f6157d36f92a3640be9dd1eca0330874',
  'e0ec50d0160f26706800844dd0b8cec5bb11904e',
]);

const LEGACY_UI_WRAPPER_SCRIPTS = new Set([
  'node .vibe/harness/scripts/vibe-playwright-test.mjs',
  'node scripts/vibe-playwright-test.mjs',
]);
const UI_WRAPPER_SCRIPT = 'node .vibe/harness/scripts/vibe-stagehand-test.mjs';
const UI_SCRIPT_KEYS = ['test:ui', 'vibe:test-ui'];
const REPORT_PATH = '.vibe/harness-migration-1.16.0.md';
const CONVENTIONS_PATH = 'docs/context/conventions.md';
const TEST_PATTERNS_BLOCK = /(<!-- BEGIN:VIBE:TEST-PATTERNS -->)([\s\S]*?)(<!-- END:VIBE:TEST-PATTERNS -->)/;

function readJson(filePath, fallback) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function gitBlobId(filePath) {
  const content = readFileSync(filePath);
  return createHash('sha1')
    .update(Buffer.from(`blob ${content.byteLength}\0`))
    .update(content)
    .digest('hex');
}

function pruneEmptyDirs(root, relativePaths) {
  const directories = Array.from(
    new Set(
      relativePaths
        .map((relativePath) => path.posix.dirname(relativePath))
        .filter((relativePath) => relativePath !== '.')
        .sort((left, right) => right.length - left.length),
    ),
  );

  for (const directory of directories) {
    try {
      rmdirSync(path.join(root, directory));
    } catch {
      // The directory still contains preserved or unrelated files.
    }
  }
}

function migrateRetiredHarnessFiles(root) {
  const syncHashesPath = path.join(root, '.vibe', 'sync-hashes.json');
  const syncHashes = readJson(syncHashesPath, { files: {} });
  const hashMap =
    syncHashes.files && typeof syncHashes.files === 'object' && !Array.isArray(syncHashes.files)
      ? syncHashes.files
      : {};
  const removed = [];
  const retained = [];

  for (const relativePath of RETIRED_HARNESS_FILES) {
    const absolutePath = path.join(root, relativePath);
    if (!existsSync(absolutePath)) {
      continue;
    }

    const trackedHash = typeof hashMap[relativePath] === 'string' ? hashMap[relativePath] : null;
    const trackedAndUnmodified = trackedHash !== null && trackedHash === sha256(absolutePath);
    const knownReleaseBlob = KNOWN_RELEASE_BLOBS.has(gitBlobId(absolutePath));

    if (!trackedAndUnmodified && !knownReleaseBlob) {
      retained.push(`${relativePath}: locally modified or unknown content`);
      continue;
    }

    rmSync(absolutePath, { force: true });
    delete hashMap[relativePath];
    removed.push(relativePath);
  }

  if (removed.length > 0 && existsSync(syncHashesPath)) {
    syncHashes.files = hashMap;
    writeJson(syncHashesPath, syncHashes);
  }
  pruneEmptyDirs(root, removed);

  const reportPath = path.join(root, REPORT_PATH);
  if (retained.length > 0) {
    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(
      reportPath,
      [
        '# Harness Migration v1.16.0',
        '',
        'Stagehand (`@browserbasehq/stagehand`) replaced Playwright for harness UI tests and browser smoke.',
        'The following retired Playwright harness files were preserved because their contents could not be proven unmodified:',
        '',
        ...retained.map((entry) => `- ${entry}`),
        '',
        'Review them manually: `npm run vibe:test-ui` now runs `.vibe/harness/scripts/vibe-stagehand-test.mjs`,',
        'and `.claude/skills/test-patterns/typescript-stagehand.md` (`ts-stagehand`) replaces the `ts-playwright` shard.',
        'Project-owned Playwright suites and devDependencies are intentionally untouched.',
        '',
      ].join('\n'),
      'utf8',
    );
  } else {
    rmSync(reportPath, { force: true });
  }

  return { removed, retained };
}

function migratePackageScripts(root) {
  const packagePath = path.join(root, 'package.json');
  if (!existsSync(packagePath)) {
    return { rewritten: 0, playwrightDevDependency: 'missing' };
  }

  const pkg = readJson(packagePath, {});
  const devDependencies = pkg.devDependencies && typeof pkg.devDependencies === 'object' ? pkg.devDependencies : {};
  const playwrightDevDependency = Object.hasOwn(devDependencies, '@playwright/test') ? 'present' : 'absent';
  if (!pkg.scripts || typeof pkg.scripts !== 'object' || Array.isArray(pkg.scripts)) {
    return { rewritten: 0, playwrightDevDependency };
  }

  let rewritten = 0;
  for (const key of UI_SCRIPT_KEYS) {
    const value = pkg.scripts[key];
    if (typeof value === 'string' && LEGACY_UI_WRAPPER_SCRIPTS.has(value.trim())) {
      pkg.scripts[key] = UI_WRAPPER_SCRIPT;
      rewritten += 1;
    }
  }

  if (rewritten > 0) {
    writeJson(packagePath, pkg);
  }
  return { rewritten, playwrightDevDependency };
}

/**
 * /vibe-init links the Planner's mandatory test shards inside the VIBE:TEST-PATTERNS marker block of the
 * project-owned conventions.md. Re-point the retired Playwright shard there, and only there, so the
 * Planner's shard read does not dangle after the shard file is removed.
 */
function migrateConventionsShardLinks(root) {
  const conventionsPath = path.join(root, CONVENTIONS_PATH);
  if (!existsSync(conventionsPath)) {
    return 'missing';
  }

  const original = readFileSync(conventionsPath, 'utf8');
  const match = TEST_PATTERNS_BLOCK.exec(original);
  if (!match) {
    return 'no-marker';
  }

  const block = match[2];
  const rewritten = block
    .replaceAll('typescript-playwright.md', 'typescript-stagehand.md')
    .replaceAll('ts-playwright', 'ts-stagehand')
    .replaceAll('TypeScript + Playwright', 'TypeScript + Stagehand');
  if (rewritten === block) {
    return 'idempotent';
  }

  writeFileSync(conventionsPath, original.replace(TEST_PATTERNS_BLOCK, () => `${match[1]}${rewritten}${match[3]}`), 'utf8');
  return 'rewritten';
}

function main() {
  const root = path.resolve(process.argv[2] ?? process.cwd());
  const files = migrateRetiredHarnessFiles(root);
  const scripts = migratePackageScripts(root);
  const conventions = migrateConventionsShardLinks(root);
  process.stdout.write(
    `[migrate 1.16.0] removedRetiredHarness=${files.removed.length} retainedRetiredHarness=${files.retained.length} packageScripts=rewritten:${scripts.rewritten} playwrightDevDependency=${scripts.playwrightDevDependency} conventions=${conventions}\n`,
  );
  if (scripts.playwrightDevDependency === 'present') {
    process.stdout.write(
      '[migrate 1.16.0] note: @playwright/test remains in devDependencies; the harness no longer needs it (keep it only for project-owned suites). Install the new harness dependency with: npm install -D @browserbasehq/stagehand\n',
    );
  }
}

try {
  main();
  process.exit(0);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
