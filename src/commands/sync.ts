import { execSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import process from 'node:process';
import { getBooleanFlag, getStringFlag, parseArgs } from '../lib/args.js';
import { runMain } from '../lib/cli.js';
import type { VibeConfig } from '../lib/config.js';
import { loadConfig } from '../lib/config.js';
import { readJson, writeJson } from '../lib/fs.js';
import { logger } from '../lib/logger.js';
import { paths } from '../lib/paths.js';
import { runCommand } from '../lib/shell.js';
import {
  applySyncPlan,
  buildSyncPlan,
  createBackup,
  loadManifest,
  runMigrations,
  type SyncAction,
} from '../lib/sync.js';

const SEMVER_REF_PATTERN = /^\d+\.\d+\.\d+$/;

export function resolveUpstreamRef(config: VibeConfig, refOverride?: string): string {
  if (refOverride) {
    return refOverride;
  }

  if (config.upstream?.ref) {
    return config.upstream.ref;
  }

  if (config.harnessVersion && SEMVER_REF_PATTERN.test(config.harnessVersion)) {
    return `v${config.harnessVersion}`;
  }

  return 'main';
}

async function cloneUpstream(url: string, ref: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'vibe-sync-'));
  execSync(`git clone --depth 1 --branch ${JSON.stringify(ref)} ${JSON.stringify(url)} ${JSON.stringify(dir)}`, {
    stdio: 'pipe',
    encoding: 'utf8',
  });
  return dir;
}

function renderPlanTable(actions: SyncAction[]): string {
  const rows = actions.map((action) => {
    let detail = '';
    if ('reason' in action) {
      detail = action.reason;
    } else if ('sections' in action) {
      detail = action.sections.join(', ');
    } else if ('keys' in action) {
      detail = action.keys.join(', ');
    }

    return `| ${action.type} | ${action.path} | ${detail} |`;
  });

  return ['| action | path | detail |', '|---|---|---|', ...rows].join('\n');
}

async function resolveConflicts(actions: SyncAction[], force: boolean): Promise<SyncAction[]> {
  if (force) {
    return actions.map((action) =>
      action.type === 'conflict'
        ? { type: 'replace', path: action.path, reason: `forced: ${action.reason}` }
        : action,
    );
  }

  const conflicts = actions.filter((action) => action.type === 'conflict');
  if (conflicts.length === 0) {
    return actions;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Conflicts detected. Re-run with --force or use an interactive terminal.');
  }

  const rl = readline.createInterface({ input, output });
  try {
    const resolved: SyncAction[] = [];
    for (const action of actions) {
      if (action.type !== 'conflict') {
        resolved.push(action);
        continue;
      }

      const answer = (
        await rl.question(`Replace local changes for ${action.path}? [y/N] `)
      ).trim().toLowerCase();

      if (answer === 'y' || answer === 'yes') {
        resolved.push({
          type: 'replace',
          path: action.path,
          reason: `accepted upstream after conflict: ${action.reason}`,
        });
      } else {
        resolved.push({
          type: 'skip',
          path: action.path,
          reason: `kept local copy: ${action.reason}`,
        });
      }
    }

    return resolved;
  } finally {
    rl.close();
  }
}

async function verifyPostSync(): Promise<void> {
  await runCommand('npx', ['tsc', '--noEmit'], { cwd: paths.root });
  await runCommand('node', ['scripts/vibe-preflight.mjs', '--bootstrap'], {
    cwd: paths.root,
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = getBooleanFlag(args, 'dry-run');
  const force = getBooleanFlag(args, 'force');
  const jsonMode = getBooleanFlag(args, 'json');
  const noBackup = getBooleanFlag(args, 'no-backup');
  const noVerify = getBooleanFlag(args, 'no-verify');
  const from = getStringFlag(args, 'from');
  const refOverride = getStringFlag(args, 'ref');

  const config = await loadConfig();
  let upstreamRoot: string | null = null;
  let cleanupRequired = false;

  try {
    if (from) {
      upstreamRoot = path.resolve(from);
    } else if (config.upstream?.type === 'local') {
      upstreamRoot = path.resolve(config.upstream.url);
    } else {
      if (!config.upstream?.url) {
        throw new Error('Missing upstream configuration in .vibe/config.json');
      }
      const ref = resolveUpstreamRef(config, refOverride);
      logger.info(`Cloning upstream ${config.upstream.url}#${ref}`);
      upstreamRoot = await cloneUpstream(config.upstream.url, ref);
      cleanupRequired = true;
    }

    const manifest = await loadManifest(upstreamRoot);
    const plan = await buildSyncPlan(paths.root, upstreamRoot, manifest);
    const resolvedActions = await resolveConflicts(plan.actions, force);
    const finalPlan = { ...plan, actions: resolvedActions };

    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(finalPlan, null, 2)}\n`);
    } else {
      process.stdout.write(`${renderPlanTable(finalPlan.actions)}\n`);
      if (finalPlan.migrations.length > 0) {
        process.stdout.write(`Migrations: ${finalPlan.migrations.join(', ')}\n`);
      }
    }

    if (dryRun) {
      return;
    }

    const backupTargets = finalPlan.actions
      .filter((action) => action.type !== 'skip' && action.type !== 'conflict' && action.type !== 'new-file')
      .map((action) => action.path);

    if (!noBackup && backupTargets.length > 0) {
      const backupDir = await createBackup(paths.root, backupTargets);
      logger.info(`Backup created at ${backupDir}`);
    }

    await applySyncPlan(paths.root, upstreamRoot, finalPlan, manifest);
    await runMigrations(paths.root, upstreamRoot, finalPlan.migrations);

    const sharedConfig = await readJson<VibeConfig>(paths.sharedConfig);
    sharedConfig.harnessVersionInstalled = finalPlan.toVersion;
    await writeJson(paths.sharedConfig, sharedConfig);

    if (!noVerify) {
      await verifyPostSync();
    }
  } finally {
    if (cleanupRequired && upstreamRoot) {
      await rm(upstreamRoot, { recursive: true, force: true });
    }
  }
}

runMain(main, import.meta.url);
