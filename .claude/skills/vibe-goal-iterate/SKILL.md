---
name: vibe-goal-iterate
description: Convert a fully settled design into repeated /goal + $vibe-iterate implementation cycles. Use when the user has finished a detailed design discussion, says there are no more open questions, and wants Codex to autonomously split the design into items, run mini planning/interview checkpoints only when needed, generate Planner/Sprint work, implement each item, verify it, persist handoffs/checkpoints, and continue non-stop until every item is complete or a real blocker is found.
---

# Vibe Goal Iterate

Use this skill to turn a finalized design discussion into an autonomous sequence of implementation iterations. It is for settled work, not early brainstorming.

## Operating Rule

Proceed without asking for more prompts when all of these are true:

- The user explicitly says the design is complete, reasonable, approved, or has no more open questions.
- The remaining work can be decomposed into concrete implementation items.
- The repository has its own vibe-doctor skills or equivalent `/goal`, `$goal-to-plan`, `$vibe-iterate`, sprint, QA, and checkpoint workflows.

Stop for user input only when an item contains a material unresolved product decision, an external credential/access blocker, destructive data risk, or scope conflict that cannot be resolved from local context.

## Multi-Item Loop Contract

Treat the decomposed item list as an authoritative work queue. Every queued item must get its own `/goal` + `$vibe-iterate` cycle unless it is explicitly marked blocked or deferred with a reason.

For each item, in order:

- Persist the current item, remaining queue, acceptance criteria, constraints, and verification plan before starting the cycle.
- Invoke the repo-local `$vibe-iterate` workflow for that item, using the item objective and prior completed/blocked item summaries as the carryover seed.
- Run the mini `/goal` or `$goal-to-plan` planning step inside that item-scoped iteration.
- Implement and verify only that item unless the generated plan identifies a required shared prerequisite.
- Mark the item `completed`, `blocked`, or `deferred` in the durable handoff/session state before moving on.
- Immediately continue to the next non-completed item without asking for another user prompt.

Do not send a final response, mark the goal complete, or stop after the first item while any queued item remains neither completed nor blocked. Legal stopping points are: all items completed, a concrete blocker requiring user input, an explicit user interruption, or a scope conflict recorded with the required expansion.

## Verification Override

This skill narrows verification while the multi-item queue is still running.

- For each item, run only targeted verification tied to that item's changed code, acceptance criteria, or immediate integration point.
- Do not run harness-wide or full-suite verification between items. Examples include full project test/build/QA commands, harness self-tests, broad wrapper audits, or sync/preflight audits that are unrelated to the current item.
- `npm run vibe:checkpoint` remains allowed for durable handoff/session state because it is a context-persistence check, not harness-wide verification.
- Run harness-wide or full-suite verification only when both conditions are true: the final queued item has finished, and the completed iteration explicitly changed harness/runtime/skill/orchestration behavior.
- If harness-wide or full-suite verification is skipped, record the reason in the item or final audit summary.

## Workflow

1. Confirm initialization and mode.
   - In a vibe-doctor project, enforce the local `AGENTS.md` initialization boundary before non-init work.
   - Treat this as Orchestrator work until an actual Sprint Generator prompt/spec is created.
   - Load repo-local `$vibe-iterate` and `$goal-to-plan` wrappers when available; use their shared runbooks rather than inventing a parallel process.

2. Freeze the design into a durable work packet.
   - Create or update a concise handoff/design note before implementation begins.
   - Include: goal, invariants, non-goals, item list, dependencies/order, open risks, verification commands, and rollback/guardrails.
   - If the repo has `.vibe/agent/handoff.md` and `.vibe/agent/session-log.md`, update them before the first implementation item.

3. Decompose into implementation items.
   - Prefer small items that can be completed and verified independently.
   - Order prerequisite infrastructure first, then domain logic, then API/UI wiring, then tests/docs.
   - For each item, define acceptance criteria and narrow verification commands before editing code.

4. Run one mini `/goal` + `$vibe-iterate` cycle for each item.
   - Start a fresh item-scoped `$vibe-iterate` pass for every item in the queue, not just the first item.
   - Use `$goal-to-plan` or the local `/goal` equivalent to convert that item into an implementation plan.
   - If a Planner/Sprint prompt is required by the repo workflow, generate it and then execute the Sprint.
   - Keep each Planner/Sprint fresh-context where the repo's `$vibe-iterate` workflow requires it.

5. Implement, verify, persist, continue.
   - Implement the current item fully.
   - Run only the targeted verification allowed by the Verification Override while queued items remain.
   - Update `.vibe/agent/handoff.md`, `.vibe/agent/session-log.md`, and any project report/checkpoint artifacts after each completed item or before any long transition.
   - Commit/push only when the user has asked for it or the repo's current task explicitly requires it.
   - Re-read the durable queue state, select the next non-completed item, and continue without waiting for another prompt unless blocked.

6. Finish with an audit summary.
   - Finish only after checking the authoritative item queue and confirming that no item is still pending.
   - Report completed items, changed files, commits/pushes, verification results, remaining risks, and any deferred items.
   - If a blocker stopped the loop, include the exact item, reason, and required decision/scope expansion.

## Handoff Policy

Always write a handoff for this workflow. Fresh chat context is not enough because this skill intentionally runs multi-item work that can cross context limits, server restarts, Planner calls, or interruptions.

Use this minimum cadence:

- Before item 1: write the frozen design/work packet.
- After each item: update progress, completed verification, and next item.
- Before starting any generated Sprint or fresh-context Planner: persist the exact item scope and constraints.
- Before final response: ensure durable state reflects the actual end state.

Avoid large handoffs. Keep them audit-dense: bullets, file paths, invariants, commands, status. Do not paste long transcripts.

## Item Template

Use this shape internally for each item:

```text
Item:
Objective:
Invariants:
Files likely touched:
Acceptance criteria:
Verification:
Risks/blockers:
Status:
```

## Guardrails

- Do not broaden scope just to keep the loop moving.
- Do not delete or hard-reset user changes.
- Do not treat source/data loss, destructive DB changes, or schema migrations as routine; add explicit backups/rollback and ask if risk is not already approved.
- Do not let a top-N projection silently violate a user's "full coverage" invariant; require manifest/projection audit when completeness matters.
- If a generated Sprint's file scope is too narrow for the item, stop that Sprint and record the required scope expansion instead of bypassing the rules.
