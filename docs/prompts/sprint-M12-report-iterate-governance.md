# Sprint M12 — Project Report + /vibe-iterate + Agent Reset + Review Regression & Weighted Priority (v1.3.0)

## 배경

v1.2.1 까지 하네스 진화 완료 (131 pass / 1 skip, Ouroboros 완전 제거). 본 Sprint 는 **사용자가 지시한 5개 요구사항** 을 단일 minor 릴리스(v1.3.0) 로 묶어 하네스 governance 층을 완성한다:

1. Sprint 완료 시 user-friendly HTML 프로젝트 보고서 자동 생성 + 브라우저 자동 오픈 (하네스 리뷰 콘텐츠 제외).
2. `/vibe-iterate` — 최초 기획된 sprint 전부 종료 후 report + handoff 기반으로 인터뷰 단계부터 차등 재기획.
3. `.vibe/agent/` 를 init 상태로 reset (메타-프로젝트 역사 제거).
4. `/vibe-review` regression 검증 — 이전 review 가 제안한 이슈가 현재 버전에서 커버됐는지.
5. 모든 review finding 에 `agent_friendly(10) / token_efficient(5) / user_fyi(1)` 가중치 priority + script-wrapper 지향.

**유지 철학**: downstream 프로젝트(웹/모바일/데이터/CLI/하드웨어 어느 도메인이든)에서 그대로 작동해야 함. 하네스 리뷰 filter 는 이 메타-프로젝트에서만 동작하고, downstream 에서는 모든 sprint 가 "project" 카테고리로 취급된다.

---

## 범위 요약

- **총 예상 LOC**: ~900 (report ~300 + iterate ~200 + review 확장 ~150 + reset ~50 + migration ~80 + 테스트 ~150)
- **파일 총 개수**: ~20 (신규 스크립트 2 + skill 1 + lib 1 + 확장 파일 6 + reset 대상 7 + 테스트 4)
- **단일 Sprint**: 모든 5개 요구사항 한 번에 반영 후 v1.3.0 태깅.

---

## 요구 1 — Project report generator + 자동 브라우저 실행

### 1.1 `scripts/vibe-project-report.mjs` (신규, ~300 LOC)

**역할**: 프로젝트 현재 상태를 시각적 HTML 한 페이지로 렌더링하고 기본 브라우저로 연다. 하네스 운영 노이즈는 숨기고 "내 프로젝트가 어디까지 왔는지" 만 보여준다.

**입력 소스** (존재 시에만 로드, 누락은 graceful default):

- `docs/context/product.md` — 프로젝트명, one-liner, platform
- `docs/plans/sprint-roadmap.md` — 전체 계획된 Sprint 목록
- `docs/plans/project-milestones.md` (요구 2 에서 신규 생성) — 마일스톤 정의
- `.vibe/agent/sprint-status.json` — passed sprints + pendingRisks + LOC
- `.vibe/agent/session-log.md` — `[decision]` / `[discovery]` 태그 항목 + iteration markers
- `.vibe/agent/handoff.md` — 현재 상태 스냅샷
- `.vibe/agent/iteration-history.json` (요구 2 신규) — iteration 타임라인
- `git log --oneline -200` — 최근 커밋 메시지 (filter 후 사용)

### 1.2 Filter rules (critical — 하네스 리뷰 제외 전략)

"이 저장소가 메타-프로젝트인가 downstream 사용자 프로젝트인가" 를 구분하는 heuristic 을 **단일 함수 `isMetaProject()`** 로 고립. 판정 기준:

- `.vibe/config.json.project?.kind === "meta"` 가 true, **또는**
- `package.json.name === "vibe-doctor"`, **또는**
- `docs/plans/sprint-roadmap.md` 파일명 기반 프로젝트 이름이 "vibe-doctor" 로 시작

메타 프로젝트일 때 **제외 규칙**:

- session-log entries 중 tag 가 `[harness-review]`, `[meta-sprint-complete]`, `[sprint-complete]` 인 것은 sprint 라인 외에는 감춤.
- sprint id 가 정규식 `^sprint-M\d+`, `^self-evolution-`, `^harness-`, `^v\d+\.` 인 경우 "meta sprint" 로 분류 → HTML 섹션 5 (핵심 결정) 에서만 요약으로 표시, 섹션 4 (Sprint 별 산출) 에서는 숨김.
- commit 메시지가 `docs(process)`, `chore(harness)`, `refactor(process)`, `docs(sprint):` prefix 로 시작하면 "프로젝트 산출" 목록에서 제외.

