#!/usr/bin/env node
// Runs the harness browser UI tests (.vibe/harness/test/stagehand/*.test.ts) with node:test + tsx on
// top of Stagehand-driven headless Chrome. Stagehand ships no test runner, so this wrapper owns the
// defaults that the former Playwright config carried (test directory, serial execution, pass-through flags).

import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { isStagehandInstalled, stagehandInstallGuidance } from './lib/stagehand-browser.mjs';

const root = process.cwd();
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const UI_TEST_DIR = path.resolve(scriptDir, '..', 'test', 'stagehand');
const TEST_SUFFIX = '.test.ts';

function usage() {
  return [
    'Usage: node .vibe/harness/scripts/vibe-stagehand-test.mjs [node --test flags] [test files]',
    '',
    'Runs .vibe/harness/test/stagehand/*.test.ts with `node --import tsx --test` on Stagehand-driven headless Chrome.',
    'Arguments starting with "-" (for example --test-name-pattern=<regex>, --test-timeout=<ms>,',
    '--test-reporter=<name>) are passed to node before the file list; other arguments replace the',
    'default test file list.',
    '',
    '  --list   print the discovered UI test files without running them',
    '  --help   print this message',
    '',
    'Chrome is resolved by Stagehand: the local Google Chrome/Chromium install, or CHROME_PATH.',
    '',
  ].join('\n');
}

export function listUiTestFiles(directory = UI_TEST_DIR, relativeTo = root) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(TEST_SUFFIX))
    .map((entry) => path.relative(relativeTo, path.join(directory, entry.name)).split(path.sep).join('/'))
    .sort();
}

export function partitionArgs(args) {
  const flags = [];
  const files = [];
  for (const arg of args) {
    if (arg.startsWith('-')) {
      flags.push(arg);
    } else {
      files.push(arg);
    }
  }
  return { flags, files };
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(usage());
    return;
  }

  if (argv.includes('--list')) {
    const files = listUiTestFiles();
    process.stdout.write(`${files.map((file) => `${file}\n`).join('')}Total: ${files.length} test file${files.length === 1 ? '' : 's'}\n`);
    return;
  }

  if (!isStagehandInstalled(root)) {
    process.stderr.write(stagehandInstallGuidance('[vibe:test-ui]', 'npm run vibe:test-ui'));
    process.exit(1);
  }

  const { flags, files } = partitionArgs(argv);
  const targets = files.length > 0 ? files : listUiTestFiles();
  if (targets.length === 0) {
    process.stderr.write(`[vibe:test-ui] no ${TEST_SUFFIX} files found under ${UI_TEST_DIR}\n`);
    process.exit(1);
  }

  const child = spawn(process.execPath, ['--import', 'tsx', '--test', ...flags, ...targets], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });

  child.on('error', (error) => {
    process.stderr.write(`[vibe:test-ui] failed to start the UI test runner: ${error.message}\n`);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.stderr.write(`[vibe:test-ui] UI test runner exited from signal ${signal}\n`);
      process.exit(1);
    }
    process.exit(code ?? 1);
  });
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
