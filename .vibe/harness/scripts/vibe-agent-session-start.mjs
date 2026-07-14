#!/usr/bin/env node
// Provider-neutral session-start entrypoint.
// Runs best-effort lifecycle checks without polluting provider stdout.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SESSION_START_DEDUPE_MS = 60_000;

function readHookInput() {
  if (process.stdin.isTTY) {
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
const HOOK_MODE = process.argv.includes('--hook') || HOOK_INPUT?.hook_event_name === 'SessionStart';
const vibeHarnessHooks = process.env.VIBE_HARNESS_HOOKS?.trim().toLowerCase();
if (vibeHarnessHooks === 'off' || vibeHarnessHooks === '0' || vibeHarnessHooks === 'false') {
  if (!HOOK_MODE) {
    console.log(`[vibe] harness hooks disabled (VIBE_HARNESS_HOOKS=${vibeHarnessHooks})`);
  }
  process.exit(0);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const hookProjectDir = process.env.CLAUDE_PROJECT_DIR?.trim()
  || (typeof HOOK_INPUT?.cwd === 'string' ? HOOK_INPUT.cwd.trim() : '');
const root = HOOK_MODE && hookProjectDir
  ? path.resolve(hookProjectDir)
  : process.env.VIBE_ROOT
    ? path.resolve(process.env.VIBE_ROOT)
    : process.cwd();

const steps = [
  'vibe-session-started.mjs',
  'vibe-version-check.mjs',
  'vibe-model-registry-check.mjs',
];

function hookString(field) {
  const value = HOOK_INPUT?.[field];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

const hookSessionId = hookString('session_id');
const hookSource = hookString('source');

function writeStderr(value) {
  if (value) {
    process.stderr.write(value.endsWith('\n') ? value : `${value}\n`);
  }
}

function claimHookDelivery() {
  if (!HOOK_MODE || !hookSessionId) {
    return true;
  }

  const key = createHash('sha256')
    .update(`${hookSessionId}\0${hookSource || 'unknown'}`, 'utf8')
    .digest('hex');
  const markerDir = path.join(root, '.vibe', 'runs', 'session-start-deliveries');
  const markerPath = path.join(markerDir, `${key}.json`);
  mkdirSync(markerDir, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(markerPath, `${JSON.stringify({
        schemaVersion: 1,
        sessionId: hookSessionId,
        source: hookSource || null,
        claimedAt: new Date().toISOString(),
      })}\n`, { encoding: 'utf8', flag: 'wx' });
      return true;
    } catch (error) {
      if (!error || typeof error !== 'object' || error.code !== 'EEXIST') {
        writeStderr(`[vibe-agent-session-start] dedupe unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`);
        return true;
      }

      try {
        if (Date.now() - statSync(markerPath).mtimeMs < SESSION_START_DEDUPE_MS) {
          return false;
        }
      } catch (statError) {
        if (!statError || typeof statError !== 'object' || statError.code !== 'ENOENT') {
          writeStderr(`[vibe-agent-session-start] dedupe marker unreadable: ${
            statError instanceof Error ? statError.message : String(statError)
          }`);
          return true;
        }
      }
      rmSync(markerPath, { force: true });
    }
  }

  return false;
}

function stepEnv() {
  const env = {
    ...process.env,
    VIBE_ROOT: root,
    VIBE_SESSION_INVOCATION: HOOK_MODE ? 'hook' : 'provider-wrapper',
  };
  delete env.VIBE_SESSION_ID;
  delete env.VIBE_SESSION_SOURCE;
  if (hookSessionId) {
    env.VIBE_SESSION_ID = hookSessionId;
  }
  if (hookSource) {
    env.VIBE_SESSION_SOURCE = hookSource;
  }
  return env;
}

function runStep(scriptName) {
  const scriptPath = path.join(scriptDir, scriptName);
  if (!existsSync(scriptPath)) {
    return;
  }

  const child = spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    env: stepEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  writeStderr(child.stdout ?? '');
  writeStderr(child.stderr ?? '');

  if (child.error) {
    writeStderr(`[vibe-agent-session-start] ${scriptName} skipped: ${child.error.message}`);
  } else if (typeof child.status === 'number' && child.status !== 0) {
    writeStderr(`[vibe-agent-session-start] ${scriptName} exited ${child.status}`);
  }
}

if (process.env.VIBE_SKIP_AGENT_SESSION_START === '1') {
  process.exit(0);
}

if (!claimHookDelivery()) {
  process.exit(0);
}

for (const step of steps) {
  runStep(step);
}

process.exit(0);
