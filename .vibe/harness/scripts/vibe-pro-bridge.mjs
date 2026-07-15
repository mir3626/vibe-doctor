#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const tsxLoader = [
  path.join(scriptDir, '..', 'node_modules', 'tsx', 'dist', 'loader.mjs'),
  path.join(scriptDir, '..', '..', '..', 'node_modules', 'tsx', 'dist', 'loader.mjs'),
].find((candidate) => existsSync(candidate));
const tsxImport = tsxLoader ? pathToFileURL(tsxLoader).href : 'tsx';
const commandPath = path.join(scriptDir, '..', 'src', 'commands', 'pro-bridge.ts');
const result = spawnSync(
  process.execPath,
  ['--import', tsxImport, commandPath, ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    windowsHide: true,
  },
);

process.exit(result.status ?? 1);