Downstream 프로젝트에서는 `isMetaProject() === false` 이므로 **모든 sprint 가 그대로 노출**.

Intent: 요구 1 의 "프로젝트 관련 내용만" 을 이 함수 하나로 달성. Planner 가 filter 로직을 모듈화해 downstream 프로젝트에서 실수로 가려지지 않도록 보장.

### 1.3 HTML 구조 (dogfood5 디자인 계승)

참조: `C:\Users\Tony\Workspace\dogfood5\docs\reports\vibe-init-process-report.html` 의 색감/타이포그래피/카드 레이아웃을 따른다. **외부 CDN 금지** — 모든 CSS 는 `<style>` 태그에 inline, 폰트는 system-ui stack. 자바스크립트는 필요시에만 (타임라인 토글 등) inline.

섹션 순서:

1. **프로젝트 개요** — 프로젝트명(H1), one-liner(subtitle), 최종 상태 뱃지(idle / in-progress / iteration-N-in-progress), 생성일·최종 수정일.
2. **Iteration 타임라인** — `iteration-history.json.iterations[]` 를 수평 스텝퍼로 렌더. 각 iteration 클릭 시 해당 iteration 의 sprint 목록 토글.
3. **마일스톤 진척도** — `project-milestones.md` 의 `{id, name, target_iteration, progress_metric}` 을 progress bar 로. progress 계산은 `src/lib/iteration.ts` 의 `computeMilestoneProgress()` 사용.
4. **Sprint 별 산출 요약 (현재 iteration)** — 카드 그리드. 각 카드: sprint id, name, 목표 한 줄, 실제 LOC, completedAt, status 뱃지.
5. **핵심 결정** — Phase 3 인터뷰 seed summary (product.md 에서 발췌) + session-log 의 `[decision]` 태그 항목 중 메타가 아닌 것.
6. **테스트 / 빌드 / 배포 상태** — `package.json.scripts` 중 `test`, `build`, `lint` 결과 요약 (Optional — 파일 기반 최신 결과가 없으면 "run `npm test`" 안내 텍스트).
7. **다음 단계 권장** — 모든 계획 sprint 완료 시 `/vibe-iterate` 사용 안내 박스, iteration 중이면 현재 sprint 다음 단계, idle 이면 `/vibe-init` 재실행 안내.

각 섹션은 `<section data-section="overview">` 형태로 감싸 추후 테스트에서 Dom query 로 검증 가능하도록.

### 1.4 브라우저 자동 오픈

`process.platform` 분기:

- `win32` → `spawn('cmd', ['/c', 'start', '""', outPath], { detached: true, stdio: 'ignore' })`
- `darwin` → `spawn('open', [outPath], { detached: true, stdio: 'ignore' })`
- 그 외 (linux) → `spawn('xdg-open', [outPath], { detached: true, stdio: 'ignore' })`

실패하거나 `--no-open` 플래그 시 최종 경로만 stdout 에 출력 후 **exit 0**. 절대 터미널을 블록하지 않는다 (detached + stdio: 'ignore').

### 1.5 CLI 계약

```
node scripts/vibe-project-report.mjs [--no-open] [--output <path>] [--verbose]
```

- default output: `docs/reports/project-report.html`
- `--verbose` 시 stderr 에 어떤 filter 가 적용됐는지 (`meta-project=true/false, excluded sprints=N, excluded commits=N`) 출력.

### 1.6 `vibe-sprint-complete.mjs` 확장 — auto trigger

마지막 sprint 감지 로직:

- `docs/plans/sprint-roadmap.md` 의 `parseRoadmapSprintIds()` 결과 `roadmapSprintIds` 배열 획득
- 방금 완료된 `sprintId` 가 `roadmapSprintIds` 의 **마지막 원소** 이고 **passed** 이면 자동 트리거.
- iteration-history.json 에 현재 iteration 의 모든 plannedSprints 가 completed 인지 추가 확인.

자동 호출:

```js
spawnSync(process.execPath, [resolve('scripts/vibe-project-report.mjs')], { stdio: 'inherit' });
```

`--no-auto-report` CLI 플래그로 억제 가능. 중간 sprint 완료 시에는 report 생성 안 함 (intent: 각 sprint 완료마다 브라우저가 팝업되면 피로).

---

## 요구 2 — `/vibe-iterate` 명령 + iteration tracking

### 2.1 `.claude/skills/vibe-iterate/SKILL.md` (신규)

구조는 `vibe-init/SKILL.md` 와 유사하되 **차등 인터뷰** 가 핵심. 5 Phase:

