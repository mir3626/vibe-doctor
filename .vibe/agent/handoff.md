# Orchestrator Handoff

PROJECT NOT INITIALIZED.

This file is project-owned runtime state. Downstream projects must run `/vibe-init` before product work; init rewrites this placeholder with the current project's handoff.

## 1. Identity

- repo: `vibe-doctor`
- status: template placeholder
- harnessVersion: `1.7.27`

## 2. Status

The checked-in upstream template intentionally does not ship active project handoff state.

Maintenance checkpoint: release metadata is set for `v1.7.27`. The harness keeps `docs/plans/sprint-roadmap.md` as an active, current-iteration roadmap and archives completed or inactive iteration sections under `docs/plans/archive/roadmaps/`. Checkpoint enforces a compact `.vibe/agent/handoff.md` budget so downstream handoffs stay current-focused instead of accumulating sprint history.

Latest maintenance work (v1.7.27): all five Claude harness entrypoints auto-detect their event from stdin in addition to accepting explicit hook flags. This keeps legacy, cached, or partially synced commands inside hook mode, binds runtime roots through `CLAUDE_PROJECT_DIR` or the hook input `cwd`, and prevents manual diagnostics from leaking into provider stdout. PreCompact success is empty stdout, PreCompact validation failure remains stderr/exit 2, and Stop QA failure remains nonblocking with one JSON `systemMessage` and exit 0.

Previous maintenance work (v1.7.26): every Claude harness hook command and runtime root is bound to `${CLAUDE_PROJECT_DIR}`. Hook-mode success/skip paths keep stdout empty, reportable nonblocking outcomes use one JSON `systemMessage`, and PreCompact validation failure uses stderr/exit 2. Stop remains nonblocking on QA failure (exit 0 + log-backed JSON notice); PostToolUse uses the verified npm option order so `--hook` reaches config-audit.

Previous maintenance work (v1.7.25): harness hook kill-switch + legacy-model override shard. Setting `VIBE_HARNESS_HOOKS=off` (also `0`/`false`) in a session's environment makes all five hook entry points (Stop QA gate, SessionStart, Notification, PostToolUse config-audit, PreCompact checkpoint) exit 0 immediately, so harness-unrelated headless agents spawned by downstream product code no longer run `vibe:qa` on every Stop or rewrite the handoff on compaction. Separately, the model-compensation rules moved from CLAUDE.md `HARNESS:mechanical-overrides` into `docs/context/legacy-model-overrides.md` (sync manifest harness list); SOTA-tier sessions skip the shard, only sub-SOTA Orchestrator/Generator models read it. The three tier-independent rules stay in CLAUDE.md.

Previous maintenance work (v1.7.24): `vibe-checkpoint.mjs` gained a `docs.integrity` check after a downstream incident truncated a project CLAUDE.md to 0 bytes and the checkpoint stayed green. Targets fixed first-read docs plus `docs/context/*.md`, tracked-and-exists only, fails on empty/under-64-byte content, report-only in both modes. The `maintain-context` runbook gained native-edit-tools-only and pre-commit `git diff --stat` gate rules.

Previous maintenance work (v1.7.23): `vibe-checkpoint.mjs` opt-in `--auto-refresh` mode wired into the Claude Code `PreCompact` hook; upserts a bounded idempotent `<!-- vibe:auto-state:* -->` git-snapshot block when the handoff is stale or work-outdated, otherwise writes nothing.

## 3. Next Action

Run `/vibe-init` in a new downstream project. Existing downstream projects can sync to `v1.7.27`; agent-mode one-liner initialization should not begin MVP work until `npm run vibe:init-ready` passes. Initialized projects should keep product verification in root `test`/`typecheck`/`lint`/`build` scripts and use explicit `vibe:*` commands for harness verification.
