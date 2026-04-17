# dogfood8 인계 — iter-3 closure (v1.4.1) 브리핑

## 목적

iter-3 (harness diet + tune-up) 종료 후 **downstream dogfood8 프로젝트** 에서
post-acceptance 검증 수행. 이 문서는 **사용자 참고용** — 실제 agent 에게 전달되는
first-class prompt 는 `.claude/templates/agent-delegation-prompt.md` 가 생성.

## iter-3 요약 (v1.4.1 released)

| Sprint | commit | 핵심 결과 |
|--------|--------|----------|
| N1 | `8c2d2a5` | CLAUDE.md 292→248 lines. 4 B/C tier cluster 삭제 + `.vibe/audit/iter-3/rules-deleted.md` 보관. dogfood6~7 transcript retrospective 재스캔. |
| N2 | `2a229e3` | sprint-commit archive staging fix (자체 검증). run-codex auto status-tick. **artificial v1.4.1 bump → auto-tag `v1.4.1` production 자동 생성 성공**. dogfood8 handoff prompt 작성. |
| N3 | `fb97967` | CLAUDE.md §0 Charter (line 1-40) + FREEZE-POSTURE + Extensions 재구조화. `.vibe/config.json.mode` 2-value define-only. `/vibe-review` rules-deleted hook + metric shift. |
| closure | `d10dfb7` | `docs/reports/project-report.html` Phase 5 생성. |

**Evaluator 첫 소환** 완료 (verdict=partial, blocking=0). 4 dangling references 발견 → cleanup.

Core values 보존: interview / sprint-loop / Codex delegation / sub-agent isolation 건드리지 않음.

## dogfood8 실행 순서 (사용자 작업)

### Step 1 — dogfood8 디렉토리 준비

새 디렉토리 (예: `C:\Users\Tony\Workspace\dogfood8`) 에 vibe-doctor template 을 sync.
기존 방식 그대로 (git clone 또는 `/vibe-sync`). **v1.4.1 tag 를 명시적으로 pull** 하여 iter-3
산출물 포함 여부 확인.

### Step 2 — 새 Claude Code 세션에서 `/vibe-init`

dogfood8 디렉토리를 workspace 로 열고 새 Claude Code 세션 시작. `/vibe-init` 실행.

### Step 3 — Step 1-0 에서 "agent" 선택

`/vibe-init` 의 Step 1-0 세션 진행 모드 질문에 **`agent`** 답변.

### Step 4 — ONE_LINER 입력

`/vibe-init` 이 후속 질문: "무엇을 만들고 싶은지 한 줄로 정의해주세요."

**추천 one-liner** (A/B/C 중 택 1, 또는 직접 입력):

- **A. (추천)** `커맨드라인 가계부 도구 (CLI + JSON store). 태그별 월간 요약 + 일일 지출 cap 경고. 차별점: 같은 카테고리에서 예산 초과 2일 연속 발생 시 다음 날 자동 경고.`
- **B.** `개인 독서 기록 웹앱. 책 등록 → 한줄평 → 월간 페이지 차트. 차별점: 독서 리듬 (요일별 분포) 시각화.`
- **C.** `Pomodoro + 세션 일기 겸용 웹앱. 25분 사이클 후 자동 프롬프트 "이번 세션 무엇을 했는지?" → 주간 요약 리포트.`

### Step 5 — 출력된 prompt 를 copy-paste

`/vibe-init` 이 `agent-delegation-prompt.md` template 에 `<ONE_LINER>` 를 치환한 뒤
완성된 prompt 를 **터미널에 markdown 코드블록으로 출력** + skill 즉시 종료.

출력된 prompt 를 **동일 세션 또는 새로운 Claude Code 세션의 첫 user turn** 에
copy-paste. agent 가 Charter first-class 해석 하에 Phase 2~4 + Sprint 로드맵 +
Sprint 실행 + closure 자율 진행.

### Step 6 — 완료 후 검증

agent 가 최종 보고 7 항목 제출 (`agent-delegation-prompt.md` 하단 참조):

1. 총 소요 시간 + Codex token 사용량
2. Planner skip / 소환 비율
3. Evaluator 소환 발동 여부
4. harnessVersion bump 시 auto-tag 자동 생성 여부
5. session-log `[failure]` / `[drift-observed]` incident 총 카운트
6. `.vibe/audit/iter-3/rules-deleted.md` 복원 후보 rule id list
7. mode=agent 진행 중 사용자 개입 실제 회수 (이상적 = 0)

### Step 7 — `/vibe-review` 실행

dogfood8 프로젝트 완료 후 dogfood8 디렉토리에서 `/vibe-review` 실행.
iter-3 N3 D4 hook 이 `.vibe/audit/iter-3/rules-deleted.md` 를 자동 체크하여 **미결정
복원 케이스를 자동 findings** 로 append 한다. 복원 여부를 여기서 결정.

## iter-3 가 측정하려는 것

사용자 관찰: dogfood7 대비 **작업 시간이 길었고** vanilla Claude 로 했으면 2 시간 내 완료 가능.
iter-3 diet 와 agent-delegation template 가 이 gap 을 얼마나 줄이는지가 핵심 metric.

**기대**:
- 총 소요 시간: 1.5~2.5 시간 (Sprint 당 20~40 분, Planner 절반 이상 skip 가정)
- 사용자 개입: 0~2 회 (이상적 0, 초기 정착 단계 허용치 2)
- auto-tag: harness bump 없으면 N/A. bump 발생 시 자동 tag 생성 확인.

## 수동 조치 필요 사항 (iter-3 residual)

- **dogfood8 종료 후 rules-deleted 복원 결정**: `/vibe-review` findings 기반.
- **`.vibe/audit/iter-3/` cleansing**: dogfood8 post-acceptance 승인 후 `rm -rf
  .vibe/audit/iter-3/` 로 template initial state 복원 (downstream 에 audit artifacts
  확산 방지).
- **iter-3 관련 uncommitted template files** 없음 (모두 commit 완료).

## 참고 링크

- agent-delegation template: `.claude/templates/agent-delegation-prompt.md`
- vibe-init Step 1-0-agent 분기: `.claude/skills/vibe-init/SKILL.md`
- iter-3 roadmap: `docs/plans/sprint-roadmap.md` (line 385+)
- CLAUDE.md Charter: `CLAUDE.md` line 1-40 (BEGIN:CHARTER ~ END:CHARTER)
- rule audit artifacts: `.vibe/audit/iter-3/{rule-audit-report,rules-deleted}.md`
- v1.4.1 release notes: `docs/release/v1.4.1.md`
