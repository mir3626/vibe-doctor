---
name: write-report
description: Write a concise Markdown completion report for a task.
---

Create a report in `docs/reports/` that includes:
- what changed
- tests and QA run
- remaining risks
- usage summary if available
- context files updated

Read `docs/context/workflow-integrity.md` and include the affected workflows,
upstream inputs, downstream consumers, cumulative entrypoint-to-output journey,
preserved invariants, and exact evidence binding.

If `.vibe/agent/pro-roundtrip/ACTIVE.json` names an active flow with
`autoReportRequired: true`, this skill is also the automatic `$vibe-pro-go`
reporting tail:

- create the schema-valid report input for the active Sprint and exact HEAD;
- record it with `npm run vibe:pro-go -- report <flow> --evidence <input.json>`;
- on the last Sprint, require the final workflow gate and prepare the aggregate
  Web Pro report without waiting for another skill invocation;
- publish only with GitHub write authorization. Without it, retain the complete
  durable packet and report the single remaining publish action.
