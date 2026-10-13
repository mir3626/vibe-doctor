# vibe-iterate Phase 0 - Load State

The Orchestrator reads:

- `docs/reports/project-report.html` (latest report)
- `.vibe/agent/handoff.md`
- `.vibe/agent/session-log.md`
- `docs/plans/project-milestones.md`
- `.vibe/agent/iteration-history.json` — including the previous iteration's
  `carryover` (`{ backlogDoc, open }`) when present
- the standing backlog doc named by `carryover.backlogDoc` (default
  `docs/plans/next-iteration-backlog.md`) when it exists — the durable list of
  un-implemented items scattered backlog sections would otherwise lose
- the previous iteration section in `docs/plans/archive/roadmaps/<iter-id>.md`
  when present, otherwise the previous section in `docs/plans/sprint-roadmap.md`

This state is Orchestrator input only; do not inject the full history into
Planner prompts. Fold the still-open `carryover`/backlog items into the
differential interview so real un-implemented work is not dropped; a backlog
item the user drops or that a Sprint has since implemented is removed from the
doc and the next `carryover`, not silently kept.

Resolve the current iteration's `executionBinding` before consulting Pro state:

- `standalone-goal-iterate` restores local design, queue, completion, and report
  authority; an unrelated `ACTIVE.json` is not a substitute authority.
- `pro-roundtrip` requires its exact non-null `proFlowPath` to match the active
  packet before any Pro design, Sprint, checkpoint, or report is used.
- an absent binding is legacy state and retains the existing ambient Pro
  protection; do not use this compatibility case for a new item-scoped
  `$vibe-goal-iterate` record.

A malformed binding or explicit Pro mismatch fails closed instead of being
downgraded to legacy. Pass only a short lane/path header to Planner.
