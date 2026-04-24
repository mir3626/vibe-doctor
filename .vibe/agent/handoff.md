# Orchestrator Handoff

## 1. Identity

- **repo**: `vibe-doctor`
- **branch**: `main`
- **last pushed release**: `v1.6.12`
- **working target**: `v1.7.0`
- **current iteration**: harness source boundary refactor complete locally, push pending
- **harnessVersion**: `1.7.0`
- **language/tone**: Korean user-facing, concise engineering notes

## 2. Status

User approved the structural separation plan and asked to preserve legacy one-stop bootstrap sync behavior. v1.7.0 candidate implements:

- canonical harness runtime, source, tests, migrations, Playwright config, and TypeScript configs under `.vibe/harness/**`;
- downstream root `src/**`, `scripts/**`, `test/**`, `app/**`, `components/**`, and `lib/**` treated as project-owned by default;
- package scripts split so `vibe:*` runs harness tasks while ordinary `build`, `typecheck`, `test`, and `test:ui` remain project-facing aliases for compatibility;
- `/vibe-review` guidance clarified as template/harness review, separate from normal product code review;
- legacy root `scripts/vibe-sync-bootstrap.mjs` retained as a compatibility bridge that delegates to `.vibe/harness/scripts/vibe-sync-bootstrap.mjs` or fetches the canonical upstream bootstrap;
- v1.7.0 migration removes old root harness files only when `.vibe/sync-hashes.json` proves they are unmodified synced harness copies, and reports retained ambiguous files instead of deleting them.

## 3. Verification

Completed on Windows:

- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run vibe:test-ui -- --version`
- `npm run vibe:test-ui`
- `npm run vibe:config-audit --silent`
- `npm run vibe:sync -- --dry-run --from .`

The self-checkout dry-run exits 0 but shows expected conflicts for moved `.vibe/harness/**` files because this source checkout has no `.vibe/sync-hashes.json` baseline for those new paths.

## 4. Preserved Value

- Legacy projects can still bootstrap through the documented root raw URL.
- Downstream product files at root-level source/test/script paths are no longer overwritten by harness sync.
- Existing exact old `test:ui` harness aliases are redirected to `npm run vibe:test-ui`; project-owned custom scripts remain untouched.
- Ambiguous old root harness files are retained with a report rather than silently removed.

## 5. Next Action

Commit/tag `v1.7.0`, push `main` and the tag, then use `/vibe-sync` from downstream projects to receive the boundary split.

## 6. Pending Risks

- Historical docs and session logs still contain old root paths as history; live guidance has been updated.
- The first downstream sync from legacy versions should inspect `.vibe/harness-migration-1.7.0.md` if the migration retains ambiguous root files.
