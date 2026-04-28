# Session Log — append-only 증분 저널

> Orchestrator가 **세션 중 발견한 비자명하고 압축 후에도 살려야 할 정보**를 즉시 append하는
> 버퍼. handoff.md가 "현재 상태 스냅샷"이라면 이건 "시간순 저널"이다. 기계적 compaction이
> 지우는 mid-session 결정·실패·관찰을 보존한다.

## 운영 규칙

- **Append only**. 기존 항목 수정·삭제 금지 (단, Sprint 종료 시 Orchestrator가 handoff에
  요약 흡수 후 `## Archived (<sprintId>)` 섹션으로 이동 → 물리 truncate).
- 각 항목은 한두 줄. 길어지면 파일/경로/링크만 남기고 본문은 해당 파일로.
- 형식: `- YYYY-MM-DDTHH:mm:ss.sssZ [tag] 내용`. full ISO8601 timestamp 권장 (`.vibe/harness/scripts/vibe-session-log-sync.mjs` 가 정규화).
- tag 예: `decision`, `failure`, `discovery`, `user-directive`, `drift-observed`, `sprint-complete`, `phase3-po-proxy`, `audit-clear`, `harness-review`.
- **언제 append하나**:
  - 사용자가 비자명한 선호·제약을 드러냈지만 memory로 승격하기엔 범위가 좁을 때
  - 실패·우회·임시 결정이 발생했고 그 이유가 코드/git에 남지 않을 때
  - Sprint 목표에서 의도적으로 벗어난 결정 (deviation)
  - context drift나 압축 이력을 스스로 감지했을 때
- **언제 append하지 않나**: git log/diff/코드에서 자명하게 복원 가능한 사실.

## Entries

- 2026-04-28T15:51:54.800Z [harness-review] Codex `/vibe-init` partial-init patch: explicit `--mode=human|agent` gate added, `mode=agent` now delegation-only with Codex-aware prompt rendering, config.local Codex wrapper path fixed, partial-init `/vibe-review` exception documented, and verification passed (`typecheck`, focused tests, full `npm test`, `build`, encoding checks).
- 2026-04-24T09:20:00.000Z [harness-review] v1.7.0 candidate separates canonical harness code under `.vibe/harness/**`, keeps a root `scripts/vibe-sync-bootstrap.mjs` legacy bridge, clarifies `/vibe-review` as template/harness review, and verifies typecheck/test/build/ui/config-audit/sync-dry-run locally.
- 2026-04-24T08:13:22.847Z [harness-review] v1.6.12 candidate hardens downstream init/review/playwright surfaces: provider PATH lookup, Codex init boundary, explicit review-signals platform detection, and Playwright test wrapper all verified locally.
- 2026-04-24T06:46:59.619Z [sprint-complete] sprint-linux-ci-run-codex-wrapper -> passed. v1.6.11 fixes the GitHub Actions npm test failure introduced at v1.6.1 by making run-codex wrapper tests deterministic on Linux CI.
- 2026-04-24T06:32:15.136Z [sprint-complete] sprint-playwright-dashboard-report-smoke -> passed. v1.6.10 adds Playwright browser smoke tests for dashboard attention and project-report controls while keeping downstream harness typecheck independent from Playwright installation.
- 2026-04-24T06:13:41.477Z [sprint-complete] sprint-dashboard-attention-wiring -> passed. v1.6.9 wires dashboard attention events through Claude Notification hooks and Codex wrapper completion/failure events; wiring drift output is now empty.
- 2026-04-24T05:39:04.765Z [sprint-complete] sprint-wiring-drift-detector -> passed. v1.6.8 adds `/vibe-review` wiring drift findings for `scripts/vibe-*.mjs` runtime references and sync-manifest coverage.
- 2026-04-24T05:33:29.436Z [sprint-complete] sprint-rule-disposition-gate -> passed. v1.6.7 adds rule dispositions and `--fail-on-undisposed` to `vibe-rule-audit`.
- 2026-04-24T05:30:00.000Z [decision][iter-9-kickoff] User requested proceeding through v1.6.8: Sprint 1 rule disposition gate, Sprint 2 wiring drift detector.
- 2026-04-24T05:12:14.677Z [sprint-complete] sprint-iter8-app-loc-threshold -> passed. v1.6.6 adds app-code LOC threshold detection to lightweight audit and invalidates prototype Evaluator exceptions on `LOC_THRESHOLD_BREACH`.
- 2026-04-24T05:00:00.000Z [decision][iter-8-kickoff] Next sprint selected from deferred dogfood10 Finding C: app LOC threshold breach detection. Direct Codex Orchestrator fallback used; no sub-agent spawned.
- 2026-04-24T04:42:23.019Z [user-directive] User preference: after verified harness changes, do not ask separately before pushing; proceed directly with commit/tag/push when that is the natural next step.
- 2026-04-24T04:34:00.000Z [checkpoint] v1.6.5 local patch clarifies Codex role modes, aligns `/vibe-sync` docs with harness-only typecheck + caret/exact ref semantics, downgrades `gap-rule-only-in-md` to pending enforcement, and passes typecheck/focused tests/diff-check/full test/build before checkpoint.

