# Sprint: N3 — freeze posture + mode flag (iter-3 closure)

> 공용 규칙은 `.vibe/agent/_common-rules.md` 준수. 특히 §5 범위 준수, §9 Final report
> 형식, §13 Sandbox-bound Generator invariants, §14 Wiring Integration Checklist.

## Context & why

`iter-3 (harness diet + tune-up)` 의 **마지막 slot**. 직전 두 Sprint 결과:

- **N1 (`8c2d2a5`)** — CLAUDE.md `292 → 248 lines`. `.vibe/audit/iter-3/{rule-audit-report,rules-deleted}.md` 산출. `vibe-rule-audit.mjs` 확장 (transcript scan + tier 산출). B/C tier rule 전량 삭제 + Should trigger 전량 제거.
- **N2 (`2a229e3`)** — sprint-commit archive staging fix (suffix-less .md 포함), run-codex success-path status-tick 자동 호출, 인위적 `harnessVersion 1.4.0 → 1.4.1` bump 로 `v1.4.1` auto-tag **production 자기 검증 성공**. dogfood8 인계 프롬프트 저장.

N3 가 풀어야 할 **남은 과제 4가지**:

1. **Charter 물리 위치**: Agent read 가 lazy 하여 CLAUDE.md 중간쯤 선언된 규칙을 실제로는 참조하지 않는 현상 관측됨. `<!-- BEGIN:CHARTER -->` 블록을 **file 최상단**으로 물리 재배치하여 "반드시 먼저 읽는 구역" 확보.
2. **Freeze posture 공식화**: iter-3 이후 harness 증식을 **시간축으로** 막는 declarative gate. Self-expansion pattern 재발 방지의 구조적 답변.
3. **`mode` flag 진입점**: human / agent 2값 flag 를 **정의만** 하고 실제 분기 로직은 iter-4+ 로 defer. 지금 선언 해두면 iter-4 Sprint 진입 비용이 낮아진다.
4. **복원 결정 자동 노출**: N1 에서 삭제한 rule 들의 `restoration_decision: pending` 항목이 `/vibe-review` 실행 때마다 자동 findings 로 떠올라 잊혀지지 않도록 한다.
5. **Review metric shift**: `/vibe-review` 의 1차 metric 을 "uncovered rule 수" → "dogfood friction-per-sprint + shipped product value" 로 전환. iter-3 diet 철학의 측정 축 정착.

본 Sprint 는 iter-3 의 **closure** 도 겸한다 — `iteration-history.json` 의 iter-3 entry 완료 스냅샷은 이 Sprint 의 단일 commit 에 반드시 포함된다.

## Prerequisites (already installed)

- Node.js ≥ 24
- `zod` (`src/lib/schemas/` single-source schemas)
- 모든 기존 `vibe-*.mjs` scripts
- `.claude/agents/sprint-planner.md`
- `.vibe/audit/iter-3/rules-deleted.md` (N1 산출)
- `docs/release/v1.4.1.md` (N2 산출)
- tests 204 pass / 0 fail / 1 skip baseline

**Generator 주의**: Codex 샌드박스에서 `npm install`, `npm run vibe:*` 은 **실행 금지**.
정적 분석 + 단일 파일 단위 smoke 만 허용 (§13). `preflight` 실패는 무시하고 계속.

## Deliverables

### D1 — CLAUDE.md Charter / Extensions 물리 재구조화

**파일**: `CLAUDE.md` (현재 248 lines)

**요구사항**:

1. **파일 최상단** (line 1 부터) 에 다음 블록 순서 배치:
   - `<!-- BEGIN:CHARTER -->` … `<!-- END:CHARTER -->`
   - `<!-- BEGIN:FREEZE-POSTURE -->` … `<!-- END:FREEZE-POSTURE -->`  (D3 내용)
   - `<!-- BEGIN:EXTENSIONS -->` … `<!-- END:EXTENSIONS -->`
   - `<!-- BEGIN:PROJECT:custom-rules -->` … `<!-- END:PROJECT:custom-rules -->` (기존 최하단 블록 유지)

2. **Charter 블록 내용 요건** (20 ~ 40 lines 범위 목표, self-contained):
   - (a) **역할 제약** — Orchestrator 는 code 파일 직접 편집 금지, Generator(Codex) 위임 상수 규칙.
   - (b) **Sprint loop 골격** — `preflight → Planner(sprint-planner subagent) → Codex generate → verify(tsc/test) → sprint-complete → sprint-commit`.
   - (c) **Sub-agent = context checkpoint 원칙** — specialization 이 아니라 context 격리 메커니즘.
   - (d) **Trigger matrix Must 조건만** — Planner: 매 Sprint 시작 전 Must (+ trivial 3조건 예외는 한 줄 pointer). Evaluator: self-QA 실패 / context pressure / 비-executable AC / >5 files or >500 LOC. **Should 조건 서술 금지** (N1 에서 전량 제거됨).
   - (e) **Wiring Integration Checklist pointer** — "신규/변경 파일은 `.vibe/agent/_common-rules.md §14` 의 W1~W14 / D1~D6 체크리스트를 Final report 에 명기".
   - (f) **Role 호출 메커니즘 표** — `| 역할 | 모델 | 호출 메커니즘 |` 4-row 표. 표 위에 `<!-- BEGIN:SPRINT_ROLES (vibe-init 자동 업데이트 영역) -->` / `<!-- END:SPRINT_ROLES -->` 마커 **반드시 보존** (vibe-init 이 이 마커로 자동 치환함). Planner 호출은 `Agent({ subagent_type: 'sprint-planner', model: 'opus' })` 명시.

