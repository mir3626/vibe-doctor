# Orchestrator Handoff — self_evolution

> 이 파일은 Orchestrator 재인스턴스화의 **연료**다. 컨텍스트 압축/세션 종료 후 새
> Orchestrator가 부팅될 때 `CLAUDE.md → MEMORY → sprint-status.json → session-log.md →
> **이 파일**` 순으로 읽어 직전 상태를 복원한다. 체크포인트마다 이 파일을 갱신한다.
> 역할 제약·트리거 매트릭스는 `CLAUDE.md`, handoff 필드 스키마는
> `.vibe/agent/sprint-status.schema.json` 참조 (중복 금지).

## 1. Identity

- **branch**: `self_evolution` (origin 푸시 완료)
- **working dir**: `C:\Users\Tony\Workspace\vibe-doctor`
- **today**: 2026-04-09
- **language/tone**: 한국어 반말 (memory: `feedback_language_tone.md`)

## 2. Mission

dogfood 1(Bookshelf) + dogfood 2(Lingua Lens Chrome ext) 측정 기반 vibe-doctor
self-evolution. 핵심 재프레임:

- **subagent는 specialization이 아니라 context checkpoint 메커니즘**이다.
- 무한 context window가 있다면 Orchestrator 하나로 충분. 제약 하에서 퀄리티를 지키려는 게 목적.
- `sprint-status.json` + `handoff.md` + `session-log.md`는 regression guard가 아니라
  **Orchestrator 재인스턴스화의 연료**다.
- 기본값 "lean"은 tiny project에서만 유효. 실제 프로젝트는 context pressure로 subagent 불가피.

## 3. Sprint 이력

| Sprint | 요약 | 상태 |
|---|---|---|
| `self-evolution-0` | P0 A~E: handoff 박제, trigger matrix 재작성, schema/status 확장, preflight 실행화, re-incarnation 프로토콜 | **passed** |
| `self-evolution-1` | Fine-tuning: startup footprint 감축(A2~A5) + compaction survivability(B1~B6) | **진행 중 → 완료 시 갱신** |

### P1 (이월)
- Sprint 프롬프트 template/slot
- `run-codex.sh` final report 추출 + heartbeat
- `.gitattributes` 자동화
- Partial shard read (section anchors)

### P2 (이월)
- 병렬 Sprint 지침 원인 조사 (`docs/orchestration/sprint.md`)
- Tribunal 모드 Evaluator

## 4. Last action summary

self-evolution-1 fine-tuning pass: CLAUDE.md designmd 제거 + Sprint 흐름/규칙 병합 +
.vibe/agent 설명 슬림화(포인터 1줄), MEMORY에서 중복 `project_self_evolution.md` 제거,
handoff.md 자체 슬림화(역할/트리거 중복 제거), re-incarnation.md에 session-log 부트
단계 추가 + context budget tripwire 객관화, `session-log.md` append-only 버퍼 신규,
`scripts/vibe-checkpoint.mjs` + `.claude/settings.json` PreCompact hook 도입,
`scripts/vibe-preflight.mjs`에 handoff staleness 검사 추가.

## 5. Next action (재부팅 시 여기부터)

1. 사용자 피드백 대기 (self-evolution-1 산출물 리뷰 or 3차 dogfood 착수 결정).
2. 추가 요청 시 P1 항목 착수 (Sprint 프롬프트 template/slot 등).

## 6. 사용자 합의 상태

- dogfood 퀄리티 만족 — "거의 100점"
- 산출물까지 자율 권한 유지
- 한국어 반말 유지
- main은 dogfood P0 반영본까지 푸시 완료. 작업은 `self_evolution`.
- A1(CLAUDE.md 기계적 오버라이드 글로벌 이전) **거부** — 템플릿 배포 대상이라 프로젝트 내 유지.
