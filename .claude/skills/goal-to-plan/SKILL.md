---
name: goal-to-plan
description: Turn a user goal into a short implementation plan and approval gate.
---

Use this skill when a user provides a goal but no detailed method.

For a multi-item or multi-Sprint goal, read
`docs/context/workflow-integrity.md`. If
`.vibe/agent/pro-roundtrip/ACTIVE.json` is active, treat its flow, design event,
contract IDs, Sprint order, and exact code binding as authoritative.

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
