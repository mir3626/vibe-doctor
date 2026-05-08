# Orchestrator Handoff

## 1. Identity

- **repo**: `vibe-doctor`
- **branch**: `main`
- **working release**: `v1.7.13` (LTS baseline remains `v1.7.3-lts`)
- **current mode**: Codex Orchestrator maintenance
- **harnessVersion**: `1.7.13`
- **language/tone**: Korean user-facing, concise engineering notes

## 2. Status

Prepared the v1.7.13 template iteration-state reset patch.

- Reset upstream template `.vibe/agent/iteration-history.json` to an empty history.
- Reset upstream template `docs/plans/sprint-roadmap.md` to an initial placeholder so new downstream projects do not inherit old upstream Iteration 7-12 sections.
- Updated `/vibe-init` copied-template-state cleanup to reset iteration history and sprint roadmap alongside sprint status, handoff, and session log.
- Added guarded migration `.vibe/harness/migrations/1.7.13.mjs` and registered it in `.vibe/sync-manifest.json`.
- Migration removes known upstream template iteration entries, including stale `iter-9`, by matching upstream labels/sprint IDs. It preserves real project-owned `iter-9` work.
- Added release notes and README highlight for `v1.7.13`.

## 3. Verification

Completed on Windows for the v1.7.13 candidate:

- `node --import tsx --test .vibe/harness/test/init-guard.test.ts`
- `node --import tsx --test .vibe/harness/test/sync.test.ts`
- `npm run vibe:typecheck`
- `npm run vibe:gen-schemas -- --check`
- `node .vibe/harness/scripts/vibe-preflight.mjs --bootstrap`
- `npm test` (377 tests: 376 pass, 1 skipped)
- `git diff --check`
- UTF-8 replacement/mojibake checks for touched files

## 4. Expected Downstream Behavior

Downstream projects syncing to `v1.7.13` should run the guarded migration. Projects that copied the old upstream template iteration state should no longer have stale Iteration 7-12 entries driving `/vibe-iterate`, so the next iteration should start from project-owned state instead of stale `iter-9`.

## 5. Next Action

Commit, tag, and push `v1.7.13`. After push, downstream projects with the symptom should run `/vibe-sync` to pick up the migration, then rerun `/vibe-iterate`.

## 6. Pending Risks

- The migration intentionally matches known upstream labels/sprint IDs; unrelated project-owned `iter-9` work is preserved.
- If a downstream has manually mixed old upstream roadmap sections with real project roadmap content, the migration is conservative and may require a one-time manual cleanup.
- Historical archived docs can still mention old upstream iterations; they are not active state for `/vibe-iterate`.
