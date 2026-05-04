# Orchestrator Handoff

## 1. Identity

- **repo**: `vibe-doctor`
- **branch**: `main`
- **working release**: `v1.7.2`
- **current mode**: Codex Orchestrator maintenance
- **harnessVersion**: `1.7.2`
- **language/tone**: Korean user-facing, concise engineering notes

## 2. Status

Review-input harness sprint is implemented, verified, and pushed on top of `v1.7.2`.

- Utility opt-in detection now accepts both `[decision][phase3-utility-opt-in]` and `[decision] [phase3-utility-opt-in]`, so real session-log spacing suppresses the default Phase 3 utility warning.
- `vibe-review-inputs` now parses the current six-column `docs/context/harness-gaps.md` ledger instead of the old ad hoc open-only regex.
- Review inputs now include `uncoveredHarnessGaps[]` for unresolved or not-covered rows and `deadlineHarnessGaps[]` for unresolved rows with `+N sprint(s)` or `O*` deadline markers, while preserving `openHarnessGapCount`.
- Repeated open lightweight-audit pending risks are rolled up into non-persisted `pendingRiskRollups[]`; no pendingRisk schema or stored status values were changed.
- The `/vibe-review` skill runbook now tells reviewers to use those consolidated fields instead of repeating stale risk noise.
- `docs/context/harness-gaps.md` records the new review-input coverage under `gap-rule-only-in-md`, while keeping the row under review because wrapper/rule coverage is still intentionally partial.
- The review-input gap/risk rollup patch was pushed to `origin/main` at `c09395d`.
- Previous pushed patches remain on `origin/main`: referenced-MD wrapper guard at `ba6bebb`, project report duplicate-open at `44188b6`, and preflight wrapper-path at `a5b64dd`.

## 3. Verification

Completed on Windows for this patch:

- `npm run typecheck`
- `node --import tsx --test .vibe/harness/test/vibe-review-inputs.test.ts` (16 tests)
- `npm test` (347 tests: 346 pass, 1 skipped)
- `npm run build`
- `git diff --check`
- `npm run vibe:checkpoint`
- Strict UTF-8 decode and mojibake regex checks over touched TypeScript and Markdown files
- `node .vibe/harness/scripts/vibe-review-inputs.mjs` smoke confirmed `uncoveredHarnessGaps`, `deadlineHarnessGaps`, and `pendingRiskRollups` are emitted in the current checkout

## 4. Expected Downstream Behavior

`/vibe-review` should stop auto-seeding utility opt-in skip findings when the session log contains the spaced Phase 3 decision tag. Review inputs should also surface partial or pending harness ledger rows and repeated lightweight-audit risk clusters as explicit upstream process signals.

## 5. Next Action

No immediate action required. Pending policy choices can be planned as separate sprints if selected.

## 6. Pending Risks

- Policy choices were intentionally excluded: no new pendingRisk lifecycle statuses, no migration, and no product identity prompt/evidence gate.
- The open question of whether explicit `bundle=false` should require a replacement policy finding remains separate from the spacing bug fix.
- PowerShell PATH on this machine does not expose `file` or GNU `grep`; equivalent strict UTF-8 and regex checks passed.