- **Phase 0 — Prior iteration 로드**: report.html + handoff.md + session-log.md 최근 N + project-milestones.md + sprint-roadmap.md + iteration-history.json 모두 자동 로드. Orchestrator 가 직전 iteration 의 goal, 달성 항목, 미해결 항목을 3~5 bullet 로 요약.
- **Phase 1 — 차등 인터뷰**: `scripts/vibe-interview.mjs --mode iterate --carryover <prior-iter-id>` 실행. 기존 답변 재확인 질문 1~2개 + 미해결 dimension 집중 probing + 신규 목표 수집 (이번 iteration 에서 무엇을 추가/변경/제거할지).
- **Phase 2 — 새 Sprint 로드맵**: 기존 `sprint-roadmap.md` 를 **덮어쓰지 않고** 새 섹션을 append. 섹션 헤더: `## Iteration N: <label>` 후 동일 포맷의 sprint 블록. `<!-- BEGIN:VIBE:CURRENT-SPRINT -->` 포인터 블록은 새 iteration 의 첫 sprint 로 업데이트.
- **Phase 3 — Sprint 실행**: 기존 프로세스 그대로 (Planner 소환 → Generator 위임 → 검증 → sprint-complete).
- **Phase 4 — Completion**: 이번 iteration 완료 시 `iteration-history.json.iterations[].completedAt` 설정 + summary 2~3 문장 작성 + report 재생성 (타임라인 누적).

### 2.2 `scripts/vibe-interview.mjs` 확장 — `--mode iterate` 옵션

- 추가 플래그: `--mode <init|iterate>` (기본 `init`), `--carryover <iteration-id>`.
- iterate 모드일 때:
  - carryover iteration 의 seed (prior decisions, deferred dimensions, unresolved ambiguities) 를 synthesizer prompt 의 새 섹션 `## Prior iteration carryover` 로 주입.
  - ambiguity 계산은 "기존 답변 중 여전히 유효한 것" 을 starting coverage 로 취급 → 재질문은 **미해결 + 신규** dimension 만.
  - max-rounds 기본값을 더 낮게 (15) 잡아 iteration 인터뷰가 초기보다 빨리 수렴하도록.
- 기존 init 모드 동작은 **완전히 불변** (backward compat 강제).

### 2.3 `.vibe/agent/iteration-history.json` (신규 상태 파일)

```json
{
  "$schema": "./iteration-history.schema.json",
  "currentIteration": "iter-1",
  "iterations": [
    {
      "id": "iter-1",
      "label": "프로토타입",
      "startedAt": "ISO",
      "completedAt": "ISO|null",
      "goal": "한 줄 요약",
      "plannedSprints": ["sprint-01-engine-core"],
      "completedSprints": [],
      "milestoneProgress": { "prototype": 0 },
      "summary": ""
    }
  ]
}
```

- schema 파일 `.vibe/agent/iteration-history.schema.json` 도 함께 생성 (additionalProperties 허용 + 위 필드 required).
- 미존재 시 graceful default: `{ currentIteration: null, iterations: [] }` 반환.

### 2.4 `docs/plans/project-milestones.md` (신규 템플릿 — vibe-init Phase 3 가 생성)

```md
# Project Milestones

> 각 마일스톤은 여러 iteration 에 걸쳐 진척될 수 있다.

## Milestones

- **prototype** — target_iteration=`iter-1`, progress_metric=`sprint_complete_ratio`
  - 정의: 최소 기능이 한 번 end-to-end 로 동작하는 상태.
- **beta** — target_iteration=`iter-2`, progress_metric=`feature_coverage`
  - 정의: 핵심 사용자 플로우 3개 이상.
- **release** — target_iteration=`iter-3`, progress_metric=`passing_tests_ratio`
  - 정의: CI green + 문서 완료.
```

- vibe-init Phase 3 말미에 파일이 없으면 위 스켈레톤을 생성. 사용자가 직접 수정 가능.
- `src/lib/iteration.ts` 의 파서가 읽어 UI 에 표시.

### 2.5 `src/lib/iteration.ts` (신규, ~80 LOC)

```ts
export interface IterationEntry { /* 위 JSON 스키마 그대로 */ }
export interface IterationHistory { currentIteration: string | null; iterations: IterationEntry[]; }

export async function readIterationHistory(root?: string): Promise<IterationHistory>;
export async function writeIterationHistory(history: IterationHistory, root?: string): Promise<void>;
export async function startIteration(input: { id: string; label: string; goal: string; plannedSprints: string[] }, root?: string): Promise<IterationEntry>;
export async function recordSprintCompletion(sprintId: string, root?: string): Promise<void>;
export async function completeIteration(summary: string, root?: string): Promise<IterationEntry>;
export function computeMilestoneProgress(history: IterationHistory, milestones: Milestone[]): Record<string, number>;
```

