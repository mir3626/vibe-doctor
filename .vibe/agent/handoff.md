# Orchestrator Handoff — idle

> 이 파일은 Orchestrator 재인스턴스화의 **연료**다. 컨텍스트 압축/세션 종료 후 새
> Orchestrator가 부팅될 때 `CLAUDE.md → MEMORY → sprint-status.json → session-log.md →
> **이 파일**` 순으로 읽어 직전 상태를 복원한다. 체크포인트마다 이 파일을 갱신한다.
> 역할 제약·트리거 매트릭스는 `CLAUDE.md`, handoff 필드 스키마는
> `.vibe/agent/sprint-status.schema.json` 참조 (중복 금지).

## 1. Identity

- **branch**: (현재 브랜치 기록)
- **working dir**: (로컬 경로 기록)
- **language/tone**: (memory shard 참조)

## 2. Status: IDLE — 새 프로젝트 시작 대기

`/vibe-init` 을 실행하여 Phase 0 (환경 점검 → provider 선택 → 네이티브 소크라테스식 인터뷰 → Sprint 로드맵) 을 시작한다.

## 3. 완료된 Sprint 이력

(없음 — 새 프로젝트)

## 4. 진행 중 Sprint

(없음)

## 5. pendingRisks

(없음 — `.vibe/agent/sprint-status.json` 의 `pendingRisks[]` 필드로 관리)

## 6. 다음 행동

1. `node scripts/vibe-preflight.mjs --bootstrap` 실행하여 환경 green 확인.
2. `/vibe-init` 스킬 호출.
3. Phase 0 완료 후 `node scripts/vibe-phase0-seal.mjs` 로 Phase 0 아티팩트 commit.
4. 각 Sprint: Planner 소환 → Generator 위임 → 재검증 → `node scripts/vibe-sprint-commit.mjs <id> passed` 순차.
5. 최종 Sprint 완료 시 `scripts/vibe-project-report.mjs` 자동 HTML 보고서 + 브라우저 오픈.
6. 이후 개선은 `/vibe-iterate` 로 다음 iteration 진입.
