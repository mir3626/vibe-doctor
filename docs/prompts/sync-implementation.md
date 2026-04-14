# Task: Implement vibe-doctor Harness Sync System

## Overview
Implement a harness version sync mechanism for vibe-doctor. The system lets downstream projects update their harness files (scripts, skills, agent configs) from the upstream vibe-doctor template while preserving project-specific customizations.

Non-code files (CLAUDE.md markers, .vibe/config.json, .claude/settings.json, sync-manifest.json) are already done. You need to implement **all TypeScript source files and JavaScript scripts**.

## Existing Codebase Context

### Current `src/lib/config.ts` (extend this):
```typescript
import { readJson } from './fs.js';
import { paths } from './paths.js';

export interface ProviderRunner {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface SprintRoles {
  planner: string;
  generator: string;
  evaluator: string;
}

export interface SprintConfig {
  unit: string;
  subAgentPerRole: boolean;
  freshContextPerSprint: boolean;
}

export interface VibeConfig {
  orchestrator: string;
  sprintRoles: SprintRoles;
  sprint: SprintConfig;
  providers: Record<string, ProviderRunner>;
  qa?: {
    preferScripts?: string[];
  };
}

// ... mergeConfig and loadConfig functions exist
```

### Current `src/lib/paths.ts` (extend this):
```typescript
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
```

### Current `src/lib/fs.ts` (available utilities):
- `readJson<T>(path): Promise<T>`
- `writeJson(path, data): Promise<void>`
- `readText(path): Promise<string>`
- `writeText(path, content): Promise<void>`

### Current `src/lib/shell.ts`:
- `run(cmd, opts?): Promise<{stdout, stderr, exitCode}>`

### Current `src/lib/cli.ts`:
- `runMain(fn): void` — wraps async entry points with error handling

### Current `src/lib/logger.ts`:
- `log`, `info`, `warn`, `error`, `ok` functions

## Files to Create/Modify

### 1. Modify `src/lib/config.ts`
Add to `VibeConfig` interface:
```typescript
harnessVersion?: string;
harnessVersionInstalled?: string;
upstream?: {
  type: 'git' | 'local';
  url: string;
  ref?: string;
};
```

### 2. Modify `src/lib/paths.ts`
Add to paths object:
```typescript
syncManifest: path.join(cwd, '.vibe', 'sync-manifest.json'),
syncHashes: path.join(cwd, '.vibe', 'sync-hashes.json'),
syncBackupDir: path.join(cwd, '.vibe', 'sync-backup'),
syncCache: path.join(cwd, '.vibe', 'sync-cache.json'),
migrationsDir: path.join(cwd, 'migrations'),
```

### 3. Create `src/lib/sync.ts` — Core Sync Engine

This is the main implementation file. Key exports:

```typescript
export interface SyncManifest {
  manifestVersion: string;
  files: {
    harness: string[];
    hybrid: Record<string, HybridFileConfig>;
    project: string[];
  };
  migrations: Record<string, string | null>;
}

export interface HybridFileConfig {
  strategy: 'section-merge' | 'json-deep-merge' | 'template-regenerate';
  harnessMarkers?: string[];
  preserveMarkers?: string[];
  harnessKeys?: string[];
  projectKeys?: string[];
  note?: string;
}

export type SyncAction =
  | { type: 'replace'; path: string; reason: string }
  | { type: 'section-merge'; path: string; sections: string[] }
  | { type: 'json-merge'; path: string; keys: string[] }
  | { type: 'template-regen'; path: string }
  | { type: 'skip'; path: string; reason: string }
  | { type: 'conflict'; path: string; reason: string }
  | { type: 'new-file'; path: string }
  | { type: 'delete'; path: string; reason: string };

export interface SyncPlan {
  fromVersion: string | null;
  toVersion: string;
  actions: SyncAction[];
  migrations: string[];
}
```

Key functions to implement:

#### `loadManifest(upstreamDir: string): Promise<SyncManifest>`
Read and parse `.vibe/sync-manifest.json` from the upstream directory.

