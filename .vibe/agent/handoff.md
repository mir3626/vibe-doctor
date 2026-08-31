# Orchestrator Handoff — vibe-doctor

<!-- vibe:auto-state:start -->
> Auto-captured git snapshot; refreshed by `npm run vibe:checkpoint`.
<!-- vibe:auto-state:end -->

PROJECT NOT INITIALIZED.

This repository is the upstream `vibe-doctor` template. Downstream product work still requires `/vibe-init`; this handoff covers harness maintenance only.

## Status

- Branch/release: `main`, `v1.14.0` release packet based on `0e4aec49a1115f8aff5287dacff898c511c5a555`.
- Maintenance and release integration are complete for both the standalone goal-iteration decoupling and the safe bare/force-close Pro-flow lifecycle.
- Existing user-local `.vibe/agent/tokens.json` modification is unrelated and must remain uncommitted.
- User inputs remain untracked and byte-identical:
  - `docs/prompts/goal-vibe-goal-iterate-pro-decoupling.md` — SHA-256 `1B3079935F526728DD80FE5A6F238BE2E4B47264F0E2D8071249C1498E6482ED`
  - `docs/reports/vibe-goal-iterate-pro-decoupling-handoff-20260831.md` — SHA-256 `5565590CE1B753B454EE48A0789CCFBE04D494528A33EBCFD4A081C413612EF5`
- The user authorized the `v1.14.0` release commit plus origin branch/tag publication. No actual Pro publication, normal close, or operator force-close is authorized by that release directive.

## Completed scope 1 — goal-iterate / Pro decoupling

- Active iteration history now owns a strict `executionBinding`: `standalone-goal-iterate` requires `proFlowPath: null`; `pro-roundtrip` requires one exact flow path.
- A valid standalone binding ignores but never mutates unrelated ambient Pro state. Explicit Pro bindings remain exact and fail closed.
- Legacy iteration records without the binding retain the ambient Pro completion gate.
- Completion replay cannot attach an old standalone Sprint to a newer iteration or bypass a same-named active legacy Pro flow.
- Goal-to-plan, vibe-iterate phases, Planner, report guidance, workflow integrity docs, schema, and tests consume the same origin-scoped rule.

## Completed scope 2 — safe bare Pro status and deterministic operator close

- Bare `$vibe-pro-go` / `npm run vibe:pro-go` is local-pointer inspection only. It reads the checkout identity and local `ACTIVE.json`, reports `scaffoldingCreated: false`, and never fetches the bridge, selects a remote flow, syncs, bootstraps, starts, or creates packet/worktree scaffolding.
- Resume is explicit: `npm run vibe:pro-go -- go <exact-flow>` or a qualified `--date` / `--slug` selector. Unqualified `go` may use only a valid checkout-owned active local pointer.
- Operator termination is explicit and two-phase:
  - dry-run: `npm run vibe:pro-go -- force-close <flow> --reason "<one-line reason>"`
  - publish after fresh user approval: `npm run vibe:pro-go -- force-close <flow> --reason "<same reason>" --publish --user-approved`
- `proGoAutoPublish` never authorizes force-close. The immutable `OPERATOR-CLOSE.json` is bound to the exact flow/repository/branch/base/source bridge commit and is published as an isolated single-file append-only commit.
- Repeating the exact reason is idempotent; a different reason is an immutable-record conflict. A valid record reports terminal `force-closed`, never approved/completed.
- Force-closed flows cannot be resumed by exact or qualified selectors. A force-closed member blocks coordinated normal close for the entire group.
- The root Web bridge runbook verifies the operator record before pinned protocol/event-chain continuation, including schema, binding, single-commit path history, isolated addition, parent/source, and byte-identical FLOW evidence. This allows poisoned or superseded-generation flows to terminate without mutating their old protocol generation.

## Verification

- Final all-group release verification after every review remediation: `npm run vibe:verify:release` — 562 tests, 561 pass, 0 fail, 1 intentional skip.
- Focused Pro lifecycle coverage includes bare no-origin/no-scaffolding, poisoned-flow force-close, immutable-reason conflict/idempotence, exact and qualified selector terminal behavior, and coordinated-close refusal.
- Schema generation/check, TypeScript, skill validation, Codex wrapper audit, iterate shard audit, sync audit, contract tests, diff checks, UTF-8/mojibake checks, and input-hash restoration passed during implementation.
- Independent final diff review found no remaining P0-P3 findings after coordinated-close, immutable-reason, and Web cross-surface parity remediations.

## Boundaries and restart

- The force-close publish command is a new external lifecycle mutation and always requires fresh user approval for the exact flow and reason. Do not infer it from this handoff or a bare skill invocation.
- Do not hand-edit `.vibe/worktrees/pro-roundtrip`, rewrite `vibe-pro-bridge`, or represent force-close as normal completion.
- The two user input files cannot be shipped in the pristine upstream template; release verification temporarily isolates only those exact paths and restores/verifies their hashes in `finally`.
- No implementation item remains. The release commit/tag must exclude `.vibe/agent/tokens.json` and the two untracked project-owned user inputs; after publication, verify `origin/main`, local `HEAD`, and peeled `v1.14.0` all resolve to the same commit.
