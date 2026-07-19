# vibe-iterate Phase 4 - Run Sprints Normally

Each Sprint follows the existing process: Planner prompt, Codex implementation,
verification, and standard Sprint completion.

Before each Sprint, reconcile its prompt with `docs/context/workflow-integrity.md`
and the authoritative roadmap/design. Require a `Workflow Continuity` block,
targeted Sprint evidence, and a cumulative entrypoint-to-output journey. If a
shared schema, config, API, state transition, or workflow boundary changed,
Sprint-local unit tests alone cannot pass the Sprint.

Planner must not receive `.vibe/agent/iteration-history.json`. The Orchestrator
may prepend only a short prior-sprint header such as:

```md
This is iter-<N> sprint-NN.
```

If `.vibe/agent/pro-roundtrip/ACTIVE.json` is active:

- use its `flowPath`, `designEventId`, `currentSprintId`, base SHA, and Sprint
  order as the binding;
- record the current Sprint's Web Pro report checkpoint with
  `npm run vibe:pro-go -- report <flow> --evidence <input.json>` before running
  `vibe-sprint-complete`;
- on the last Sprint, set the final gate only after full workflow verification,
  generate the aggregate implementation/remediation report automatically, and
  publish it when GitHub write authorization is already present;
- if publication is not authorized, stop only at the external-write boundary
  with the complete local report packet and the exact publish action. The user
  does not need to invoke another skill.

# vibe-iterate Phase 5 - Refresh Project Report

After every Sprint in the iteration is complete, ensure the project report is
fresh. The final `vibe-sprint-complete` / `vibe-sprint-commit` path already
invokes the report generator when the current roadmap or iteration is complete,
so do not run the same command again just to satisfy this phase.

If the automatic report was skipped or the report is stale, run:

```bash
node .vibe/harness/scripts/vibe-project-report.mjs
```

The regenerated `docs/reports/project-report.html` should render the cumulative
iteration timeline, milestone progress, and the cumulative Workflow Continuity
evidence. For a silent refresh when a browser tab is already open, use
`--no-open`.

# User Follow-Up

Point the user to the report's Iteration timeline and milestone progress. Keep
`.vibe/agent/handoff.md` focused on the current iteration only; prior iteration
state belongs in `.vibe/agent/iteration-history.json`.
