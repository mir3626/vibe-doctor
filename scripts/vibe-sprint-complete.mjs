#!/usr/bin/env node

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

const [, , sprintId, status, ...rest] = process.argv;
if (!sprintId || !status || !['passed', 'failed'].includes(status)) {
  fail('Usage: node scripts/vibe-sprint-complete.mjs <sprintId> <passed|failed> [--summary "summary text"]');
}

let summary = '';
for (let i = 0; i < rest.length; i += 1) {
  if (rest[i] === '--summary') {
    summary = rest[i + 1] ?? '';
    i += 1;
  }
}

const nowIso = new Date().toISOString();
const finalSummary = summary || `Sprint ${sprintId} completed with ${status}`;

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

const existingSprint = sprintStatus.sprints.find((entry) => entry?.id === sprintId);
if (existingSprint) {
  warn(`sprint "${sprintId}" already exists in sprints[] - updating existing entry`);
  existingSprint.name = sprintId;
  existingSprint.status = status;
  existingSprint.completedAt = nowIso;
} else {
  sprintStatus.sprints.push({
    id: sprintId,
    name: sprintId,
    status,
    completedAt: nowIso,
  });
}

sprintStatus.handoff = {
  ...(sprintStatus.handoff ?? {}),
  currentSprintId: 'idle',
  lastActionSummary: finalSummary,
  updatedAt: nowIso,
};

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
  const entry = `- ${nowIso} [sprint-complete] ${sprintId} -> ${status}. ${finalSummary}`;
  const entriesPattern = /(^## Entries\s*$\n?)/m;

  if (!entriesPattern.test(sessionLogContent)) {
    warn(`could not find "## Entries" section in ${sessionLogPath} - skipping append`);
  } else {
    const updatedSessionLog = sessionLogContent.replace(entriesPattern, `$1\n${entry}\n`);
    writeFileSync(sessionLogPath, updatedSessionLog, 'utf8');
  }
}
