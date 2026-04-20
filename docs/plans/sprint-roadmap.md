# Sprint Roadmap

<!-- BEGIN:VIBE:CURRENT-SPRINT -->
> **Current**: sprint-M3-review-adapter-blind-spot (not started, started 2026-04-20)
> **Completed**: sprint-M2-generator-scope-discipline, sprint-M1-codex-unavailable-signal
> **Pending**: —
<!-- END:VIBE:CURRENT-SPRINT -->

## 배경

이 파일은 `/vibe-init` Phase 4 에서 Orchestrator 가 프로젝트별 Sprint 로드맵을 작성해 저장하는 공간이다. 이후 `/vibe-iterate` 호출 시 새 iteration 섹션이 append 된다.

---

# Iteration 7 — dogfood10-findings-A-B-D (2026-04-21)

## 배경

dogfood10 (첫 다운스트림 프로젝트, Next.js 15 AI 개인 대시보드) 가 vibe-doctor v1.4.3 harness 로 iter-1 MVP 를 완주하고 `/vibe-review` 를 돌린 결과, harness 업스트림에서만 해결 가능한 finding 4건이 식별됐다. upstream 리뷰 (2026-04-21) 에서 3건 (A/B/D) 을 iter-7 로, 1건 (C) 을 iter-8 로 분할 확정.

전체 핸드오프 상세: [`docs/plans/iter-7-upstream-handoff.md`](./iter-7-upstream-handoff.md)

## 범위 요약

- 총 Sprint: **3**
- Priority 실행 순서: **M1 (B) → M2 (D) → M3 (A)**
- Growth budget: **net ≤ +150 LOC** (예상 합계 122 LOC, 15% buffer 148 LOC)
- New scripts: **0** (기존 스크립트 확장 only)
- Target harness version: **v1.4.3 → v1.5.0**

## Sprint M1 — Codex unavailable signaling

- **id**: `sprint-M1-codex-unavailable-signal`
- **finding**: B (Codex 403 single-point-of-failure fallback)
- **목표**: `scripts/run-codex.sh` 가 retry 모두 소진 후 실패하면 사용자·Orchestrator 모두에게 명시적 signal 을 남긴다. `.vibe/agent/codex-unavailable.flag` 파일 (timestamp 포함) + stderr 에 `CODEX_UNAVAILABLE` 블록 hint.
- **핵심 산출**:
  - `scripts/run-codex.sh` 최종 실패 분기에 flag touch + stderr hint
  - `.vibe/agent/codex-unavailable.flag` 는 다음 성공 호출 시 auto-remove (TTL = 다음 exit 0)
  - `.gitignore` 에 `.vibe/agent/codex-unavailable.flag` 추가
  - `test/run-codex-wrapper.test.ts` 1 case 추가 (3회 실패 → flag 생성 + stderr hint 존재)
  - `CLAUDE.md` Extensions 의 "훅 강제 메커니즘" 표에 flag 소비 프로토콜 1줄
  - `docs/context/codex-execution.md` 에 403 troubleshooting 섹션 append
- **예상 LOC**: 40 (shell 25 + test 15 + 문서 소폭)
- **의존**: none
- **scope glob**: `scripts/run-codex.sh`, `test/run-codex-wrapper.test.ts`, `.gitignore`, `CLAUDE.md`, `docs/context/codex-execution.md`

## Sprint M2 — Generator scope discipline

- **id**: `sprint-M2-generator-scope-discipline`
- **finding**: D (Generator 자발적 unit test 생성 차단)
- **목표**: `run-codex.sh` 가 자동 prepend 하는 `_common-rules.md` 에 §15 신규 섹션 추가 — Planner prompt 가 test 파일 생성을 명시하지 않는 한 Generator 는 `test/**/*.test.ts`, `src/**/*.test.ts`, `__tests__/` 생성 금지. Planner 가 opt-in 명시했을 때만 해제.
- **핵심 산출**:
  - `.vibe/agent/_common-rules.md` §15 섹션 신규 작성 (12 LOC)
  - `test/run-codex-wrapper.test.ts` 에 "run-codex.sh prepends §15 rule" 검증 1 case (10 LOC)
- **예상 LOC**: 22
- **의존**: M1 (동일 test file 확장이라 순서 의존)
- **scope glob**: `.vibe/agent/_common-rules.md`, `test/run-codex-wrapper.test.ts`

## Sprint M3 — Review adapter-health blind-spot rubric

- **id**: `sprint-M3-review-adapter-blind-spot`
- **finding**: A (`/vibe-review` adapter-health smoke blind-spot rubric)
- **목표**: `/vibe-review` 가 "adapter 가 0 items 반환해도 e2e smoke 가 통과" 상태를 blocker 로 auto-seed. `collectReviewInputs()` 에 `productFetcherPaths` 필드 추가, SKILL.md rubric 섹션에 항목 추가, test 1 case.
- **핵심 산출**:
  - `src/lib/review.ts` `ReviewInputs` 에 `productFetcherPaths: string[]` 필드 + `collectReviewInputs()` 확장 (`app/api/**/route.ts` + 동등 패턴 수집)
  - `.claude/skills/vibe-review/SKILL.md` Automatic Checks 섹션에 rubric 항목 추가
  - `test/vibe-review-inputs.test.ts` 에 productFetcherPaths 수집 검증 1 case
  - `docs/context/harness-gaps.md` 에 신규 id `gap-external-adapter-blind-spot` append (**기존 `gap-review-catch-wiring-drift` 는 별개 gap 이므로 병합하지 말 것**)
- **예상 LOC**: 60 (SKILL.md 20 + review.ts 25 + test 15)
- **의존**: M1, M2 (budget 소진 여부 확인 후 진입 — 초과 조짐 시 iter-8 로 이월 가능)
- **scope glob**: `src/lib/review.ts`, `.claude/skills/vibe-review/SKILL.md`, `test/vibe-review-inputs.test.ts`, `docs/context/harness-gaps.md`

## 다음 Iteration (iter-8)

- Finding C (app-LOC threshold breach detection) — `scripts/vibe-audit-lightweight.mjs` 확장 + `.vibe/config.json.audit.projectRoots` / `prototypeLocThreshold` 신규 옵션 필드
- 예상 LOC: 55
- target harnessVersion: v1.5.1

## 사용법

1. 각 Sprint 시작 전 `node scripts/vibe-preflight.mjs` (green) + Planner 소환 (Agent, sprint-planner, opus).
2. Planner 출력 prompt 를 `cat docs/prompts/<sprintId>*.md | ./scripts/run-codex.sh -` 로 Generator 에 위임.
3. Orchestrator 샌드박스 밖 재검증 (`npx tsc --noEmit`, `npm test`).
4. `node scripts/vibe-sprint-complete.mjs <sprintId> passed` → state + handoff + session-log 갱신.
5. `node scripts/vibe-sprint-commit.mjs <sprintId> passed --scope <scope-glob>` — 단일 커밋 생성. harnessVersion bump 시 auto-tag.
6. iteration 종료 시 `docs/handoff.md` 에 "iter-7 closure: addresses dogfood10 review-4 findings A+B+D" 한 줄 기록 + `sync-manifest.json` 업데이트 확인.


