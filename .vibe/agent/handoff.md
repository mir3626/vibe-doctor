# Orchestrator Handoff

## 1. Identity

- **repo**: `vibe-doctor`
- **branch**: `main`
- **working release**: `v1.7.4` (LTS baseline remains `v1.7.3-lts`)
- **current mode**: Codex Orchestrator maintenance
- **harnessVersion**: `1.7.4`
- **language/tone**: Korean user-facing, concise engineering notes

## 2. Status

Current mainline policy checkpoint is `v1.7.4`; LTS baseline remains immutable tag `v1.7.3-lts`.

- `/vibe-init` now records bundle policy as `automatic`, `custom`, or `off`. Ambiguous user answers default to `automatic`; explicit frontend opt-out requires rationale plus replacement evidence.
- `/vibe-review` now distinguishes forgotten frontend utility gates from explicit opt-outs missing replacement evidence, and flags unresolved automatic bundle policy for frontend/browser projects.
- `pendingRisk.status` now supports `open`, `acknowledged`, `accepted`, `deferred`, `closed-by-scope`, and `resolved`.
- Preflight, sprint commit, dashboard, project report, and review rollups treat only `open` pending risks as blocking/actionable by default.
- Added migration `.vibe/harness/migrations/1.7.3.mjs` to normalize pendingRisk lifecycle aliases and add missing `bundle.policy` defaults.
- Planner/Evaluator prompt policy now requires screenshot/playthrough/identity-payoff evidence for frontend, game, visual, canvas/WebGL/Three.js, editor, and dashboard Sprints; typecheck/test/build/browser-smoke alone is not enough for those experiential ACs.
- Harness version, README, release notes, sync manifest, and generated `sprint-status.schema.json` are updated for `v1.7.3`.
- `v1.7.3-lts` is an immutable LTS alias pointing at the same release commit as `v1.7.3`; no moving `lts` tag is used.
- v1.7.4 records the approved context-overhead policy: no capsule/router/prompt reduction until context coverage observability and fail-closed safeguards have dogfood evidence; `vibe-checkpoint` freshness is not decision completeness; durable events need concise session-log markers; handoff rewrites are required when restart state changes.

## 3. Verification

Completed on Windows for the v1.7.4 policy checkpoint patch:

- `npm run typecheck`
- `node .vibe/harness/scripts/vibe-review-inputs.mjs` smoke confirmed `gap-context-overhead-policy` appears in `uncoveredHarnessGaps[]` and `deadlineHarnessGaps[]`.
- `npm test` (355 tests: 354 pass, 1 skipped)
- `npm run build`

## 4. Expected Downstream Behavior

Downstream projects syncing to `v1.7.4` get the v1.7.3 lifecycle/policy changes plus the context-overhead policy checkpoint. Projects that need stability can pin `v1.7.3-lts`.

## 5. Next Action

After the next dogfood runs, `/vibe-review` should inspect `gap-context-overhead-policy` evidence before recommending any context coverage observability or capsule/prompt reduction sprint.

## 6. Pending Risks

- Bundle/browserSmoke replacement-evidence enforcement is review-only, not preflight-blocking.
- Product identity is prompt-policy enforced, not script-gated; if dogfood still passes weak experiential work, the next escalation should add an artifact/evidence wrapper guard.
- PowerShell PATH on this machine does not expose `file` or GNU `grep`; use strict UTF-8 decode and regex equivalents for encoding checks.