3. **Charter self-containment 증거**:
   - Charter 만 읽어도 agent 가 "코드 위임 규칙 + Sprint loop 순서 + Planner 소환 방법 + Evaluator 소환 조건" 4 가지를 수행 가능해야 함.
   - Charter 안에서 `docs/context/*.md` 또는 `_common-rules.md` 로의 pointer 는 허용되지만, 본문 이해에 필수인 내용은 Charter 안에 직접 서술.

4. **Extensions 블록 구성** (기존 content 재편성 — 내용 손실 금지):
   - 기존 CLAUDE.md 의 다음 섹션들을 Extensions 로 이동: `## 추론 강도 정책`, `## 훅 강제 메커니즘 — MD보다 스크립트`, `> Agent 도구 provider 별 호출 방법 블록`, `## Sprint 흐름 — 2단 구조`, `## Sprint 프롬프트 작성자`, `## Agent 오케스트레이션 레이어`, `## 관련 스킬`, `# 에이전트 지시사항: 기계적 오버라이드`, `## 핵심 재프레임 — 왜 sub-agent인가` (Charter 의 (c) 요약만 남기고 상세는 Extensions).
   - Extensions 끝에 **context shards pointer section** 보강: `docs/context/{product,architecture,conventions,orchestration,qa,tokens,secrets,codex-execution,harness-gaps}.md` 9 shards 를 1 줄 설명 + 언제 읽을지로 bullet list.
   - Charter ↔ Extensions contradict 금지 — 같은 규칙이 양쪽에 있으면 Charter 문구 우선, Extensions 는 **세부 / 사례 / 근거** 레이어.

5. **기존 `<!-- BEGIN:HARNESS:* -->` 마커 처리**:
   - 현재 `core-framing`, `role-constraints`, `trigger-matrix`, `reasoning-policy`, `hook-enforcement`, `sprint-flow`, `mechanical-overrides` 등의 마커가 있음. **삭제 금지** — vibe-sync / downstream 이 참조할 수 있음. Extensions 블록 내부로 물리적으로 이동시키되 마커 이름은 그대로.
   - Charter 블록 안에 둘 것만 Charter 마커로 감싸고, 나머지는 Extensions 안에서 기존 마커 유지.

6. **내용 손실 금지 기준**:
   - N1 `rule-audit-report.md` / `rules-deleted.md` 에 이미 삭제 승인된 내용 외에는 보존.
   - 특히 다음 **핵심 가치 rule** 은 Charter 에 반드시 포함: 역할 제약 / Sprint loop / sub-agent checkpoint / Codex 위임. 절대 삭제·약화 금지.
   - `# 에이전트 지시사항: 기계적 오버라이드` 섹션 (STEP 0, 강제 검증, sub-agent 스워밍, 컨텍스트 열화 인식, 편집 무결성, 시맨틱 검색 금지 등 10 항목) 은 Extensions 안으로 이동하되 10 항목 전부 보존. 요약·압축 금지.
   - `## 훅 강제 메커니즘` 표의 모든 행 보존 — vibe-preflight / run-codex / vibe-sprint-complete / vibe-checkpoint / vibe-version-check / vibe-stop-qa-gate / vibe-sprint-commit / vibe-session-log-sync / vibe-resolve-model / vibe-model-registry-check / vibe-interview / vibe-phase0-seal / vibe-browser-smoke / vibe-audit-lightweight / vibe-gen-schemas / vibe-audit-clear / vibe-status-tick / vibe-sprint-mode / vibe-planner-skip-log / vibe-sprint-commit --push-tag / vibe-rule-audit / vibe-audit-skip-set 전량.
   - `### Planner 소환 — subagent_type 지정 필수` 경고 블록 Charter 내부 role mechanics 아래 또는 Extensions 에 보존.
   - `> **CRITICAL — provider별 호출 방법**` 블록 (Claude 계열 Agent 도구 / Codex bash / gemini bash) 은 Extensions 로 이동 보존.

**Charter 블록 구조 참고 (intent 수준 — 본문 의도만 서술)**:

Charter 는 다음 6 sub-section 을 논리적 흐름으로 포함. 섹션 제목은 Generator 판단.

1. "This repo treats Claude as Orchestrator" — 1 줄 정의 + 기본값 (Orchestrator 단독 + self-QA).
2. "Role constraint (always on)" — Orchestrator code-file 직접 Edit 금지 + Generator=Codex 위임 상수 규칙 + 호출 방법 1 줄 (`Bash("... | ./scripts/run-codex.sh -")`).
3. "Sprint loop (one iteration)" — 7 단계 bullet: preflight → Planner (sprint-planner subagent) → Codex generate → Orchestrator verify → self-QA → sprint-complete → sprint-commit. 각 단계에 관련 script 1 개씩 inline 참조.
4. "Sub-agent = context checkpoint" — 2 줄. specialization 이 아니라 context isolation 가치. 상세는 Extensions 로 pointer.
5. "Trigger matrix (Must only)" — Planner: 매 Sprint Must + trivial 3조건 예외 한 줄 pointer. Evaluator: self-QA fail / context pressure / 비-executable AC / >5 files or >500 LOC. **Should 언급 절대 금지**.
6. "Role call mechanics" — 4-row 표 + `<!-- BEGIN:SPRINT_ROLES -->` / `<!-- END:SPRINT_ROLES -->` 마커 보존 필수. 표 하단에 Planner 호출 예시 1 줄 (`Agent({ subagent_type: 'sprint-planner', model: 'opus' })`).

