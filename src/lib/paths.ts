import path from 'node:path';

const cwd = process.cwd();

export const paths = {
  cwd,
  root: cwd,
  vibeDir: path.join(cwd, '.vibe'),
  vibeRunsDir: path.join(cwd, '.vibe', 'runs'),
  syncManifest: path.join(cwd, '.vibe', 'sync-manifest.json'),
  syncHashes: path.join(cwd, '.vibe', 'sync-hashes.json'),
  syncBackupDir: path.join(cwd, '.vibe', 'sync-backup'),
  syncCache: path.join(cwd, '.vibe', 'sync-cache.json'),
  localConfig: path.join(cwd, '.vibe', 'config.local.json'),
  localConfigExample: path.join(cwd, '.vibe', 'config.local.example.json'),
  sharedConfig: path.join(cwd, '.vibe', 'config.json'),
  migrationsDir: path.join(cwd, 'migrations'),
  reportsDir: path.join(cwd, 'docs', 'reports'),
  plansDir: path.join(cwd, 'docs', 'plans'),
  envFile: path.join(cwd, '.env'),
  envExample: path.join(cwd, '.env.example'),
};
