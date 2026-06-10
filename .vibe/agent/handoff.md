# Orchestrator Handoff

PROJECT NOT INITIALIZED.

This file is project-owned runtime state. Downstream projects must run `/vibe-init` before product work; init rewrites this placeholder with the current project's handoff.

## 1. Identity

- repo: `vibe-doctor`
- status: template placeholder
- harnessVersion: `1.7.22`

## 2. Status

The checked-in upstream template intentionally does not ship active project handoff state.

Maintenance checkpoint: release metadata is set for `v1.7.22`. The harness keeps `docs/plans/sprint-roadmap.md` as an active, current-iteration roadmap and archives completed or inactive iteration sections under `docs/plans/archive/roadmaps/`. Checkpoint enforces a compact `.vibe/agent/handoff.md` budget so downstream handoffs stay current-focused instead of accumulating sprint history.

Latest maintenance work: `vibe-goal-iterate` now overrides per-item verification scope. During the multi-item loop it allows only targeted verification tied to the current item, forbids harness-wide/full-suite verification between items, keeps `npm run vibe:checkpoint` allowed as context persistence, and permits harness-wide/full-suite verification only when the final queued item has finished and the iteration explicitly changed harness/runtime/skill/orchestration behavior. Verification for this documentation change was intentionally narrow: skill validation for shared and Codex folders, `npm run vibe:codex-wrapper-audit`, and Markdown injection diagnostic.

Previous maintenance work: `vibe-goal-iterate` is now project-owned. The shared runbook lives at `.claude/skills/vibe-goal-iterate/SKILL.md`, the Codex wrapper lives at `.codex/skills/vibe-goal-iterate/SKILL.md`, and Codex UI metadata remains at `.codex/skills/vibe-goal-iterate/agents/openai.yaml`. The previous global `C:\Users\Tony\.codex\skills\vibe-goal-iterate` directory was removed by moving it into this repository. Verification passed: skill validation for both folders, `npm run vibe:codex-wrapper-audit`, targeted `codex-wrapper-audit.test.ts`, Markdown injection diagnostic, `npm run vibe:sync-audit`, and encoding/mojibake checks.

Previous maintenance work: `vibe:qa` now treats initialized downstream projects as project-QA only, and `vibe-stop-qa-gate` captures full QA stdout/stderr under `.vibe/runs/<date>/stop-qa-*.log` while printing only a concise summary. Agent-mode `/vibe-init` delegation now has a hard pre-MVP gate: delegated agents must read the phase shards directly and pass `npm run vibe:init-ready` after Phase 2~4 before writing Sprint prompts or implementation files. The gate rejects missing or template-owned `.vibe/config.local.json`, `sprint-status.json`, context shards, roadmap, session-log roadmap decision, interview log, or git initialization. This is template maintenance state only; downstream projects still start by running `/vibe-init`.

## 3. Next Action

Run `/vibe-init` in a new downstream project. Existing downstream projects can sync to `v1.7.22`; agent-mode one-liner initialization should not begin MVP work until `npm run vibe:init-ready` passes. Initialized projects should keep product verification in root `test`/`typecheck`/`lint`/`build` scripts and use explicit `vibe:*` commands for harness verification.
