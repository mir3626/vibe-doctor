# Orchestrator Handoff

<!-- vibe:auto-state:start -->
> Auto-captured git snapshot (PreCompact); not a substitute for the narrative below.
> Captured: 2026-07-20T04:16:32.521Z
> Branch: main @ 9d69d0e chore(release): v1.8.3
> Uncommitted: 11 file(s)
> - M .vibe/agent/handoff.md
> -  M .vibe/agent/session-log.md
> -  M .vibe/config.json
> -  M .vibe/harness/scripts/run-codex.sh
> -  M .vibe/harness/src/pro-roundtrip/report.ts
> -  M .vibe/harness/test/pro-roundtrip-cli.test.ts
> -  M .vibe/harness/test/run-codex-wrapper.test.ts
> -  M README.md
> -  M docs/release/README.md
> -  M package.json
> - ?? docs/release/v1.8.4.md
> Staged: none; Unstaged: 10 files changed, 346 insertions(+), 40 deletions(-)
> Recent commits:
> - 9d69d0e chore(release): v1.8.3
> - 47e8379 chore(release): v1.8.2
> - f10c4b7 feat(pro-go): add GitHub-backed Web Pro workflow
> - f2f9512 fix(hooks): isolate SessionStart from Stop QA
> - 1ac35d6 fix(hooks): detach harness-only Stop QA
<!-- vibe:auto-state:end -->

PROJECT NOT INITIALIZED.

This is the upstream `vibe-doctor` template, so downstream product work still requires `/vibe-init`.

## 1. Identity

- repo: `vibe-doctor`
- mode: Codex Orchestrator maintenance
- harnessVersion: `1.8.4`
- publication branch/base: rewritten `main` lineage from `f2f9512aeee62f0d13537e8b5fe99c8947a4bdd5`
- remote state: `origin/main` carries the GitHub-only Pro workflow through `v1.8.4`; preserved `origin/vibe-pro-bridge` remains isolated and is not part of this release push
- publication state: v1.8.4 published to `main` with annotated tag per the direct-main release convention; the triggering user directive was the downstream bug report requesting upstream integration and release inclusion. No release PR is required.

## 2. Active Work

- v1.8.4 (this session): downstream dogfood (mir3626/osint-stock-screener) reported that a design-less `start audit` flow could not record remediation evidence after Web Pro feedback — `recordSprintReport` expected `audit` kind while the publisher only reads `remediation/<feedback-event>/` checkpoints, so the remediation-report target was unreachable. Fixed the expected-kind derivation (feedback → remediation regardless of contract), dropped the redundant kind clause from the contract-less binding guard, and added a full contract-less remediation roundtrip regression test. Also fixed a v1.7.27 regression found live: `run-codex.sh`'s session-start lifecycle child drained piped prompts via the hook stdin auto-detect (`readFileSync(0)`), breaking every `cat prompt | run-codex.sh -` delegation; now runs with `</dev/null` plus a wrapper regression test.
- Public entrypoint is now `$vibe-pro-go` / `npm run vibe:pro-go`.
- Bare invocation selects the newest non-closed flow for the current repo/branch by latest completed bridge event, syncs its durable packet, and returns paths plus the next executable action.
- Web-first entry is supported through root `bridge-runbook.md`: GitHub exact-ref actions only, no Web Search/index/default fallback, Pro-origin goal + design creation, then normal CLI continuation.
- `bootstrap --publish` verifies the root runbook is already committed/pushed on the bound code branch before publishing immutable `protocol/v1` plus `PROTOCOL.json`.
- `docs/context/workflow-integrity.md` is the shared anti-overengineering and cross-Sprint contract. Planner, goal-to-plan, goal-iterate, iterate, write-report, common Generator rules, and orchestration docs all reference it.
- `sync` writes `.vibe/agent/pro-roundtrip/ACTIVE.json`. An active Pro Sprint cannot pass `vibe-sprint-complete` without a design/Sprint/current-HEAD checkpoint whose Sprint/cumulative gates pass; the final Sprint also needs the final workflow gate.
- A Pro-origin goal/iterate/Sprint automatically prepares its Web implementation/remediation report without another skill invocation. GitHub publication still stops at the explicit external-write authorization boundary.
- Internal schema/source/local packet identifiers keep `pro-roundtrip` for durable-format compatibility. Historical design documents retain the old public name with a history note.
- Release migration `1.8.2` removes proven-unmodified legacy MCP bridge harness files and exact default config/scripts while preserving customized files, historical `.vibe/pro-bridge/**` results, and project-owned designs.
- v1.8.3 includes the Windows self-test descendant hidden-window policy, M1 semantic group receipts, and M2 Pro E2E/runtime optimization.
- Completed M1 test-cost queue from the 2026-07-20 harness review:
  1. completed — explicit test-group manifest, cumulative diff planner, success-only content-addressed receipts, ownership audit, and fail-closed unknown handling;
  2. completed — manual self-test and Stop QA share the planner/receipts; partially synced Stop installs retain the legacy fallback;
  3. completed — documented the operating contract and passed targeted, build, audit, and final full regression checks.
