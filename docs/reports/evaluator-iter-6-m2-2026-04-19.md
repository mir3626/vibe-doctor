# Evaluator Audit — iter-6 M2 (2026-04-19)

Sprint 대상: `sprint-M2-parser-false-positive` (harness-dogfood9 regression fix)
Baseline commit: `abd5e0e` (iter-6 kickoff)
Evaluator: fresh opus subagent, independent of Generator/Orchestrator context

## Verdict

**pass, blocking=0**

AC-1, AC-2 모두 실행 수준에서 충족. 회귀 0건. LOC budget 내 (code add 32 / limit 35). 테스트 +2건 통과. M3 scope 및 iter-4 O1/O2/O3 산출물 미변경.

## Checks

| # | check | result | evidence |
|---|---|---|---|
| 1 | AC-1 — `collectPendingRestorationDecisions()` 가 iter-4 판정 섹션 내 delete-confirmed slug 를 pending 에서 제외 | PASS | `node --import tsx -e "...collectPendingRestorationDecisions()"` → `length=0`. helper `collectDeleteConfirmedSlugs()` (src/lib/review.ts:208-229) 가 (a) scalar `restoration_decision: delete-confirmed` (asterisk strip 포함) + (b) heading 이 `iter-N` 또는 `delete-confirmed` 를 포함하는 섹션 내 backtick slug 를 모두 수집, `parseRestorationSections` 가 반환 직전 slug 비교 후 skip (review.ts:233, 242-244). |
| 2 | AC-2 — `parseRoadmapSprintIds` 가 iter-1 스타일 (`## Sprint M1 — ...` + `- **id**: \`...\`` 인라인 bullet) 에서 id 추출 | PASS | 실제 roadmap 파싱 결과 12개 sprint id 모두 추출 (iter-1 M1~M10 + iter-6 M2/M3), `warning=roadmap-id-missing` 0건. 수정 내용: lookahead 6 → 12, `if (!line)` → `if (line === undefined \|\| /^## /.test(line))` (다음 ## heading 에서 안전 종료), regex `-` → `[-*]` + id 콜론 뒤 공백 0+ 허용. |
| 3 | LOC budget | PASS | `git diff abd5e0e --numstat -- src/lib/review.ts scripts/vibe-sprint-complete.mjs` → review.ts +28/-0, sprint-complete.mjs +4/-4. **코드 net +28 / budget ≤35 OK**. 테스트 파일 별도 집계: vibe-review-inputs.test.ts +31/-0, sprint-commit.test.ts +28/-1. release note `docs/release/v1.4.3.md` 신규 9 line. 새 scripts 0. |
| 4 | 회귀 검증 | PASS | `npx tsc --noEmit` exit 0 (0 errors). `npm test --silent` → 251 tests, 250 pass / 0 fail / 1 skipped (기존 대비 +2 tests, 신규만 추가). `run-codex.sh`, `run-codex.cmd`, `vibe-status-tick.mjs` 변경 없음 (M3 defer scope 보존). `vibe-interview.mjs`, `src/lib/preflight-roadmap.ts`, `.claude/agents/sprint-planner.md`, `.vibe/audit/iter-3/rules-deleted.md` 모두 변경 없음 (iter-4 O1/O2/O3 + closed ledger 보존). |
| 5 | Wiring Integration | PASS | `docs/release/v1.4.3.md` 존재 (M2 섹션 + M3 placeholder). 신규 테스트는 기존 suite 에 추가 (`describe('review inputs')`, `describe('computeCurrentPointerBlock')`) — 구조 이상 없음. `parseRoadmapSprintIds` 는 `export function` 으로 승격되어 sprint-commit.test.ts 에서 import (함수 export 1개 추가 — prompt §2 에서 허용 명시). M3 Sprint (`sprint-M3-status-tick-windows-regression`) 구현 파일 (`scripts/vibe-status-tick.mjs`, 플랫폼 분기 스크립트) 에 영향 없음. |
| 6 | 드리프트 체크 | PASS | iter-6 goal "regression 복원 성격, 새 기능 없음" 유지 — 추가된 helper `collectDeleteConfirmedSlugs` 는 기존 parser 의 false-positive 필터링 로직. M3 scope (status-tick, platform wrapper) 침범 0. `rules-deleted.md` 본문 수정 0. `sprint-status.json` actualLoc 자동 기록 (150/-39 net +111 filesChanged=4) 은 working tree 내 모든 diff 를 포함한 집계 (state file + test 포함) — 커밋 시 재계산 예정이므로 문제 아님. |

## Findings

**차단 없음.** 참고용 관찰사항 2건:

### F1 — roadmap Pending 리스트 노출 (사전 빚 exposure, 차단 아님)

`docs/plans/sprint-roadmap.md` current-pointer 블록이 iter-1 M1~M10 sprint 들을 **Pending** 으로 표시하고 있다. 원인은 parser 수정 이전에는 iter-1 heading 일부를 lookahead 6 + `-` 전용 regex 로 놓쳐서 pending list 집계 자체에서 빠졌기 때문. 수정 후 12개 sprint 전부 인식 → session-log 내 `[sprint-complete]` 마커가 없는 iter-1 M1~M10 가 pending 으로 drift.

- **영향**: 정보 표시만. 기능/빌드/테스트 영향 0.
- **판단**: 본 Sprint scope 내 drift 아님 — parser 가 올바르게 동작하기 시작하면서 **사전 데이터 gap** (iter-1 sprint 완료가 session-log 에서 누락된 상태) 가 노출된 것. 스펙 §1.3 "기존 정상 매칭 케이스 회귀 X" 에 해당하지 않음 (기존 silent mismatch 였으므로).
- **권고**: M3 Sprint 또는 별도 후속 clean-up 에서 (a) iter-1 sprint 들을 roadmap 에서 archive 섹션으로 분리, 또는 (b) `computeCurrentPointerBlock` 이 session-log 외 다른 source (sprint-status.json `sprints[].id` 등) 를 completed 판정에 보조 사용하도록 확장. 본 Sprint 에서 해결 요구 안 함.

### F2 — sprint-status.json actualLoc 집계 범위 (informational)

`sprint-status.json` entry 에 기록된 `actualLoc: {added:150, deleted:39, net:+111, filesChanged:4}` 는 `git diff --shortstat HEAD~1 HEAD` 기반이고 HEAD 가 아직 abd5e0e (kickoff commit) 이므로 HEAD~1..HEAD 는 kickoff commit 자체의 diff (iteration-history/roadmap seed). 실제 Sprint 커밋 생성 시 재계산된다. 현재 수치는 무해하지만 audit 에 혼동 여지 — Orchestrator 의 `vibe-sprint-commit.mjs` 단계에서 자동 재기록되는 것으로 확인됨.

## Recommendation

- **Verdict**: `pass`, blocking=0 → 그대로 `node scripts/vibe-sprint-commit.mjs sprint-M2-parser-false-positive passed` 진행 권고.
- **M3 Sprint 착수 전 참고**: F1 의 roadmap pointer drift 는 status-tick windows regression M3 scope 와 무관하나, M3 완료 후 후속 clean-up candidate 로 session-log 에 메모 권장. 필요하면 N+1 backlog 로 `/vibe-review` 시드.
- Release note `docs/release/v1.4.3.md` 는 M3 Sprint 완료 시점에 M3 섹션 append 후 v1.4.3 bump 진행.
