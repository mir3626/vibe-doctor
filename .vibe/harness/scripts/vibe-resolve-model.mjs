#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const ROLE_NAMES = ['planner', 'generator', 'evaluator'];
import { resolveRoleRef } from '../src/lib/model-resolution.mjs';

function parseJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function mergeConfig(base, override) {
  return {
    ...base,
    ...override,
    sprintRoles: {
      ...(base.sprintRoles ?? {}),
      ...(override.sprintRoles ?? {}),
    },
    sprint: {
      ...(base.sprint ?? {}),
      ...(override.sprint ?? {}),
    },
    providers: {
      ...(base.providers ?? {}),
      ...(override.providers ?? {}),
    },
    qa: {
      ...(base.qa ?? {}),
      ...(override.qa ?? {}),
    },
  };
}

function loadCliConfig(root) {
  const sharedPath = path.join(root, '.vibe', 'config.json');
  const localPath = path.join(root, '.vibe', 'config.local.json');
  const shared = parseJson(sharedPath);

  if (!existsSync(localPath)) {
    return shared;
  }

  return mergeConfig(shared, parseJson(localPath));
}

function loadRegistry(root) {
  const registryPath = path.join(root, '.vibe', 'model-registry.json');
  if (!existsSync(registryPath)) {
    return null;
  }

  const registry = parseJson(registryPath);
  if (registry.schemaVersion !== 1) {
    throw new Error(
      `registry schemaVersion ${String(registry.schemaVersion)} is unsupported; run npm run vibe:sync to refresh the harness registry`,
    );
  }

  return registry;
}

export function resolveRoleFromCli(roleName, { root } = {}) {
  const cwd = path.resolve(root ?? process.cwd());
  const config = loadCliConfig(cwd);
  const ref = config.sprintRoles?.[roleName];

  if (!ref) {
    throw new Error(`unknown role "${roleName}" (available: ${ROLE_NAMES.join(', ')})`);
  }

  return resolveRoleRef(loadRegistry(cwd), ref);
}

function main() {
  const [, , roleName, ...rest] = process.argv;
  const jsonMode = rest.includes('--json');

  if (!roleName) {
    process.stderr.write('usage: node .vibe/harness/scripts/vibe-resolve-model.mjs <role> [--json]\n');
    process.exit(1);
  }

  try {
    const resolved = resolveRoleFromCli(roleName);
    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(resolved)}\n`);
      return;
    }

    const fields = [resolved.familyAlias, resolved.apiId, resolved.provider];
    if (resolved.tier) {
      fields.push(resolved.tier);
    }
    process.stdout.write(`${fields.join('\t')}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('unknown role "')) {
      process.stderr.write(`${message}\n`);
      process.exit(2);
    }

    process.stderr.write(`${message}\n`);
    process.exit(3);
  }
}

const entryHref = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === entryHref) {
  main();
}
