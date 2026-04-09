import path from 'node:path';

const cwd = process.cwd();

export const paths = {
  cwd,
  root: cwd,
  vibeDir: path.join(cwd, '.vibe'),
  vibeRunsDir: path.join(cwd, '.vibe', 'runs'),
  localConfig: path.join(cwd, '.vibe', 'config.local.json'),
  localConfigExample: path.join(cwd, '.vibe', 'config.local.example.json'),
  sharedConfig: path.join(cwd, '.vibe', 'config.json'),
  reportsDir: path.join(cwd, 'docs', 'reports'),
  plansDir: path.join(cwd, 'docs', 'plans'),
  envFile: path.join(cwd, '.env'),
  envExample: path.join(cwd, '.env.example'),
};
