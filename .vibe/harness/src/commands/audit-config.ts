import process from 'node:process';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { runMain } from '../lib/cli.js';
import { appendJsonl } from '../lib/fs.js';
import { logger } from '../lib/logger.js';
import { paths } from '../lib/paths.js';
import { runCommand } from '../lib/shell.js';
import { isoDate } from '../lib/time.js';

type HookInput = {
  hook_event_name?: unknown;
  cwd?: unknown;
};

function readHookInput(): HookInput | null {
  if (process.stdin.isTTY) {
    return null;
  }

  try {
    const raw = readFileSync(0, 'utf8').trim();
    if (!raw) {
      return null;
    }

    const input: unknown = JSON.parse(raw);
    return input && typeof input === 'object' ? input as HookInput : null;
  } catch {
    return null;
  }
}

const EXPLICIT_HOOK_MODE = process.argv.includes('--hook');

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

async function main(hookMode: boolean, hookInput: HookInput | null): Promise<void> {
  const vibeHarnessHooks = process.env.VIBE_HARNESS_HOOKS?.trim().toLowerCase();
  if (vibeHarnessHooks === 'off' || vibeHarnessHooks === '0' || vibeHarnessHooks === 'false') {
    if (!hookMode) {
      console.log(`[vibe] harness hooks disabled (VIBE_HARNESS_HOOKS=${vibeHarnessHooks})`);
    }
    return;
  }

  const hookProjectDir = process.env.CLAUDE_PROJECT_DIR?.trim()
    || (typeof hookInput?.cwd === 'string' ? hookInput.cwd.trim() : '');
  const root = hookMode && hookProjectDir
    ? path.resolve(hookProjectDir)
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
    if (hookMode) {
      process.stdout.write(`${JSON.stringify({ systemMessage: message })}\n`);
    } else {
      logger.error(message);
      process.exitCode = 1;
    }
    return;
  }

  if (!hookMode) {
    logger.info('Config audit passed');
  }
}

runMain(async () => {
  const hookInput = readHookInput();
  const hookMode = EXPLICIT_HOOK_MODE || hookInput?.hook_event_name === 'PostToolUse';
  try {
    await main(hookMode, hookInput);
  } catch (error) {
    if (!hookMode) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`${JSON.stringify({ systemMessage: `Config audit error: ${message}` })}\n`);
  }
}, import.meta.url);
