#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function warn(message) {
  process.stderr.write(`Warning: ${message}\n`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sh(cmd) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
}

function trySh(cmd) {
  try {
    return sh(cmd);
  } catch {
    return null;
  }
}

function parseShortStat(shortstat) {
  const text = shortstat.trim();
  const filesChanged = Number(text.match(/(\d+)\s+files?\s+changed/)?.[1] ?? 0);
  const added = Number(text.match(/(\d+)\s+insertions?\(\+\)/)?.[1] ?? 0);
  const deleted = Number(text.match(/(\d+)\s+deletions?\(-\)/)?.[1] ?? 0);
  return {
    added,
    deleted,
    net: added - deleted,
    filesChanged,
  };
}

function getActualLoc() {
  const hasHead = trySh('git rev-parse --verify HEAD');
  if (!hasHead) {
    return null;
  }

  const hasParent = trySh('git rev-parse --verify HEAD~1');
  const shortstat = hasParent
    ? trySh('git diff --shortstat HEAD~1 HEAD')
    : trySh('git show --shortstat --format= --root HEAD');

  if (shortstat === null) {
    return null;
  }

  return parseShortStat(shortstat);
}

function formatNet(value) {
  return value >= 0 ? `+${value}` : `${value}`;
}

function parseScopeValue(value) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function readAuditEveryN() {
  const configPath = resolve('.vibe/config.json');
  if (!existsSync(configPath)) {
    return 5;
  }

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    return Number.isInteger(config?.audit?.everyN) ? config.audit.everyN : 5;
  } catch {
    return 5;
  }
}

const [, , sprintId, status, ...rest] = process.argv;
if (!sprintId || !status || !['passed', 'failed'].includes(status)) {
  fail('Usage: node scripts/vibe-sprint-complete.mjs <sprintId> <passed|failed> [--summary "summary text"] [--scope <path1,path2,...>]');
}

let summary = '';
let scope = null;
for (let i = 0; i < rest.length; i += 1) {
  if (rest[i] === '--summary') {
    summary = rest[i + 1] ?? '';
    i += 1;
  } else if (rest[i] === '--scope') {
    scope = parseScopeValue(rest[i + 1] ?? '');
    i += 1;
  }
}

const nowIso = new Date().toISOString();
const finalSummary = summary || `Sprint ${sprintId} completed with ${status}`;
const actualLoc = getActualLoc();

const statusPath = resolve('.vibe/agent/sprint-status.json');
const handoffPath = resolve('.vibe/agent/handoff.md');
const sessionLogPath = resolve('.vibe/agent/session-log.md');

if (!existsSync(statusPath)) {
  fail(`Missing required file: ${statusPath}`);
}

let sprintStatus;
try {
  sprintStatus = JSON.parse(readFileSync(statusPath, 'utf8'));
} catch (error) {
  fail(`Failed to parse ${statusPath}: ${error.message}`);
}

if (!Array.isArray(sprintStatus.sprints)) {
  sprintStatus.sprints = [];
}
if (!Array.isArray(sprintStatus.pendingRisks)) {
  sprintStatus.pendingRisks = [];
}
if (!Number.isInteger(sprintStatus.sprintsSinceLastAudit)) {
  sprintStatus.sprintsSinceLastAudit = 0;
}

const existingSprint = sprintStatus.sprints.find((entry) => entry?.id === sprintId);
if (existingSprint) {
  warn(`sprint "${sprintId}" already exists in sprints[] - updating existing entry`);
  existingSprint.name = sprintId;
  existingSprint.status = status;
  existingSprint.completedAt = nowIso;
  if (actualLoc) {
    existingSprint.actualLoc = actualLoc;
  } else {
    delete existingSprint.actualLoc;
  }
} else {
  const nextSprint = {
    id: sprintId,
    name: sprintId,
    status,
    completedAt: nowIso,
  };
  if (actualLoc) {
    nextSprint.actualLoc = actualLoc;
  }
  sprintStatus.sprints.push(nextSprint);
}

if (scope !== null) {
  sprintStatus.lastSprintScope = [...scope];
  sprintStatus.lastSprintScopeGlob = [...scope];
}

if (status === 'passed') {
  sprintStatus.sprintsSinceLastAudit += 1;
  const everyN = readAuditEveryN();
  const auditRiskId = `audit-${sprintId}`;
  if (
    sprintStatus.sprintsSinceLastAudit >= everyN &&
    !sprintStatus.pendingRisks.some((entry) => entry?.id === auditRiskId)
  ) {
    sprintStatus.pendingRisks.push({
      id: auditRiskId,
      raisedBy: 'vibe-sprint-complete',
      targetSprint: '*',
      text: `Evaluator audit due (sprintsSinceLastAudit=${sprintStatus.sprintsSinceLastAudit}, everyN=${everyN}).`,
      status: 'open',
      createdAt: nowIso,
    });
  }
}

sprintStatus.handoff = {
  ...(sprintStatus.handoff ?? {}),
  currentSprintId: 'idle',
  lastActionSummary: finalSummary,
  updatedAt: nowIso,
};
sprintStatus.stateUpdatedAt = nowIso;

writeFileSync(statusPath, `${JSON.stringify(sprintStatus, null, 2)}\n`, 'utf8');

if (!existsSync(handoffPath)) {
  warn(`missing ${handoffPath} - skipping handoff update`);
} else {
  const handoffContent = readFileSync(handoffPath, 'utf8');
  const nextStatusLine = `## 2. Status: IDLE - Sprint ${sprintId} ${status}`;
  let updatedHandoff = handoffContent.replace(/^## 2\. Status:.*$/m, nextStatusLine);

  if (updatedHandoff === handoffContent) {
    warn(`could not find "## 2. Status:" section in ${handoffPath}`);
  }

  const historyRow = `| \`${sprintId}\` | ${sprintId} | ${status} |`;
  const historyPattern = /(^## 3\.[^\n]*\n\n\|.*\n\|[-| ]+\n)((?:\|.*\n)*)/m;
  if (historyPattern.test(updatedHandoff)) {
    updatedHandoff = updatedHandoff.replace(historyPattern, (_, header, rows) => {
      const duplicatePattern = new RegExp(`^\\|\\s*\\\`${escapeRegExp(sprintId)}\\\`\\s*\\|.*$`, 'm');
      const filteredRows = rows
        .split('\n')
        .filter((line) => line && !duplicatePattern.test(line));
      return `${header}${[...filteredRows, historyRow].join('\n')}\n`;
    });
  } else {
    warn(`could not find sprint history table in ${handoffPath}`);
  }

  writeFileSync(handoffPath, updatedHandoff, 'utf8');
}

if (!existsSync(sessionLogPath)) {
  warn(`missing ${sessionLogPath} - skipping session log update`);
} else {
  const sessionLogContent = readFileSync(sessionLogPath, 'utf8');
  const locSuffix = actualLoc
    ? ` LOC +${actualLoc.added}/-${actualLoc.deleted} (net ${formatNet(actualLoc.net)})`
    : '';
  const entry = `- ${nowIso} [sprint-complete] ${sprintId} -> ${status}. ${finalSummary}${locSuffix}`;
  const entriesPattern = /(^## Entries\s*$\n?)/m;

  if (!entriesPattern.test(sessionLogContent)) {
    warn(`could not find "## Entries" section in ${sessionLogPath} - skipping append`);
  } else {
    const updatedSessionLog = sessionLogContent.replace(entriesPattern, `$1\n${entry}\n`);
    writeFileSync(sessionLogPath, updatedSessionLog, 'utf8');
  }
}
