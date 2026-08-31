# vibe-iterate Phase 2 - Write Active Sprint Roadmap

The Orchestrator creates a new roadmap section from unfinished prior Sprints and
new iteration goals. Write the new current section to
`docs/plans/sprint-roadmap.md`:

```md
## Iteration iter-<N>
```

Never delete existing roadmap content unless it has first been archived under
`docs/plans/archive/roadmaps/<iter-id>.md`. The active roadmap file should hold
only the current iteration plus the current-sprint pointer block.

After Phase 3 sets `currentIteration`, run:

```bash
node .vibe/harness/scripts/vibe-roadmap-maintenance.mjs --mode start-check
```

The command is idempotent and checks for missing archive writes before compacting
`docs/plans/sprint-roadmap.md`.

# vibe-iterate Phase 3 - Update Iteration History

Append a record to `.vibe/agent/iteration-history.json` and set
`currentIteration` to the new id. Include `id`, `label`, `goal`, `startedAt`,
`plannedSprints[]`, carryover summary, and open risks or deferred items.

When the iteration is an item in `$vibe-goal-iterate`, also write the caller's
durable `executionBinding` without re-deriving it from repository files:

```json
{ "executionLane": "standalone-goal-iterate", "proFlowPath": null }
```

For an explicit `$vibe-pro-go` origin only, set the execution lane to
`pro-roundtrip` and write the exact `proFlowPath` such as
`flows/YYYYMMDD/NNN-slug`. Every item in the same loop inherits the same
binding. Missing/mismatched explicit Pro
binding fails closed. Ordinary `/vibe-iterate` behavior outside these lanes
remains compatible; field absence is reserved for pre-existing/legacy state
and must not be used to make a new goal-iterate item ambiguous.
