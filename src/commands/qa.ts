import process from 'node:process';
import path from 'node:path';
import { readJson, appendJsonl } from '../lib/fs.js';
import { logger } from '../lib/logger.js';
import { paths } from '../lib/paths.js';
import { runCommand } from '../lib/shell.js';
import { isoDate, isoStamp } from '../lib/time.js';

interface PackageJson {
  scripts?: Record<string, string>;
}

async function main(): Promise<void> {
  const packageJson = await readJson<PackageJson>(path.join(paths.root, 'package.json'));
  const available = packageJson.scripts ?? {};
  const order = ['test:unit', 'test', 'typecheck', 'lint', 'build'];
  const selected = order.filter((name) => Boolean(available[name]));

  const results: Array<{ script: string; ok: boolean; note?: string }> = [];

  if (selected.length === 0) {
    logger.warn('No QA scripts found. Create at least test or typecheck automation.');
    results.push({ script: 'qa-bootstrap-needed', ok: false, note: 'No scripts found' });
  }

  for (const script of selected) {
    logger.info(`Running npm run ${script}`);
    try {
      await runCommand('npm', ['run', script], { cwd: paths.root });
      results.push({ script, ok: true });
    } catch (error) {
      const note = error instanceof Error ? error.message : String(error);
      logger.error(note);
      results.push({ script, ok: false, note });
      break;
    }
  }

  const outputFile = path.join(paths.vibeRunsDir, isoDate(), 'qa.jsonl');
  await appendJsonl(outputFile, {
    type: 'qa',
    timestamp: new Date().toISOString(),
    runId: isoStamp(),
    results,
  });

  if (results.some((item) => !item.ok)) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
