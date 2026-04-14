#!/usr/bin/env node
// vibe-preflight performs mechanical Sprint start checks.
// Replaces the former .vibe/agent/preflight.md runbook.
// Usage: node scripts/vibe-preflight.mjs [--json]

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const JSON_MODE = process.argv.includes('--json');
const BOOTSTRAP_MODE = process.argv.includes('--bootstrap');
const results = [];

function record(id, ok, detail) {
  results.push({ id, ok, detail });
}

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts }).trim();
}

function parseIso(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time);
}

function getLastCommitDate() {
  try {
    const value = sh('git log -1 --format=%cI');
    return parseIso(value);
  } catch {
    return null;
  }
}

// 1. Git work tree
if (BOOTSTRAP_MODE) {
  record('git.worktree', true, 'bootstrap mode - git worktree check skipped');
} else {
  try {
    const inside = sh('git rev-parse --is-inside-work-tree');
    record('git.worktree', inside === 'true', inside || 'not a git repo');
  } catch {
    record('git.worktree', false, 'not a git repo - run: git init && git add -A && git -c commit.gpgsign=false commit -m "chore: initial scaffold"');
  }
}

// 2. Git clean
if (BOOTSTRAP_MODE) {
  record('git.clean', true, 'bootstrap mode - git clean check skipped');
} else {
  try {
    const dirty = sh('git status --short');
    record('git.clean', dirty === '', dirty ? `uncommitted:\n${dirty}` : 'clean');
  } catch (e) {
    record('git.clean', false, e.message);
  }
}

// 3. package.json delta vs HEAD~1 (first-commit aware)
if (BOOTSTRAP_MODE) {
  record('deps.delta', true, 'bootstrap mode - dependency delta check skipped');
} else {
  try {
    const hasPkg = existsSync(resolve('package.json'));
    if (!hasPkg) {
      record('deps.delta', true, 'no package.json (skip)');
    } else {
      let hasParent = false;
      try {
        sh('git rev-parse HEAD~1');
        hasParent = true;
      } catch {
        hasParent = false;
      }

      if (!hasParent) {
        record('deps.delta', true, 'single-commit repo - baseline; run npm install once outside sandbox');
      } else {
        const diff = sh('git diff HEAD~1 HEAD -- package.json');
        record('deps.delta', true, diff ? 'package.json changed since HEAD~1 - Orchestrator must run npm install outside sandbox' : 'no change');
      }
    }
  } catch (e) {
    record('deps.delta', false, e.message);
  }
}

// 4. Provider health - dynamically from .vibe/config.json (or config.local.json)
const configPaths = [resolve('.vibe/config.local.json'), resolve('.vibe/config.json')];
let cfg = null;
for (const p of configPaths) {
  if (existsSync(p)) {
    try {
      cfg = JSON.parse(readFileSync(p, 'utf8'));
      break;
    } catch {
      // fall through
    }
  }
}

if (!cfg) {
  record('provider.config', false, 'no .vibe/config.json - run /vibe-init');
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
        record(`provider.${name}`, false, `${p.command} CLI not found or not authenticated - check: ${p.command} --version`);
      }
    }
  }
}

// 5. Sprint status + handoff presence
const statusPath = resolve('.vibe/agent/sprint-status.json');
const handoffPath = resolve('.vibe/agent/handoff.md');
const sessionLogPath = resolve('.vibe/agent/session-log.md');
let sprintStatus = null;
if (BOOTSTRAP_MODE) {
  record('sprint.status', true, 'bootstrap mode - sprint status check skipped');
} else {
  try {
    if (existsSync(statusPath)) {
      sprintStatus = JSON.parse(readFileSync(statusPath, 'utf8'));
      const vc = Array.isArray(sprintStatus.verificationCommands) ? sprintStatus.verificationCommands.length : 0;
      record('sprint.status', true, `${vc} verification commands cumulative; handoff.currentSprintId=${sprintStatus.handoff?.currentSprintId ?? 'n/a'}`);
    } else {
      record('sprint.status', true, 'no sprint-status.json yet (first sprint)');
    }
  } catch (e) {
    record('sprint.status', false, e.message);
  }
}

