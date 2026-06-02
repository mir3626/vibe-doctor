# Orchestrator Handoff

PROJECT NOT INITIALIZED.

This file is project-owned runtime state. Downstream projects must run `/vibe-init` before product work; init rewrites this placeholder with the current project's handoff.

## 1. Identity

- repo: `vibe-doctor`
- status: template placeholder
- harnessVersion: `1.7.21`

## 2. Status

The checked-in upstream template intentionally does not ship active project handoff state.

Maintenance checkpoint: release metadata is set for `v1.7.21`. The harness keeps `docs/plans/sprint-roadmap.md` as an active, current-iteration roadmap and archives completed or inactive iteration sections under `docs/plans/archive/roadmaps/`. Checkpoint enforces a compact `.vibe/agent/handoff.md` budget so downstream handoffs stay current-focused instead of accumulating sprint history.

Latest maintenance work: `vibe:qa` now treats initialized downstream projects as project-QA only, and `vibe-stop-qa-gate` captures full QA stdout/stderr under `.vibe/runs/<date>/stop-qa-*.log` while printing only a concise summary. Agent-mode `/vibe-init` delegation now has a hard pre-MVP gate: delegated agents must read the phase shards directly and pass `npm run vibe:init-ready` after Phase 2~4 before writing Sprint prompts or implementation files. The gate rejects missing or template-owned `.vibe/config.local.json`, `sprint-status.json`, context shards, roadmap, session-log roadmap decision, interview log, or git initialization. This is template maintenance state only; downstream projects still start by running `/vibe-init`.

## 3. Next Action

Run `/vibe-init` in a new downstream project. Existing downstream projects can sync to `v1.7.21`; agent-mode one-liner initialization should not begin MVP work until `npm run vibe:init-ready` passes. Initialized projects should keep product verification in root `test`/`typecheck`/`lint`/`build` scripts and use explicit `vibe:*` commands for harness verification.
