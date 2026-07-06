# Orchestrator Handoff

PROJECT NOT INITIALIZED.

This file is project-owned runtime state. Downstream projects must run `/vibe-init` before product work; init rewrites this placeholder with the current project's handoff.

## 1. Identity

- repo: `vibe-doctor`
- status: template placeholder
- harnessVersion: `1.7.24`

## 2. Status

The checked-in upstream template intentionally does not ship active project handoff state.

Maintenance checkpoint: release metadata is set for `v1.7.24`. The harness keeps `docs/plans/sprint-roadmap.md` as an active, current-iteration roadmap and archives completed or inactive iteration sections under `docs/plans/archive/roadmaps/`. Checkpoint enforces a compact `.vibe/agent/handoff.md` budget so downstream handoffs stay current-focused instead of accumulating sprint history.

Latest maintenance work: `vibe-checkpoint.mjs` gained a `docs.integrity` check (v1.7.24), prompted by a downstream incident where a `/maintain-context` pass truncated a project CLAUDE.md to 0 bytes via a shell one-liner and the checkpoint still passed. The check targets `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.vibe/agent/_common-rules.md`, and `docs/context/*.md`, restricted to git-tracked files that exist on disk (degrading to an existence-based size scan when git is unavailable), and fails when content trims to empty or is under 64 bytes (`VIBE_DOC_MIN_BYTES`). Report-only in both modes — `--auto-refresh` never rewrites these documents. The `maintain-context` runbook gained two workflow rules: native Edit/Write tools only for rewriting existing docs (no shell heredocs / same-file read-while-write-open expressions), and a pre-commit `git diff --stat` gate for mass deletions in first-read documents. Verified: `vibe:typecheck`, full `vibe:self-test` (467 pass / 0 fail / 1 skip), 4 new `checkpoint.test.ts` cases, and a live-repo smoke (`docs.integrity` checked 22 files).

Previous maintenance work: `vibe-checkpoint.mjs` opt-in `--auto-refresh` mode (v1.7.23), wired into the Claude Code `PreCompact` hook. When the handoff is stale or work-outdated it upserts a bounded idempotent `<!-- vibe:auto-state:* -->` git-snapshot block and bumps `handoff.updatedAt`; otherwise it writes nothing. Without the flag the script stays read-only verification.

Previous maintenance work: `vibe-goal-iterate` now overrides per-item verification scope. During the multi-item loop it allows only targeted verification tied to the current item, forbids harness-wide/full-suite verification between items, keeps `npm run vibe:checkpoint` allowed as context persistence, and permits harness-wide/full-suite verification only when the final queued item has finished and the iteration explicitly changed harness/runtime/skill/orchestration behavior.

## 3. Next Action

Run `/vibe-init` in a new downstream project. Existing downstream projects can sync to `v1.7.24`; agent-mode one-liner initialization should not begin MVP work until `npm run vibe:init-ready` passes. Initialized projects should keep product verification in root `test`/`typecheck`/`lint`/`build` scripts and use explicit `vibe:*` commands for harness verification.