마지막 줄 뒤에 Wiring Integration pointer 1 줄: "신규·변경 파일은 `.vibe/agent/_common-rules.md §14` 의 W1~W14 / D1~D6 체크리스트를 Final report `## Wiring Integration` 섹션에 보고".

**검증**:
- `grep -c "<!-- BEGIN:CHARTER -->" CLAUDE.md` → 1
- `grep -c "<!-- END:CHARTER -->" CLAUDE.md` → 1
- `grep -c "<!-- BEGIN:EXTENSIONS -->" CLAUDE.md` → 1
- Charter 블록 line 수 (BEGIN-END 사이, marker 제외) : `20 ≤ lines ≤ 40`
- `<!-- BEGIN:SPRINT_ROLES` 마커와 `<!-- END:SPRINT_ROLES -->` 마커 보존 (Charter 내부로 이동했더라도).
- Charter 안에 키워드 `sprint-planner`, `Codex`, `context checkpoint`, `매 Sprint` 모두 존재.
- Charter 안에서 `Should` 단어가 등장하지 않음 (case-insensitive) — trigger matrix 단일화 강제.

### D2 — `.vibe/config.json` `mode` flag 정의 (실제 분기 로직 구현 금지)

**파일**:
- `.vibe/config.json` — top-level `"mode": "human"` 추가 (기존 필드 뒤, `harnessVersionInstalled` 앞이 자연스러움).
- `src/lib/config.ts` — `VibeConfig` interface 에 `mode?: 'human' | 'agent'` optional field 추가. `mergeConfig` 가 기본적으로 top-level copy 이므로 별도 merge 로직 불필요 (override 가 있으면 그대로 덮어씀).
- CLAUDE.md Charter (또는 Charter 직후 `<!-- BEGIN:EXTENSIONS -->` 최상단) — "5 분기점 calling convention" 섹션 신설. 제목 예: `## Mode flag calling convention (human / agent — iter-4 defer)`.

**5 분기점 문서 요건** (각 항목 1~2 줄, pseudocode 금지):

1. **Interview mode** — human: `scripts/vibe-interview.mjs` 인터랙티브 prompt. agent: seed prompt → synthesizer 자동 재귀 없이 dimension 전량 seed 주입 + 자동 answer.
2. **Error output format** — human: 한국어 + emoji + 친화적 다음 행동 제안. agent: JSON `{ "code": "...", "message": "...", "hint": "..." }` 한 줄.
3. **Confirmation gates** — human: 사용자 approve 대기. agent: risk-tier ≤ N (정의 defer) auto-approve, initialized `[decision][auto-approved]` session-log 기록.
4. **Doc verbosity** — human: Charter + Extensions 자동 확장 읽기. agent: Charter only 우선, Extensions 는 explicit `docs/context/*.md` 읽기 요구에만.
5. **Status display** — human: statusline emoji + 한국어. agent: JSON log line (`{ "sprint": "...", "elapsed": N, "tokens": N }`).

**중요**: 각 항목 끝에 `— 구현: iter-4+ (defer)` 명시. 지금 분기 로직은 **작성 금지**.

**테스트 요건** (최소 1개 신규):
- `test/config.test.ts` 확장 — "loadConfig returns mode: 'human' by default" 또는 "VibeConfig type permits mode union" 중 적합한 것 1개. `mergeConfig({...base, mode: 'agent'})` override 가 'agent' 를 리턴하는지 확인 1개. 총 **+1 이상 신규 assertion**.

**검증**:
- `node -e "const c=require('./.vibe/config.json'); process.exit(c.mode==='human'?0:1)"` → exit 0
- `grep -c "mode\|5 분기점" CLAUDE.md` ≥ 1 (Charter 또는 Extensions 어디에 있든)
- `npx tsc --noEmit` 0 errors (interface 확장 후에도)

**범위 밖**:
- 실제 mode 분기 로직 구현 (scripts / lib 어디에도 금지).
- mode 별 statusline / interview / error output 분기 코드.
- `src/lib/schemas/` 확장 (현재 `.vibe/config.json` 전용 Zod schema 는 없음 — `src/lib/schemas/index.ts` 확인 후 없으면 skip. 있으면 `mode: z.enum(['human','agent']).optional()` 만 추가).

### D3 — Soft freeze posture 선언 블록

**위치**: CLAUDE.md Charter 블록 직후 `<!-- BEGIN:FREEZE-POSTURE -->` … `<!-- END:FREEZE-POSTURE -->` 블록 (D1 에서 구조 확정).

**내용 요건** (8 ~ 15 lines 내외):

- 제목: `# Soft freeze (iter-3 closure)` 또는 `## Soft freeze (iter-3 closure posture)`.
- 핵심 문장 4 가지 포함:
  1. iter-3 종료 이후 harness 변경은 **분기 1회 (≤ 3 개월)** 로 제한.
  2. 각 iteration 당 **net +150 LOC cap + 0 new scripts** 원칙 준수 (delete 는 무제한).
  3. Growth 는 **실제 dogfood friction-per-sprint 증거가 있을 때만** 정당화.
  4. 변경 제안 진입 경로는 `/vibe-review` findings **또는** user directive 로만 허용.
