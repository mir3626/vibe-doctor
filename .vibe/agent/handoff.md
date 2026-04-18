# Orchestrator Handoff — iter-4 (harness-stability-tune)

> 이 파일은 Orchestrator 재인스턴스화의 **연료**다. 압축/세션 전환 후 새 Orchestrator 는
> `CLAUDE.md → MEMORY → sprint-status.json → session-log.md → 이 파일` 순으로 읽어 직전
> 상태를 복원한다.

## 1. Identity

- **repo**: `C:\Users\Tony\Workspace\vibe-doctor`
- **branch**: `main`
- **last release**: `v1.4.1` (iter-3 closure, artificial bump for auto-tag 검증)
- **current iteration**: `iter-4` (startedAt 2026-04-18T13:45:00Z)
- **harnessVersion**: `1.4.1` (iter-4 종료 후 v1.4.2 patch 예정)
- **language/tone**: 한국어 반말

## 2. Status: IDLE - Sprint sprint-O1-interview-coverage passed

`/vibe-iterate` Phase 0~3 완료:
- Phase 0 state load: handoff(iter-3), iteration-history, roadmap iter-3 section, review-6 carryover
- Phase 1 Differential Interview: **14 rounds 후 `--abort`** (review-6 `#2` coverage 누적 버그 재현 — success_metric ↔ goal 무한 loop). 재현 fixture 로 O1 regression test 에 활용.
- Phase 2 roadmap append: `docs/plans/sprint-roadmap.md` 에 `# Iteration 4 — harness-stability-tune` 섹션 추가 (O1~O3 + 공통 제약)
- Phase 3 iteration-history: iter-4 entry append + `currentIteration: "iter-4"` 세팅

## 3. iter-4 3 Sprint 구조 (a > b > c priority)

| Sprint | id | Focus | 예상 LOC |
|--------|-----|------|---------|
| **O1** (dominant) | `sprint-O1-interview-coverage` | review-6 `#2` — interview engine sub-field coverage 회계 버그 fix (replace-with-higher-confidence) + `--status` pendingDim 노출 + regression test (iter-4 kickoff 14-round fixture 포함) | +80 |
| **O2** | `sprint-O2-script-wrapper-triage` | `#3` audit-skip-set bootstrap + `#4` preflight roadmap iteration 경계 인식 + `#5` bundle/browserSmoke path configurable | +155 |
| **O3** | `sprint-O3-planner-contract-polish` | `#7` Planner common checklist component-integration + `#6` actualLoc lockfile blacklist + pending restoration 4건 최종 판정 | +50 |
| `sprint-O1-interview-coverage` | sprint-O1-interview-coverage | passed |

**Growth budget (예외)**: net ≤ +285 LOC (default +150 대비 1회 예외, 사용자 명시 승인). **0 new scripts 유지**. iter-5 부터 +150 복귀.

## 4. 핵심 가치 (절대 보존)

- `scripts/vibe-interview.mjs` + `.claude/skills/vibe-init` / `vibe-interview` (socratic core) — O1 에서 수정하되 sub-field ledger 구조 유지, 가중치 회계만 교정
- sprint-planner agent + `vibe-sprint-complete` / `vibe-sprint-commit` (sprint loop)
- `run-codex.{sh,cmd}` wrapper (Windows/UTF-8 + EPERM skip)
- Codex Generator 위임 원칙
- Sub-agent context isolation

## 5. iter-4 제약

- **Evidence source**: review-6 findings (`docs/reports/review-6-2026-04-18.md`) + dogfood8 인계 프롬프트 + iter-4 kickoff interview abort 재현
- **Artifacts**: `.vibe/audit/iter-4/` iteration-scoped (O2/O3 수행 시 생성). iter 종료 후 `rm -rf` cleansing 가능
- **Platform validation**: Windows(MINGW bash + PowerShell) + macOS
- **Release 타깃**: v1.4.2 (patch) — 버그 수정 성격
- **Out of scope**: 새 스크립트 추가, CLAUDE.md Charter 구조 변경, 외부 provider 정책

## 6. 다음 행동 (이 세션 재시작 직후)

### Step 1 — iter-4 kickoff commit (pending)

```bash
git add .vibe/agent/{handoff.md,session-log.md,iteration-history.json} \
        docs/plans/sprint-roadmap.md \
        docs/reports/review-6-2026-04-18.md
git commit -m "chore(iter-4): kickoff — review-6 + roadmap + history"
```

### Step 2 — 사용자 승인 후 Sprint O1 Planner 소환

**자율 모드 아님**. Sprint 시작 전 사용자 명시 승인.

```
Agent({ subagent_type: 'sprint-planner', model: 'opus', prompt: ... })
```

출력: `docs/prompts/sprint-O1-interview-coverage.md`. Planner 에 전달할 seed: review-6 `#2` finding + iter-4 kickoff interview abort 재현 시나리오 (14 rounds, success_metric↔goal loop) + 공용 checklist `_common-rules.md`.

### Step 3 — Codex 위임

```bash
cat docs/prompts/sprint-O1-interview-coverage.md | ./scripts/run-codex.sh -
```

### Step 4 — 재검증 (tsc + node --test + 새 regression test 통과)

### Step 5 — sprint-commit → O2 승인 요청

## 7. pendingRisks

- `lightweight-audit-sprint-M-process-discipline` (INFO, iter-2 carryover) — `src/lib/schemas/{index,iteration-history,sprint-api-contracts}.ts` 개별 test 없음 (intentional, `test/schemas.test.ts` 통합 커버). iter-4 O1 에서 coverage 수정 시 추가 검토.

## 8. 링크

- iter-4 review 근거: `docs/reports/review-6-2026-04-18.md`
- iter-4 roadmap slot: `docs/plans/sprint-roadmap.md` (line 468+, `# Iteration 4`)
- iter-4 iteration entry: `.vibe/agent/iteration-history.json.iterations[0]`
- dogfood8 인계 원본: `.vibe/audit/iter-3/dogfood8-handoff-prompt.md`
- iter-3 closure ref: commits `ce6fd78` (Windows sandbox skip) + `1c31f90` (statusline tune) / tag `v1.4.1`
- Wiring Checklist: `.vibe/agent/_common-rules.md §14`
