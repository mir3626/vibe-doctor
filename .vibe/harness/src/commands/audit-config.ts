import process from 'node:process';
import path from 'node:path';
import { runMain } from '../lib/cli.js';
import { appendJsonl } from '../lib/fs.js';
import { logger } from '../lib/logger.js';
import { paths } from '../lib/paths.js';
import { runCommand } from '../lib/shell.js';
import { isoDate } from '../lib/time.js';

const HOOK_MODE = process.argv.includes('--hook');

export const forbiddenPatterns = [
  '.env',
  '.env.local',
  '.env.production',
  'config/credentials.json',
  'secrets/',
] as const;

/**
 * Returns the subset of tracked files that look like sensitive files or
 * directories. Patterns ending in `/` are treated as directory prefixes,
 * everything else requires exact equality — this prevents `.env.example`
 * from colliding with `.env`.
 */
export function findViolations(
  tracked: string[],
  patterns: readonly string[] = forbiddenPatterns,
): string[] {
  return tracked.filter((file) =>
    patterns.some((pattern) =>
      pattern.endsWith('/') ? file.startsWith(pattern) : file === pattern,
    ),
  );
}

async function main(): Promise<void> {
  const vibeHarnessHooks = process.env.VIBE_HARNESS_HOOKS?.trim().toLowerCase();
  if (vibeHarnessHooks === 'off' || vibeHarnessHooks === '0' || vibeHarnessHooks === 'false') {
    if (!HOOK_MODE) {
      console.log(`[vibe] harness hooks disabled (VIBE_HARNESS_HOOKS=${vibeHarnessHooks})`);
    }
    return;
  }

  const root = HOOK_MODE && process.env.CLAUDE_PROJECT_DIR?.trim()
    ? path.resolve(process.env.CLAUDE_PROJECT_DIR)
    : paths.root;
  const result = await runCommand('git', ['ls-files'], {
    cwd: root,
    allowFailure: true,
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr.trim() || `exit ${result.exitCode}`}`);
  }

  const tracked = result.stdout.split(/\r?\n/).filter(Boolean);
  const violations = findViolations(tracked);

  await appendJsonl(path.join(root, '.vibe', 'runs', isoDate(), 'audit.jsonl'), {
    type: 'config-audit',
    timestamp: new Date().toISOString(),
    violations,
  });

  if (violations.length > 0) {
    const message = `Sensitive files appear tracked: ${violations.join(', ')}`;
    if (HOOK_MODE) {
      process.stdout.write(`${JSON.stringify({ systemMessage: message })}\n`);
    } else {
      logger.error(message);
      process.exitCode = 1;
    }
    return;
  }

  if (!HOOK_MODE) {
    logger.info('Config audit passed');
  }
}

runMain(async () => {
  try {
    await main();
  } catch (error) {
    if (!HOOK_MODE) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`${JSON.stringify({ systemMessage: `Config audit error: ${message}` })}\n`);
  }
}, import.meta.url);
