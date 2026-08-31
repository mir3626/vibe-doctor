# vibe-iterate Phase 4 - Run Sprints Normally

Each Sprint follows the existing process: Planner prompt, Codex implementation,
verification, and standard Sprint completion.

Before each Sprint, reconcile its prompt with `docs/context/workflow-integrity.md`
and the authoritative roadmap/design. Require a `Workflow Continuity` block,
targeted Sprint evidence, and a cumulative entrypoint-to-output journey. If a
shared schema, config, API, state transition, or workflow boundary changed,
Sprint-local unit tests alone cannot pass the Sprint.

For harness-owned changes, carry the iteration/goal base SHA and run
`npm run vibe:verify -- <goal-base-sha>`. A current successful group
receipt is cumulative evidence; branch name or an earlier Sprint-local pass is
not. Reserve `vibe:verify:release` for the release/tag/migration/compatibility
boundaries defined in `docs/guides/verification-reuse.md`.

Planner must not receive `.vibe/agent/iteration-history.json`. The Orchestrator
may prepend only a short prior-sprint header such as:

```md
This is iter-<N> sprint-NN.
Execution lane: standalone-goal-iterate
Pro flow path: null
```

Use the bound exact flow path instead of `null` for `pro-roundtrip`. Resolve the
completion/report lane from that durable header and iteration record:

- `standalone-goal-iterate`: run the local Sprint completion/report path. Do
  not create a Pro checkpoint or Web report and do not treat an unrelated
  `ACTIVE.json` as authority.
- `pro-roundtrip`: require the exact path to match the active packet, then use
  its design event, current Sprint, base SHA, and Sprint order; record the Web
  Pro checkpoint before `vibe-sprint-complete`, require the final workflow gate
  on the last Sprint, and prepare/publish the aggregate report only within the
  existing GitHub authorization boundary.
- binding absent: preserve the legacy ambient Pro protection and current
  reporting tail. Do not auto-migrate or use absence for a new goal-iterate
  item.

Malformed binding, missing explicit Pro state, or exact-path mismatch fails
closed.

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