- 마지막 줄: "본 freeze 는 iter-3 완료 commit 이후 유효. 해제 조건: 사용자 명시 승인 + session-log `[decision][freeze-lifted]` 기록."

**검증**:
- `grep -c "Soft freeze\|분기 1회\|+150 LOC\|net +150" CLAUDE.md` ≥ 2

### D4 — `/vibe-review` rules-deleted 자동 체크 hook

**파일** (기존 확장 — `0 new scripts` 원칙):

1. **`src/lib/review.ts`** — 신규 export 함수 `collectPendingRestorationDecisions(root?: string): Promise<PendingRestoration[]>` 추가.
   - 스캔 대상: `.vibe/archive/rules-deleted-*.md` **AND** `.vibe/audit/iter-*/rules-deleted.md` (glob 패턴 각각).
   - 각 파일에서 `restoration_decision: pending` 줄이 포함된 section 의 제목(`## <slug> — <title>`)과 `tier`, `reason` 추출.
   - 반환 type: `interface PendingRestoration { sourceFile: string; ruleSlug: string; title: string; tier: 'S'|'A'|'B'|'C'; reason: string; }` — `src/lib/review.ts` 내부 또는 `src/lib/schemas/` 의 기존 파일에 type export.
   - 파일이 하나도 없으면 `[]` 반환 (no-op).

2. **`ReviewInputs` interface** (src/lib/review.ts) — `pendingRestorations: PendingRestoration[]` field 추가. `collectReviewInputs` 에서 `collectPendingRestorationDecisions` 호출 후 채움.

3. **`.claude/skills/vibe-review/SKILL.md`** — 다음 두 가지 업데이트:
   - `## Automatic Checks` 섹션에 항목 추가: "`pendingRestorations.length > 0` 이면 각 entry 당 `🟡 Friction` finding 자동 seed. `id: review-pending-restoration-<ruleSlug>`, `proposal: '<title>' 복원 여부 결정 필요 (tier=<tier>, reason=<reason>, source=<file>)`, `estimated_loc: 0`, `proposed_sprint: 'backlog'`."
   - `## Protocol` step 2 "자동 로드 입력" list 에 항목 추가: "`.vibe/archive/rules-deleted-*.md` + `.vibe/audit/iter-*/rules-deleted.md` pending 복원 결정 목록".

4. **테스트 `test/vibe-review-inputs.test.ts`** 확장 (신규 파일 금지 — 기존 확장):
   - `collectPendingRestorationDecisions` 가 `.vibe/audit/iter-3/rules-deleted.md` 의 `pending` entry 를 파싱 1개 이상 반환하는지 (fixture 를 tmp 디렉토리에 작성 후 `collectPendingRestorationDecisions(tmpRoot)` 호출).
   - 파일이 없는 tmp root 에서 `[]` 반환.
   - 최소 2 개 assertion 추가.

**파싱 스펙**:
- section 경계: `^## ` 로 시작, `^---$` 또는 다음 `^## ` 까지 한 section.
- 각 section 내부에서 key=value 추출 (YAML-like): `tier: B`, `reason: "..."`, `restoration_decision: pending`.
- `restoration_decision: pending` 이 없는 section 은 skip.
- 제목 `## <slug> — <title>` 파싱: `—` (em dash) 또는 ` - ` (space dash space) 구분자로 split, 없으면 전체를 title 로 사용하고 slug 는 title 을 lowercase + hyphenate.
- `tier` 값이 `S`/`A`/`B`/`C` 이외인 경우 `'C'` 로 fallback + `reason` 앞에 `[tier-fallback] ` prefix.
- `reason` 에 quote 있으면 양끝 `'`/`"` strip.

**Glob 대상 디렉토리**:
- `.vibe/archive/rules-deleted-*.md` — 이전 iteration 이 archive 로 이동시킨 ledger (현재는 없을 수 있음).
- `.vibe/audit/iter-*/rules-deleted.md` — 현 iter-3 산출물 포함. glob 으로 `iter-1`, `iter-2`, `iter-3`, ... 미래 iteration 까지 자동 스캔.
- 두 디렉토리 모두 존재하지 않으면 `[]` 반환 (no-op). 파일이 0-byte 이거나 파싱 실패 section 만 있으면 `[]`.

**우선순위 규칙**:
- 동일 `ruleSlug` 가 두 곳에 존재하면 `.vibe/audit/iter-*/rules-deleted.md` 의 최신 iter 값을 우선 (archive 는 이전 결정 후 이동된 상태로 간주).

**검증**:
- `npm test` (Orchestrator 가 밖에서 돌림) — `vibe-review-inputs.test.ts` 신규 assertion pass.
- `npx tsc --noEmit` 0 errors.

**범위 밖**:
- `rules-deleted-*.md` 파일의 실제 schema 정규화 (D4 scope 밖 — 읽기만).
- 복원 결정 자체의 UI / 자동 실행 흐름.

### D5 — Review metric shift 선언

**파일**:

