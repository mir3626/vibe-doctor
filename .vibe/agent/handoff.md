# Orchestrator Handoff — iter-6 kickoff (harness-dogfood9-regression-fix)

> 이 파일은 Orchestrator 재인스턴스화의 **연료**다. 압축/세션 전환 후 새 Orchestrator 는
> `CLAUDE.md → MEMORY → sprint-status.json → session-log.md → 이 파일` 순으로 읽어 직전
> 상태를 복원한다.

## 1. Identity

- **repo**: `C:\Users\Tony\Workspace\vibe-doctor`
- **branch**: `main`
- **last release**: `v1.4.2` (iter-4 closure, tag pushed)
- **current iteration**: `iter-6` (startedAt 2026-04-19T02:00:00Z)
- **harnessVersion**: `1.4.2` (iter-6 종료 후 v1.4.3 patch bump 예정, local only)
- **language/tone**: 한국어 반말
- **push mode**: **local-only** — 모든 commit / tag 는 local 에서만. 사용자가 직접 push.

## 2. Status: IDLE - Sprint sprint-M2-parser-false-positive passed

dogfood9 리뷰 인계 수용 → iter-6 scope 축소 결정 (옵션 B: bug-only, M2+M3, +65 LOC).

dogfood9 metric 이 iter-4 fixes 전부 실효 증명 (41.7분 / 483K tokens / incident 0 / interview auto-terminate / 재위임 0.0 / preflight WARN 0). review-14 findings 8건 중 실 regression 2건만 수용:

- **M2 대상**: rules-deleted parser false-positive (iter-4 O3 회귀) + sprint-complete heading warnings.
- **M3 대상**: run-codex status-tick Windows silent-skip (iter-3 N2 회귀). 본 세션에서도 실제 재현 확인.

defer findings: auto-opt-in (web-scoped), sprite-assets (product scope).

## 3. iter-6 Sprint 구조

| Sprint | id | Focus | 예상 LOC |
|--------|-----|------|---------|
| **M2** | `sprint-M2-parser-false-positive` | src/lib/review.ts delete-confirmed skip + sprint-complete iter-1 heading parser | +35 |
| **M3** | `sprint-M3-status-tick-windows-regression` | run-codex.sh token 추출 Windows 호환 fix + regression test | +30 |
| `sprint-M2-parser-false-positive` | sprint-M2-parser-false-positive | passed |

**Growth budget**: net ≤ +65 LOC (default +150 내). **0 new scripts**.

**Audit cadence**: `sprintsSinceLastAudit=4/5` 현재 상태. M2 완료 시 5 도달 → **Evaluator Must** 소환. audit-clear 후 M3 진행.

## 4. 핵심 가치 (절대 보존)

- `scripts/vibe-interview.mjs` core synthesizer/parser 불변 (auto-opt-in post-process 는 defer)
- sprint-planner agent + `vibe-sprint-complete` / `vibe-sprint-commit`
- `run-codex.{sh,cmd}` wrapper 계약 (M3 는 확장만)
- Codex Generator 위임 원칙
- Sub-agent context isolation

## 5. iter-6 제약

- **Evidence source**: dogfood9 review-14 요약 (user-provided handoff). 원본 파일 접근 금지.
- **No push**: `git push` 금지 (사용자 명시). 모든 commit + tag 는 local.
- **Platform validation**: Windows(MINGW + PowerShell) + macOS.
- **Release 타깃**: v1.4.3 (patch, bug-fix only).
- **Out of scope**: auto-opt-in 기능, downstream dogfood9 파일 수정, 새 스크립트 추가.

## 6. 다음 행동 (이 세션 재시작 직후)

### Step 1 — iter-6 kickoff commit (즉시)

```bash
git add .vibe/agent/{handoff.md,session-log.md,iteration-history.json} docs/plans/sprint-roadmap.md
git commit -m "chore(iter-6): kickoff — harness-dogfood9-regression-fix"
```

### Step 2 — Sprint M2 Planner 소환 (autonomous, user approved)

```
Agent({ subagent_type: 'planner', model: 'opus', prompt: ... })
→ docs/prompts/sprint-M2-parser-false-positive.md
```

### Step 3 — Codex 위임 → verify → sprint-commit
### Step 4 — Evaluator Must (audit counter=5) → audit-clear
### Step 5 — Sprint M3 동일 패턴
### Step 6 — iter-6 closure: v1.4.3 bump + tag (local only)

## 7. pendingRisks

- `lightweight-audit-sprint-M-process-discipline` (INFO, iter-2 carryover) — iter-5 이후 자연 해소 관찰 중.

## 8. 링크

- iter-6 roadmap: `docs/plans/sprint-roadmap.md` (line 569+, `# Iteration 6`)
- iter-6 history entry: `.vibe/agent/iteration-history.json.iterations[0]`
- dogfood9 review-14 요약: session-log `[decision][iter-6-kickoff]` + 본 handoff §2
- iter-4 closure ref: commit `e4f45d5` + tag `v1.4.2` (pushed)
- status-tick regression evidence: 본 세션 Codex 호출 로그 전수에서 `status-tick: skipped reason=no-tokens`
