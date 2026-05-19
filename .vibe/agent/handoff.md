# Orchestrator Handoff

PROJECT NOT INITIALIZED.

This file is project-owned runtime state. Downstream projects must run `/vibe-init` before product work; init rewrites this placeholder with the current project's handoff.

## 1. Identity

- repo: `vibe-doctor`
- status: template placeholder
- harnessVersion: `1.7.19`

## 2. Status

The checked-in upstream template intentionally does not ship active project handoff state.

Maintenance checkpoint: release metadata is set for `v1.7.19`. The harness now keeps `docs/plans/sprint-roadmap.md` as an active, current-iteration roadmap and archives completed or inactive iteration sections under `docs/plans/archive/roadmaps/`. Start/completion checks run through `vibe-roadmap-maintenance`, and preflight, sprint-complete, project-report, dashboard, interview carryover, and roadmap parsing understand the active/archive split. Checkpoint now enforces a compact `.vibe/agent/handoff.md` budget so downstream handoffs stay current-focused instead of accumulating sprint history.

Latest maintenance work: Vowline-inspired harness improvements are partially implemented. `vibe-review-inputs.mjs` wiring drift now follows explicit skill shard markdown references, and Planner/Generator contracts now require a compact `Sprint Contract` block covering target/output surface, allowed writes, exceptions, reference-only values, proof predicates, current proof, and non-proof. This is template maintenance state only; downstream projects still start by running `/vibe-init`.

## 3. Next Action

Run `/vibe-init` in a new downstream project. Existing downstream projects can sync to `v1.7.19`; the roadmap migration archives old iteration sections without dropping sprint details, and oversized handoffs must be compacted before checkpoint passes. Remaining Vowline-inspired backlog: provider bridge verification and installer/update patterns are deferred until there is a concrete host portability incident.
