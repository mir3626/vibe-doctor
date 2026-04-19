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

