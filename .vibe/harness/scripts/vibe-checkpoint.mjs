#!/usr/bin/env node
// vibe-checkpoint performs mechanical context persistence checks.
// Usage: node .vibe/harness/scripts/vibe-checkpoint.mjs [--json] [--auto-refresh]

const vibeHarnessHooks = process.env.VIBE_HARNESS_HOOKS?.trim().toLowerCase();
if (vibeHarnessHooks === 'off' || vibeHarnessHooks === '0' || vibeHarnessHooks === 'false') {
  console.log(`[vibe] harness hooks disabled (VIBE_HARNESS_HOOKS=${vibeHarnessHooks})`);
  process.exit(0);
}

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const JSON_MODE = process.argv.includes('--json');
const AUTO_REFRESH = process.argv.includes('--auto-refresh');
const results = [];
const MAX_HANDOFF_BYTES = Number.parseInt(process.env.VIBE_HANDOFF_MAX_BYTES ?? '', 10) || 96 * 1024;
const MAX_HANDOFF_LINES = Number.parseInt(process.env.VIBE_HANDOFF_MAX_LINES ?? '', 10) || 1200;
const MIN_DOC_BYTES = Number.parseInt(process.env.VIBE_DOC_MIN_BYTES ?? '', 10) || 64;
const AUTO_STATE_START = '<!-- vibe:auto-state:start -->';
const AUTO_STATE_END = '<!-- vibe:auto-state:end -->';
const DOC_INTEGRITY_FIXED = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.vibe/agent/_common-rules.md'];

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

const handoffPath = resolve('.vibe/agent/handoff.md');
const sessionLogPath = resolve('.vibe/agent/session-log.md');
const statusPath = resolve('.vibe/agent/sprint-status.json');

function getHandoffFreshness(status, lastCommit) {
  const updatedAt = parseIso(status?.handoff?.updatedAt);
  const mtime = statSync(handoffPath).mtime;
  const freshest = [updatedAt, mtime]
    .filter(Boolean)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const recentCutoff = Date.now() - (30 * 60 * 1000);
  const freshByTime = freshest ? freshest.getTime() >= recentCutoff : false;
  const freshByCommit = freshest && lastCommit ? freshest.getTime() >= lastCommit.getTime() : false;
  const updatedAtText = updatedAt ? updatedAt.toISOString() : String(status?.handoff?.updatedAt ?? 'n/a');
  const mtimeText = mtime.toISOString();
  const lastCommitText = lastCommit ? lastCommit.toISOString() : 'n/a';
  const detail = `updatedAt=${updatedAtText}, mtime=${mtimeText}, lastCommit=${lastCommitText}`;

  return {
    fresh: Boolean(freshByTime || freshByCommit),
    updatedAt,
    detail: freshByTime || freshByCommit ? detail : `handoff stale: ${detail}`,
  };
}