구현 원칙:

- 모든 async 함수는 `readJson/writeJson` helper 재사용.
- `computeMilestoneProgress` 는 순수 함수 (no IO) — 테스트 용이성.
- progress_metric 이 `sprint_complete_ratio` 면 `completedSprints.length / plannedSprints.length`, `feature_coverage`/`passing_tests_ratio` 는 일단 0 반환 (향후 확장 포인트).

### 2.6 Context isolation 유지 전략

- 각 iteration 의 **Sprint 실행 자체는 기존 Planner fresh context 방식 그대로**. iteration 정보가 Planner context 를 오염시키지 않도록, Planner 에 전달하는 입력은 여전히 `product.md + architecture.md + sprint-roadmap.md 해당 slot + 직전 sprint 2~3줄 요약`. iteration-history 는 전달하지 않는다.
- 사용자가 "전체 build-up 을 follow-up" 하는 장치는 **report.html + iteration-history.json** 두 파일이 single source of truth. Orchestrator 는 iteration 경계에서만 이들을 갱신하고, Sprint 내부에서는 touch 하지 않는다.
- Intent: sub-agent 의 context isolation(품질 담보) 과 사용자의 거시 시야(follow-up) 를 각각 다른 레이어에서 해결.

---

## 요구 3 — `.vibe/agent/` init 상태로 reset

본 Sprint 의 일부로 **수동 파일 편집** 으로 수행 (migration 스크립트에 포함하지 않음 — downstream 프로젝트 데이터 보호). 메타 프로젝트만 대상.

### 3.1 유지 파일 (touch 하지 않음)

- `.vibe/agent/README.md`
- `.vibe/agent/_common-rules.md`
- `.vibe/agent/re-incarnation.md`
- `.vibe/agent/sprint-status.schema.json`
- `.vibe/agent/project-map.schema.json`
- `.vibe/agent/sprint-api-contracts.schema.json`
- `.vibe/agent/iteration-history.schema.json` (본 Sprint 에서 신규 생성)

### 3.2 Reset 대상 (template-default 내용으로 교체)

- **`handoff.md`** — placeholder 버전:
  - `## 1. Identity` — branch/working dir placeholder
  - `## 2. Status: IDLE - no sprint started` (history 섹션은 빈 표 헤더만)
  - `## 3. 완료된 Sprint 이력` — 표 헤더만
  - `## 4. 산출물` — 섹션은 있지만 비어있음 주석: `<!-- Sprint 완료 시 채워짐 -->`
  - `## 5. Next action` — "Phase 0 (`/vibe-init`) 또는 iteration (`/vibe-iterate`) 실행"
  - `## 6. 이월된 P1/P2` — 빈 섹션
  - `## 7. 사용자 합의 상태 (영속)` — 빈 섹션

- **`session-log.md`** — `## Entries` 섹션까지만 유지, 본문 + `## Archived (*)` 섹션 전부 삭제.

- **`sprint-status.json`** — 필드별:
  ```json
  {
    "$schema": "./sprint-status.schema.json",
    "schemaVersion": "0.1",
    "project": { "name": "vibe-doctor", "createdAt": "<existing-or-now>", "runtime": "node24", "framework": "claude-code-template" },
    "sprints": [],
    "verificationCommands": [
      { "id": "vibe-preflight", "command": "node scripts/vibe-preflight.mjs", "expectExitCode": 0, "runOutsideSandbox": false },
      { "id": "vibe-checkpoint", "command": "node scripts/vibe-checkpoint.mjs", "expectExitCode": 0, "runOutsideSandbox": false }
    ],
    "sandboxNotes": [],
    "handoff": { "currentSprintId": "idle", "lastActionSummary": "vibe-doctor harness reset to init state", "openIssues": [], "orchestratorContextBudget": "low", "preferencesActive": ["ko-informal"], "handoffDocPath": ".vibe/agent/handoff.md", "updatedAt": "<now>" },
    "pendingRisks": [],
    "lastSprintScope": [],
    "lastSprintScopeGlob": [],
    "sprintsSinceLastAudit": 0,
    "stateUpdatedAt": "<now>"
  }
  ```
  - `verificationCommands` 2개는 보존 (preflight/checkpoint 는 하네스 상수).

