# Orchestrator Handoff

## 1. Identity

- **repo**: `vibe-doctor`
- **branch**: `main`
- **working release**: `v1.7.7` (LTS baseline remains `v1.7.3-lts`)
- **current mode**: Codex Orchestrator maintenance
- **harnessVersion**: `1.7.7`
- **language/tone**: Korean user-facing, concise engineering notes

## 2. Status

Current mainline release is `v1.7.7`, pushed to `origin/main` at `1d4dfe8`; tag `v1.7.7` is also pushed. LTS baseline remains immutable tag `v1.7.3-lts`.

- `/vibe-init` now records bundle policy as `automatic`, `custom`, or `off`. Ambiguous user answers default to `automatic`; explicit frontend opt-out requires rationale plus replacement evidence.
- `/vibe-review` now distinguishes forgotten frontend utility gates from explicit opt-outs missing replacement evidence, and flags unresolved automatic bundle policy for frontend/browser projects.
- `pendingRisk.status` now supports `open`, `acknowledged`, `accepted`, `deferred`, `closed-by-scope`, and `resolved`.
- Preflight, sprint commit, dashboard, project report, and review rollups treat only `open` pending risks as blocking/actionable by default.
- Added migration `.vibe/harness/migrations/1.7.3.mjs` to normalize pendingRisk lifecycle aliases and add missing `bundle.policy` defaults.
- Planner/Evaluator prompt policy now requires screenshot/playthrough/identity-payoff evidence for frontend, game, visual, canvas/WebGL/Three.js, editor, and dashboard Sprints; typecheck/test/build/browser-smoke alone is not enough for those experiential ACs.
- Harness version, README, release notes, sync manifest, and generated `sprint-status.schema.json` are updated for `v1.7.3`.
- `v1.7.3-lts` is an immutable LTS alias pointing at the same release commit as `v1.7.3`; no moving `lts` tag is used.
- v1.7.4 records the approved context-overhead policy: no capsule/router/prompt reduction until context coverage observability and fail-closed safeguards have dogfood evidence; `vibe-checkpoint` freshness is not decision completeness; durable events need concise session-log markers; handoff rewrites are required when restart state changes.
- v1.7.5 adds `npm run vibe:context-audit`, a report-only harness skill/runbook dependency scanner. It classifies referenced paths as `hard`, `soft`, or `unknown`, reports `known`, `missing`, `ambiguous`, and `stale` buckets, and records context byte overhead without gating preflight, sprint commit, push, tags, Generator prompts, or capsule routing.
- v1.7.6 refreshes `vibe-dashboard.mjs` and `vibe-project-report.mjs` with a calmer operational UI, Geist typography, compact inline SVG brand mark, reduced section-as-card nesting, and render-only `data-demo="true"` preview rows for empty dashboard/report states.
- v1.7.7 adds a `/vibe-interview` consensus gate: termination now emits `phase:"consensus"` before final seed generation, `--consensus --decision approve|revise|defer|proxy-unconfirmed` records the outcome, and the final Phase 3 seed includes a `Phase 3 Consensus Check` block with status/hash/corrections/unresolved dimensions.

## 3. Verification

Completed on Windows for the v1.7.7 interview consensus candidate:

- `node --check .vibe/harness/scripts/vibe-interview.mjs`
- `node --import tsx --test .vibe/harness/test/interview-cli.test.ts .vibe/harness/test/interview-engine.test.ts .vibe/harness/test/interview-coverage.test.ts`
- `npm run typecheck`
- `npm test` (359 tests: 358 pass, 1 skipped)
- `npm run build`
- `git diff --check`
- strict UTF-8 decode and mojibake regex equivalents passed; PowerShell PATH does not expose `file` or GNU `grep` on this machine.

## 4. Expected Downstream Behavior

Downstream projects syncing to `v1.7.7` get the v1.7.3 lifecycle/policy changes, v1.7.4 context-overhead checkpoint, v1.7.5 report-only context dependency audit, v1.7.6 dashboard/report UI refresh, and the `/vibe-interview` consensus gate. Projects that need stability can pin `v1.7.3-lts`.

## 5. Next Action

Dogfood `/vibe-init` on a downstream project and confirm: termination pauses at consensus, `revise` preserves corrections, human approval produces `status: approved`, and PO-proxy produces `status: proxy-unconfirmed`.

After the next dogfood runs, `/vibe-review` should inspect `gap-context-overhead-policy` evidence and `vibe-context-audit` baseline noise before recommending any context coverage observability or capsule/prompt reduction sprint.

For the Matt Pocock skills + grill-pass integration review, the current safe upstream sequence is: dogfood the P1-lite report-only dependency/context audit -> domain-language artifact with canonical/provisional/conflict states -> shadow grill pass after normal interview -> advisory `/vibe-diagnose` -> architecture rubric only after dogfood evidence. Do not add blocking `phase0-seal` term-conflict gates, blocking lint, termination-threshold changes, Generator scope leakage, or push/tag side effects before dogfood.

## 6. Pending Risks

- Bundle/browserSmoke replacement-evidence enforcement is review-only, not preflight-blocking.
- Product identity is prompt-policy enforced, not script-gated; if dogfood still passes weak experiential work, the next escalation should add an artifact/evidence wrapper guard.
- `vibe-context-audit` currently produces a noisy report-only baseline; do not convert it into a gate until dogfood proves the classification is actionable.
- UI preview rows are render-only; if users confuse them for real sprint data during dogfood, add stronger sample labeling before expanding the pattern.
- Consensus corrections are explicit override records, not semantic coverage rewrites. If dogfood shows this is too weak, add a correction-parser/recoverage pass in a later release.
- `/vibe-review` does not yet surface `proxy-unconfirmed` consensus states automatically.
- PowerShell PATH on this machine does not expose `file` or GNU `grep`; use strict UTF-8 decode and regex equivalents for encoding checks.
