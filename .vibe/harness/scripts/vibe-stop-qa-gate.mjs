#!/usr/bin/env node
// Gate vibe:qa so Stop hooks only run when the repo has code changes.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.cs', '.py', '.go', '.rs',
  '.java', '.kt', '.swift', '.rb', '.php', '.c', '.cpp', '.h', '.hpp', '.m', '.mm',
]);
const FILENAMES = new Set([
  'package.json', 'tsconfig.json', 'Cargo.toml', 'go.mod',
  'pyproject.toml', 'requirements.txt', 'pom.xml',
]);
const SUFFIXES = ['.csproj', '.asmdef'];
const DENY_PREFIXES = [
  'node_modules/', '.git/', 'dist/', 'build/', 'coverage/',
  '.vibe/sync-backup/', '.vibe/runs/',
];

function git(repoRoot, ...args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'buffer' });
}

function normalizeGitPath(filePath) {
  return filePath.replaceAll('\\', '/');
}

function classify(filePath) {
  const normalized = normalizeGitPath(filePath);
  if (DENY_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return false;
  }

  const base = path.posix.basename(normalized);
  if (FILENAMES.has(base) || SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    return true;
  }

  return EXTENSIONS.has(path.posix.extname(base).toLowerCase());
}

function parseStatusZ(buffer) {
  const tokens = buffer.toString('utf8').split('\0');
  const paths = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const entry = tokens[index];
    if (!entry) {
      continue;
    }

    const status = entry.slice(0, 2);
    const candidate = entry.slice(3);
    if (status[0] === 'R' || status[0] === 'C' || status[1] === 'R' || status[1] === 'C') {
      const destination = tokens[index + 1];
      if (destination) {
        paths.push(destination);
        index += 1;
      } else if (candidate) {
        paths.push(candidate);
      }
      continue;
    }

    if (candidate) {
      paths.push(candidate);
    }
  }

  return paths;
}

function parseListZ(buffer) {
  return buffer.toString('utf8').split('\0').filter(Boolean);
}

function relativeLogPath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).replaceAll('\\', '/');
}

function writeQaLog(repoRoot, result) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const stamp = now.toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const dir = path.join(repoRoot, '.vibe', 'runs', date);
  const logPath = path.join(dir, `stop-qa-${stamp}.log`);
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const status = typeof result.status === 'number' ? result.status : 1;

  mkdirSync(dir, { recursive: true });
  writeFileSync(
    logPath,
    [
      '# vibe-stop-qa-gate',
      `timestamp: ${now.toISOString()}`,
      'command: npm run vibe:qa --silent',
      `exit: ${status}`,
      '',
      '## stdout',
      stdout.trimEnd(),
      '',
      '## stderr',
      stderr.trimEnd(),
      '',
      result.error ? `## error\n${result.error.message}\n` : '',
    ].join('\n'),
    'utf8',
  );

  return relativeLogPath(repoRoot, logPath);
}

function runQa(repoRoot) {
  return spawnSync('npm', ['run', 'vibe:qa', '--silent'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function main() {
  try {
    const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    const changed = new Set([
      ...parseStatusZ(git(repoRoot, 'status', '--porcelain=v1', '-z')),
      ...parseListZ(git(repoRoot, 'ls-files', '--others', '--exclude-standard', '-z')),
    ].map(normalizeGitPath));

    const codePaths = [...changed].filter(classify);
    if (codePaths.length === 0) {
      console.log('[vibe-qa] skip: no code changes');
      process.exit(0);
    }

    const sample = codePaths.slice(0, 3).join(', ');
    console.log(`[vibe-qa] run: ${sample}`);
    const tsxInstalled = existsSync(path.join(repoRoot, 'node_modules', 'tsx', 'package.json'));
    if (!tsxInstalled) {
      console.log('[vibe-qa] skip: tsx not installed \u2014 run `npm install` first');
      process.exit(0);
    }
    const result = runQa(repoRoot);
    const logPath = writeQaLog(repoRoot, result);
    if (result.status === 0 && !result.error) {
      console.log(`[vibe-qa] ok: log=${logPath}`);
      process.exit(0);
    }
    const status = typeof result.status === 'number' ? result.status : 1;
    const errorSuffix = result.error ? ` error=${result.error.message}` : '';
    console.error(`[vibe-qa] fail: exit=${status} log=${logPath}${errorSuffix}`);
    process.exit(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[vibe-qa] gate error: ${message}`);
    process.exit(0);
  }
}

main();