- **`project-map.json`** → `{ "$schema": "./project-map.schema.json", "updatedAt": "<now>", "modules": {}, "activePlatformRules": [] }`
- **`sprint-api-contracts.json`** → `{ "$schema": "./sprint-api-contracts.schema.json", "updatedAt": "<now>", "contracts": {} }`
- **`project-decisions.jsonl`** → 빈 파일.
- **`tokens.json`** → `{ "updatedAt": "<now>", "cumulativeTokens": 0, "elapsedSeconds": 0, "sprintTokens": {} }`

### 3.3 삭제 대상

- `.vibe/agent/claude-md-delta-M8.md` — 임시 보조 파일 (실제 존재 확인 후 삭제).
- `.vibe/archive/prompts/` 하위 메타 Sprint 산출 prompts — 유지 (git history 로 충분). 삭제 불필요.

### 3.4 docs/plans 리셋

- `docs/plans/sprint-roadmap.md` — 메타 roadmap 은 **보존** (v1.2.0 역사 레코드). 단 `<!-- BEGIN:VIBE:CURRENT-SPRINT -->` 블록은 `Current: idle / Completed: — / Pending: —` 로 리셋.
- `docs/plans/project-milestones.md` — 본 Sprint 에서 신규 생성 (2.4 템플릿).

Intent: 메타-진화 흔적은 git history + release notes 에 남기고, 런타임 상태만 "새 프로젝트" 출발점으로 돌린다. 메타 프로젝트를 downstream 프로젝트처럼 "첫 iteration 시작" 할 수 있도록.

---

## 요구 4 — `/vibe-review` regression 검증

### 4.1 `src/lib/review.ts` 확장

신규 export:

```ts
export interface PriorReviewIssue {
  id: string;
  severity: 'blocker' | 'friction' | 'polish' | 'structural';
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  proposal: string;
  sourceReportPath: string;
  sourceReportDate: string;
}

export interface RegressionStatus {
  issue: PriorReviewIssue;
  status: 'covered' | 'partial' | 'open';
  evidence: string[]; // git commit hashes, file paths, harness-gaps entry ids
}

export async function loadPriorReviewIssues(root?: string): Promise<PriorReviewIssue[]>;
export async function assessRegression(issues: PriorReviewIssue[], root?: string): Promise<RegressionStatus[]>;
export function computeRegressionCoverage(statuses: RegressionStatus[]): { covered: number; partial: number; open: number; score: number };
```

**`loadPriorReviewIssues` 구현**:

- `docs/reports/` 에서 `review-*.md` 파일 전부 스캔 (최신순 정렬).
- 각 파일에서 `## Findings` 섹션의 YAML 블록들을 파싱 → `{id, severity, priority, proposal}` 추출.
- 중복 id 는 최신 report 의 것만 유지 (한 이슈가 여러 review 에 반복 등장하면 최신 상태 기준).

**`assessRegression` 구현** (3 signal 조합):

1. **git log 검색**: `git log --all --grep=<issue.id>` 로 커밋 메시지에 issue id 언급 여부. 1+ 개 매치 → partial signal.
2. **harness-gaps ledger**: `docs/context/harness-gaps.md` 에서 issue.id 또는 proposal 의 핵심 키워드(2 단어 이상)가 표 row 에 등장하고 status 컬럼이 `covered` 면 covered signal.
3. **sync-manifest 파일 존재**: issue.proposal 이 스크립트/파일 경로를 언급하면 (`scripts/vibe-*.mjs` 패턴 추출), 해당 경로가 실제 존재하는지 확인. 존재 → covered signal.

판정 규칙:

- covered signal ≥ 1 AND git signal ≥ 1 → **covered**
- covered signal ≥ 1 OR git signal ≥ 1 → **partial**
- 둘 다 없음 → **open**

`evidence[]` 에 매치된 git 커밋 hash, 파일 경로, harness-gaps row 를 저장.

**`computeRegressionCoverage`**:

```
score = covered.length / issues.length  // 0 when issues.length === 0
```

returns `{ covered, partial, open, score }` — HTML/MD 렌더링에 바로 사용.

### 4.2 `.claude/skills/vibe-review/SKILL.md` 확장

"## Report Shape" 의 섹션 목록에 추가:

```md
5. `## 🔁 Regression (Prior Reviews)`
   - 각 prior issue 를 bullet 로: `- [✅ covered | ⚠️ partial | ❌ open] <id>: <proposal 한 줄> (evidence: <3개까지>)`
   - 상단에 coverage score 요약 1줄: `Coverage: <covered>/<total> (<score%>)`