1. **`.claude/skills/vibe-review/SKILL.md`** `## Rubric` 섹션 업데이트:
   - 각 tier 판정 기준을 명시적으로 "primary metric = **dogfood friction incident count per sprint** + **delivered product feature count**" 로 재정의.
   - 예시 포맷:
     - `🔴 Blocker` — sprint 당 friction incident ≥ 3 발생 또는 product delivery 차단.
     - `🟡 Friction` — sprint 당 friction incident 1~2, 사용자/Orchestrator 우회 반복.
     - `🟢 Polish` — friction 0 이지만 UX/문서 개선 여지.
     - `🔵 Structural` — friction 잠재 + 장기 유지보수 축 영향.
   - "uncovered rule 수" / "open harness gap 수" 는 **secondary signal** 로 강등. 단, `openHarnessGapCount > 0` 이면 1 개 finding 에 근거로 연결하는 기존 규칙은 보존 (중복 열 갈이 아닌 우선순위만 재정의).

2. **`docs/plans/sprint-roadmap.md`** — iter-3 섹션의 **"유지 철학"** 또는 "성공 기준" 근처에 한 줄 추가:
   - `> **Review metric (iter-3 closure)**: 평가 우선순위는 "dogfood friction incident per sprint + delivered product value" — 기존 "uncovered rule / harness gap 수" 는 secondary signal 로 강등.`
   - 기존 섹션 편집 최소화 — 한 줄 insert.

**검증**:
- `grep -c "friction-per-sprint\|friction incident\|primary metric" .claude/skills/vibe-review/SKILL.md` ≥ 2
- `grep -c "dogfood friction\|delivered product value" docs/plans/sprint-roadmap.md` ≥ 1

**범위 밖**:
- `review.ts` 의 `detectOptInGaps` 내부 로직 재작성 (rubric 만 SKILL.md 문서 수준).
- `priority_score` 공식 변경 (기존 `10·agent + 5·token + 1·user` 유지).
- `test/review-priority.test.ts` / `test/review-regression.test.ts` 로직 변경 — 단, 문구 변경으로 fail 하면 fixture 한 줄만 조정.

### D6 — iter-3 closure (iteration-history + release note)

**파일**:

1. **`.vibe/agent/iteration-history.json`** — `iterations[0]` (`id: "iter-3"`) entry 업데이트:
   - `completedAt`: `"2026-04-17T..."` 형태 ISO8601 (현재 시각 — Generator 가 실행 시점 `new Date().toISOString()`).
   - `completedSprints`: `["sprint-N1-rule-audit-diet", "sprint-N2-critical-bug-triage", "sprint-N3-freeze-mode-flag"]`.
   - `milestoneProgress`: `{"rule-audit-diet": 1, "critical-bug-triage": 1, "freeze-mode-flag": 1}` (모두 1.0).
   - `summary`: 3 문장 재작성. N1 결과 (CLAUDE.md 292→248, audit artifacts) + N2 결과 (archive staging fix, auto-tag v1.4.1 production 자기 검증 성공) + N3 결과 (Charter/Extensions 재구조화, mode flag define-only, freeze posture) 각 1 문장씩. LOC 총합 (net +150 이하) 명시.

2. **`docs/release/v1.4.1.md`** — append-only. 파일 끝에 신규 섹션 추가:
   ```
   ## iter-3 N3 — freeze posture + mode flag (closure)

   - CLAUDE.md restructured with explicit CHARTER / FREEZE-POSTURE / EXTENSIONS blocks at file top.
   - `.vibe/config.json.mode` added ("human" | "agent"); branching logic deferred to iter-4+.
   - Soft freeze posture declared: ≤ quarterly harness changes, net +150 LOC cap, 0 new scripts per iteration.
   - `/vibe-review` now auto-surfaces pending restoration decisions from rules-deleted ledgers.
   - Review metric primary axis shifted to dogfood friction-per-sprint + delivered product value.
   - iteration-history.json iter-3 entry sealed.
   ```
   **harnessVersion bump 금지** — N2 에서 이미 1.4.1 로 bump 했으므로 v1.4.2 파일 신규 생성하지 않는다. 같은 v1.4.1 에 append 가 의도.

**검증**:
- `node -e "const h=require('./.vibe/agent/iteration-history.json'); const i=h.iterations.find(x=>x.id==='iter-3'); process.exit(i.completedAt && i.completedSprints.length===3 ? 0 : 1)"` → exit 0
- `grep -c "iter-3 N3" docs/release/v1.4.1.md` ≥ 1
- `.vibe/config.json.harnessVersion` == `"1.4.1"` (N2 값 유지, bump 금지).

**Orchestrator 주의**: iter-3 closure 파일 3종 (CLAUDE.md, config.json, iteration-history.json, release note) 모두 이 Sprint 의 **단일 commit** 에 포함. Orchestrator 가 post-commit 으로 별도 업데이트하지 않는다.

## File-level spec