const hasHandoff = existsSync(handoffPath);
const hasSessionLog = existsSync(sessionLogPath);
if (BOOTSTRAP_MODE) {
  record('sprint.handoff', true, 'bootstrap mode - handoff check skipped');
} else {
  record(
    'sprint.handoff',
    hasHandoff && hasSessionLog,
    hasHandoff && hasSessionLog
      ? `handoff=${handoffPath}; sessionLog=${sessionLogPath}`
      : `missing handoff=${hasHandoff ? 'present' : handoffPath}; sessionLog=${hasSessionLog ? 'present' : sessionLogPath}`
  );
}

try {
  if (BOOTSTRAP_MODE) {
    record('handoff.stale', true, 'bootstrap mode - handoff freshness check skipped');
  } else if (!hasHandoff) {
    record('handoff.stale', true, 'warning: handoff missing; freshness skipped');
  } else {
    const updatedAt = parseIso(sprintStatus?.handoff?.updatedAt);
    const lastCommit = getLastCommitDate();
    const handoffMtime = statSync(handoffPath).mtime;

    if (!updatedAt) {
      record(
        'handoff.stale',
        true,
        `warning: handoff.updatedAt missing or invalid; mtime=${handoffMtime.toISOString()}, lastCommit=${lastCommit ? lastCommit.toISOString() : 'n/a'}`
      );
    } else if (lastCommit && updatedAt.getTime() < lastCommit.getTime()) {
      record(
        'handoff.stale',
        true,
        `warning: handoff stale: updatedAt=${updatedAt.toISOString()}, mtime=${handoffMtime.toISOString()}, lastCommit=${lastCommit.toISOString()}`
      );
    } else {
      record(
        'handoff.stale',
        true,
        `fresh enough: updatedAt=${updatedAt.toISOString()}, mtime=${handoffMtime.toISOString()}, lastCommit=${lastCommit ? lastCommit.toISOString() : 'n/a'}`
      );
    }
  }
} catch (e) {
  record('handoff.stale', true, `warning: unable to evaluate handoff freshness (${e.message})`);
}

// 6. product.md existence (Phase 0 gate)
const productPath = resolve('docs/context/product.md');
const hasProduct = existsSync(productPath);
if (hasProduct) {
  const content = readFileSync(productPath, 'utf8').trim();
  record('phase0.product', content.length > 50, content.length > 50 ? 'product.md present and populated' : 'product.md exists but too short (<50 chars)');
} else {
  record('phase0.product', false, 'missing docs/context/product.md - run Phase 0 (Ouroboros PM interview) first');
}

// 7. Harness version check
try {
  const config = JSON.parse(readFileSync(resolve('.vibe/config.json'), 'utf8'));
  if (config.harnessVersion && config.harnessVersionInstalled) {
    if (config.harnessVersion !== config.harnessVersionInstalled) {
      record(
        'harness.version',
        true,
        `installed: ${config.harnessVersionInstalled}, available: ${config.harnessVersion}. Run: npm run vibe:sync`,
      );
    } else {
      record('harness.version', true, `v${config.harnessVersion}`);
    }
  } else {
    record('harness.version', true, 'no version tracking configured');
  }
} catch {
  record('harness.version', true, 'version check skipped');
}

// 8. Optional orchestration shard presence
const orchestrationPath = resolve('docs/context/orchestration.md');
if (existsSync(orchestrationPath)) {
  record('orchestration.doc', true, 'present');
} else {
  record('orchestration.doc', true, 'missing (optional shard - v1.1.0+)');
}

if (JSON_MODE) {
  process.stdout.write(JSON.stringify(results, null, 2) + '\n');
} else {
  for (const r of results) {
    const mark = r.ok ? 'OK ' : 'FAIL';
    process.stdout.write(`[${mark}] ${r.id} - ${r.detail}\n`);
  }
}

const anyFail = results.some((r) => !r.ok);
process.exit(anyFail ? 1 : 0);
