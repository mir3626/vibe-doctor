import process from 'node:process';
import path from 'node:path';
import { parseArgs, getStringFlag } from '../lib/args.js';
import { runMain } from '../lib/cli.js';
import { readText, writeText } from '../lib/fs.js';
import { logger } from '../lib/logger.js';
import { paths } from '../lib/paths.js';
import { slugify } from '../lib/slug.js';
import { isoDate, isoStamp } from '../lib/time.js';
import { createWorktree } from '../lib/worktree.js';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const taskFile = getStringFlag(args, 'task-file');

  if (!taskFile) {
    throw new Error('Missing --task-file');
  }

  const taskBody = await readText(taskFile);
  const slug = slugify(path.basename(taskFile, path.extname(taskFile)) || isoStamp());

  const primary = await createWorktree(`vibe/primary-${slug}`);
  const challenger = await createWorktree(`vibe/challenger-${slug}`);

  const reportPath = path.join(
    paths.root,
    'docs',
    'orchestration',
    `${isoDate()}-${slug}-escalation.md`,
  );

  const content = [
    `# Escalation for ${slug}`,
    '',
    '## Trigger',
    '- same task failed tests twice in a row',
    '',
    '## Task brief',
    '```md',
    taskBody.trim(),
    '```',
    '',
    '## Worktrees',
    `- primary: ${primary.directory}`,
    `- challenger: ${challenger.directory}`,
    '- reviewer: compare diffs from both branches before merge',
    '',
    '## Suggested next commands',
    `- npm run vibe:run-agent -- --provider codex --role coder --prompt-file ${taskFile} --cwd ${primary.directory}`,
    `- npm run vibe:run-agent -- --provider gemini --role challenger --prompt-file ${taskFile} --cwd ${challenger.directory}`,
    '',
  ].join('\n');

  await writeText(reportPath, `${content}\n`);

  logger.info('Created worktrees:');
  logger.info(`- ${primary.directory}`);
  logger.info(`- ${challenger.directory}`);
  logger.info(`Escalation brief: ${reportPath}`);
}

runMain(main, import.meta.url);
