#!/usr/bin/env node
// Run harness-owned QA out of band so Claude Stop hooks return immediately.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER_FLAG = '--background-worker';
const WORKER_MODE = process.argv.includes(WORKER_FLAG);

function readHookInput() {
  if (WORKER_MODE || process.stdin.isTTY) {
    return null;
  }

  try {
    const raw = readFileSync(0, 'utf8').trim();
    if (!raw) {
      return null;
    }
    const input = JSON.parse(raw);
    return input && typeof input === 'object' ? input : null;
  } catch {
    return null;
  }
}

const HOOK_INPUT = readHookInput();
const HOOK_MODE = process.argv.includes('--hook') || HOOK_INPUT?.hook_event_name === 'Stop';
const FORCE_RUN = process.argv.includes('--force');
const STATE_SCHEMA_VERSION = 2;
const STATE_FILE = path.join('.vibe', 'runs', 'stop-harness-qa-state.json');
const LEASE_FILE = path.join('.vibe', 'runs', 'stop-harness-qa-worker.lock');
const LEASE_STALE_MS = 30 * 60 * 1000;
const SELF_TEST_WINDOWS_HIDE_PRELOAD = path.join(
  '.vibe',
  'harness',
  'test',
  'windows-hide-child-process.cjs',
);
const LOCKFILES = [
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
];
const FALLBACK_HARNESS_PATTERNS = [
  '.vibe/harness/**',
  '.vibe/settings-presets/**',
  '.claude/agents/**',
  '.claude/skills/**',
  '.claude/templates/**',
  '.codex/agents/**',
  '.codex/skills/**',
  '.vibe/sync-manifest.json',
  'scripts/vibe-sync-bootstrap.mjs',
];
const FALLBACK_HYBRID_PATHS = [
  'CLAUDE.md',
  'AGENTS.md',
  'GEMINI.md',
  '.claude/settings.json',
  '.vibe/config.json',
  'package.json',
];

function hooksDisabled() {
  const value = process.env.VIBE_HARNESS_HOOKS?.trim().toLowerCase();
  return value === 'off' || value === '0' || value === 'false';
}

function git(repoRoot, ...args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'buffer' });
}

function normalizeGitPath(filePath) {
  return filePath.replaceAll('\\', '/');
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
    if (status.includes('R') || status.includes('C')) {
      if (candidate) {
        paths.push(candidate);
      }
      const pairedPath = tokens[index + 1];
      if (pairedPath) {
        paths.push(pairedPath);
        index += 1;
      }
    } else if (candidate) {
      paths.push(candidate);
    }
  }

  return paths;
}

function readOwnership(repoRoot) {
  try {
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, '.vibe', 'sync-manifest.json'), 'utf8'));
    const patterns = manifest?.files?.harness;
    const hybrid = manifest?.files?.hybrid;
    if (!Array.isArray(patterns) || !hybrid || typeof hybrid !== 'object') {
      throw new Error('invalid sync manifest ownership');
    }
    return { patterns, hybridPaths: Object.keys(hybrid) };
  } catch {
    return {
      patterns: FALLBACK_HARNESS_PATTERNS,
      hybridPaths: FALLBACK_HYBRID_PATHS,
    };
  }
}

function matchesHarnessPattern(filePath, pattern) {
  const normalizedPattern = normalizeGitPath(pattern);
  if (normalizedPattern.endsWith('/**')) {
    return filePath.startsWith(normalizedPattern.slice(0, -2));
  }
  return filePath === normalizedPattern;
}

function listHarnessChanges(repoRoot) {
  const changed = new Set(parseStatusZ(
    git(repoRoot, 'status', '--porcelain=v1', '-z', '--untracked-files=all'),
  ).map(normalizeGitPath));
  const ownership = readOwnership(repoRoot);
  const hybrid = new Set(ownership.hybridPaths.map(normalizeGitPath));

  return [...changed]
    .filter((filePath) => hybrid.has(filePath)
      || ownership.patterns.some((pattern) => matchesHarnessPattern(filePath, pattern)))
    .sort();
}