```

Protocol 섹션에 helper 호출 추가:

```bash
node --import tsx -e "import { loadPriorReviewIssues, assessRegression, computeRegressionCoverage } from './src/lib/review.ts'; const issues = await loadPriorReviewIssues(); const statuses = await assessRegression(issues); const cov = computeRegressionCoverage(statuses); console.log(JSON.stringify({ statuses, cov }, null, 2));"
```

- `loadPriorReviewIssues` 결과가 비어있으면 섹션 생략 (첫 review 에서는 regression 없음).
- 파싱 실패한 파일은 `## Inputs loaded` 에 warning 으로 기록.

Intent: 하네스 진화의 피드백 루프 폐쇄. 이전 review 가 제안한 것을 다음 review 가 점수화 → 망각 방지.

---

## 요구 5 — 가중치 priority + script-wrapper 지향

### 5.1 `src/lib/review.ts` 에 `computePriorityScore()` 추가

```ts
export interface IssueWeights {
  agentFriendly: number;   // 0~5, 에이전트가 기계적으로 재사용 가능한 정도
  tokenEfficient: number;  // 0~5, 토큰 절감 기여
  userFyi: number;         // 0~5, 사용자가 직접 인지해야 하는 정도
}

export function computePriorityScore(weights: IssueWeights): number {
  return 10 * weights.agentFriendly + 5 * weights.tokenEfficient + 1 * weights.userFyi;
}
```

- 입력 검증: 각 값 0~5 정수. 범위 밖이면 throw.
- 최대값: 10·5 + 5·5 + 1·5 = **80**.
- 순수 함수, no IO — 테스트 용이.

### 5.2 `vibe-review` SKILL.md rubric 업데이트

"## Findings Format" 의 YAML 블록에 필드 추가:

```yaml
- id: review-<slug>
  severity: blocker|friction|polish|structural
  priority: P0|P1|P2|P3
  weights: { agent_friendly: 0-5, token_efficient: 0-5, user_fyi: 0-5 }
  priority_score: <computed>
  proposal: 1~2문장 요약
  recommended_approach: script-wrapper|md-rule|config-default|user-action
  estimated_loc: number
  proposed_sprint: 다음 M번호 또는 "backlog"
```

- Orchestrator 가 weights 를 채우면 `priority_score` 는 `computePriorityScore(weights)` 로 계산.
- `recommended_approach` 기본값 권장: **`script-wrapper` 우선 검토** — MD 규칙으로만 해결 가능한지 먼저 보지 말고, "스크립트가 기계 검증할 수 있는가?" 를 먼저 물은 뒤 불가능할 때만 md-rule.

Rubric 에 한 줄 추가:

```md
## Approach preference (신규)

- **script-wrapper** 가 가능한지 먼저 검토. 스크립트 hook / preflight / stop-gate / sprint-complete 확장으로 기계 강제 가능한 규칙은 MD 에만 쓰지 말 것.
- MD 규칙은 script 로 강제할 수 없는 계약(철학, 권장 패턴) 에만 사용.
- weights.agent_friendly 가 높을수록 script-wrapper 후보. user_fyi 만 높으면 문서/UI 안내.
```

### 5.3 정렬 규칙

report 의 `## Findings` 섹션은 **priority_score 내림차순** 으로 정렬. 동점이면 severity → priority → id 순.

Intent: 하네스 governance 에서 "규칙이 MD 에만 남아 Orchestrator 가 까먹는" 안티패턴을 review 단계에서 적극 차단. 가중치로 우선순위 정렬 → 제한된 sprint 용량에서 agent-friendly 개선이 먼저 반영되도록.

---

## Contract (backward compatibility)

- **불변**: 기존 `vibe-sprint-complete.mjs` / `vibe-review` / `vibe-interview.mjs` 동작. 추가 동작은 opt-in 플래그 또는 감지 후 자동 (마지막 sprint / iterate 모드).
- **HTML**: self-contained, 외부 CDN/font/script 없음.
- **브라우저 open**: 실패해도 exit 0. stderr 경고만.
- **iteration-history**: 미존재 시 graceful default.
- **review.ts**: 기존 `collectReviewInputs` / `detectOptInGaps` 시그니처 유지. 신규 함수만 추가.

## 테스트

### `test/project-report.test.ts`

