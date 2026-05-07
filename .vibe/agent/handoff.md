# Orchestrator Handoff

## 1. Identity

- **repo**: `vibe-doctor`
- **branch**: `main`
- **working release**: `v1.7.12` (LTS baseline remains `v1.7.3-lts`)
- **current mode**: Codex Orchestrator maintenance
- **harnessVersion**: `1.7.12`
- **language/tone**: Korean user-facing, concise engineering notes

## 2. Status

Current mainline release is `v1.7.12`, pushed to `origin/main` at `a2908f3`; annotated tag `v1.7.12` is also pushed. LTS baseline remains immutable tag `v1.7.3-lts`.

Prepared the v1.7.12 provider-neutral Orchestrator wording patch.

- Confirmed the strongest problematic assertion was in synced Codex memory: `AGENTS.md` told Sprint Generator work to escalate uncertain design decisions to a Claude-specific Orchestrator.
- Updated `AGENTS.md` to escalate to the current upstream Orchestrator instead.
- Reworded `CLAUDE.md` so Claude is the nominal Orchestrator for Claude sessions, while explicitly not claiming Claude is the only valid Orchestrator.
- Reworded README overview, core-design table, and operating principles so the default nominal mode remains Claude Code Orchestrator + Codex Generator, but direct Codex sessions are explicitly allowed as Codex Orchestrator maintenance mode for upstream harness work.
- Reworded `docs/context/orchestration.md` role table with the same distinction.
- Added `docs/release/v1.7.12.md` and bumped harness metadata to `1.7.12`.

## 3. Verification

Completed on Windows for the v1.7.12 candidate:

- Strong-claim search for Claude-specific Orchestrator assertions across synced docs and agent memory returned no active hits.
- `npm run vibe:typecheck`
- `npm run vibe:gen-schemas -- --check`
- `node .vibe/harness/scripts/vibe-preflight.mjs --bootstrap`
- `npm test` (375 tests: 374 pass, 1 skipped)
- `git diff --check`
- JSON parse checks for `package.json` and `.vibe/config.json`

## 4. Expected Downstream Behavior

Downstream projects syncing to `v1.7.12` should no longer see Codex memory or overview docs strongly claim that the Orchestrator must be Claude. They should still understand the default nominal mode as Claude Code Orchestrator + Codex Generator, while direct Codex maintenance sessions remain supported.

## 5. Next Action

Downstream projects can sync to `v1.7.12` when they need the provider-neutral Orchestrator wording correction.

## 6. Pending Risks

- Provider-neutral wording does not change runtime defaults; `.vibe/config.json` still defaults this upstream repo to `claude-opus` as its nominal Orchestrator.
- Package identity still contains legacy `vibe-base-claude-code-ts` naming; this patch only addresses Orchestrator role assertions, not package renaming.
- Existing report-only `context-audit` and `rule-audit` noise is unchanged.
