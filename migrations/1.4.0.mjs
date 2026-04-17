#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function compareVersions(left, right) {
  const leftParts = String(left ?? '')
    .replace(/^v/, '')
    .split('.')
    .map((part) => Number(part));
  const rightParts = String(right ?? '')
    .replace(/^v/, '')
    .split('.')
    .map((part) => Number(part));
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function patchSprintStatus(root) {
  const filePath = path.join(root, '.vibe', 'agent', 'sprint-status.json');
  if (!existsSync(filePath)) {
    return 'missing';
  }

  const status = JSON.parse(readFileSync(filePath, 'utf8'));
  let mutated = false;

  if (!Array.isArray(status.verificationCommands)) {
    status.verificationCommands = isRecord(status.policies) && Array.isArray(status.policies.verificationCommands)
      ? status.policies.verificationCommands
      : [];
    mutated = true;
  }

  if (status.verifiedAt === undefined || (status.verifiedAt !== null && typeof status.verifiedAt !== 'string')) {
    status.verifiedAt = null;
    mutated = true;
  }

  if (isRecord(status.handoff)) {
    if (typeof status.handoff.lastActionSummary !== 'string') {
      status.handoff.lastActionSummary =
        typeof status.handoff.nextAction === 'string' ? status.handoff.nextAction : '';
      mutated = true;
    }
    if (
      status.handoff.orchestratorContextBudget !== 'low' &&
      status.handoff.orchestratorContextBudget !== 'medium' &&
      status.handoff.orchestratorContextBudget !== 'high'
    ) {
      status.handoff.orchestratorContextBudget = 'medium';
      mutated = true;
    }
    if (!Array.isArray(status.handoff.preferencesActive)) {
      status.handoff.preferencesActive = [];
      mutated = true;
    }
    if (typeof status.handoff.updatedAt !== 'string' && typeof status.handoff.lastHandoffAt === 'string') {
      status.handoff.updatedAt = status.handoff.lastHandoffAt;
      mutated = true;
    }
  }

  if (!mutated) {
    return 'idempotent';
  }

  writeJson(filePath, status);
  return 'patched';
}

function updateConfig(root) {
  const filePath = path.join(root, '.vibe', 'config.json');
  if (!existsSync(filePath)) {
    return 'config-missing';
  }

  const config = JSON.parse(readFileSync(filePath, 'utf8'));
  if (compareVersions(config.harnessVersionInstalled, '1.4.0') >= 0) {
    return 'idempotent';
  }

  config.harnessVersionInstalled = '1.4.0';
  writeJson(filePath, config);
  return 'updated';
}

function main() {
  const root = path.resolve(process.argv[2] ?? process.cwd());
  const actions = [`sprintStatus=${patchSprintStatus(root)}`, `config=${updateConfig(root)}`];
  const idempotent = actions.every((entry) => entry.endsWith('=idempotent') || entry.endsWith('=missing'));
  process.stdout.write(`[migrate 1.4.0] ${actions.join(' ')}${idempotent ? ' idempotent' : ''}\n`);
}

try {
  main();
  process.exit(0);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