#### `buildSyncPlan(localRoot: string, upstreamRoot: string, manifest: SyncManifest): Promise<SyncPlan>`
Compare local vs upstream files based on manifest categories:
- For `harness` files: check if file exists locally, compare content hash. If local differs from last-synced hash (in `.vibe/sync-hashes.json`), mark as `conflict`. If file doesn't exist locally, mark as `new-file`. If unchanged, mark as `replace`.
- For `hybrid` files: create appropriate merge action based on strategy.
- For `project` files: skip.
- Collect migration scripts for versions between installed and target.

#### `sectionMerge(localContent: string, upstreamContent: string, config: HybridFileConfig): string`
Parse both files by `<!-- BEGIN:NAME -->` / `<!-- END:NAME -->` markers:
- Sections matching `harnessMarkers` → replace with upstream content
- Sections matching `preserveMarkers` → keep local content
- `PROJECT:*` sections → keep local content
- Content outside any markers → replace with upstream
- If local has NO markers (legacy), return `null` to signal Tier 2 needed

#### `jsonDeepMerge(localJson: any, upstreamJson: any, config: HybridFileConfig): any`
Merge JSON based on key ownership:
- For `harnessKeys`: take upstream value. Support glob pattern `scripts.vibe:*` meaning all keys under `scripts` starting with `vibe:`.
- For `projectKeys`: keep local value.
- Unrecognized keys: keep local.

#### `computeFileHash(filePath: string): Promise<string>`
SHA-256 hash of file content.

#### `createBackup(localRoot: string, files: string[]): Promise<string>`
Copy listed files to `.vibe/sync-backup/<ISO-timestamp>/`. Return backup dir path.

#### `applySyncPlan(localRoot: string, upstreamRoot: string, plan: SyncPlan, manifest: SyncManifest): Promise<void>`
Execute each action in the plan. After applying, update `.vibe/sync-hashes.json` with new hashes.

#### `runMigrations(localRoot: string, upstreamRoot: string, migrations: string[]): Promise<void>`
Execute each migration `.mjs` file in order via `node <script> <localRoot>`.

### 4. Create `src/commands/sync.ts` — CLI Entry Point

Usage: `npx tsx src/commands/sync.ts [options]`

Options:
- `--dry-run` — show plan without applying
- `--force` — skip conflict prompts, always accept upstream
- `--from <path>` — use local directory as upstream source (instead of git)
- `--ref <tag>` — override upstream git ref
- `--no-backup` — skip backup creation
- `--no-verify` — skip post-sync verification
- `--json` — output plan as JSON

Flow:
1. Load local config, extract `upstream` settings
2. If `--from` provided, use that path. Otherwise `git clone --depth 1 --branch <ref> <url>` to temp dir
3. Load upstream manifest and config
4. Build sync plan
5. Display plan (markdown table or JSON)
6. If `--dry-run`, exit
7. Create backup (unless `--no-backup`)
8. Apply plan
9. Run migrations
10. Stamp `harnessVersionInstalled` in local `.vibe/config.json`
11. Run verification (unless `--no-verify`): `npx tsc --noEmit` and `node scripts/vibe-preflight.mjs --bootstrap`
12. Clean up temp directory

### 5. Create `scripts/vibe-version-check.mjs` — SessionStart Hook Script

Lightweight script that runs at session start:
1. Read `.vibe/config.json` — get `harnessVersionInstalled` and `upstream`
2. If `upstream` not configured, exit silently (exit 0, no output)
3. Check `.vibe/sync-cache.json` for `lastCheckedAt`. If within 24 hours, exit silently
4. Run `git ls-remote --tags <upstream.url>` to find latest version tag (format: `v1.0.0`, `v1.2.0` etc)
5. Compare with `harnessVersionInstalled`
6. If newer version available, write to stdout:
   ```
   [vibe-sync] 하네스 업데이트 가능: v1.0.0 → v1.2.0. `/vibe-sync` 또는 `npm run vibe:sync`로 반영하세요.
   ```
7. Update `.vibe/sync-cache.json` with `{ "lastCheckedAt": "<ISO>", "latestVersion": "1.2.0" }`
8. Always exit 0 (never block session start). Wrap everything in try/catch.