| 파일 | 조작 | 핵심 변경 |
|---|---|---|
| `CLAUDE.md` | **rewrite** | 최상단 CHARTER + FREEZE-POSTURE + EXTENSIONS 블록 물리 배치. 기존 content 재편성 (중복 제거). 핵심 가치 rule 보존. |
| `.vibe/config.json` | edit | top-level `"mode": "human"` 추가. `harnessVersion` / `harnessVersionInstalled` 변경 금지. |
| `src/lib/config.ts` | edit | `VibeConfig.mode?: 'human' \| 'agent'` optional field 추가. |
| `src/lib/review.ts` | edit | `collectPendingRestorationDecisions` 신규 export + `ReviewInputs.pendingRestorations` 확장 + `collectReviewInputs` 호출. |
| `.claude/skills/vibe-review/SKILL.md` | edit | Protocol/Automatic Checks/Rubric 업데이트 (D4 + D5). |
| `docs/plans/sprint-roadmap.md` | edit | iter-3 섹션에 "Review metric (iter-3 closure)" 한 줄 삽입. |
| `.vibe/agent/iteration-history.json` | edit | iter-3 entry closure (completedAt / completedSprints / milestoneProgress / summary). |
| `docs/release/v1.4.1.md` | edit | N3 deliverable 요약 append. |
| `test/config.test.ts` | edit | mode flag default + override 테스트 ≥ 1. |
| `test/vibe-review-inputs.test.ts` | edit | `collectPendingRestorationDecisions` 테스트 ≥ 2. |

**Do NOT modify**:
- `docs/context/*.md` 9 shards — pointer 만 Extensions 에서 보강, 내용 편집 금지.
- `scripts/*.mjs` 전체 — 0 new scripts 원칙 + 기존 scripts 내용 변경 없음.
- `.claude/agents/sprint-planner.md` — N1~N2 에서 확정됨.
- `src/lib/schemas/` 의 기존 파일 — config.json 전용 schema 가 없다면 D2 가 touch 할 이유 없음.
- `package.json` — 새 deps / 새 scripts 추가 금지.

## Acceptance criteria

| # | 기준 | 명령 |
|---|---|---|
| AC1 | TypeScript 0 errors | `npx tsc --noEmit` |
| AC2 | 전체 테스트 pass (기존 204 + 신규 3+ 이상) | `npm test` (Orchestrator 밖에서) |
| AC3 | CHARTER 블록 존재 | `grep -c "<!-- BEGIN:CHARTER -->" CLAUDE.md` = 1 |
| AC4 | CHARTER 블록 line 수 범위 | Charter BEGIN-END 사이 line count `20 ≤ n ≤ 40` |
| AC5 | EXTENSIONS 블록 존재 | `grep -c "<!-- BEGIN:EXTENSIONS -->" CLAUDE.md` = 1 |
| AC6 | FREEZE-POSTURE 블록 존재 | `grep -c "<!-- BEGIN:FREEZE-POSTURE -->" CLAUDE.md` = 1 |
| AC7 | SPRINT_ROLES 마커 보존 | `grep -c "<!-- BEGIN:SPRINT_ROLES" CLAUDE.md` = 1 |
| AC8 | mode flag default "human" | `node -e "process.exit(require('./.vibe/config.json').mode==='human'?0:1)"` exit 0 |
| AC9 | 5 분기점 문서화 | `grep -cE "5 분기점\|mode flag\|mode:" CLAUDE.md` ≥ 1 |
| AC10 | rules-deleted rubric 항목 | `grep -c "pending-restoration\|restoration_decision" .claude/skills/vibe-review/SKILL.md` ≥ 1 |
| AC11 | metric shift 선언 | `grep -c "friction-per-sprint\|friction incident" .claude/skills/vibe-review/SKILL.md` ≥ 1 |
| AC12 | iter-3 completedAt non-null | `node -e "const h=require('./.vibe/agent/iteration-history.json'); const i=h.iterations.find(x=>x.id==='iter-3'); process.exit(i.completedAt?0:1)"` exit 0 |
| AC13 | iter-3 net LOC (N1+N2+N3 누적) ≤ +150 | `git diff --stat <iter-3-base>..HEAD` 수치 + commit message LOC 합산. Orchestrator 가 확인. |
| AC14 | 0 new scripts (iter-3 전체) | `git diff --name-status <iter-3-base>..HEAD -- scripts/` 에 `A` 상태 없음 |
| AC15 | harnessVersion 유지 | `.vibe/config.json.harnessVersion == "1.4.1"` (bump 금지) |
| AC16 | Charter self-containment keyword | Charter 내부에 `sprint-planner`, `Codex`, `매 Sprint`, `context checkpoint` 전부 등장 |
| AC17 | 핵심 가치 rule 보존 | Charter 또는 Extensions 에서 "Orchestrator는 소스코드" / "Generator(Codex) 위임" / "sub-agent context" / "Planner 소환 매 Sprint" 키워드 모두 유지 |

## Wiring Integration Checklist

Final report 에 아래 표를 포함. 각 항목 `touched / n/a / skipped+reason`.

