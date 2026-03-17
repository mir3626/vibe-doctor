import process from 'node:process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileExists, readJson, writeJson } from '../lib/fs.js';
import { logger } from '../lib/logger.js';
import { paths } from '../lib/paths.js';
import type { VibeConfig } from '../lib/config.js';

async function promptValue(
  rl: readline.Interface,
  label: string,
  fallback: string,
): Promise<string> {
  const answer = (await rl.question(`${label} [${fallback}]: `)).trim();
  return answer || fallback;
}

async function main(): Promise<void> {
  if (await fileExists(paths.localConfig)) {
    logger.info('.vibe/config.local.json already exists');
    return;
  }

  const base = await readJson<VibeConfig>(paths.localConfigExample);
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  if (!interactive) {
    await writeJson(paths.localConfig, base);
    logger.info('created .vibe/config.local.json with defaults');
    return;
  }

  const rl = readline.createInterface({ input, output });

  try {
    const defaultCoder = await promptValue(rl, 'default coder', base.defaultCoder);
    const challenger = await promptValue(rl, 'challenger provider', base.challenger);
    const reviewer = await promptValue(rl, 'reviewer provider', base.reviewer);

    const localConfig: VibeConfig = {
      ...base,
      defaultCoder,
      challenger,
      reviewer,
    };

    await writeJson(paths.localConfig, localConfig);
    logger.info('created .vibe/config.local.json');
  } finally {
    rl.close();
  }
}

main().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
