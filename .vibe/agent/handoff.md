# Orchestrator Handoff — vibe-doctor

<!-- vibe:auto-state:start -->
> Auto-captured git snapshot; refreshed by checkpoint when requested.
<!-- vibe:auto-state:end -->

PROJECT NOT INITIALIZED.

This is the upstream template; downstream product work still requires /vibe-init.

## Current outcome

- Branch main; v1.15.2 release candidate is implemented and verified. User explicitly authorized version/tag publication and osint-stock-screener upgrade. Main/tag publication and exact remote verification are next; no Pro lifecycle action is authorized.
- User directive: ordinary harness patches must run temporary Git/worktree Pro tests only when the changed behavior affects vibe-pro-go.
- npm test / vibe:self-test now use changed groups and reusable passing receipts. vibe:self-test:all remains full/forced; vibe:verify:release remains full/forced.
- pro-roundtrip opts out of broad shared globs. Its explicit inputs cover Pro code/tests/fixtures/skills/protocol documents, args/cli/logger, Pro schemas, universal integrity core and verifier profile inputs. Keep inputPatterns and impactPatterns aligned when Pro gains a dependency.
- Unknown harness paths, changed verifier/dependency/CI configuration and invalid comparison bases still select all groups with reasons. No ambient ACTIVE.json base is borrowed.
- Push/PR Linux legacy/Astra CI uses a full checkout history and the prior push / PR base SHA, with --force on selected groups. Windows contract coverage is unchanged. Already committed local patches need an explicit base SHA.
- Shared and Astra agent rules plus README now direct patch verification through the changed-group path, with no manual Pro run for unrelated edits.

## Verification

- Focused verification-runner: 12/12 pass, including selection exclusions, real Pro dependencies, receipt stability/invalidation and actual child-test execution from a clean committed fixture.
- The fixture proves unrelated edits never start the Pro sentinel; mapped Pro changes, --all, missing bases and unknown harness paths do start it. Existing receipt corruption, mutation and profile regressions also pass.
- Final Astra core + static-audits: 195 pass / 1 conditional skip / 0 fail. Legacy static-audits: 95/95 pass. Typecheck, build, CI YAML/base wiring and diff/encoding checks pass.
- Release validation after versioning: full forced Astra verification passed 573 tests / 571 pass / 2 conditional skips / 0 failures, including the Pro Git integration suite. Build, generated schemas, sync audit and encoding/diff checks pass. Remote CI is pending publication.
- Downstream: reviewed 467 sync targets, preserved all 21 unchanged local conflicts, and applied this candidate through the normal sync API with a backup. Package/config/installed versions are 1.15.2 and ref is ^v1.15.2. Core/static tests passed 201/205 with four conditional skips; typecheck, build, bootstrap preflight and custom CI base/manual-full wiring pass.
- Downstream product-contract checker retains exactly eight baseline violations (client roster and migration documentation); new violations zero, CI syntax/wiring passes. Keep this separate from harness acceptance and the stopped product Goal.
- Verification receipts: .vibe/runs/verification-receipts/. Release, preservation, sync and baseline evidence: .tmp/release-1.15.2/. Legacy static log: .tmp/pro-test-selection-legacy-static.log.

## Prior state and preserve

- v1.15.1 publication/downstream sync completed on 2026-09-07; exact refs and earlier release evidence are in session-log.md and .tmp/release-1.15.0/. Downstream product R33 remains stopped by its owner; this task upgrades only the harness.
- Live Astra versus legacy model task-success comparison remains blocked by the previously observed child-runtime denials. Do not retry automatically; see .tmp/astra-implementation-20260907/paired/ADJUDICATION.md and docs/reports/astra-harness-implementation-2026-09-07.md.
- Preserve original dirty .vibe/agent/tokens.json (SHA-256 A73281082B7FD132E0C5A5567D16750E3A56AEB3A7DC98747B6B58B4E2BB4922), existing untracked plans/prompts/reports and .tmp artifacts. No user draft was staged, moved or deleted.
- Preserve standalone/exact-Pro binding, local-only bare status, append-only evidence and exact-flow close authority. Do not retry cleanup of prior review copies after its approval rejection.

## Next action

- Commit the scoped upstream payload, atomically push main plus annotated v1.15.2, verify remote CI/tag bytes, then commit/push only the downstream upgrade. Preserve its 63 pre-existing dirty paths, 21 customizations and protected settings. Record exact remote outcomes afterward.