- 2026-04-24T04:11:15.098Z [checkpoint] v1.6.4 local patch implements Codex Orchestrator maintain-context workflow: Generator token-threshold automation explicitly deferred, maintain-context now updates handoff/session-log then runs `npm run vibe:checkpoint`, common rules/docs distinguish Codex Orchestrator from run-codex Generator invocations, and initial checkpoint failure exposed stale handoff now refreshed.

- 2026-04-23T08:36:00.000Z [harness-review] v1.5.8 verification passed on Windows: `npm run typecheck`, `node --import tsx --test test/upstream-bootstrap.test.ts`, `npm run build`, and `npm test`.
- 2026-04-23T08:30:00.000Z [harness-review] v1.5.8 upstream bootstrap patch: session-start/version-check and `/vibe-init` now infer missing upstream config from `git remote origin`, preserve existing upstream, quietly skip missing remotes, and guard template self-sync unless `--from` is supplied.
- 2026-04-23T06:36:27.869Z [sprint-complete] sprint-agent-init-codex-skills -> passed. Sprint sprint-agent-init-codex-skills completed with passed LOC +252/-36 (net +216)
- 2026-04-23T06:35:10.389Z [harness-review] v1.5.15 agent-gated init patch: direct `npm run vibe:init` now exits with guidance, agent skills use `--from-agent-skill`, Claude `/vibe-init` docs were updated, and `.codex/skills/*` wrappers now delegate to the shared `.claude/skills/*` runbooks.
- 2026-04-23T06:34:30.000Z [harness-review] v1.5.15 verification passed on Windows: `npm run typecheck`, focused init/Codex/sync tests, `npm run build`, and full `npm test`.
- 2026-04-23T06:09:42.800Z [audit-clear] resolved=1 note=v1.5.14 missing-upstream bootstrap verified with focused tests, typecheck, build, and full npm test
- 2026-04-23T06:09:23.857Z [sprint-complete] sprint-missing-upstream-sync-bootstrap -> passed. Sprint sprint-missing-upstream-sync-bootstrap completed with passed LOC +168/-51 (net +117)
- 2026-04-23T06:07:45.265Z [harness-review] v1.5.14 missing-upstream sync bootstrap patch: `/vibe-sync` now initializes missing upstream config before clone, treats product repo origins as default vibe-doctor upstream, preserves vibe-doctor fork origins for dogfood clones, marks template self-checkouts, and lets `vibe-sync-bootstrap` create `.vibe/config.json` for legacy projects.
- 2026-04-23T05:58:59.815Z [sprint-complete] sprint-wsl-dashboard-open-error -> passed. Sprint sprint-wsl-dashboard-open-error completed with passed LOC +278/-42 (net +236)
- 2026-04-23T05:57:46.134Z [harness-review] v1.5.13 WSL browser opener patch: `vibe:dashboard` and `vibe:report` now catch async child process `error` events from `xdg-open`/browser launchers, leaving the server/report usable and warning instead of crashing on EACCES.
- 2026-04-23T03:44:29.698Z [sprint-complete] sprint-pinned-upstream-ref -> passed. Sprint sprint-pinned-upstream-ref completed with passed LOC +142/-43 (net +99)
- 2026-04-23T03:44:06.469Z [harness-review] v1.5.12 verification passed on Windows: `npm run typecheck`, `node --import tsx --test test/sync.test.ts test/vibe-sync-bootstrap.test.ts`, `npm run build`, and `npm test`.
- 2026-04-23T03:42:04.706Z [harness-review] v1.5.12 pinned upstream ref patch: restored semver `upstream.ref` as a real pin, added interactive `/vibe-sync` update-once choice when cached latestVersion is newer, kept non-interactive sync pinned unless `--ref` is supplied, and changed `vibe-sync-bootstrap` to preserve existing pins without auto-creating new ones.
- 2026-04-23T03:42:00.000Z [harness-review] v1.5.11 post-sync verify scope patch: added `tsconfig.harness.json`, changed `/vibe-sync` post-verify to prefer `npx tsc -p tsconfig.harness.json --noEmit`, removed product `tsconfig.json` from harness hybrid ownership, and verified typecheck/build/full test.
- 2026-04-23T03:26:41.208Z [sprint-complete] sprint-harness-typecheck-scope -> passed. Sprint sprint-harness-typecheck-scope completed with passed LOC +181/-45 (net +136)
- 2026-04-23T03:22:00.000Z [harness-review] v1.5.10 verification passed on Windows: `npm run typecheck`, `node --import tsx --test test/sync.test.ts`, `npm run build`, and `npm test`.
- 2026-04-23T03:20:00.000Z [harness-review] v1.5.10 sync ref-resolution patch: default `/vibe-sync` now refreshes version cache best-effort and uses cached `latestVersion` when newer than installed, so downstream projects with semver `upstream.ref` like `v1.4.3` are not trapped on the old tag; explicit `--ref` and non-version refs remain preserved.
- 2026-04-23T03:14:41.740Z [sprint-complete] sprint-sync-latest-ref -> passed. Sprint sprint-sync-latest-ref completed with passed LOC +379/-337 (net +42)
- 2026-04-23T03:01:37.580Z [audit-clear] resolved=1 note=v1.5.9 Windows statusline hook compatibility verified with typecheck, build, full test, vibe:qa, rule-audit, and CMD statusline smoke
- 2026-04-23T03:01:26.437Z [sprint-complete] sprint-windows-hook-portability -> passed. Sprint sprint-windows-hook-portability completed with passed LOC +395/-67 (net +328)
- 2026-04-23T03:00:00.000Z [harness-review] v1.5.9 Windows hook compatibility patch: moved Claude statusline execution to cross-platform `.claude/statusline.mjs`, rewired `.claude/settings.json` away from POSIX inline env/redirection syntax, kept `.sh`/`.ps1` compatibility wrappers, and verified statusline/settings tests plus full typecheck/build/test/qa.
- 2026-04-23T00:33:26.236Z [sprint-complete] sprint-upstream-bootstrap -> passed. Sprint sprint-upstream-bootstrap completed with passed LOC +28/-9 (net +19)
- 2026-04-22T16:33:00.000Z [harness-review] v1.5.7 executable tracking patch: marked `scripts/run-codex.sh` and `.claude/statusline.sh` executable in Git so v1.5.6 mode handling does not leave downstream mode-only diffs for intended shell wrappers.
- 2026-04-22T16:28:00.000Z [harness-review] v1.5.6 sync mode patch: refined v1.5.5 mode-safe copy so synced `.sh` harness wrappers are executable (`0755`) while regular synced files remain non-executable, covering the WSL `./scripts/run-codex.sh` permission edge case.
- 2026-04-22T16:17:38.375Z [harness-review] v1.5.5 sync hardening patch: added `replace-if-unmodified`, `json-array-union`, marker-based `AGENTS.md`/`GEMINI.md` section merge, `.vscode`/`.editorconfig`/`.gitattributes` hybrid ownership, mode-safe synced copies for WSL/Linux, and verified Windows plus clean WSL temp-copy typecheck/build/test.
- 2026-04-22T15:50:00.000Z [harness-review] v1.5.4 project-safe `.gitignore` sync patch: added `line-union` sync strategy, moved `.gitignore` from raw harness replacement to hybrid line merge, and added regression coverage so downstream project ignore entries are preserved on future syncs.
- 2026-04-22T15:36:19.331Z [harness-review] v1.5.3 WSL Codex wrapper patch: fixed `run-codex.sh` stdin loss caused by WSL-visible `chcp.com` consuming prompt input, replaced fixed `en_US.UTF-8` with installed UTF-8 locale resolution, hardened wrapper tests with `chcp.com`/locale stubs, and verified Windows + WSL temp-copy typecheck/build/test.
- 2026-04-22T13:20:00.000Z [harness-review] v1.5.2 Markdown encoding patch: added VS Code UTF-8 workspace settings, EditorConfig recommendation, sync-manifest coverage, encoding-settings regression tests, and strict UTF-8 validation for all Markdown files.
- 2026-04-22T13:00:00.000Z [harness-review] v1.5.1 provider-neutral lifecycle patch: added `vibe-agent-session-start.mjs`, wired Claude/Codex/`vibe:run-agent` session-start checks, added `_common-rules.md` Section 16 for context persistence, and documented Codex PreCompact fallback.
- 2026-04-21T00:00:01.000Z [decision] [sprint-mode-tier] user=a (extended). node scripts/vibe-sprint-mode.mjs on --tier extended 실행 → 71 preset rules active (41 new). iter-7 3-sprint 자율 실행 목표 interruption 0. iter-7 종료 시 off 토글 재확인 예정.
- 2026-04-21T00:00:00.000Z [decision] [iter-7-kickoff] dogfood10 review-4 findings A+B+D upstream iter-7. iter-8 에 C 이월. target harnessVersion v1.5.0. sprint order M1(B) → M2(D) → M3(A). predicted net 122 LOC (buffered 148). handoff 상세: docs/plans/iter-7-upstream-handoff.md
- 2026-04-20T16:47:56.928Z [sprint-complete] sprint-M3-review-adapter-blind-spot -> passed. Sprint sprint-M3-review-adapter-blind-spot completed with passed LOC +333/-11 (net +322)
- 2026-04-20T16:36:15.993Z [sprint-complete] sprint-M2-generator-scope-discipline -> passed. Sprint sprint-M2-generator-scope-discipline completed with passed LOC +972/-14 (net +958)
- 2026-04-20T16:27:10.624Z [sprint-complete] sprint-M1-codex-unavailable-signal -> passed. Sprint sprint-M1-codex-unavailable-signal completed with passed LOC +360/-26 (net +334)
