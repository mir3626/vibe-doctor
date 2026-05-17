# Orchestrator Handoff

PROJECT NOT INITIALIZED.

This file is project-owned runtime state. Downstream projects must run `/vibe-init` before product work; init rewrites this placeholder with the current project's handoff.

## 1. Identity

- repo: `vibe-doctor`
- status: template placeholder
- harnessVersion: `1.7.18`

## 2. Status

The checked-in upstream template intentionally does not ship active project handoff state.

Maintenance checkpoint: release metadata is set for `v1.7.18`. The harness now keeps `docs/plans/sprint-roadmap.md` as an active, current-iteration roadmap and archives completed or inactive iteration sections under `docs/plans/archive/roadmaps/`. Start/completion checks run through `vibe-roadmap-maintenance`, and preflight, sprint-complete, project-report, dashboard, interview carryover, and roadmap parsing understand the active/archive split. Checkpoint now enforces a compact `.vibe/agent/handoff.md` budget so downstream handoffs stay current-focused instead of accumulating sprint history. This is template maintenance state only; downstream projects still start by running `/vibe-init`.

## 3. Next Action

Run `/vibe-init` in a new downstream project. Existing downstream projects can sync to `v1.7.18`; the roadmap migration archives old iteration sections without dropping sprint details, and oversized handoffs must be compacted before checkpoint passes.