- M1 goal base: `47e8379ee476a40bbd2a9a4cb7cc949c36ac6471`. Core receipt proof: first pass ran 87 tests; the identical second input returned `run=0 reuse=1`.
- M1 invariants: unknown harness impact fails closed to every applicable group; a failure never becomes reusable; full `vibe:self-test` still executes every root harness test; Stop remains background/nonblocking, ignores product-only changes, and never runs product QA; Windows descendants stay hidden.
- M1 non-goals: refactoring process-heavy E2E cases, deleting historical tests, changing project-owned downstream QA, or publishing the work.
- Completed M2 E2E-performance queue:
  1. completed — added an in-process Pro command execution boundary with explicit output/CWD/context injection while preserving the shipped CLI wrapper;
  2. completed — lifecycle tests reuse one validated bridge context, retain real Git commits/pushes and a spawned wrapper smoke, and batch immutable-history inspection into one `git log`;
  3. completed — added context-ownership/state-convergence guards, documented the E2E boundary, and passed cumulative plus forced final verification.
- M2 baseline: isolated `pro-roundtrip-cli.test.ts` took 100.1 seconds; its four cases took 7.1s, 70.0s, 11.6s, and 11.1s. Goal base remains `47e8379ee476a40bbd2a9a4cb7cc949c36ac6471`.
- M2 current proof: isolated CLI suite passes 6/6 in 30.5 seconds, 69.5% below baseline. The v1.8.3 release-candidate lane passed 501 tests (500 pass/0 fail/1 skip) in about 79.6 seconds wall time versus the M1 boundary's 120.7 seconds.
- M2 invariants: user-facing arguments/output/errors stay compatible; append-only/tamper/stale-HEAD behavior still uses real Git history; `pro-roundtrip-transport.test.ts` remains the independent transport boundary; at least one spawned `vibe-pro-go.mjs` smoke remains.
- M2 non-goals: protocol/schema changes, mocked safety claims, removal of transport coverage, product-owned QA changes, release/tag, or publication.

## 3. Verification and Risks

- Final `npm run vibe:verify:release`: 501 tests, 500 pass, 0 fail, 1 intentional skip in about 79.6 seconds wall time. The final base-bound pass ran 15 Pro tests plus typecheck, then the identical repeat returned `run=0 reuse=8`.
- Focused Pro tests include Web-origin goal/design, root-runbook bootstrap gate, bare latest-flow resume, manifest, report/remediation/approval/close, stale HEAD, tamper, collision, and branch isolation.
- `vibe:typecheck`, `vibe:build`, schema drift check, both skill validations, Codex wrapper audit, iterate shard audit, sync audit, `git diff --check`, and `vibe:pro-go doctor` passed.
- Migration regression tests and live detached-worktree application against the preserved MCP lineage passed: 53 legacy harness files removed, 40/40 historical artifacts and 6/6 project plan files preserved.
- Windows console-flash remediation passed 81 focused cmd/PowerShell/Git Bash/Stop/report tests plus the full suite. The new regression proves all seven Node child-process APIs are wrapped and the preload survives a descendant Node process.
- User completed the live Web M0 on `mir3626/vibe-pro-bridge-m0`: exact non-default read, nested small and ~98 KiB UTF-8 creates, re-read/blob/commit receipts, and sequential convergence all passed without main/PR/update/delete mutation.
- No real protocol or operational flow was published by this implementation session. Integration writes used temporary bare remotes only.
- `origin/main` was replaced with the user-authorized GitHub-only lineage using an exact-SHA force-with-lease; do not reconstruct or merge the former MCP lineage back into main unless explicitly requested.
- v1.8.3 publishes the formerly local console-flash fix together with M1 and M2; the release contains no product-owned changes.
- The forced release lane still costs about 80 seconds because it intentionally bypasses receipts and runs many unrelated process-heavy lanes concurrently. The isolated Pro CLI lane is now about 30.5 seconds; optimize another lane only from fresh timing evidence.
- Shared receipts are now safe only for a matching semantic hash. Do not broaden impact globs or retire tests without manifest ownership coverage and a passing forced release boundary.

## 4. Restart Steps

1. Read `.claude/skills/vibe-pro-go/SKILL.md`, `docs/context/pro-go-setup.md`, and `docs/context/workflow-integrity.md`.
2. Inspect `main`, tag `v1.8.3`, and `origin/vibe-pro-bridge` before new edits. Keep the preserved MCP implementation isolated unless the user explicitly requests otherwise.
3. Run `npm run vibe:pro-go -- doctor`; do not pass `--publish` without a fresh explicit external-write authorization.
4. For usage, Web starts with `@GitHub <owner/repo> ... ./bridge-runbook.md`; Codex resumes with bare `$vibe-pro-go`.
5. Use `origin/vibe-pro-bridge` only as the append-only shared-drive branch defined by the new protocol; do not merge it into `main`.
6. M1 and M2 are complete. If further test-time work is requested, re-profile the forced release lane and start a separately scoped queue; do not retire the Pro wrapper or real-Git transport boundaries.