| Checkpoint | Expected |
|---|---|
| W1 CLAUDE.md §훅 테이블 | possibly touched (Extensions 재배치 시 물리 위치 이동). 마커 행은 보존. |
| W2 CLAUDE.md §관련 스킬 | n/a (새 skill 추가 없음; 기존 vibe-review 확장만) |
| W3 CLAUDE.md §Sprint flow | n/a (flow 절차 변경 없음) |
| W4 `.claude/settings.json` hooks | n/a |
| W5 statusLine | n/a |
| W6 sync-manifest harness[] | n/a (신규 파일 없음) |
| W7 sync-manifest hybrid.harnessKeys | **touched** — `.vibe/config.json` 에 새 top-level key `mode` 도입. `.vibe/sync-manifest.json.files[".vibe/config.json"].hybrid.harnessKeys` 에 `mode` 추가 필요 (downstream 이 mode 기본값을 이어받도록). 확인 후 누락 시 추가. |
| W8 README.md | n/a (사용자 대면 기능 아님 — iter-4+ 실제 분기 시 추가) |
| W9 package.json scripts | n/a |
| W10 release note `docs/release/v1.4.1.md` | **touched** — N3 요약 append |
| W11 migrations | n/a (schema 변경 아님 — 선택적 optional field 추가만) |
| W12 test regression | **touched** — `test/config.test.ts` + `test/vibe-review-inputs.test.ts` 확장 |
| W13 harness-gaps.md | n/a (freeze 선언은 gap 해소가 아니라 posture) |
| W14 .gitignore | n/a |
| Charter self-containment | **touched** — 증거: Charter keyword 검증 (AC16) |
| Iter-3 closure | **touched** — iteration-history.json iter-3 entry sealed |

**verified-callers** — 신규 `collectPendingRestorationDecisions` 호출처 명시 필수:
- `src/lib/review.ts` 내부 `collectReviewInputs` 에서 호출
- `test/vibe-review-inputs.test.ts` 신규 assertion
- `.claude/skills/vibe-review/SKILL.md` `## Automatic Checks` 에서 로직 설명

## Non-goals

- **실제 mode 분기 로직 구현** — D2 는 정의 + 문서화만. `if (config.mode === 'agent') { ... }` 분기 코드 **전면 금지**. iter-4+ defer.
- **rule 추가 / 삭제** — N1 에서 완료됨. CLAUDE.md 에서 Charter/Extensions 재배치는 편집이지 rule 목록 조작이 아니다.
- **외부 provider 정책 대응** (Anthropic / OpenAI / GitHub terms / rate-limit) — iter-3 전체 범위 밖.
- **mode flag UI / statusline 표시** — 현 iter 는 flag 존재만.
- **harnessVersion bump** — v1.4.1 유지. v1.4.2 파일 신규 생성 금지.
- **새 `scripts/vibe-*.mjs` 추가** — 0 new scripts. 기존 `src/lib/review.ts` 확장만.
- **context shards 편집** — `docs/context/*.md` 9 파일 모두 Do NOT modify.
- **restoration 결정 자동화** — D4 는 노출(seed findings)만. 결정 자동 실행 / rule 복원 로직 구현 금지.

## Estimated LOC

- add ~50 (Charter 내용 재작성 이동은 delete+add 로 계산, 순수 신규는 FREEZE-POSTURE ~10 + mode flag 관련 ~5 + review.ts 확장 ~25 + SKILL.md 변경 ~10 = ~50)
- delete ~50 (CLAUDE.md Extensions 재편성 시 중복 제거 + Should trigger 문구 잔재 정리)
- tests ~20 add
- iteration-history / release note ~15 add

**iter-3 net LOC 누적 (N1 + N2 + N3)**: ≤ +150 보수 유지 (N1 은 삭제 dominant, N2 는 +~150, N3 는 net ≈ 0 ~ +30).

## Final report contract

Final report (`.vibe/agent/sprint-N3-report.md` 또는 Codex 표준 output) 에 반드시 포함:

1. **`## Files added`** / **`## Files modified`** — `_common-rules.md §9` 형식.

2. **`## Verification`** 표:
   ```
   | command | exit |
   |---|---|
   | npx tsc --noEmit | 0 |
   | (npm test — Orchestrator 수행) | (0 기대) |
   ```

3. **`## Charter evidence`** — Charter 블록의 line range (예: `CLAUDE.md:1-35`) + 다음 키워드 등장 증거 (grep 결과 발췌): `sprint-planner`, `Codex`, `매 Sprint`, `context checkpoint`. 핵심 가치 rule 4 가지 (Orchestrator 소스코드 금지 / Codex 위임 / sub-agent checkpoint / Planner 매 Sprint) 각각 Charter or Extensions 위치 명시.

4. **`## Mode flag evidence`** — `.vibe/config.json.mode` 값 + `VibeConfig.mode` 타입 확인 + 5 분기점 문서 블록 line range.

5. **`## Iter-3 closure evidence`** —
   - `iteration-history.json iterations[0]` 의 `completedAt` / `completedSprints` 스냅샷 첨부.
   - `docs/release/v1.4.1.md` append 된 섹션 line range.

6. **`## Wiring Integration`** — 위 표 상태 + `verified-callers` 리스트.

7. **`## Sandbox-only failures`** — `npm install` / `npm test` 등 샌드박스 밖에서 Orchestrator 가 돌려야 하는 명령 나열 (있을 경우).

8. **`## Deviations`** — scope 에서 벗어난 변경 (예상: 없음 / "none").

## Migration-safety notes