### 6. Modify `scripts/vibe-preflight.mjs`

Add a new check after the existing checks (before final output):
```javascript
// 9. Harness version check
try {
  const config = JSON.parse(readFileSync(resolve('.vibe/config.json'), 'utf8'));
  if (config.harnessVersion && config.harnessVersionInstalled) {
    if (config.harnessVersion !== config.harnessVersionInstalled) {
      record('harness.version', false,
        `installed: ${config.harnessVersionInstalled}, available: ${config.harnessVersion}. Run: npm run vibe:sync`);
    } else {
      record('harness.version', true, `v${config.harnessVersion}`);
    }
  } else {
    record('harness.version', true, 'no version tracking configured');
  }
} catch {
  record('harness.version', true, 'version check skipped');
}
```
This is a non-blocking warning (use `true` for ok to not block sprints, but show the detail).

### 7. Create `scripts/vibe-sync-bootstrap.mjs` — Legacy Project Bootstrap

Self-contained script that can be run standalone (no project dependencies needed):

```bash
# Usage from a legacy project root (all platforms):
node /path/to/vibe-doctor/scripts/vibe-sync-bootstrap.mjs

# macOS / Linux one-liner (process substitution):
node <(curl -sL https://raw.githubusercontent.com/mir3626/vibe-doctor/main/scripts/vibe-sync-bootstrap.mjs)

# Windows one-liner (stdin pipe — process substitution returns /dev/fd/N paths that node.exe cannot resolve):
curl -sL https://raw.githubusercontent.com/mir3626/vibe-doctor/main/scripts/vibe-sync-bootstrap.mjs | node --input-type=module -
```

Flow:
1. Verify current directory has `.vibe/config.json` (is a vibe-doctor project)
2. Determine upstream source: check if argv[2] is a path, otherwise use default git URL
3. Clone upstream to temp dir
4. Read upstream sync-manifest.json
5. Copy all harness-owned files from upstream (with backup of existing files to `.vibe/sync-backup/bootstrap-<timestamp>/`)
6. For CLAUDE.md: backup as `CLAUDE.md.local`, copy new version, print diff summary
7. For `.claude/settings.json`: json-deep-merge hooks from upstream, preserve local permissions
8. For `package.json`: merge `scripts.vibe:*` and `engines` from upstream, preserve local deps
9. Add `harnessVersion`, `harnessVersionInstalled`, `upstream` to `.vibe/config.json`
10. Print summary of what was changed
11. Clean up temp dir

### 8. Create `migrations/1.0.0.mjs` — Initial Migration

The bootstrap migration for v1.0.0 (mostly a no-op since bootstrap handles everything):
1. Read `.vibe/config.json`
2. Ensure `harnessVersion` and `harnessVersionInstalled` fields exist
3. Exit 0

### 9. Create `test/sync.test.ts` — Unit Tests

Test the core sync functions:
- `sectionMerge`: with markers, without markers (legacy), with new upstream sections
- `jsonDeepMerge`: harness keys replaced, project keys preserved, glob pattern `scripts.vibe:*`
- `computeFileHash`: consistent hashing
- `buildSyncPlan`: correct action types for different file categories

Use Node.js built-in test runner (`import { describe, it } from 'node:test'`; `import assert from 'node:assert'`).

## Important Constraints

- Use ES module syntax (`import`/`export`), matching existing codebase
- TypeScript strict mode (`"strict": true`)
- No external dependencies — only Node.js built-in modules + existing `src/lib/*` utilities
- All file paths use `node:path` for cross-platform compatibility
- Use `node:crypto` for SHA-256 hashing
- Use `node:child_process` `execSync` for git commands
- Error messages in English (code comments minimal, English)
- Follow existing patterns: `runMain()` wrapper for commands, `record()` pattern for preflight
- The `.mjs` scripts must work standalone without TypeScript compilation

## Verification

After implementation:
1. `npx tsc --noEmit` must pass
2. `node --import tsx --test test/sync.test.ts` must pass
3. All existing tests must still pass: `node --import tsx --test test/*.test.ts`
