# Session Log — append-only 증분 저널

> Orchestrator가 **세션 중 발견한 비자명하고 압축 후에도 살려야 할 정보**를 즉시 append하는
> 버퍼. handoff.md가 "현재 상태 스냅샷"이라면 이건 "시간순 저널"이다. 기계적 compaction이
> 지우는 mid-session 결정·실패·관찰을 보존한다.

## 운영 규칙

- **Append only**. 기존 항목 수정·삭제 금지 (단, Sprint 종료 시 Orchestrator가 handoff에
  요약 흡수 후 `## Archived (<sprintId>)` 섹션으로 이동 → 물리 truncate).
- 각 항목은 한두 줄. 길어지면 파일/경로/링크만 남기고 본문은 해당 파일로.
- 형식: `- YYYY-MM-DDTHH:mm:ss.sssZ [tag] 내용`. full ISO8601 timestamp 권장 (`scripts/vibe-session-log-sync.mjs` 가 정규화).
- tag 예: `decision`, `failure`, `discovery`, `user-directive`, `drift-observed`, `sprint-complete`, `phase3-po-proxy`, `audit-clear`, `harness-review`.
- **언제 append하나**:
  - 사용자가 비자명한 선호·제약을 드러냈지만 memory로 승격하기엔 범위가 좁을 때
  - 실패·우회·임시 결정이 발생했고 그 이유가 코드/git에 남지 않을 때
  - Sprint 목표에서 의도적으로 벗어난 결정 (deviation)
  - context drift나 압축 이력을 스스로 감지했을 때
- **언제 append하지 않나**: git log/diff/코드에서 자명하게 복원 가능한 사실.

## Entries

- 2026-04-22T15:36:19.331Z [harness-review] v1.5.3 WSL Codex wrapper patch: fixed `run-codex.sh` stdin loss caused by WSL-visible `chcp.com` consuming prompt input, replaced fixed `en_US.UTF-8` with installed UTF-8 locale resolution, hardened wrapper tests with `chcp.com`/locale stubs, and verified Windows + WSL temp-copy typecheck/build/test.
- 2026-04-22T13:20:00.000Z [harness-review] v1.5.2 Markdown encoding patch: added VS Code UTF-8 workspace settings, EditorConfig recommendation, sync-manifest coverage, encoding-settings regression tests, and strict UTF-8 validation for all Markdown files.
- 2026-04-22T13:00:00.000Z [harness-review] v1.5.1 provider-neutral lifecycle patch: added `vibe-agent-session-start.mjs`, wired Claude/Codex/`vibe:run-agent` session-start checks, added `_common-rules.md` Section 16 for context persistence, and documented Codex PreCompact fallback.




- 2026-04-21T00:00:01.000Z [decision] [sprint-mode-tier] user=a (extended). node scripts/vibe-sprint-mode.mjs on --tier extended 실행 → 71 preset rules active (41 new). iter-7 3-sprint 자율 실행 목표 interruption 0. iter-7 종료 시 off 토글 재확인 예정.
- 2026-04-21T00:00:00.000Z [decision] [iter-7-kickoff] dogfood10 review-4 findings A+B+D upstream iter-7. iter-8 에 C 이월. target harnessVersion v1.5.0. sprint order M1(B) → M2(D) → M3(A). predicted net 122 LOC (buffered 148). handoff 상세: docs/plans/iter-7-upstream-handoff.md
- 2026-04-20T16:47:56.928Z [sprint-complete] sprint-M3-review-adapter-blind-spot -> passed. Sprint sprint-M3-review-adapter-blind-spot completed with passed LOC +333/-11 (net +322)
- 2026-04-20T16:36:15.993Z [sprint-complete] sprint-M2-generator-scope-discipline -> passed. Sprint sprint-M2-generator-scope-discipline completed with passed LOC +972/-14 (net +958)
- 2026-04-20T16:27:10.624Z [sprint-complete] sprint-M1-codex-unavailable-signal -> passed. Sprint sprint-M1-codex-unavailable-signal completed with passed LOC +360/-26 (net +334)
