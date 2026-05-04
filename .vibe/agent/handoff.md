# Orchestrator Handoff

## 1. Identity

- **repo**: `vibe-doctor`
- **branch**: `main`
- **working release**: `v1.7.3` (`v1.7.3-lts`)
- **current mode**: Codex Orchestrator maintenance
- **harnessVersion**: `1.7.3`
- **language/tone**: Korean user-facing, concise engineering notes

## 2. Status

Policy sprint for the remaining dogfood12 review decisions is implemented, verified, and pushed to `origin/main` at `e471844`; tags `v1.7.3` and `v1.7.3-lts` are also pushed.

- `/vibe-init` now records bundle policy as `automatic`, `custom`, or `off`. Ambiguous user answers default to `automatic`; explicit frontend opt-out requires rationale plus replacement evidence.
- `/vibe-review` now distinguishes forgotten frontend utility gates from explicit opt-outs missing replacement evidence, and flags unresolved automatic bundle policy for frontend/browser projects.
- `pendingRisk.status` now supports `open`, `acknowledged`, `accepted`, `deferred`, `closed-by-scope`, and `resolved`.
- Preflight, sprint commit, dashboard, project report, and review rollups treat only `open` pending risks as blocking/actionable by default.
- Added migration `.vibe/harness/migrations/1.7.3.mjs` to normalize pendingRisk lifecycle aliases and add missing `bundle.policy` defaults.
- Planner/Evaluator prompt policy now requires screenshot/playthrough/identity-payoff evidence for frontend, game, visual, canvas/WebGL/Three.js, editor, and dashboard Sprints; typecheck/test/build/browser-smoke alone is not enough for those experiential ACs.
- Harness version, README, release notes, sync manifest, and generated `sprint-status.schema.json` are updated for `v1.7.3`.
- `v1.7.3-lts` is an immutable LTS alias pointing at the same release commit as `v1.7.3`; no moving `lts` tag is used.

## 3. Verification

Completed on Windows for this local patch:

- `npm run typecheck`
- focused lifecycle/review/sync/report/dashboard/init-contract tests:
  `node --import tsx --test .vibe/harness/test/vibe-review-inputs.test.ts .vibe/harness/test/sprint-status.test.ts .vibe/harness/test/preflight-audit-gate.test.ts .vibe/harness/test/sprint-commit.test.ts .vibe/harness/test/project-report.test.ts .vibe/harness/test/dashboard-server.test.ts .vibe/harness/test/config-path-resolution.test.ts .vibe/harness/test/sync.test.ts .vibe/harness/test/codex-skills.test.ts .vibe/harness/test/schemas.test.ts`
- `npm test` (355 tests: 354 pass, 1 skipped)
- `npm run build`

## 4. Expected Downstream Behavior

Downstream projects syncing to `v1.7.3` get explicit pendingRisk lifecycle states without breaking existing `open|acknowledged|resolved` records. Frontend/game/visual projects should get stronger prompt-level evidence requirements before a Sprint is accepted, while utility opt-outs remain review findings rather than preflight failures.

## 5. Next Action

No immediate action. Next dogfood sync/review should validate the v1.7.3 behavior in a downstream project.

## 6. Pending Risks

- Bundle/browserSmoke replacement-evidence enforcement is review-only, not preflight-blocking.
- Product identity is prompt-policy enforced, not script-gated; if dogfood still passes weak experiential work, the next escalation should add an artifact/evidence wrapper guard.
- PowerShell PATH on this machine does not expose `file` or GNU `grep`; use strict UTF-8 decode and regex equivalents for encoding checks.
