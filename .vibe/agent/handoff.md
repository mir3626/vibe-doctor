# Orchestrator Handoff — iter-3 진행 중 (harness diet + tune-up)

> 이 파일은 Orchestrator 재인스턴스화의 **연료**다. 압축/세션 전환 후 새 Orchestrator 는
> `CLAUDE.md → MEMORY → sprint-status.json → session-log.md → 이 파일` 순으로 읽어 직전
> 상태를 복원한다.

## 1. Identity

- **repo**: `C:\Users\Tony\Workspace\vibe-doctor`
- **branch**: `main`
- **last release**: `v1.4.0` (iter-2 closure)
- **current iteration**: `iter-3` (startedAt 2026-04-17T06:59:41Z)
- **harnessVersion**: `1.4.0` (iter-3 N2 에서 artificial `1.4.1` bump 예정)
- **language/tone**: 한국어 반말

## 2. Status: iter-3 kickoff — Sprint N1 Planner 소환 대기

/vibe-iterate Phase 1~3 완료:
- Differential Interview 7 rounds, ambiguity terminate (log: `.vibe/interview-log/iter-3.json`)
- sprint-roadmap.md 에 `# Iteration 3 — harness diet + tune-up` 섹션 append
- iteration-history.json 에 iter-3 entry + `currentIteration: "iter-3"` 설정

**SKILL.md 수정 완료 (commit a3d4d3f)**: Step 1-0 (session mode), Step 3-5 (Sprint 로드맵), Phase 0 naming 정리.

## 3. iter-3 3 Sprint 구조 (a > b > c > d priority)

| Sprint | id | Focus | 예상 LOC (add/delete) |
|--------|-----|------|------|
| **N1** (dominant) | `sprint-N1-rule-audit-diet` | 28 rules semantic cluster 재정의 + dogfood6~7 transcript 재스캔 + S/A/B/C tier + B/C delete + Should→Must 격상 | +130 / -300~600 |
| **N2** | `sprint-N2-critical-bug-triage` | sprint-commit archive staging fix + artificial v1.4.1 bump 으로 auto-tag 자기 검증 + run-codex auto status-tick + dogfood8 인계 프롬프트 작성 | +150 / ~0 |
| **N3** | `sprint-N3-freeze-mode-flag` | CLAUDE.md §0 Charter (file top) + §1+ Extensions 재구조화 + config.json.mode 2-value define-only + soft freeze declaration + /vibe-review rules-deleted hook | +80 / -100 |

**Growth budget 총합**: net ≤ +150 LOC, 0 new scripts.

## 4. 핵심 가치 (절대 보존)

- `scripts/vibe-interview.mjs` + `.claude/skills/vibe-init` / `vibe-interview` (socratic core)
- sprint-planner agent + `vibe-sprint-complete` / `vibe-sprint-commit` (sprint loop)
- `run-codex.{sh,cmd}` wrapper (Windows/UTF-8)
- Codex Generator 위임 원칙
- Sub-agent context isolation

## 5. iter-3 제약

- **Evidence source**: session-log `[failure]` tag + dogfood6~7 transcript retrospective 재스캔 (확장)
- **Rule unit**: semantic cluster (line/섹션 단위 아님)
- **Charter 위치**: CLAUDE.md 파일 최상단 (agent read lazy hedge)
- **Charter 내용**: 역할 제약 + Sprint loop + sub-agent principle + trigger matrix Must + wiring checklist pointer + role 호출 표 (Should 없음 — N1 에서 제거)
- **Rule relation**: Should → Must 단일방향 격상 or delete. Must Not 은 rule-level prohibition 한정 (trigger matrix 에서 사용 금지)
- **Artifacts**: `.vibe/audit/iter-3/` iteration-scoped 디렉토리 (iter 종료/dogfood8 완료 후 `rm -rf` 로 cleansing)
- **Validation matrix**: Windows + macOS 양쪽
- **Out of scope**: 외부 provider 정책 변동 대응, wiring checklist 에 stakeholder 영향 명시 layer 추가, 본인 workflow 자체 개선

## 6. 다음 행동 (이 세션 재시작 직후)

### Step 1 — iter-3 kickoff commit (pending)

```bash
git add .vibe/agent/{handoff.md,session-log.md,iteration-history.json} \
        .vibe/interview-log/ \
        docs/plans/sprint-roadmap.md
git commit -m "chore(iter-3): kickoff — interview + roadmap + history"
```

### Step 2 — 사용자 승인 받고 Sprint N1 Planner 소환

**자율 모드 아님**. Sprint 시작 전 사용자 승인.

Planner 소환:
```
Agent({ subagent_type: 'planner' (or sprint-planner in future session), model: 'opus', prompt: ... })
```

출력: `docs/prompts/sprint-N1-rule-audit-diet.md`.

### Step 3 — Codex 위임

```bash
cat docs/prompts/sprint-N1-rule-audit-diet.md | ./scripts/run-codex.sh -
```

### Step 4 — 재검증 (tsc + test + rule audit smoke + LOC budget check)

### Step 5 — Sprint commit → N2 승인 요청

## 7. pendingRisks

- `lightweight-audit-sprint-M-process-discipline` (INFO, iter-2 carryover) — `src/lib/schemas/{index,iteration-history,sprint-api-contracts}.ts` 개별 test 없음 (intentional, `test/schemas.test.ts` 통합 커버). dogfood8 post-acceptance 시점에 처리.

## 8. 링크

- iter-3 interview log: `.vibe/interview-log/iter-3.json`
- iter-3 roadmap slot: `docs/plans/sprint-roadmap.md` (line 385+, `# Iteration 3`)
- iter-3 iteration entry: `.vibe/agent/iteration-history.json.iterations[0]`
- iter-2 closure ref: commit `9bd7f2d`, tag `v1.4.0`
- Wiring Checklist: `.vibe/agent/_common-rules.md §14`
