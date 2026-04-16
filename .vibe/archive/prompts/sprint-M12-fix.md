# Sprint M12 — 누락 산출 보강

## 누락

1. `.claude/skills/vibe-iterate/SKILL.md` 미생성.
2. `docs/release/v1.3.0.md` 미생성.
3. `.vibe/config.json.harnessVersion` 을 "1.3.0" 으로 bump 안 됨 (현재 "1.2.1").

## 수정 (3건만, 스코프 엄격)

### 1. `.claude/skills/vibe-iterate/SKILL.md` 신규

내용 골자 (~80-100 줄):

- Purpose: 프로젝트의 최초 Sprint 로드맵이 모두 완료된 후, 사용자가 프로젝트를 다음 iteration 으로 진입시키기 위한 스킬. 기존 handoff + report.html + iteration-history.json 을 기반으로 prior context 를 계승하면서도 Planner 는 fresh context 유지.
- Phase 0 — state 로드: `docs/reports/project-report.html` (최신), `.vibe/agent/handoff.md`, `.vibe/agent/session-log.md`, `docs/plans/project-milestones.md`, `.vibe/agent/iteration-history.json`, 직전 iteration 의 `docs/plans/sprint-roadmap.md` 를 Orchestrator 가 읽는다.
- Phase 1 — 차등 인터뷰: `node scripts/vibe-interview.mjs --mode iterate --carryover <prior-iter-id> --output .vibe/interview-log/iter-<N>.json` 호출. carryover seed 는 이전 iteration 의 미해결 항목 + 확정 결정 + 사용자 요구 신규 항목을 synthesizer prompt 에 주입하여 "이전과 모순되지 않게 깊게만 파고든다".
- Phase 2 — 새 Sprint 로드맵 생성: Orchestrator 가 이전 iteration 미완료 sprint + 신규 목표 sprint 를 기반으로 `docs/plans/sprint-roadmap.md` 에 `## Iteration iter-<N>` 섹션을 **append** (기존 내용 덮어쓰기 금지).
- Phase 3 — iteration-history.json 에 새 iteration 레코드 append (`label`, `goal`, `plannedSprints[]` 등). `currentIteration` 갱신.
- Phase 4 — 각 sprint 는 기존 프로세스 그대로 (Planner 소환 → Codex → verify → `vibe-sprint-commit`). Planner 소환 시 iteration-history 는 **주입 금지** (context isolation). 단 Orchestrator 가 해당 sprint 의 prior-sprint summary 에 "이번은 iter-<N> sprint-NN" 라는 헤더만 추가.
- Phase 5 — iteration 의 모든 sprint 완료 시 `scripts/vibe-project-report.mjs` 자동 재실행 → report.html 이 iteration 타임라인 누적 렌더. 브라우저 오픈.
- 사용자 follow-up 포인트: report.html 의 "Iteration 타임라인" + "마일스톤 진척도" 섹션이 전체 build-up 을 한 눈에 보여줌. handoff.md 는 현재 iteration 상태만 유지 (prior iteration 은 iteration-history.json 으로 이관).
- Context isolation 보장: Planner 는 여전히 fresh context. iteration 간 상태는 파일 계층 (iteration-history.json, report.html, sprint-roadmap.md) 으로만 전달.
- 실패 케이스: carryover seed 없이 `--mode iterate` 호출 → 새 iteration 을 빈 carryover 로 시작 (fresh restart 에 해당).

### 2. `docs/release/v1.3.0.md` 신규

- 한 단락 릴리스 요약.
- 5개 신규 기능:
  - HTML 프로젝트 보고서 자동 생성 + 브라우저 오픈 (`scripts/vibe-project-report.mjs`).
  - `/vibe-iterate` 슬래시 커맨드 + iteration tracking (`.vibe/agent/iteration-history.json`).
  - `.vibe/agent/*` init 상태 리셋 (기존 dogfood/harness 기록 제거).
  - `/vibe-review` regression 검증 (이전 리뷰 이슈 현재 커버리지 자동 대조).
  - 리뷰 가중치 공식 priority_score = 10·agent_friendly + 5·token_efficient + 1·user_fyi + script-wrapper 우선 지향.
- Upgrade path: `npm run vibe:sync -- --from /path/to/vibe-doctor`.
- Breaking change: 없음.
- Known issues: cmd wrapper health 1 test skip (M2 부터 이월).

### 3. `.vibe/config.json` 에서 `"harnessVersion": "1.2.1"` → `"1.3.0"`

## 범위 밖

다른 파일 손대지 않음. `package.json` 의 version 은 이미 0.1.0 으로 내부 버전이 아니므로 건드리지 않음.

## 검증

| 조건 | 명령 |
|---|---|
| tsc 0 errors | `npx tsc --noEmit` |
| npm test pass 유지 | `npm test` |
| vibe-iterate skill 존재 | `test -f .claude/skills/vibe-iterate/SKILL.md` |
| v1.3.0 릴리스 노트 존재 | `test -f docs/release/v1.3.0.md` |
| harnessVersion 1.3.0 | `grep '"harnessVersion": "1.3.0"' .vibe/config.json` |

Final report §_common-rules §9.
