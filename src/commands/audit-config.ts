import process from 'node:process';
import path from 'node:path';
import { appendJsonl } from '../lib/fs.js';
import { logger } from '../lib/logger.js';
import { paths } from '../lib/paths.js';
import { runCommand } from '../lib/shell.js';
import { isoDate } from '../lib/time.js';

const forbiddenPatterns = [
  '.env',
  '.env.local',
  '.env.production',
  'config/credentials.json',
  'secrets/',
];

async function main(): Promise<void> {
  const result = await runCommand('git', ['ls-files'], {
    cwd: paths.root,
    allowFailure: true,
  });

  const tracked = result.stdout.split(/\r?\n/).filter(Boolean);
  const violations = tracked.filter((file) =>
    forbiddenPatterns.some((pattern) =>
      pattern.endsWith('/') ? file.startsWith(pattern) : file === pattern,
    ),
  );

  await appendJsonl(path.join(paths.vibeRunsDir, isoDate(), 'audit.jsonl'), {
    type: 'config-audit',
    timestamp: new Date().toISOString(),
    violations,
  });

  if (violations.length > 0) {
    logger.error(`Sensitive files appear tracked: ${violations.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  logger.info('Config audit passed');
}

main().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