function updateHash(hash, label, value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  hash.update(`${label}\0${buffer.length}\0`, 'utf8');
  hash.update(buffer);
  hash.update('\0', 'utf8');
}

function updateFileHash(hash, repoRoot, relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  updateHash(hash, 'path', relativePath);
  try {
    const stat = lstatSync(absolutePath);
    updateHash(hash, 'mode', stat.mode);
    if (stat.isSymbolicLink()) {
      updateHash(hash, 'symlink', readlinkSync(absolutePath));
    } else if (stat.isFile()) {
      updateHash(hash, 'file', readFileSync(absolutePath));
    } else {
      updateHash(hash, 'kind', 'non-file');
    }
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      updateHash(hash, 'kind', 'missing');
      return;
    }
    throw error;
  }
}

function computeFingerprint(repoRoot, harnessPaths) {
  const hash = createHash('sha256');
  updateHash(hash, 'schema', STATE_SCHEMA_VERSION);
  updateHash(hash, 'node', process.version);
  updateHash(hash, 'platform', `${process.platform}/${process.arch}`);
  const inputs = new Set([...harnessPaths, ...LOCKFILES]);
  for (const relativePath of [...inputs].sort()) {
    updateFileHash(hash, repoRoot, relativePath);
  }
  return hash.digest('hex');
}

function readJson(absolutePath) {
  try {
    return JSON.parse(readFileSync(absolutePath, 'utf8'));
  } catch {
    return null;
  }
}

function atomicWriteJson(absolutePath, value) {
  const dir = path.dirname(absolutePath);
  const tempPath = `${absolutePath}.${process.pid}.${Date.now()}.tmp`;
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    renameSync(tempPath, absolutePath);
  } finally {
    rmSync(tempPath, { force: true });
  }
}

function readState(repoRoot) {
  const state = readJson(path.join(repoRoot, STATE_FILE));
  if (
    state?.schemaVersion !== STATE_SCHEMA_VERSION
    || !['success', 'failure'].includes(state?.result)
    || typeof state?.fingerprint !== 'string'
    || typeof state?.logPath !== 'string'
  ) {
    return null;
  }
  return state;
}

function writeState(repoRoot, state) {
  atomicWriteJson(path.join(repoRoot, STATE_FILE), {
    schemaVersion: STATE_SCHEMA_VERSION,
    ...state,
  });
}

function leasePath(repoRoot) {
  return path.join(repoRoot, LEASE_FILE);
}

function acquireLease(repoRoot, fingerprint) {
  const target = leasePath(repoRoot);
  mkdirSync(path.dirname(target), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(target, `${JSON.stringify({
        schemaVersion: STATE_SCHEMA_VERSION,
        fingerprint,
        startedAt: new Date().toISOString(),
      })}\n`, { encoding: 'utf8', flag: 'wx' });
      return true;
    } catch (error) {
      if (!error || typeof error !== 'object' || error.code !== 'EEXIST') {
        throw error;
      }
      const lease = readJson(target);
      const startedAt = Date.parse(lease?.startedAt ?? '');
      if (Number.isFinite(startedAt) && Date.now() - startedAt < LEASE_STALE_MS) {
        return false;
      }
      rmSync(target, { force: true });
    }
  }
  return false;
}

function releaseLease(repoRoot, fingerprint) {
  const target = leasePath(repoRoot);
  const lease = readJson(target);
  if (!lease || lease.fingerprint === fingerprint) {
    rmSync(target, { force: true });
  }
}

function relativeLogPath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).replaceAll('\\', '/');
}

function npmInvocation(script) {
  const npmExecPath = process.env.npm_execpath?.trim();
  if (npmExecPath && existsSync(npmExecPath)) {
    return {
      command: process.execPath,
      args: [npmExecPath, 'run', script, '--silent'],
    };
  }

  const bundledNpmCli = path.join(
    path.dirname(process.execPath),
    'node_modules',
    'npm',
    'bin',
    'npm-cli.js',
  );
  if (existsSync(bundledNpmCli)) {
    return {
      command: process.execPath,
      args: [bundledNpmCli, 'run', script, '--silent'],
    };
  }

  if (process.platform === 'win32') {
    return {
      command: process.env.ComSpec || process.env.COMSPEC || 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm.cmd', 'run', script, '--silent'],
    };
  }

  return { command: 'npm', args: ['run', script, '--silent'] };
}

