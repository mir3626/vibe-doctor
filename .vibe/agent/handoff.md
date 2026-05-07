# Orchestrator Handoff

## 1. Identity

- **repo**: `vibe-doctor`
- **branch**: `main`
- **working release**: `v1.7.10` (LTS baseline remains `v1.7.3-lts`)
- **current mode**: Codex Orchestrator maintenance
- **harnessVersion**: `1.7.10`
- **language/tone**: Korean user-facing, concise engineering notes

## 2. Status

Current mainline release is `v1.7.10`, pushed to `origin/main` at `1a74c43`; tag `v1.7.10` is also pushed. LTS baseline remains immutable tag `v1.7.3-lts`.

- Root cause for repeated downstream GitHub CI failures after harness sync was confirmed from `codex-widget-for-desktop` run logs.
- Failing step: `npm test` -> `.vibe/harness/test/schemas.test.ts` -> `sprint-status parses the production payload`.
- Failure details: `.vibe/agent/sprint-status.json` contained local timezone ISO timestamps such as `2026-05-08T02:25:00.000+09:00`; the previous state schemas used `z.string().datetime()` defaults, which reject explicit offsets and accept only `Z` timestamps.
- This is not a WSL wrapper failure. The WSL-related suspicion was adjacent in history, but the current reproducible failure is schema/date compatibility across Korea/Windows local state and Linux CI.
- v1.7.10 adds shared `IsoDateTimeSchema = z.string().datetime({ offset: true })` and applies it to state/schema timestamps plus sidecar artifact metadata.
- Regenerated checked-in JSON schemas and added a regression test covering `+09:00` timestamps in `sprint-status.json`.
- Verified the live `codex-widget-for-desktop` production `sprint-status.json` parses with the patched upstream schema.

## 3. Verification

Completed on Windows for the v1.7.10 offset datetime compatibility patch:

- `node --import tsx --test .vibe/harness/test/sprint-status.test.ts .vibe/harness/test/schemas.test.ts`
- `npm run vibe:gen-schemas -- --check`
- `npm run typecheck`
- `npm run build`
- `npm test` (367 tests: 366 pass, 1 skipped)
- `git diff --check`
- patched schema parsed the current downstream `codex-widget-for-desktop` `.vibe/agent/sprint-status.json`
- `npm run vibe:context-audit` (report-only; existing noisy baseline)
- `npm run vibe:rule-audit` (report-only; existing 27 undisposed CLAUDE.md rules remain)

## 4. Expected Downstream Behavior

Downstream projects syncing to `v1.7.10` should stop failing GitHub CI merely because harness state timestamps use explicit timezone offsets such as `+09:00`.

`codex-widget-for-desktop` should sync to `v1.7.10`, rerun CI, and the previous `Invalid datetime` failure in `schemas.test.ts` should disappear.

## 5. Next Action

Sync `codex-widget-for-desktop` to `v1.7.10` and rerun CI. If CI still fails, inspect whether the new failure is product-specific. The earlier historical `node-pty prebuild linux-x64 is not a directory` failure was product/runtime packaging, not this harness schema bug.

## 6. Pending Risks

- State schemas now accept explicit offsets; scripts still generally write UTC `Z` timestamps via `new Date().toISOString()`.
- JSON Schema `format: date-time` does not express the Zod offset option strongly, so runtime Zod tests remain the primary regression guard.
- Existing report-only `context-audit` and `rule-audit` noise is unchanged.