- 빈 iteration-history + 빈 sprint-status 로 렌더 → 모든 섹션 placeholder 로 존재.
- 메타 프로젝트 flag true 시 `sprint-M*` sprint 가 카드 섹션에서 제외되는지 DOM query 로 검증.
- downstream 시나리오 (isMetaProject=false) 에서 모든 sprint 가 노출되는지.
- `--no-open` 플래그 시 브라우저 spawn 호출 안 일어남 (spawn mock).
- 생성된 HTML 이 self-contained 인지 (`<link href="http`, `<script src="http` 부재 검증).

### `test/iteration.test.ts`

- `startIteration` 후 `readIterationHistory().currentIteration` 매치.
- `recordSprintCompletion` 이 `completedSprints` 에 중복 없이 append.
- `completeIteration` 이 `completedAt` + `summary` 세팅.
- `computeMilestoneProgress` — `sprint_complete_ratio` 공식 경계값 (0 sprints, 모두 완료, 부분 완료).

### `test/review-regression.test.ts`

- tmp 디렉토리에 `docs/reports/review-1-2026-04-01.md` fixture (2 개 issue) 생성.
- `loadPriorReviewIssues` 가 YAML 블록 정확히 파싱.
- `assessRegression` — mock git log / mock harness-gaps.md 로 covered/partial/open 각 케이스 검증.
- `computeRegressionCoverage` — 0 issues, all covered, mixed 케이스.

### `test/review-priority.test.ts`

- `computePriorityScore({ agentFriendly:5, tokenEfficient:5, userFyi:5 })` === 80.
- 경계값 (0/0/0, 범위 밖 throw).
- 단조성: agent_friendly 증가 시 score 증가.

모든 테스트는 기존 `node --import tsx --test test/*.test.ts` 러너로 실행.

## 릴리스

### `package.json`

- `"harnessVersion"`: `"1.3.0"` (실제 필드는 `.vibe/config.json`, package.json 은 `version` 참고 용도만).
- scripts 추가:
  - `"vibe:project-report": "node scripts/vibe-project-report.mjs"`
  - `"vibe:iterate": "echo use /vibe-iterate slash command"` (문서용 placeholder)

### `.vibe/config.json`

- `harnessVersion`: `"1.3.0"`.
- 신규 `review.weights` 기본값 (선택적):
  ```json
  "review": { "recentEntries": 50, "weights": { "agentFriendly": 10, "tokenEfficient": 5, "userFyi": 1 } }
  ```

### `migrations/1.3.0.mjs` (신규, ~80 LOC)

- `iteration-history.json` seed (미존재 시만 — existing project 데이터 보호).
- `.vibe/config.json.review.weights` 주입 (미존재 시만).
- `.vibe/agent/` reset 은 **migration 에서 수행하지 않음** — 파괴적이므로 본 Sprint 가 메타 프로젝트에서만 수동으로 수행. downstream 은 v1.3.0 sync 시 agent 파일 건드리지 않음.
- migration은 idempotent.

### `docs/release/v1.3.0.md` (신규)

- 개요 한 단락: "Project HTML report + iteration tracking + review governance."
- 업그레이드 경로: `npm run vibe:sync`.
- 신규 기능 bullet 5개 (요구 1~5).
- breaking change: **없음**.

### `sync-manifest.json` 업데이트

- `files.harness` 에 신규 파일 추가:
  - `scripts/vibe-project-report.mjs`
  - `.claude/skills/vibe-iterate/SKILL.md`
  - `src/lib/iteration.ts`
  - `.vibe/agent/iteration-history.schema.json`
  - `migrations/1.3.0.mjs`
  - `test/project-report.test.ts`, `test/iteration.test.ts`, `test/review-regression.test.ts`, `test/review-priority.test.ts`
  - `docs/release/v1.3.0.md`
- `files.project` 에 추가:
  - `.vibe/agent/iteration-history.json`
  - `docs/plans/project-milestones.md`
- `migrations."1.3.0"` → `"migrations/1.3.0.mjs"`.

### `CLAUDE.md` 업데이트

- `hook-enforcement` 표에 추가 행:
  - `| 마지막 Sprint 완료 시 | scripts/vibe-project-report.mjs | HTML 프로젝트 보고서 자동 생성 + 브라우저 오픈 |`
- `관련 스킬` 줄에 `/vibe-iterate` 추가.
- 신규 섹션 (optional): `<!-- BEGIN:HARNESS:iteration -->` 마커로 iteration 개념 1 단락 설명.

### `README.md` 업데이트

- Features 섹션에 "HTML 프로젝트 보고서 + iteration tracking" 추가.
- "How to iterate" 짧은 섹션 추가 (`/vibe-iterate` 사용법 3 step).

---

## Generator 위임 지침