function upsertAutoStateBlock(content, block) {
  const start = content.indexOf(AUTO_STATE_START);
  const end = content.indexOf(AUTO_STATE_END);
  if (start !== -1 && end > start) {
    return content.slice(0, start) + block + content.slice(end + AUTO_STATE_END.length);
  }

  const match = content.match(/^# .*$/m);
  if (match?.index !== undefined) {
    const at = match.index + match[0].length;
    return `${content.slice(0, at)}\n\n${block}${content.slice(at)}`;
  }

  return `${block}\n\n${content}`;
}

function runAutoRefresh() {
  try {
    if (!existsSync(handoffPath) || !existsSync(statusPath)) {
      return;
    }

    const status = JSON.parse(readFileSync(statusPath, 'utf8'));
    if (
      !status
      || typeof status !== 'object'
      || Array.isArray(status)
      || !status.handoff
      || typeof status.handoff !== 'object'
      || Array.isArray(status.handoff)
    ) {
      return;
    }

    const g = (cmd) => {
      try {
        return sh(cmd);
      } catch {
        return '';
      }
    };
    if (g('git rev-parse --is-inside-work-tree') !== 'true') {
      return;
    }

    const lastCommit = getLastCommitDate();
    const { fresh, updatedAt } = getHandoffFreshness(status, lastCommit);
    const porcelain = g('git status --porcelain').split(/\r?\n/).filter(Boolean);
    const isOutdated = porcelain.length > 0 || Boolean(lastCommit && updatedAt && lastCommit.getTime() > updatedAt.getTime());
    if (fresh && !isOutdated) {
      return;
    }

    const now = new Date().toISOString();
    const recentCommits = g('git log -5 --format=%h%x09%s')
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(0, 5)
      .map((line) => `- ${line.replace('\t', ' ')}`);
    const body = [
      'Auto-captured git snapshot (PreCompact); not a substitute for the narrative below.',
      `Captured: ${now}`,
      `Branch: ${g('git rev-parse --abbrev-ref HEAD') || 'n/a'} @ ${(g('git log -1 --format=%h%x09%s') || 'n/a').replace('\t', ' ')}`,
      `Uncommitted: ${porcelain.length} file(s)`,
      ...porcelain.slice(0, 20).map((line) => `- ${line}`),
      ...(porcelain.length > 20 ? [`- ... +${porcelain.length - 20} more`] : []),
      `Staged: ${g('git diff --cached --shortstat') || 'none'}; Unstaged: ${g('git diff --shortstat') || 'none'}`,
      'Recent commits:',
      ...(recentCommits.length > 0 ? recentCommits : ['- n/a']),
    ];
    const block = [AUTO_STATE_START, ...body.map((line) => `> ${line}`), AUTO_STATE_END].join('\n');

    writeFileSync(handoffPath, upsertAutoStateBlock(readFileSync(handoffPath, 'utf8'), block), 'utf8');
    status.handoff.updatedAt = now;
    writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
  } catch {
  }
}

function getDocIntegrityTargets() {
  try {
    if (sh('git rev-parse --is-inside-work-tree') === 'true') {
      const tracked = sh('git ls-files -- CLAUDE.md AGENTS.md GEMINI.md .vibe/agent/_common-rules.md "docs/context/*.md"')
        .split(/\r?\n/)
        .filter(Boolean)
        .filter((file) => existsSync(resolve(file)));
      return { degraded: false, targets: tracked };
    }
  } catch {
  }

  const contextDir = resolve('docs/context');
  let contextDocs = [];
  try {
    contextDocs = existsSync(contextDir)
      ? readdirSync(contextDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => `docs/context/${entry.name}`)
      : [];
  } catch {
  }

  return {
    degraded: true,
    targets: [
      ...DOC_INTEGRITY_FIXED.filter((file) => existsSync(resolve(file))),
      ...contextDocs,
    ],
  };
}

if (AUTO_REFRESH) {
  runAutoRefresh();
}

record('handoff.exists', existsSync(handoffPath), existsSync(handoffPath) ? handoffPath : `missing: ${handoffPath}`);
record('session-log.exists', existsSync(sessionLogPath), existsSync(sessionLogPath) ? sessionLogPath : `missing: ${sessionLogPath}`);

let status = null;
let statusOk = false;
try {
  if (!existsSync(statusPath)) {
    record('status.exists', false, `missing: ${statusPath}`);
  } else {
    status = JSON.parse(readFileSync(statusPath, 'utf8'));
    statusOk = true;
    record('status.exists', true, statusPath);
  }
} catch (e) {
  record('status.exists', false, `${statusPath}: ${e.message}`);
}

try {
  if (!existsSync(handoffPath)) {
    record('handoff.fresh', false, `handoff missing: ${handoffPath}`);
  } else if (!statusOk) {
    record('handoff.fresh', false, 'sprint-status.json unavailable for freshness check');
  } else {
    const lastCommit = getLastCommitDate();
    const { fresh, detail } = getHandoffFreshness(status, lastCommit);
    record('handoff.fresh', fresh, detail);
  }
} catch (e) {
  record('handoff.fresh', false, e.message);
}

try {
  if (!existsSync(handoffPath)) {
    record('handoff.budget', false, `handoff missing: ${handoffPath}`);
  } else {
    const content = readFileSync(handoffPath, 'utf8');
    const bytes = Buffer.byteLength(content, 'utf8');
    const lines = content.split(/\r?\n/).length;
    const ok = bytes <= MAX_HANDOFF_BYTES && lines <= MAX_HANDOFF_LINES;
    record(
      'handoff.budget',
      ok,
      ok
        ? `bytes=${bytes}/${MAX_HANDOFF_BYTES}, lines=${lines}/${MAX_HANDOFF_LINES}`
        : `handoff too large for active context: bytes=${bytes}/${MAX_HANDOFF_BYTES}, lines=${lines}/${MAX_HANDOFF_LINES}. Archive old history and keep only current state, verification, risks, and restart steps.`,
    );
  }
} catch (e) {
  record('handoff.budget', false, e.message);
}

try {
  const { degraded, targets } = getDocIntegrityTargets();
  const failures = [];
  for (const file of targets) {
    try {
      const content = readFileSync(resolve(file), 'utf8');
      const bytes = Buffer.byteLength(content, 'utf8');
      if (content.trim() === '') {
        failures.push(`${file}: empty`);
      } else if (bytes < MIN_DOC_BYTES) {
        failures.push(`${file}: below threshold (${bytes}/${MIN_DOC_BYTES} bytes)`);
      }
    } catch (e) {
      failures.push(`${file}: read error (${e.message})`);
    }
  }
  record(
    'docs.integrity',
    failures.length === 0,
    failures.length === 0
      ? `checked=${targets.length} file(s)${degraded ? ' (degraded)' : ''}`
      : `${failures.join('; ')}. Restore the document from git; do not regenerate it.`,
  );
} catch (e) {
  record('docs.integrity', false, e.message);
}

try {
  if (!existsSync(sessionLogPath)) {
    record('session-log.not-empty', false, `session-log missing: ${sessionLogPath}`);
  } else {
    const content = readFileSync(sessionLogPath, 'utf8');
    const entriesIndex = content.search(/^## Entries\s*$/m);

    if (entriesIndex === -1) {
      record('session-log.not-empty', false, 'missing "## Entries" section');
    } else {
      const entriesContent = content.slice(entriesIndex);
      const bulletCount = (entriesContent.match(/^- /gm) ?? []).length;
      record('session-log.not-empty', bulletCount > 0, bulletCount > 0 ? `${bulletCount} entries` : 'no bullet entries under ## Entries');
    }
  }
} catch (e) {
  record('session-log.not-empty', false, e.message);
}

try {
  if (!statusOk) {
    record('context.budget', false, 'sprint-status.json unavailable for context budget check');
  } else {
    const budget = status?.handoff?.orchestratorContextBudget;
    const valid = budget === 'low' || budget === 'medium' || budget === 'high';

    if (!valid) {
      record('context.budget', false, `invalid orchestratorContextBudget: ${String(budget)}`);
    } else if (budget === 'high') {
      record('context.budget', true, 'warning: orchestratorContextBudget=high');
    } else {
      record('context.budget', true, `orchestratorContextBudget=${budget}`);
    }
  }
} catch (e) {
  record('context.budget', false, e.message);
}

if (JSON_MODE) {
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
} else {
  for (const r of results) {
    const mark = r.ok ? 'OK ' : 'FAIL';
    process.stdout.write(`[${mark}] ${r.id} - ${r.detail}\n`);
  }
}

const anyFail = results.some((r) => !r.ok);
if (anyFail) {
  process.stderr.write('Checkpoint blocked - update .vibe/agent/handoff.md + session-log.md then retry.\n');
}
process.exit(anyFail ? 1 : 0);
