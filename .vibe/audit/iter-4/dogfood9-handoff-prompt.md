# dogfood9 인계 — iter-4 closure (v1.4.2) 브리핑

## 목적

iter-4 (harness-stability-tune) 종료 후 **downstream dogfood9 프로젝트** 에서
post-acceptance 검증 수행. dogfood8 에서 드러난 `#2~#7` 6 friction 이 실제로 사라졌는지
실전 run 으로 확인한다. 이 문서는 **사용자 참고용** — 실제 agent 에게 전달되는
first-class prompt 는 `.claude/templates/agent-delegation-prompt.md` 가 생성.

## iter-4 요약 (v1.4.2 released)

| Sprint | commit | 핵심 결과 |
|--------|--------|----------|
| O1 | `4096574` | `vibe-interview.mjs` sub-field coverage **high-watermark replace** (누적 아님) + `--status` 에 `pendingDimension` 노출 + soft-terminate 임계 0.5→0.8 상향. 7 regression tests (iter-4 kickoff 14-round abort 시나리오 포함). |
| O2 | `225dacc` | `vibe-audit-skip-set` config.local.json **skeleton bootstrap**. `src/lib/preflight-roadmap.ts` iteration 경계 파싱 (`# Iteration N` 블록). `.vibe/config.json.bundle.path` + `browserSmoke.dist` **configurable** (default `"dist"`, override `"app/dist"`). Windows spawn import() URL bug fix. |
| O3 | `b938512` | `sprint-planner.md` 에 **component-integration 계약** (Toaster/ToastProvider root mount + null-safe event handler + optimistic rollback). `vibe-sprint-commit.mjs` **LOCKFILE_BLACKLIST** (`package-lock.json` / `pnpm-lock.yaml` / `yarn.lock` / `bun.lockb`). iter-3 pending restoration 4건 **delete-confirmed**. |
| closure | `e4f45d5` | harnessVersion 1.4.1 → 1.4.2 bump. iteration-history completedAt / summary / milestoneProgress 갱신. `docs/reports/project-report.html` 자동 재생성. tag `v1.4.2` annotated + pushed. |

**테스트**: 228 → 249 (+21 pass / 0 fail / 1 skip). **preflight WARN 0** (`planner.presence` self-fix 확인).

**Core values 보존**: interview core / sprint-loop / Codex delegation / sub-agent isolation 그대로.

## dogfood9 가 측정하려는 것

iter-4 fixes 가 dogfood8 대비 얼마나 friction 을 줄였는지 direct comparison.

