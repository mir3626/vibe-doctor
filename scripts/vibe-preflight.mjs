#!/usr/bin/env node
// vibe-preflight — mechanical Sprint start checks.
// Replaces the former .vibe/agent/preflight.md runbook.
// Usage: node scripts/vibe-preflight.mjs [--json]

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const JSON_MODE = process.argv.includes('--json');
const results = [];

function record(id, ok, detail) {
  results.push({ id, ok, detail });
}

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts }).trim();
}

// 1. Git work tree
try {
  const inside = sh('git rev-parse --is-inside-work-tree');
  record('git.worktree', inside === 'true', inside || 'not a git repo');
} catch {
  record('git.worktree', false, 'not a git repo — run: git init && git add -A && git -c commit.gpgsign=false commit -m "chore: initial scaffold"');
}

// 2. Git clean
try {
  const dirty = sh('git status --short');
  record('git.clean', dirty === '', dirty ? `uncommitted:\n${dirty}` : 'clean');
} catch (e) {
  record('git.clean', false, e.message);
}

// 3. package.json delta vs HEAD~1 (first-commit aware)
try {
  const hasPkg = existsSync(resolve('package.json'));
  if (!hasPkg) {
    record('deps.delta', true, 'no package.json (skip)');
  } else {
    let hasParent = false;
    try { sh('git rev-parse HEAD~1'); hasParent = true; } catch { hasParent = false; }
    if (!hasParent) {
      record('deps.delta', true, 'single-commit repo — baseline; run npm install once outside sandbox');
    } else {
      const diff = sh('git diff HEAD~1 HEAD -- package.json');
      record('deps.delta', true, diff ? 'package.json changed since HEAD~1 — Orchestrator must run npm install OUTSIDE sandbox' : 'no change');
    }
  }
} catch (e) {
  record('deps.delta', false, e.message);
}

// 4. Provider health — dynamically from .vibe/config.json (or config.local.json)
const configPaths = [resolve('.vibe/config.local.json'), resolve('.vibe/config.json')];
let cfg = null;
for (const p of configPaths) {
  if (existsSync(p)) {
    try { cfg = JSON.parse(readFileSync(p, 'utf8')); break; } catch { /* fall through */ }
  }
}

if (!cfg) {
  record('provider.config', false, 'no .vibe/config.json — run /vibe-init');
} else {
  const sprintRoles = cfg.sprintRoles ?? {};
  const providers = cfg.providers ?? {};
  const needed = new Set(Object.values(sprintRoles).filter(Boolean));
  if (needed.size === 0) {
    record('provider.config', true, 'no sprintRoles configured (skip health check)');
  } else {
    for (const name of needed) {
      const p = providers[name];
      if (!p || !p.command) {
        record(`provider.${name}`, false, `no command configured for "${name}" in .vibe/config.json providers`);
        continue;
      }
      try {
        const v = sh(`${p.command} --version`);
        record(`provider.${name}`, true, v.split('\n')[0]);
      } catch {
        record(`provider.${name}`, false, `${p.command} CLI not found or not authenticated — check ! ${p.command} --version`);
      }
    }
  }
}

// 5. Sprint status + handoff presence
const statusPath = resolve('.vibe/agent/sprint-status.json');
const handoffPath = resolve('.vibe/agent/handoff.md');
try {
  if (existsSync(statusPath)) {
    const status = JSON.parse(readFileSync(statusPath, 'utf8'));
    const vc = Array.isArray(status.verificationCommands) ? status.verificationCommands.length : 0;
    record('sprint.status', true, `${vc} verification commands cumulative; handoff.currentSprintId=${status.handoff?.currentSprintId ?? 'n/a'}`);
  } else {
    record('sprint.status', true, 'no sprint-status.json yet (first sprint)');
  }
} catch (e) {
  record('sprint.status', false, e.message);
}
record('sprint.handoff', existsSync(handoffPath), existsSync(handoffPath) ? handoffPath : 'missing — create before next compaction');

// Output
if (JSON_MODE) {
  process.stdout.write(JSON.stringify(results, null, 2) + '\n');
} else {
  for (const r of results) {
    const mark = r.ok ? 'OK ' : 'FAIL';
    process.stdout.write(`[${mark}] ${r.id} — ${r.detail}\n`);
  }
}

const anyFail = results.some((r) => !r.ok);
process.exit(anyFail ? 1 : 0);