function appendNodeRequireOption(current, preloadPath) {
  const normalizedPath = preloadPath.replaceAll('\\', '/');
  const existing = current?.trim() ?? '';
  if (existing.includes(normalizedPath)) {
    return existing;
  }

  const requireOption = `--require="${normalizedPath}"`;
  return existing ? `${existing} ${requireOption}` : requireOption;
}

function harnessQaEnv(repoRoot) {
  const env = {
    ...process.env,
    VIBE_SKIP_AGENT_SESSION_START: '1',
  };
  const preloadPath = path.join(repoRoot, SELF_TEST_WINDOWS_HIDE_PRELOAD);
  if (process.platform === 'win32' && existsSync(preloadPath)) {
    env.NODE_OPTIONS = appendNodeRequireOption(env.NODE_OPTIONS, preloadPath);
  }
  delete env.CLAUDE_PROJECT_DIR;
  return env;
}

function selectHarnessQaScripts(repoRoot) {
  try {
    const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    if (typeof packageJson?.scripts?.['vibe:verify'] === 'string') {
      return ['vibe:verify'];
    }
  } catch {
    // Partially synced downstreams retain the legacy deterministic fallback.
  }
  return ['vibe:typecheck', 'vibe:self-test'];
}

function runHarnessQa(repoRoot) {
  const scripts = selectHarnessQaScripts(repoRoot);
  const stdout = [];
  const stderr = [];
  let status = 0;
  let error = null;

  for (const script of scripts) {
    const invocation = npmInvocation(script);
    const result = spawnSync(invocation.command, invocation.args, {
      cwd: repoRoot,
      env: harnessQaEnv(repoRoot),
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    stdout.push(`## npm run ${script}\n${result.stdout ?? ''}`);
    stderr.push(`## npm run ${script}\n${result.stderr ?? ''}`);
    if (result.status !== 0 || result.error) {
      status = typeof result.status === 'number' ? result.status : 1;
      error = result.error ?? null;
      break;
    }
  }

  return {
    scripts,
    status,
    stdout: stdout.join('\n'),
    stderr: stderr.join('\n'),
    error,
  };
}

function writeQaLog(repoRoot, result, mode) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const stamp = now.toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const dir = path.join(repoRoot, '.vibe', 'runs', date);
  const logPath = path.join(dir, `stop-harness-qa-${stamp}.log`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(logPath, [
    '# vibe-stop-qa-gate',
    `timestamp: ${now.toISOString()}`,
    `mode: ${mode}`,
    `commands: ${(result.scripts ?? ['vibe:typecheck', 'vibe:self-test'])
      .map((script) => `npm run ${script}`)
      .join('; ')}`,
    `exit: ${result.status}`,
    '',
    '## stdout',
    result.stdout.trimEnd(),
    '',
    '## stderr',
    result.stderr.trimEnd(),
    '',
    result.error ? `## error\n${result.error.message}\n` : '',
  ].join('\n'), 'utf8');
  return relativeLogPath(repoRoot, logPath);
}

function recordResult(repoRoot, fingerprint, result, mode) {
  const logPath = writeQaLog(repoRoot, result, mode);
  writeState(repoRoot, {
    fingerprint,
    result: result.status === 0 && !result.error ? 'success' : 'failure',
    exitCode: result.status,
    logPath,
    completedAt: new Date().toISOString(),
  });
  return logPath;
}

function runWorker(repoRoot, fingerprint) {
  try {
    if (hooksDisabled()) {
      return;
    }
    const harnessPaths = listHarnessChanges(repoRoot);
    if (harnessPaths.length === 0 || computeFingerprint(repoRoot, harnessPaths) !== fingerprint) {
      return;
    }
    const result = runHarnessQa(repoRoot);
    recordResult(repoRoot, fingerprint, result, 'background');
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    recordResult(repoRoot, fingerprint, {
      status: 1,
      stdout: '',
      stderr: message,
      error: null,
    }, 'background');
  } finally {
    releaseLease(repoRoot, fingerprint);
  }
}

function scheduleWorker(repoRoot, fingerprint) {
  if (!acquireLease(repoRoot, fingerprint)) {
    return false;
  }
  try {
    const workerEnv = { ...process.env };
    delete workerEnv.CLAUDE_PROJECT_DIR;
    const child = spawn(process.execPath, [
      fileURLToPath(import.meta.url),
      WORKER_FLAG,
      repoRoot,
      fingerprint,
    ], {
      cwd: repoRoot,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: workerEnv,
    });
    child.on('error', () => releaseLease(repoRoot, fingerprint));
    child.unref();
    return true;
  } catch (error) {
    releaseLease(repoRoot, fingerprint);
    throw error;
  }
}

function hookMessage(message) {
  process.stdout.write(`${JSON.stringify({ systemMessage: message })}\n`);
}

function resolveRepoRoot() {
  const hookProjectDir = process.env.CLAUDE_PROJECT_DIR?.trim()
    || (typeof HOOK_INPUT?.cwd === 'string' ? HOOK_INPUT.cwd.trim() : '');
  const invocationRoot = HOOK_MODE && hookProjectDir ? path.resolve(hookProjectDir) : process.cwd();
  if (existsSync(path.join(invocationRoot, '.git'))) {
    return invocationRoot;
  }
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: invocationRoot,
    encoding: 'utf8',
  }).trim();
}

