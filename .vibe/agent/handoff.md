# Orchestrator Handoff

## 1. Identity

- **repo**: `vibe-doctor`
- **branch**: `main`
- **last pushed release**: `v1.6.12`
- **working target**: `v1.7.0`
- **current iteration**: Codex `/vibe-init` partial-init patch pushed
- **harnessVersion**: `1.7.0`
- **language/tone**: Korean user-facing, concise engineering notes

## 2. Status

Codex Orchestrator maintenance patch for downstream `tvd-extension` partial `/vibe-init` failure was committed and pushed to `origin/main`.

- `/vibe-init` now requires an explicit `--mode=human|agent` after Step 1-0 in non-interactive agent-skill execution.
- `--mode=agent` is delegation-only: it records `.vibe/config.json.mode = "agent"`, renders the runtime-specific delegation prompt, and exits before `.env`, `.vibe/config.local.json`, `.vibe/agent/*`, or interview artifacts are touched.
- Codex delegation prompt rendering now prioritizes `AGENTS.md`, provider-neutral orchestration docs, and Codex execution guidance while treating `CLAUDE.md` as shared nominal charter context.
- `.vibe/config.local.example.json` now points Codex at `./.vibe/harness/scripts/run-codex.sh`.
- `/vibe-review` guidance now uses `npm exec --yes --package=tsx -- tsx` and documents a narrow read-only exception for init/bootstrap/harness process failure reviews in partial checkouts.
- `vibe:run-agent` session-start lookup now prefers `.vibe/harness/scripts/vibe-agent-session-start.mjs` with legacy root fallback.

## 3. Verification

Completed on Windows for this patch:

- `npm run typecheck`
- `node --import tsx --test .vibe/harness/test/init-guard.test.ts .vibe/harness/test/codex-skills.test.ts .vibe/harness/test/upstream-bootstrap.test.ts`
- `npm test` (338 tests: 337 pass, 1 skipped)
- `npm run build`
- `git diff --check`
- UTF-8 file classification and mojibake grep over touched files

## 4. Preserved Value

- Codex fresh-session `/vibe-init` can no longer accidentally run human bootstrap before asking the Step 1-0 mode question.
- `mode=agent` no longer leaves durable partial-init state that can fool initialization checks.
- Fresh downstream local Codex provider config no longer points at the removed root `scripts/run-codex.sh`.
- Legitimate harness review of broken init/bootstrap state is allowed without opening the product-work boundary.

## 5. Next Action

After sync into `tvd-extension`, rerun Codex `$vibe-init` and verify `agent` mode prints the Codex-specific delegation prompt without creating `.vibe/agent/*` or `.vibe/config.local.json`.

## 6. Pending Risks

- Historical release notes, archived prompts, and old logs still contain root `scripts/run-codex.sh` references as history.
- This patch does not implement fully autonomous Codex Phase 2-4 execution; it only makes the Step 1-0 delegation boundary executable and provider-aware.
