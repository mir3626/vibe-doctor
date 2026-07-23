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
- harnessVersion: `1.13.1`
- publication branch/base: rewritten `main` lineage from `f2f9512aeee62f0d13537e8b5fe99c8947a4bdd5`
- remote state: `origin/main` carries the GitHub-only Pro workflow through `v1.8.4`; preserved `origin/vibe-pro-bridge` remains isolated and is not part of this release push
- publication state: v1.8.4 published to `main` with annotated tag per the direct-main release convention; the triggering user directive was the downstream bug report requesting upstream integration and release inclusion. No release PR is required.

## 2. Active Work

- v1.13.1 (same session, downstream handoff adoption): `selectGoFlow` now loads the local protocol once and skips auto-selection candidates pinned to a superseded generation (recorded, surfaced as `skippedIncompatibleFlows` in `go` output; enriched all-skipped selector error names each flow + pinned version). Explicit targets unchanged fail-closed. Known residue (recorded in v1.13.1.md): bare `status` resolves via `resolveFlowPath` (lexicographic latest, no filters) and can still land on a foreign-generation flow — fix on next touch if friction shows.
- v1.13.0 (same Claude Orchestrator maintenance session, full role delegation, user consensus settled 2026-07-23): intent-alignment briefing gate + user-accepted review close. (A) `accept-review` publishes a cli-actor approval carrying `reviewAcceptance` (4th declare-in-event/enforce-in-harness application) — eligibility validated fail-closed at every snapshot load: previous event = pro feedback, zero P0/P1, disposition not design-revision-required/blocked, approval HEAD = reviewed HEAD, full-set deferral; `--user-approved` is a user-only judgment never derivable from proGoAutoPublish; `close` unchanged. (B) THE core feature per user: every Pro design/feedback pull requires a user-language alignment brief (BRIEF.md + BRIEF.json under `briefs/<eventId>/`, completeness validated against the pinned payload, classifications core/supporting/hardening/speculative/off-track vs CONTRACT `intents` INT-###) before `report`/`accept-review`/`close`; hard block with actionable gate error + `brief` roster/skeleton command; legacy exemption via packet-state `briefRequiredEventIds` (only newly synced events arm); user trim/defer rulings inject into webPrompt as binding "User scope rulings" (Pro contests only via P0/P1 with intent path). Philosophy: guard silent intent drift — "is this still what the user intended" is the top question; briefs propose, users decide.
- v1.12.0 (this session, full role delegation: Planner fable → Codex Generator gpt-5.6-sol xhigh → Evaluator fable): adopted the downstream P1 drift handoff — protocol versions are now content-addressed (`v1-<hash8>` = sha256 over the five CRLF-normalized protocol sources' sorted `name:sha256` lines; PROTOCOL.json excluded as self-reference). A harness release that changes protocol content bootstraps a fresh append-only `protocol/<version>/` namespace under the existing `--publish` gate instead of permanently stranding bridges with `protocol hash/content mismatch`. `verifyPinnedProtocol` gains a generation gate naming both versions (active cross-sync flows stay intentionally blocked; closed flows never re-synced). Schema patterns widened additively (`^v[1-9][0-9]*(-[0-9a-f]{8})?$`, legacy `"v1"` still parses); `PROTOCOL_VERSION`/`PROTOCOL_ROOT` exports removed. Evaluator caught P0 FND-A (Codex used raw-byte compare where spec required CRLF-normalized — would false-fail on `core.autocrlf=true` Windows checkouts; empirically reproduced) — remediated with the normalized compare restored plus CRLF-tolerance, mismatch, and partial-namespace regression tests. Lineage rule documented at `PROTOCOL_LINEAGE`: any PROTOCOL.json serialization change requires a v1→v2 lineage bump. Downstream (qlib repo) unblock: sync v1.12.0, then re-run the deferred `vibe:pro-go start design` for qlib-training-pipeline.
- v1.11.0 (previous session, Orchestrator direct edit under the recorded codex-token-exhausted authorization): adopted the osint coordinated cross-flow close proposal. Approvals may declare `coordinatedClose {jointInvariant, primaryFlowPath, flows[{flowPath, approvedBoundarySha}]}`; closed markers may carry paired `authorizedByFlowPath`/`authorizedByEventId` + `coordinatedWith`; report→closed becomes legal only with the reference; the flow loader verifies the reference against the same pinned bridge commit (member + boundary match, else fail-closed); `close` on a declared set writes every remaining member's marker in ONE bridge commit with already-closed members counted as satisfied (idempotent completion = the osint recovery path for stuck flow 20260721/001), keeps full primary gates on fresh joint closes, and refuses partial closes. No new event kind (decision: reuse `closed` + fields to avoid grammar/roster ripple). Deferred nothing; disposition-event proposal from v1.10.0 remains backlog.
- v1.10.1 (this session, Orchestrator direct edit under the recorded codex-token-exhausted authorization): adopted the osint shared-module ownership boundary proposal. The v1.9.0 "delete local copy + repoint alias" migration guidance is withdrawn (correction marker in v1.9.0.md); workflow-integrity §11 states the rule (harness vendors its copy, downstream keeps its own, only both-sides-compared symbols cross the boundary). Cross-boundary surface published as a compatibility contract: deriveFinalEvidenceManifest (universal-integrity-core/index.js) + workflowMatrixMarkdown (pro-roundtrip/report.js) — the second was undercounted in the proposal and caught live by the new audit. vibe:sync-audit gains report-only harness-internal-import and shared-module-drift signals (config keys audit.harnessImportAllowlist / audit.sharedModuleMirrors); exit code unaffected.
- v1.10.0 (this session, Orchestrator direct edit under the recorded codex-token-exhausted authorization): adopted the osint-stock-screener finding-scope discipline proposal for the Pro review loop. Additive schema: findings gain optional `plane`/`impactClasses`/`threatModel` + `backlog-candidate` taxonomy (never P0/P1); contracts gain optional `productPlane`. The flow loader enforces the P0/P1 impact-class gate only when the active design declares `productPlane` (historical/audit flows exempt). Publisher `assertFinalEvidence` now requires fresh evidence only for owned/affected rows (preserved rows ride the gate; matrix renders them `preserved`). WEB-RUNBOOK §4/§5 and workflow-integrity §8 carry the full discipline text. The proposal's implementer disposition event (accept/defer/dispute) is DEFERRED to backlog pending real need. Downstream needs only a sync; its `pro-review-charter.md` productPlane goes into the next design revision alongside `finalGatePolicy`.
- v1.9.0 (this session, Orchestrator direct edit under the recorded codex-token-exhausted authorization): adopted the osint-stock-screener pro-roundtrip integrity hardening (FND-019/020/022/023/024, downstream `702450b5..b3cd1578`). Transport pins one bridge commit and reads/copies/receipts all flow/event/control-document bytes from the Git object store (`runGitBinary`, `ExactBlob`, `writeBytesAtomic`, packet-state v2 additive); publisher independently reconstructs the final-evidence manifest with derived compare status and empty skipped checks. Upstream decisions: `universal-integrity-core` vendored at `.vibe/harness/src/universal-integrity-core/` (harness imports relative; downstream products alias `#universal-integrity-core` to it), and the final-gate roster moved into `CONTRACT.json` `finalGatePolicy` (no default roster; the downstream hard-coded `final-gate-policy.ts` registry was not adopted). Downstream must not `vibe:sync` before this release, then repoint its alias, drop `shared/universal-integrity-core/`, and get a design revision declaring `finalGatePolicy` for its active flow.
- v1.8.5 (this session, Orchestrator direct edit under the recorded codex-token-exhausted authorization): added `vibe-pro-go confirm-skip on|off|status` and the user-local `userDirectives.proGoAutoPublish` directive in gitignored `.vibe/config.local.json`. `go`/`status` now surface `autoPublish`; while true, the `$vibe-pro-go` runbook passes `--publish` without a per-write confirmation stop and records `[decision][auto-approved]` per publication. CLI `--publish` sentinel semantics unchanged; malformed/expired directives fail back to requiring confirmation.
- v1.8.4 (this session): downstream dogfood (mir3626/osint-stock-screener) reported that a design-less `start audit` flow could not record remediation evidence after Web Pro feedback — `recordSprintReport` expected `audit` kind while the publisher only reads `remediation/<feedback-event>/` checkpoints, so the remediation-report target was unreachable. Fixed the expected-kind derivation (feedback → remediation regardless of contract), dropped the redundant kind clause from the contract-less binding guard, and added a full contract-less remediation roundtrip regression test. Also fixed a v1.7.27 regression found live: `run-codex.sh`'s session-start lifecycle child drained piped prompts via the hook stdin auto-detect (`readFileSync(0)`), breaking every `cat prompt | run-codex.sh -` delegation; now runs with `</dev/null` plus a wrapper regression test.
- Public entrypoint is now `$vibe-pro-go` / `npm run vibe:pro-go`.
- Bare invocation selects the newest non-closed flow for the current repo/branch by latest completed bridge event, syncs its durable packet, and returns paths plus the next executable action.
- Web-first entry is supported through root `bridge-runbook.md`: GitHub exact-ref actions only, no Web Search/index/default fallback, Pro-origin goal + design creation, then normal CLI continuation.
- `bootstrap --publish` verifies the root runbook is already committed/pushed on the bound code branch before publishing the immutable content-addressed `protocol/<version>` namespace plus its `PROTOCOL.json`.
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