- **Downstream compat**: `.vibe/config.json` 에 `mode` top-level 신규 key 도입은 **optional field** 이므로 기존 downstream 프로젝트가 읽을 때 undefined 허용. Default 값 인지 시점은 downstream 이 upgrade 후 다음 `/vibe-sync` 에서 hybrid merge 를 통해 `"mode": "human"` 이 주입되도록 `sync-manifest.json` 의 `.vibe/config.json` hybrid.harnessKeys 목록에 `mode` 추가. 없으면 downstream 은 undefined 로 유지 (읽는 코드는 `?? 'human'` fallback).
- **CLAUDE.md Charter/Extensions 블록은 sync-manifest 에서 `CLAUDE.md` 가 이미 hybrid merge 로 관리되는지 확인** — 관리 중이면 `<!-- BEGIN:PROJECT:custom-rules -->` 블록이 downstream 측에서 보존됨. Charter/Extensions 물리 재배치가 hybrid merge 로직과 충돌하지 않는지 한 번 확인 (단, 수정하지 말 것 — 이슈 발견 시 report 에 기록만).
- **Schema drift 방지**: `src/lib/schemas/` 에 config.json 전용 Zod schema 가 **없으면** (현재 확인 필요) 별도 조치 불필요. 있으면 `mode: z.enum(['human', 'agent']).optional()` 한 줄 추가 + `scripts/vibe-gen-schemas.mjs --check` 가 Orchestrator 재검증에서 green 인지 확인 (Generator 는 실행 금지 — sandbox).
- **VibeConfig.mode 타입**: optional union `'human' | 'agent'`. Code 상 소비자가 아직 없으므로 타입 확장이 기존 테스트 breakage 유발할 가능성 낮음. 그러나 `test/config.test.ts` 의 기존 mergeConfig 테스트에서 override 이후 `mode` 값이 예상대로 흐르는지 assertion 1 개 추가 권장.

## Style rules

- **Intent-first**. 구현 pseudocode / 함수 body / regex 상세 작성 금지. 함수 signature 와 의도, 파일 경로, 검증 기준만 명시.
- 핵심 가치 rule (역할 제약 / Sprint loop / sub-agent checkpoint / Codex 위임) **절대 삭제 금지**. Charter 에 반드시 포함.
- Charter 는 20~40 lines 범위 (너무 작으면 self-containment 부족, 너무 크면 entry cost 증가).
- Extensions 는 기존 content 재편성 — 내용 손실 금지. 중복 제거는 Charter 우선.
- `docs/context/*.md` 9 shards 는 **건드리지 마라** — pointer 만 Extensions 에서 보강.
- Codex sandbox preflight 실패 / `npm install` 실패는 **무시하고 계속**. Final report 의 `## Sandbox-only failures` 에 명시만.
- 새 scripts 금지. 기존 `src/lib/review.ts` 확장, 신규 `.mjs` 파일 금지.
- harnessVersion bump 금지 (N2 에서 이미 1.4.1 bump 완료, 본 Sprint 는 append only).
- 단일 commit 원칙 — Orchestrator 가 `vibe-sprint-commit` 으로 Generator 산출 + 3 state 파일 + iteration-history 변경을 한 commit 에 묶는다. iter-3 closure 업데이트는 Generator 가 이 Sprint 에서 함께 수정.

---

## Risk flags (Generator 가 인지하고 기록)

1. **Charter line count 범위 초과 위험** — Charter 에 넣을 내용이 많아 40 lines 넘어가면 (d)/(e)/(f) 를 한 줄로 압축하거나 Extensions pointer 화. 역순으로 20 lines 미만이면 self-containment 부족 — 핵심 가치 4종 rule 을 full sentence 로 풀어 쓰기.
2. **Extensions 재편성 중 중복 rule 잔재** — Charter 에 있는 문장이 Extensions 에도 그대로 남으면 contradict 위험. `grep -c "Orchestrator는 소스코드" CLAUDE.md` 가 3 이상이면 중복 — Charter 에만 1 회, Extensions 에는 근거/확장만 적도록 1~2회로 제한.
3. **mode 분기 로직 유혹** — `VibeConfig.mode` 타입 추가 시 "이왕 하는 김에 interview.mjs 에서 분기하자" 충동 주의. iter-4+ defer. Generator 는 mode 값을 **읽는 코드를 작성하지 않는다**.
4. **iter-3 net LOC 초과 리스크** — N1 -300, N2 +150 가정 시 여유 적음. Extensions 재편성이 delete 우세로 흐르도록 압축 (중복 제거). 초과 시 Charter 에서 (e)/(f) Extensions pointer 화.
5. **iteration-history 업데이트 타이밍** — Generator 가 이 Sprint commit 에 함께 포함해야 함. Orchestrator 가 post-commit 업데이트 금지 (단일 commit 원칙). Generator 가 `completedAt` 을 현재 시각 (`new Date().toISOString()`) 으로 기록할 것.

## Appendix — 직전 Sprint 결과 (2~3줄 요약)

- **N1 (`8c2d2a5`)**: `CLAUDE.md 292→248 lines`. `vibe-rule-audit.mjs` 확장 (transcript scan + tier 판정). `.vibe/audit/iter-3/{rule-audit-report,rules-deleted}.md` 산출 (pending restoration 항목 2개 이상 존재).
- **N2 (`2a229e3`)**: sprint-commit archive staging fix + run-codex success-path status-tick hook + artificial `harnessVersion 1.4.0→1.4.1` bump → auto-tag `v1.4.1` **production 자기 검증 성공**. dogfood8 인계 프롬프트 저장.
- Evaluator 첫 소환 (verdict=partial, blocking=0) 완료. Dangling ref 4개 cleanup 완료.
- 현재 204 tests pass / 0 fail / 1 skip, `harnessVersion 1.4.1`, tags `v1.4.0` + `v1.4.1`.