- **코드 파일**: `scripts/vibe-project-report.mjs`, `src/lib/iteration.ts`, `scripts/vibe-interview.mjs` 확장 부분, `src/lib/review.ts` 확장 부분, `scripts/vibe-sprint-complete.mjs` 자동 트리거 블록, 테스트 4개, `migrations/1.3.0.mjs`. **Generator (Codex CLI) 위임** (`Bash("cat ... | ./scripts/run-codex.sh -")`).
- **비코드 파일**: `.claude/skills/vibe-iterate/SKILL.md`, `.claude/skills/vibe-review/SKILL.md` 업데이트, `docs/plans/project-milestones.md` 템플릿, `docs/release/v1.3.0.md`, `CLAUDE.md`, `README.md`, `sync-manifest.json`, `.vibe/config.json`. **Orchestrator 직접 편집** 가능.
- **`.vibe/agent/` reset 7개 파일 + schema 1개**: Orchestrator 직접 편집 (JSON/MD/empty).

단계 분할 (5개 파일/step 제약 준수):

- **Step 1**: `src/lib/iteration.ts` + `iteration-history.schema.json` + `test/iteration.test.ts` + `migrations/1.3.0.mjs` (4 파일)
- **Step 2**: `scripts/vibe-project-report.mjs` + `test/project-report.test.ts` + `vibe-sprint-complete.mjs` 확장 + `sync-manifest.json` (4 파일)
- **Step 3**: `src/lib/review.ts` 확장 + `test/review-regression.test.ts` + `test/review-priority.test.ts` (3 파일)
- **Step 4**: `scripts/vibe-interview.mjs` iterate 모드 확장 (1 파일)
- **Step 5**: Orchestrator 직접 편집 — 스킬 MD, 문서, config, agent reset (일괄)

각 step 후 `npx tsc --noEmit` + `node --import tsx --test test/*.test.ts` 실행 → green 확인 후 다음 step.

---

## 완료 체크리스트 (Orchestrator self-QA)

- [ ] `npx tsc --noEmit` exit 0
- [ ] `node --import tsx --test test/*.test.ts` — 기존 131 pass 유지 + 신규 테스트 4 파일 모두 pass (총 ~140 pass 예상)
- [ ] `node scripts/vibe-preflight.mjs` exit 0
- [ ] `node scripts/vibe-project-report.mjs --no-open` → `docs/reports/project-report.html` 생성 + self-contained (외부 URL 없음)
- [ ] `node scripts/vibe-interview.mjs --mode iterate --carryover iter-0 --dry-run` — 기존 init 모드 회귀 없음 (별도 테스트로 확인)
- [ ] `docs/plans/project-milestones.md` 생성 + 파서로 읽힘
- [ ] `.vibe/agent/iteration-history.json` 기본값 생성 + schema 준수
- [ ] `.vibe/agent/` reset 완료 (handoff.md placeholder, session-log.md 빈 Entries, sprint-status.json sprints[] 빈 배열, 나머지 파일 template-default)
- [ ] `/vibe-review` regression 섹션 렌더 — 기존 review 미존재 케이스에서도 skill 이 graceful 동작
- [ ] `.vibe/config.json.harnessVersion === "1.3.0"`
- [ ] `sync-manifest.json` 신규 파일 전부 등록, `--dry-run` 검증 통과
- [ ] `docs/release/v1.3.0.md` 존재

---

## 범위 밖 (defer to later)

- iteration 의 실제 사용자 플로우 검증은 M13+ 에서 downstream 프로젝트로 dogfood.
- HTML 디자인 개선 (v1.3 은 기본 템플릿 제공 수준 — 사용자 피드백 받은 후 v1.4 에서 정제).
- milestone progress_metric 확장 (`feature_coverage`, `passing_tests_ratio`) — 본 Sprint 는 `sprint_complete_ratio` 만 실제 계산, 나머지는 0 반환 확장 포인트.
- CI 자동화에서 report 생성 훅 — 로컬 dogfood 확정 후.

## 리스크 (1 건)

**Meta project detection false negative** — `isMetaProject()` 가 downstream 프로젝트를 잘못 메타로 판정하면 사용자 sprint 가 report 에서 대거 누락되어 "프로젝트 진척이 사라진 것처럼" 보인다. 완화: (a) 3 signal (config kind / package name / roadmap 파일 first header) 모두 일치해야 true 로 하드닝, (b) `--verbose` 플래그로 "meta-project=true/false" 를 stdout 에 명시, (c) 테스트에서 downstream fixture (package.name=arbitrary, config.kind 부재) 로 false 가 나오는지 강제 검증.
