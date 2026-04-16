# Session Log — append-only 증분 저널

> Orchestrator가 **세션 중 발견한 비자명하고 압축 후에도 살려야 할 정보**를 즉시 append하는
> 버퍼. handoff.md가 "현재 상태 스냅샷"이라면 이건 "시간순 저널"이다. 기계적 compaction이
> 지우는 mid-session 결정·실패·관찰을 보존한다.

## 운영 규칙

- **Append only**. 기존 항목 수정·삭제 금지 (단, Sprint 종료 시 Orchestrator가 handoff에
  요약 흡수 후 `## Archived (<sprintId>)` 섹션으로 이동 → 물리 truncate).
- 각 항목은 한두 줄. 길어지면 파일/경로/링크만 남기고 본문은 해당 파일로.
- 형식: `- YYYY-MM-DDTHH:mm [tag] 내용`. tag 예: `decision`, `failure`, `discovery`,
  `user-directive`, `drift-observed`.
- **언제 append하나**:
  - 사용자가 비자명한 선호·제약을 드러냈지만 memory로 승격하기엔 범위가 좁을 때
  - 실패·우회·임시 결정이 발생했고 그 이유가 코드/git에 남지 않을 때
  - Sprint 목표에서 의도적으로 벗어난 결정 (deviation)
  - context drift나 압축 이력을 스스로 감지했을 때
- **언제 append하지 않나**: git log/diff/코드에서 자명하게 복원 가능한 사실.

## Entries









- 2026-04-16T00:32:27.612Z [sprint-complete] sprint-M6-pattern-shards -> passed. Sprint sprint-M6-pattern-shards completed with passed LOC +2888/-227 (net +2661)
- 2026-04-16T00:11:51.213Z [sprint-complete] sprint-M5-native-interview -> passed. Sprint sprint-M5-native-interview completed with passed LOC +1530/-35 (net +1495)
- 2026-04-15T23:39:06.851Z [sprint-complete] sprint-M4-model-tier -> passed. Sprint sprint-M4-model-tier completed with passed LOC +2376/-147 (net +2229)
- 2026-04-15T22:53:55.232Z [sprint-complete] sprint-M3-sprint-flow-automation -> passed. Sprint sprint-M3-sprint-flow-automation completed with passed LOC +0/-6 (net -6)
- 2026-04-15T22:22:15.411Z [sprint-complete] sprint-M2-platform-wrappers -> passed. Sprint sprint-M2-platform-wrappers completed with passed LOC +2110/-50 (net +2060)
- 2026-04-15T16:24:04.729Z [sprint-complete] sprint-M1-schema-foundation -> passed. Sprint sprint-M1-schema-foundation completed with passed LOC +277/-0 (net +277)
- 2026-04-14T13:50:59.759Z [sprint-complete] v1.1.0-process-refactor -> passed. Sprint v1.1.0-process-refactor completed with passed LOC +1037/-38 (net +999)
- 2026-04-14T05:03:59.441Z [sprint-complete] harness-sync -> passed. Sprint harness-sync completed with passed
- 2026-04-13T00:00:00.000Z [decision] harness-sync: 하네스 싱크 메커니즘 설계 완료. 3-tier 전략: (1) section-merge(마커 있는 프로젝트), (2) sidecar full-replace(레거시), (3) json-deep-merge(settings.json/package.json). 플랜 파일: docs/prompts/sync-implementation.md
- 2026-04-13T00:00:00.000Z [decision] CLAUDE.md에 7개 HARNESS 섹션 마커 + PROJECT:custom-rules 추가. 토큰 오버헤드 ~200 tokens (4-5%).
- 2026-04-13T00:00:00.000Z [decision] SessionStart 훅으로 자동 버전 체크. git ls-remote + 24h 캐시. 실패 시 조용히 무시.
- 2026-04-13T00:00:00.000Z [decision] 레거시 부트스트랩: vibe-sync-bootstrap.mjs 원샷 스크립트로 /vibe-sync 없는 프로젝트도 업그레이드 가능.
- 2026-04-13T00:00:00.000Z [discovery] 클라우드(claude.ai/code) 환경에 Codex CLI 미설치. 코드 구현을 로컬 CLI로 이관 결정.
- 2026-04-10T08:30:00.000Z [decision] self-evolution-3: Planner 역할 확장 — 기술 사양(타입·API·파일구조) + Sprint 프롬프트 초안을 Planner가 출력하도록 CLAUDE.md 변경. Sprint 프롬프트 작성 원칙 섹션 추가.
- 2026-04-10T08:30:00.000Z [decision] dogfood3/dogfood4 관련 아티팩트 전량 discard (dogfood4-review.md 삭제, handoff/session-log에서 dogfood 참조 제거).
## Archived (self-evolution-2)

- 2026-04-10T07:32 [sprint-complete] self-evolution-2 -> passed. 스크립트 훅 기반 강제 메커니즘: run-codex.sh 규칙 자동주입 + preflight bootstrap/product.md + sprint-complete 자동화

## Archived (self-evolution-1)

- 2026-04-09T00:00 [decision] self-evolution-1 착수. 사용자가 A1(기계적 오버라이드 글로벌 이전) 거부 — 템플릿 배포 대상이라 프로젝트 내 유지. 나머지 A2~A5 + B1~B6 전부 승인.
- 2026-04-09T00:00 [discovery] handoff.md의 §3(역할 제약/trigger matrix)는 CLAUDE.md와 중복이었음. handoff 슬림화 시 포인터로 대체.
- 2026-04-09T00:00 [decision] `project_self_evolution.md` memory shard 삭제 — handoff.md와 내용 이중 주입되던 startup 예산 낭비.
