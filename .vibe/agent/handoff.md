# Orchestrator Handoff

PROJECT NOT INITIALIZED.

This file is project-owned runtime state. Downstream projects must run `/vibe-init` before product work; init rewrites this placeholder with the current project's handoff.

## 1. Identity

- repo: `vibe-doctor`
- status: template placeholder
- harnessVersion: `1.7.23`

## 2. Status

The checked-in upstream template intentionally does not ship active project handoff state.

Maintenance checkpoint: release metadata is set for `v1.7.23`. The harness keeps `docs/plans/sprint-roadmap.md` as an active, current-iteration roadmap and archives completed or inactive iteration sections under `docs/plans/archive/roadmaps/`. Checkpoint enforces a compact `.vibe/agent/handoff.md` budget so downstream handoffs stay current-focused instead of accumulating sprint history.

Latest maintenance work: `vibe-checkpoint.mjs` gained an opt-in `--auto-refresh` mode, wired into the Claude Code `PreCompact` hook. When the handoff is stale or work-outdated (uncommitted changes or commits newer than `handoff.updatedAt`), it upserts a bounded idempotent `<!-- vibe:auto-state:* -->` block with a mechanical git snapshot (branch, HEAD, changed files capped at 20, staged/unstaged diffstat, last 5 commits) and bumps `handoff.updatedAt`; otherwise it writes nothing. Without the flag the script stays byte-for-byte read-only verification, so `vibe:checkpoint`/`/maintain-context`/CI are unaffected. The narrative stays Orchestrator-authored. Verified: `vibe:typecheck`, full `vibe:self-test` (463 pass / 0 fail / 1 skip), focused `checkpoint.test.ts` (inject+bump, idempotency, no-flag no-write), and temp-repo smoke.

Previous maintenance work: `vibe-goal-iterate` now overrides per-item verification scope. During the multi-item loop it allows only targeted verification tied to the current item, forbids harness-wide/full-suite verification between items, keeps `npm run vibe:checkpoint` allowed as context persistence, and permits harness-wide/full-suite verification only when the final queued item has finished and the iteration explicitly changed harness/runtime/skill/orchestration behavior.

Previous maintenance work: `vibe-goal-iterate` is now project-owned. The shared runbook lives at `.claude/skills/vibe-goal-iterate/SKILL.md`, the Codex wrapper lives at `.codex/skills/vibe-goal-iterate/SKILL.md`, and Codex UI metadata remains at `.codex/skills/vibe-goal-iterate/agents/openai.yaml`. The previous global `C:\Users\Tony\.codex\skills\vibe-goal-iterate` directory was removed by moving it into this repository. Verification passed: skill validation for both folders, `npm run vibe:codex-wrapper-audit`, targeted `codex-wrapper-audit.test.ts`, Markdown injection diagnostic, `npm run vibe:sync-audit`, and encoding/mojibake checks.

## 3. Next Action

Run `/vibe-init` in a new downstream project. Existing downstream projects can sync to `v1.7.23`; agent-mode one-liner initialization should not begin MVP work until `npm run vibe:init-ready` passes. Initialized projects should keep product verification in root `test`/`typecheck`/`lint`/`build` scripts and use explicit `vibe:*` commands for harness verification.
