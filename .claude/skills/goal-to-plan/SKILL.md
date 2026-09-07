---
name: goal-to-plan
description: Turn a user goal into a short implementation plan and approval gate.
---

For a verified active GPT-6 Astra model, use `.vibe/agent/astra-rules.md`
unless the legacy comparison/rollback profile was explicitly selected. It replaces
mandatory role, interview, per-item goal, creative and repeated-QA ceremonies in
this runbook. Keep the concrete initialization, state, ownership and authorization
contracts. Read remaining shards on demand. Lower/unknown models use the full
workflow below; each child re-evaluates its own model.


Use this skill when a user provides a goal but no detailed method.

For a multi-item or multi-Sprint goal, read
`docs/context/workflow-integrity.md`. When this planning step runs inside
`$vibe-goal-iterate`, consume the execution binding already selected by the
caller and persist it in the item iteration: a direct loop is
`standalone-goal-iterate` with `proFlowPath: null`; a `$vibe-pro-go`-originated
loop is `pro-roundtrip` with its exact `flowPath`. Missing or mismatched explicit
Pro binding fails closed. Do not select Pro authority merely because
`.vibe/agent/pro-roundtrip/ACTIVE.json` exists. A pre-existing iteration with no
binding remains legacy and retains the existing ambient Pro protection rather
than being silently migrated.

Output structure:
1. Goal understanding
2. Proposed execution process
3. Files / folders likely to change
4. Dependencies / APIs / CLI
5. Test and QA strategy
6. Risks / trade-offs
7. Approval checkpoint
8. Workflow Continuity: affected workflows, upstream inputs, downstream
   consumers, cumulative entrypoint-to-output journey, preserved invariants,
   and evidence
9. Execution binding: lane plus exact `proFlowPath` or `null`, suitable for the
   short fresh-Planner header without copying full iteration history

For a multi-Sprint goal that may change harness-owned files, record the exact
`goalBaseSha` in the plan and use
`npm run vibe:verify -- <goalBaseSha>` for cumulative harness
verification. Do not substitute a branch name or only the latest Sprint diff.