function main() {
  if (WORKER_MODE) {
    const index = process.argv.indexOf(WORKER_FLAG);
    const repoRoot = process.argv[index + 1];
    const fingerprint = process.argv[index + 2];
    if (repoRoot && /^[a-f0-9]{64}$/.test(fingerprint ?? '')) {
      runWorker(path.resolve(repoRoot), fingerprint);
    }
    return;
  }

  if (hooksDisabled()) {
    if (!HOOK_MODE) {
      console.log('[vibe] harness hooks disabled');
    }
    return;
  }

  try {
    const repoRoot = resolveRepoRoot();
    const harnessPaths = listHarnessChanges(repoRoot);
    if (harnessPaths.length === 0) {
      if (!HOOK_MODE) {
        console.log('[vibe-harness-qa] skip: no harness-owned changes');
      }
      return;
    }

    const fingerprint = computeFingerprint(repoRoot, harnessPaths);
    const state = readState(repoRoot);
    if (!FORCE_RUN && state?.fingerprint === fingerprint) {
      if (state.result === 'success') {
        if (!HOOK_MODE) {
          console.log(`[vibe-harness-qa] skip: unchanged successful state log=${state.logPath}`);
        }
        return;
      }
      if (HOOK_MODE) {
        if (!state.reportedAt) {
          writeState(repoRoot, { ...state, reportedAt: new Date().toISOString() });
          hookMessage(`[vibe-harness-qa] background fail: exit=${state.exitCode} log=${state.logPath}`);
        }
        return;
      }
    }

    if (!existsSync(path.join(repoRoot, 'node_modules', 'tsx', 'package.json'))) {
      const message = '[vibe-harness-qa] skip: tsx not installed — run `npm install` first';
      if (HOOK_MODE) {
        hookMessage(message);
      } else {
        console.log(message);
      }
      return;
    }

    if (HOOK_MODE) {
      scheduleWorker(repoRoot, fingerprint);
      return;
    }

    console.log(`[vibe-harness-qa] run: ${harnessPaths.slice(0, 3).join(', ')}`);
    const result = runHarnessQa(repoRoot);
    const logPath = recordResult(repoRoot, fingerprint, result, 'manual');
    if (result.status === 0 && !result.error) {
      console.log(`[vibe-harness-qa] ok: log=${logPath}`);
      return;
    }
    console.error(`[vibe-harness-qa] fail: exit=${result.status} log=${logPath}`);
    process.exitCode = result.status;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const summary = `[vibe-harness-qa] gate error: ${message}`;
    if (HOOK_MODE) {
      hookMessage(summary);
    } else {
      console.error(summary);
    }
  }
}

main();