| 메트릭 | dogfood8 (baseline) | dogfood9 기대 |
|--------|----------------------|---------------|
| 총 소요 시간 | 94 분 | ≤ 75 분 (Codex 재위임 ↓ 예상) |
| Cumulative Codex tokens | 811,967 | ≤ 700K (Planner 계약 개선 효과) |
| 사용자 개입 (incident) | 1 (permission prefix) | **0** |
| Interview abort | 1 (#2 버그) | **0** (auto-terminate 기대) |
| Codex 추가 재위임 (Sprint 당) | 평균 0.5 (B3/B4 2건) | ≤ 0.25 |
| preflight WARN | 매 run 지속 | **0** (iter-4 O2 `#4` fix) |
| LOC 게이트 lockfile noise | B2 net +4303 왜곡 | **0** (O3 `#6` blacklist) |

## dogfood9 실행 순서 (사용자 작업)

### Step 1 — dogfood9 디렉토리 준비

새 디렉토리 (예: `C:\Users\Tony\Workspace\dogfood9`) 에 vibe-doctor template 을 sync.
**v1.4.2 tag 를 명시적으로 pull** 하여 iter-4 산출물 포함 여부 확인:

```bash
git clone --branch v1.4.2 https://github.com/mir3626/vibe-doctor.git dogfood9
# 또는
/vibe-sync  # upstream 에서 v1.4.2 반영
```

pull 후 확인:
- `scripts/vibe-interview.mjs` 에 `pendingDimension` 필드 노출 여부
- `src/lib/preflight-roadmap.ts` 존재
- `docs/release/v1.4.2.md` 존재
- `.claude/agents/sprint-planner.md` 에 component-integration 섹션 존재
- tests 총 249 (229 upstream 기본 + dogfood9 seed 는 별도)

### Step 2 — 새 Claude Code 세션에서 `/vibe-init`

dogfood9 디렉토리를 workspace 로 열고 새 Claude Code 세션 시작. `/vibe-init` 실행.

### Step 3 — Step 1-0 에서 "agent" 선택

세션 진행 모드 질문에 **`agent`** 답변.

### Step 4 — ONE_LINER 입력

**추천 one-liner** (A/B/C 중 택 1, 또는 직접 입력):

- **A. (추천 — web 프로젝트, O2 `#5` bundle path 검증용)** `개인 북마크 정리 웹앱 (React + Vite). 태그 자동 추출 + 검색 + 월별 archive. 차별점: 같은 도메인을 3회 이상 방문 기록하면 "즐겨찾기 후보" 로 자동 제안.`
- **B. (CLI — dogfood8 대비 도메인 전환)** `개인 reading log CLI. 책 등록 → 읽은 페이지 진행률 → 주간 리듬(요일별 분포) 리포트. JSON store + 시각화는 ASCII bar chart.`
- **C. (hybrid — interview dimension 복잡도 자극)** `로컬 개발자용 snippet 매니저 (웹앱 + CLI 쌍대). 단축키로 코드 조각 저장 + 태그 + clipboard 자동 복사. 차별점: 언어별 syntax highlight + 최근 사용 순 정렬.`

**A 권장 이유**: O2 `#5` bundle.path / browserSmoke.dist configurable 을 실제 경로로 검증 가능.
`app/dist` 같은 구조를 자연 유도.

### Step 5 — 출력된 prompt 를 copy-paste

`/vibe-init` 이 `agent-delegation-prompt.md` template 에 `<ONE_LINER>` 치환 → 완성된
prompt 를 터미널에 코드블록으로 출력 + skill 즉시 종료.

출력 prompt 를 **동일 세션 또는 새로운 세션의 첫 user turn** 에 copy-paste. agent 가
Charter first-class 해석 하에 Phase 2~4 + Sprint 로드맵 + Sprint 실행 + closure 자율 진행.

### Step 6 — 완료 후 검증 (최종 보고 10 항목)

agent 가 제출해야 하는 최종 보고 (iter-3 기준 7 항목 + iter-4 검증 3 항목):

1. **총 소요 시간** + cumulative Codex tokens
2. **Planner skip / 소환 비율** (trivial exception 3 조건 작동 확인)
3. **Evaluator 소환 발동 여부** (`audit.everyN=5` 기준)
4. **harnessVersion bump 시 auto-tag** 자동 생성 여부 (dogfood9 내에서 bump 없으면 N/A)
5. **session-log `[failure]` / `[drift-observed]` 총 incident 카운트**
6. **mode=agent 진행 중 사용자 개입 실제 회수** (이상적 = 0)
7. **pending restoration 복원 후보** list (O3 에서 iter-3 4건 모두 delete-confirmed, 새 후보 있으면 여기 기록)
8. **[iter-4 신규] Interview 총 round + auto-terminate 여부** (`--abort` 강제 종료 0 회 목표)
9. **[iter-4 신규] preflight WARN 총 발생 회수** (0 기대)
10. **[iter-4 신규] Sprint 당 Codex 재위임 평균** (B3/B4 유형 component-integration 누락 재발 여부)

### Step 7 — `/vibe-review` 실행

dogfood9 프로젝트 완료 후 dogfood9 디렉토리에서 `/vibe-review` 실행.
iter-3 N3 D4 hook 이 `.vibe/audit/iter-3/rules-deleted.md` + `.vibe/audit/iter-4/`(있다면) 을
자동 체크하여 미결정 복원 케이스 auto-seed. dogfood9 에서 발견한 신규 friction 은
review-7 로 기록 → iter-5 candidate pool.

## iter-4 가 수정한 버그 직접 확인 방법 (dogfood9 agent 지시)

agent 가 dogfood9 kickoff interview 를 진행하면서 다음을 기대:

| 버그 | 확인 방법 |
|------|-----------|
| `#2` interview coverage 누적 | 같은 dimension × sub-field 재답변 시 ratio 가 **replace** 되며 auto-terminate 도달. 14-round 무한 loop 없어야 함. |
| `#3` audit-skip-set hard-fail | `.vibe/config.local.json` 없는 상태에서 `vibe-audit-skip-set --set --reason ...` 호출하면 skeleton 자동 생성 + 정상 세팅. |
| `#4` preflight roadmap iter 경계 | `node scripts/vibe-preflight.mjs` 실행 시 planner.presence 가 dogfood9 의 **현재 iteration** 섹션 내 sprint 만 후보로 추출. |
| `#5` bundle/browserSmoke path | web 프로젝트 선택 시 `.vibe/config.json.bundle.path = "app/dist"` 설정 가능 + bundle-size gate 가 정확한 경로 사용. |
| `#6` LOC gate lockfile noise | `npm install` 유발 sprint 에서 `package-lock.json` 대량 diff 가 `actualLoc` 에 반영되지 **않음**. |
| `#7` Planner component 계약 | React/Vue 프로젝트에서 Codex 초기 산출물에 Toaster root mount / null-safe event handler 누락 **없음**. |

## 수동 조치 필요 사항 (iter-4 residual)

- **dogfood9 종료 후 복원 결정**: `/vibe-review` findings 기반. iter-3 pending restoration 4건은 이미 delete-confirmed 이므로 재고려 대상 아님.
- **`.vibe/audit/iter-3/` + `.vibe/audit/iter-4/` cleansing**: dogfood9 post-acceptance 승인 후 선택적 `rm -rf` 로 template initial state 복원. **단 `.vibe/audit/iter-3/rules-deleted.md` 는 iter-4 판정 섹션 포함하고 있어 historical record 로 보존 권장**. cleansing 여부는 사용자 판단.
- **`harness-gaps.md.gap-rule-only-in-md` status=under-review**: iter-4 O2 에서 `two-tier-audit-convention` delete 확정 반영 후 relief. dogfood9 review-7 에서 최종 close 또는 delete 결정.
- **iter-5 Growth budget 복귀**: iter-4 한정 +285 예외 종료. dogfood9 후 `/vibe-iterate` 로 iter-5 kickoff 시 **default +150 LOC / 0 new scripts** 복귀 강제.

## 참고 링크

- agent-delegation template: `.claude/templates/agent-delegation-prompt.md`
- vibe-init Step 1-0-agent 분기: `.claude/skills/vibe-init/SKILL.md`
- iter-4 roadmap: `docs/plans/sprint-roadmap.md` (line 468+, `# Iteration 4`)
- CLAUDE.md Charter: `CLAUDE.md` line 1-40 (BEGIN:CHARTER ~ END:CHARTER)
- iter-4 리뷰 근거: `docs/reports/review-6-2026-04-18.md`
- iter-3/iter-4 rules-deleted 판정: `.vibe/audit/iter-3/rules-deleted.md` (iter-4 append 섹션 포함)
- v1.4.2 release notes: `docs/release/v1.4.2.md`
- sprint-planner component-integration 계약: `.claude/agents/sprint-planner.md`
- interview coverage regression fixture: `test/interview-coverage.test.ts`
- preflight roadmap iteration 경계 로직: `src/lib/preflight-roadmap.ts`

## 한 줄 메세지

**iter-4 fix 들이 dogfood8 의 "유효 incident 1 + interview abort 1 + preflight WARN 지속"
패턴을 지웠다. dogfood9 목표는 incident 0 / abort 0 / WARN 0 으로 회귀 없음 증명.**
