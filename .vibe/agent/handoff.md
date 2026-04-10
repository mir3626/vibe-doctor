# Orchestrator Handoff — idle

> 이 파일은 Orchestrator 재인스턴스화의 **연료**다. 컨텍스트 압축/세션 종료 후 새
> Orchestrator가 부팅될 때 `CLAUDE.md → MEMORY → sprint-status.json → session-log.md →
> **이 파일**` 순으로 읽어 직전 상태를 복원한다. 체크포인트마다 이 파일을 갱신한다.
> 역할 제약·트리거 매트릭스는 `CLAUDE.md`, handoff 필드 스키마는
> `.vibe/agent/sprint-status.schema.json` 참조 (중복 금지).

## 1. Identity

- **branch**: `self_evolution` (self-evolution-0/1/2/3 완료)
- **working dir**: `C:\Users\Tony\Workspace\vibe-doctor`
- **language/tone**: 한국어 반말 (memory: `feedback_language_tone.md`)

## 2. Status: IDLE - Sprint self-evolution-3 passed

self-evolution-3 완료. Planner 역할 확장 (기술 사양 + Sprint 프롬프트 초안 출력),
Sprint 프롬프트 작성 원칙 추가 (의도 명시, 구현 세부사항 위임).

## 3. 완료된 Sprint 이력 (감사 기록)

| Sprint | 요약 | 상태 |
|---|---|---|
| `self-evolution-0` | P0: handoff 박제, trigger matrix, schema/status 확장, preflight 실행화, re-incarnation 프로토콜 | passed |
| `self-evolution-1` | Fine-tuning: startup footprint(A2~A5) + compaction survivability(B1~B6, PreCompact hook + session-log) | passed |
| `self-evolution-2` | 스크립트 훅 기반 강제 메커니즘: Phase 0 gate + 규칙 자동주입 + sprint-complete 자동화 | passed |
| `self-evolution-3` | Planner 역할 확장: 기술 사양 + Sprint 프롬프트 초안 출력 + 프롬프트 작성 원칙 | passed |

상세는 `sprint-status.json`의 `sprints[]` + `session-log.md` Archived 섹션 참조.

## 4. 이월된 P1/P2

- **P1**: Sprint 프롬프트 template/slot, `run-codex.sh` final report 추출 + heartbeat,
  `.gitattributes` 자동화, Partial shard read.
- **P2**: 병렬 Sprint 지침 원인 조사 (`docs/orchestration/sprint.md`), Tribunal 모드 Evaluator.

## 5. Next action (재부팅 시 여기부터)

**현재 저장소에서는 활성 작업 없음.** 새 세션이 이 파일을 읽고 부팅했다면:

1. 사용자 지시를 확인.
2. P1/P2 착수 또는 새 dogfood 요청 시 이 handoff를 덮어쓰고 새 Sprint로 진행.

## 6. 사용자 합의 상태 (영속)

- 산출물까지 자율 권한 유지
- 한국어 반말 유지
- `main`은 dogfood 1·2 P0 반영본까지 푸시 완료, `self_evolution`은 self-evolution-0/1/2/3
  반영본까지 푸시 완료. merge 여부는 사용자 결정 대기.
- A1(CLAUDE.md 기계적 오버라이드 글로벌 이전) **거부** — 템플릿 배포 대상.
