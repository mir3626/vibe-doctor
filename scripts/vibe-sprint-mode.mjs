#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function loadPreset(rootDir) {
  const presetPath = path.resolve(rootDir, '.vibe', 'settings-presets', 'agent-delegation.json');
  if (!existsSync(presetPath)) {
    fail(`Missing preset file: ${presetPath}`);
  }

  const preset = readJson(presetPath);
  if (!Array.isArray(preset.rules) || preset.rules.some((entry) => typeof entry !== 'string')) {
    fail(`Invalid preset rules in ${presetPath}`);
  }

  return preset.rules;
}

function loadSettings(rootDir, createIfMissing = false) {
  const settingsPath = path.resolve(rootDir, '.claude', 'settings.local.json');
  if (!existsSync(settingsPath)) {
    return {
      settingsPath,
      exists: false,
      settings: createIfMissing
        ? {
            permissions: {
              allow: [],
            },
          }
        : null,
    };
  }

  return {
    settingsPath,
    exists: true,
    settings: readJson(settingsPath),
  };
}

function getAllowRules(settings) {
  const allow = settings?.permissions?.allow;
  if (allow === undefined) {
    return [];
  }

  if (!Array.isArray(allow) || allow.some((entry) => typeof entry !== 'string')) {
    fail('Expected .claude/settings.local.json permissions.allow to be a string array');
  }

  return allow;
}

function mergePermissions(settings, allowRules) {
  const nextSettings =
    settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
  const nextPermissions =
    nextSettings.permissions &&
    typeof nextSettings.permissions === 'object' &&
    !Array.isArray(nextSettings.permissions)
      ? nextSettings.permissions
      : {};

  return {
    ...nextSettings,
    permissions: {
      ...nextPermissions,
      allow: allowRules,
    },
  };
}

function saveSettings(settingsPath, settings) {
  mkdirSync(path.dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

function runOn(rootDir) {
  const presetRules = loadPreset(rootDir);
  const { settingsPath, settings } = loadSettings(rootDir, true);
  const currentAllow = getAllowRules(settings);
  const nextAllow = [...new Set([...currentAllow, ...presetRules])];
  const addedCount = nextAllow.length - currentAllow.length;

  saveSettings(settingsPath, mergePermissions(settings, nextAllow));
  process.stdout.write(
    `[vibe-sprint-mode] ON -- ${presetRules.length} preset rules merged (${addedCount} new). Total allow rules: ${nextAllow.length}\n`,
  );
}

function runOff(rootDir) {
  const presetRules = loadPreset(rootDir);
  const presetSet = new Set(presetRules);
  const { settingsPath, exists, settings } = loadSettings(rootDir, false);

  if (!exists || settings === null) {
    process.stdout.write('[vibe-sprint-mode] OFF -- nothing to remove\n');
    return;
  }

  const currentAllow = getAllowRules(settings);
  const nextAllow = currentAllow.filter((entry) => !presetSet.has(entry));
  const removedCount = currentAllow.length - nextAllow.length;

  saveSettings(settingsPath, mergePermissions(settings, nextAllow));
  process.stdout.write(
    `[vibe-sprint-mode] OFF -- ${removedCount} preset rules removed. Remaining allow rules: ${nextAllow.length}\n`,
  );
}

function runStatus(rootDir) {
  const presetRules = loadPreset(rootDir);
  const presetSet = new Set(presetRules);
  const { settings } = loadSettings(rootDir, false);
  const currentAllow = settings === null ? [] : getAllowRules(settings);
  const activeCount = currentAllow.filter((entry) => presetSet.has(entry)).length;
  const mode = activeCount > 0 ? 'ON' : 'OFF';

  process.stdout.write(
    `[vibe-sprint-mode] ${mode} -- ${activeCount}/${presetRules.length} preset rules active\n`,
  );
}

function main() {
  const command = process.argv[2];

  if (command === 'on') {
    runOn(process.cwd());
    return;
  }

  if (command === 'off') {
    runOff(process.cwd());
    return;
  }

  if (command === 'status') {
    runStatus(process.cwd());
    return;
  }

  fail('Usage: node scripts/vibe-sprint-mode.mjs <on|off|status>');
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
