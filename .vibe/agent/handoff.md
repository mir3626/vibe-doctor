# Orchestrator Handoff — iteration-2 / M-audit 완료, M-process-discipline 대기

> 이 파일은 Orchestrator 재인스턴스화의 **연료**다. 컨텍스트 압축/세션 종료 후 새
> Orchestrator가 부팅될 때 `CLAUDE.md → MEMORY → sprint-status.json → session-log.md →
> **이 파일**` 순으로 읽어 직전 상태를 복원한다. 체크포인트마다 이 파일을 갱신한다.

## 1. Identity

- **repo**: `C:\Users\Tony\Workspace\vibe-doctor`
- **branch**: `main`
- **last commit**: `bc8f90f feat(sprint-M-audit): sprint-M-audit`
- **language/tone**: 한국어 반말

## 2. Status: IDLE - Sprint sprint-M-process-discipline passed

iteration-2 harness hardening (v1.4.0) 진행 중. 3 slot 중 **1/3 완료**.

### Sprint M-audit 산출 요약 (커밋 `bc8f90f`)

| 카테고리 | 내용 |
|---------|------|
| Zod 스키마 | `src/lib/schemas/` 6파일 (sprint-status, project-map, sprint-api-contracts, iteration-history, model-registry, index) |
| JSON schema 생성기 | `scripts/vibe-gen-schemas.mjs` + `scripts/vibe-gen-schemas-impl.ts` → `--check` / `--write` 모드 |
| State validator | `scripts/vibe-validate-state.ts` — sprint-complete 시 Zod validation gate |
| Lightweight audit | `scripts/vibe-audit-lightweight.mjs` — diff stats / spec keyword / test coverage / tmp residue / LOC outlier |
| Preflight audit gate | `scripts/vibe-preflight.mjs` 확장 — `audit.overdue` check + `--ack-audit-overdue` 우회 경로 |
| Migration | `migrations/1.4.0.mjs` — 기존 state 파일 패치 |
| CLAUDE.md | Two-tier audit convention 섹션 추가 + hook table 갱신 |
| 테스트 | +22 신규 (175 pass / 0 fail / 1 skip) |

### 해결한 review findings

- `review-evaluator-audit-overdue` — lightweight per-sprint + heavyweight per-N 2단 감사
- `review-status-json-schema-drift` — Zod single-source + `vibe-gen-schemas --check` drift 감지
- `review-tmp-debug-scripts-residue` — audit-lightweight `flagTmpScripts` 자동 감지

## 3. 다음 행동: M-process-discipline 진입 (사용자 승인 필요)

**M-process-discipline** (P1 Friction) 목표:
- `.claude/agents/planner.md` → `sprint-planner.md` 교체 (공존 X) + 전 참조 업데이트
- trivial 룰 현실화 (100 LOC 기준 조정 등)
- Planner 소환 필수 (매 Sprint Must 트리거)

**Pre-requisites**: M-audit 최신 preflight.mjs 위에서 작업. `rg planner.md` 결과 0 hit 확인 필수.

### Step-by-step

1. `node scripts/vibe-preflight.mjs` → all OK
2. Planner (opus) 소환 → `docs/prompts/sprint-M-process-discipline.md`
3. `cat docs/prompts/sprint-M-process-discipline.md | ./scripts/run-codex.sh -`
4. 샌드박스 밖 재검증 (tsc + test + `rg planner.md` 0 hit)
5. `node scripts/vibe-sprint-commit.mjs sprint-M-process-discipline passed`
6. M-harness-gates 시작 승인 요청

## 4. pendingRisks

없음. sprintsSinceLastAudit = 1 (M-audit counted).

## 5. 주의사항

- §14 Wiring Integration Checklist: 본 iteration 모든 Sprint Final report 필수 섹션
- M-process-discipline에서 `planner.md` 삭제 시 참조 전량 업데이트 (§14.2 D1)
- Zod deps가 package.json에 추가됨 → downstream vibe:sync 호환성 고려
- M-audit에서 `runLightweightAudit`가 `alreadyClosed` 시 skip하도록 fix됨

## 6. 링크

- Review SOT: `C:\Users\Tony\Workspace\dogfood7\docs\reports\review-10-2026-04-16.md`
- Iteration-2 roadmap: `docs/plans/sprint-roadmap.md` (line 279 이하)
- Wiring 체크리스트: `.vibe/agent/_common-rules.md §14`
- M-audit archived prompt: `.vibe/archive/prompts/sprint-M-audit.md`
