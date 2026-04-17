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




- 2026-04-17T03:26:24.039Z [sprint-complete] sprint-M-harness-gates -> passed. Sprint sprint-M-harness-gates completed with passed LOC +1147/-109 (net +1038)
- 2026-04-17T02:52:11.931Z [sprint-complete] sprint-M-process-discipline -> passed. Sprint sprint-M-process-discipline completed with passed LOC +2241/-796 (net +1445)
- 2026-04-17T00:14:16.000Z [decision] [m-audit-codex-fix] Codex 1차 위임 후 tsc 에러 4개 + 테스트 3개 실패. 원인: (1) 기존 테스트-Zod 타입 불일치, (2) Zod parse가 manual schemaVersion 체크보다 먼저 fail, (3) runLightweightAudit가 alreadyClosed에서도 실행. 2회 추가 Codex 위임으로 fix. total Codex tokens: 444K.
- 2026-04-17T00:14:05.802Z [sprint-complete] sprint-M-audit -> passed. Sprint sprint-M-audit completed with passed LOC +809/-22 (net +787)
- 2026-04-16T<iter-2-kickoff>Z [decision][iteration-2-seed] dogfood7 /vibe-review (review-10-2026-04-16.md) 흡수 후 iteration-2 roadmap 시드 (3 slot: M-audit / M-process-discipline / M-harness-gates). 사용자가 자율모드 아님 + 각 Sprint 시작 전 승인 + Zod v3 런타임 dep + planner.md → sprint-planner.md 교체 + §14 Wiring Checklist 전부 승인. dogfood7 review 의 M-spec-fix / M-arch-reconcile 은 project 이슈로 분리 — dogfood8 phase 0 seed 로 이월.
- 2026-04-16T<m-audit-planner>Z [decision][m-audit-planner-ready] M-audit Planner (opus) 소환 산출 = docs/prompts/sprint-M-audit.md (724 lines). Codex 위임 직전 사용자 세션 종료 요청. Codex 중간 산출 (schemas/ + audit-lightweight + migration 1.4.0 등) 은 zod 미설치 + implicit any 다수로 revert 완료. 재시작 시 sprint-M-audit.md 가 커밋된 상태에서 바로 `cat docs/prompts/sprint-M-audit.md | ./scripts/run-codex.sh -` 재위임 가능.
