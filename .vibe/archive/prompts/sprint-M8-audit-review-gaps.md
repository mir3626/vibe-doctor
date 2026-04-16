# Sprint M8 — Periodic Evaluator audit + /vibe-review skill + harness-gaps ledger

**Sprint ID**: `sprint-M8-audit-review-gaps`
**Target LOC**: ~300 (code ~180 + tests ~80 + docs ~40)
**Dependencies**: M1 (schema `sprintsSinceLastAudit`, `pendingRisks[]`), M3 (sprint-complete flow)
**Prior Sprint result (M7)**: Phase 0 seal + universal README skeleton + bundle-size (opt-in) + browser-smoke (opt-in) + Phase 3 utility opt-in decision flow shipped. 108 pass + 1 skip. Known risk: `/vibe-review` must recognize both opt-in states (bundle/browserSmoke) so missing-opt-in situations surface as review entries.

---

## 1. Intent

이 Sprint는 **프로세스 건강성**을 기계화한다.

- (a) `sprintsSinceLastAudit` 카운터가 threshold 도달 시 `pendingRisks[]` 에 audit-required 엔트리를 자동 주입하고, 명시적 clear 스크립트로만 reset 되도록 life-cycle 확립.
- (b) `/vibe-review` 슬래시 스킬을 도입하여 리뷰 재현성을 확보 — handoff + session-log + git log + pendingRisks + project-decisions 를 **자동 로드**한 뒤 4-tier rubric 으로 issue 목록을 산출.
- (c) `docs/context/harness-gaps.md` ledger 를 도입하여 dogfood 세션에서 드러난 사각지대를 문서화하고, 각 gap 의 **script/hook 커버리지** 진행도를 추적.
- (d) `CLAUDE.md` 에 "규칙 추가 시 script hook 으로 기계 강제를 목표" 선언 + harness-gaps 참조 + `5 Sprints 마다 Evaluator audit` 트리거 매트릭스 섹션 추가.

구현 세부는 Generator 재량이나, 아래 계약은 testable AC 로 강제한다.

---

## 2. Deliverables

### 2.1 Audit counter life-cycle (code)

- **수정**: `scripts/vibe-sprint-complete.mjs`
  - 이미 `sprintsSinceLastAudit++` 및 threshold 도달 시 `audit-${sprintId}` pendingRisk 주입 로직 존재. 유지.
  - pendingRisk id 포맷을 `audit-after-${sprintId}` 로 **변경하여** 의미 명확화. `targetSprint: "*"`, `raisedBy: "vibe-sprint-complete"` 유지.
  - 이미 존재하는 동일 id 엔트리가 open 상태로 남아 있으면 중복 주입 금지 (idempotency).
- **신규**: `scripts/vibe-audit-clear.mjs`
  - CLI: `node scripts/vibe-audit-clear.mjs [--resolve-risks] [--note "<text>"]`
  - 동작: `sprint-status.json.sprintsSinceLastAudit = 0`, 그리고 `--resolve-risks` 지정 시 `pendingRisks` 내 id prefix `audit-after-` 인 open 엔트리를 모두 `resolved` + `resolvedAt` 기록.
  - session-log 에 `- <iso> [audit-clear] resolved=<N> note=<text>` 엔트리 append.
  - `src/lib/sprint-status.ts` 기존 `resetAuditCounter` / `resolvePendingRisk` helper 재사용.
- **수정**: `src/lib/sprint-status.ts`
  - `resetAuditCounter` 은 존재 — 변경 없음.
  - `resolvePendingRisksByPrefix(prefix: string): Promise<number>` 신규 export (resolved count 반환). 기존 `resolvePendingRisk` 와 동일 규칙.

### 2.2 `/vibe-review` skill (신규)

- **신규 파일**: `.claude/skills/vibe-review/SKILL.md` (frontmatter: `name: vibe-review`, `description: 주기적 프로세스 리뷰 드래프트 생성`)
- **자동 로드 대상** (SKILL.md 에 절차로 명시):
  1. `.vibe/agent/handoff.md` — 전체
  2. `.vibe/agent/session-log.md` — 최근 N entries (default N=50, `.vibe/config.json.review.recentEntries` 로 override)
  3. `git log --oneline` — 최근 N commits (default N=20) 또는 마지막 `review-*.md` 이후 범위
  4. `.vibe/agent/sprint-status.json.pendingRisks` (open only)
  5. `.vibe/agent/project-decisions.jsonl` — 전체 (M3 산출)
- **Rubric** (SKILL.md 본문에 고정 문자열로 명시):
  - 🔴 Blocker — process/harness 가 **다음 Sprint 를 못 돌게** 만드는 결함
  - 🟡 Friction — 사용자/Orchestrator 가 **반복적으로 우회**하는 마찰 지점
  - 🟢 Polish — UX 개선, 문구 정비
  - 🔵 Structural — 아키텍처/계약 수준의 장기 개선
- **Issue 엔트리 스키마** (Markdown 표가 아닌 YAML 블록 + bullet 설명):
  ```yaml
  - id: review-<slug>
    severity: blocker|friction|polish|structural
    priority: P0|P1|P2|P3
    proposal: 1~2문장 요약
    estimated_loc: number
    proposed_sprint: 다음 M번호 또는 "backlog"
  ```
- **출력 파일**: `docs/reports/review-<sprintCount>-<YYYY-MM-DD>.md`
  - `<sprintCount>` = `sprint-status.json.sprints.filter(s => s.status==='passed').length`
  - 섹션: `## Inputs loaded`, `## Findings (severity desc)`, `## Suggested next-sprint scope`, `## Links`
- **M7 opt-in 인지 계약** (SKILL.md 내 "Automatic checks" 체크리스트로 강제):
  - `.vibe/config.json.bundle.enabled === false` **이면서** `product.md` / interview seed 의 platform 이 `web|mobile|browser` 중 하나 포함 → 🟡 Friction entry 자동 seed (`proposal: "frontend 프로젝트인데 bundle-size gate 가 opt-in 되지 않음"`)
  - `browserSmoke.enabled === false` + 동일 platform 조건 → 🟡 Friction entry
  - session-log 에 `[decision][phase3-utility-opt-in]` 태그가 최근 N entries 내 존재하면 위 두 entry 는 **skip** (이미 의식적으로 off 한 경우)
- **rubric/automation 테스트 가능성**: SKILL.md 는 "Orchestrator 가 수행" 프로토콜이므로 직접 unit test 대상 아님. 대신 `test/vibe-review-inputs.test.ts` 에서 "auto-load 대상 파일 존재 여부 + opt-in gate 감지 로직" 을 별도 helper (`src/lib/review.ts`) 로 분리하여 테스트.
- **신규**: `src/lib/review.ts` — `collectReviewInputs(root?)`, `detectOptInGaps(config, seed)` 2개 함수만. 각각 순수 함수 or thin I/O wrapper. Orchestrator 가 SKILL 실행 시 이 helper 를 호출하도록 SKILL.md 가 참조.

### 2.3 `docs/context/harness-gaps.md` (신규 ledger)

- 섹션 구조:
  1. `## Purpose` — 알려진 사각지대 추적 + script/hook 커버리지 진행도
  2. `## Entries` — 표 (id / symptom / covered_by / status)
  3. `## Process` — 새 gap 발견 시 어떻게 append 하는지 (3줄)
- **초기 seed entries** (dogfood6 리뷰 및 과거 Sprint 산출물에서 도출 — 정확한 id 목록은 Generator 가 아래 payload 를 그대로 기록):

| id | symptom | covered_by | status |
|---|---|---|---|
| gap-mcp-frozen-pid | ouroboros MCP stale PID 로 Phase 3 인터뷰 기동 실패 (Windows) | `scripts/vibe-interview.mjs` native fallback (M5) | covered |
| gap-windows-cli-path | Windows 에서 `./scripts/run-codex.sh` 가 provider health check 에서 cmd.exe fallback 으로 실패 | `.claude/skills/vibe-init/SKILL.md` Step 2-3 OS 감지 + `run-codex.cmd` (M2) | covered |
| gap-loc-accounting | 커밋 범위 기반 LOC 집계 누락 → sprint 크기 왜곡 | `vibe-sprint-complete.mjs` `actualLoc` 기록 + lastSprintScope (M1/M3) | covered |
| gap-cmd-wrapper-health | Codex wrapper 가 retry·버전·health subcommand 없어 진단 어려움 | `run-codex.sh --health` / `--version` (M2) | covered |
| gap-session-log-ordering | session-log 엔트리 타임스탬프 역순·중복·race 로 손상 | `vibe-session-log-sync.mjs` (M3) | covered |
| gap-audit-cadence | 프로세스 건강성 리뷰 주기 누락 → 사각지대 누적 | `sprintsSinceLastAudit` + `vibe-audit-clear.mjs` + `/vibe-review` (M8) | covered |
| gap-review-reproducibility | 리뷰가 사람 주관 기반 — 입력 재현 불가 | `/vibe-review` 자동 로드 계약 (M8) | partial |
| gap-phase0-commit-forget | Phase 0 산출물 커밋 누락으로 첫 Sprint 가 dirty tree 위에서 시작 | `vibe-phase0-seal.mjs` (M7) | covered |
| gap-opt-in-visibility | bundle/browserSmoke opt-in 미인지로 frontend 프로젝트가 검증 없이 진행 | `/vibe-review` M7 opt-in gate (M8) | partial |
| gap-rule-only-in-md | 규칙이 MD 에만 존재 → Orchestrator 가 잊음 | script hook 명시 — `CLAUDE.md §훅 강제 메커니즘` | open |
| gap-statusline-visibility | Agent 위임 중 Orchestrator 상태 불투명 | M9 대상 | open |
| gap-permission-noise | Agent 위임 시 권한 프롬프트 반복 | M9 permission preset | open |
| gap-integration-smoke | end-to-end meta smoke 부재 | M10 meta-smoke | open |

- **서술 규칙**: `covered` = 관련 script/hook 이 실사용 중 + 테스트 존재. `partial` = 스크립트 존재하나 모든 케이스 커버 X. `open` = 미해결.
- 표 뒤에 "Update protocol" 3줄: (1) 새 gap 발견 시 id `gap-<slug>` append, (2) 해결 Sprint 에서 `covered_by` 갱신, (3) `/vibe-review` 가 이 ledger 를 읽어 `open` 개수를 findings 에 반영.

### 2.4 `CLAUDE.md` 업데이트 (Orchestrator 직접 편집 — 비코드 파일)

Generator 는 CLAUDE.md 를 편집하지 않는다. 본 Sprint 프롬프트의 목적은 **Generator 가 해야 할 일** 만 기술하므로, CLAUDE.md 수정은 이 프롬프트 범위에서 제외한다. Orchestrator 가 Sprint 종료 후 단일 커밋에 포함시킨다. 아래 delta 를 Orchestrator 가 적용할 수 있도록 **파일만** 준비:

- **신규**: `.vibe/agent/claude-md-delta-M8.md` — Orchestrator 가 복사-붙여넣기 할 3개 블록을 담음:
  1. `<!-- BEGIN:HARNESS:hook-enforcement -->` 표 아래 "**원칙**: 스크립트가 FAIL..." 문장 뒤에 한 줄 추가: `규칙을 추가할 때는 MD 문서뿐 아니라 script/hook 으로 기계 강제를 목표로 한다. 미해결 사각지대는 docs/context/harness-gaps.md 에 ledger 로 추적한다.`
  2. `<!-- BEGIN:HARNESS:trigger-matrix -->` 내 `### Evaluator 소환` 뒤에 새 하위섹션: `### Periodic audit — 5 Sprints 마다` + 3줄 설명 (counter 자동 증가 → threshold 도달 시 audit-required pendingRisk 주입 → `/vibe-review` 로 드래프트 산출 → `vibe-audit-clear.mjs` 로 counter reset).
  3. `## 필요할 때만 읽을 문서` 목록 하단에 `- 하네스 사각지대 ledger: docs/context/harness-gaps.md` 추가.
- Orchestrator 가 claude-md-delta-M8.md 를 읽고 CLAUDE.md 에 수동 병합. 병합 완료 시 delta 파일은 삭제. (이 절차는 session-log 에 `[decision]` 태그로 기록.)

### 2.5 Tests

- **신규**: `test/audit-counter.test.ts`
  - case A: `sprintsSinceLastAudit = everyN - 1` 인 상태에서 passed sprint 기록 → counter = everyN + pendingRisks 에 `audit-after-<sprintId>` 1개 주입.
  - case B: 동일 조건에서 중복 호출 → 추가 주입 없음 (idempotent).
  - case C: `vibe-audit-clear --resolve-risks` 호출 → counter = 0, 관련 risk 전부 `resolved`, session-log 에 `[audit-clear]` 엔트리.
- **신규**: `test/vibe-review-inputs.test.ts`
  - `collectReviewInputs` 가 handoff / session-log / decisions / pendingRisks 를 정상 로드.
  - `detectOptInGaps` : (a) web platform + bundle.enabled=false + 최근 decision 없음 → 🟡 entry 반환, (b) 동일 조건 + `[decision][phase3-utility-opt-in]` 존재 → skip, (c) 비-web platform → skip.
- **수정**: 기존 `test/sprint-status.test.ts` — 새 helper `resolvePendingRisksByPrefix` 커버리지 추가 (open entries 만 resolve, count 반환).

### 2.6 Manifest

`.vibe/sync-manifest.json` `files.harness` 배열에 추가:
- `scripts/vibe-audit-clear.mjs`
- `.claude/skills/vibe-review/SKILL.md`
- `src/lib/review.ts`
- `test/audit-counter.test.ts`
- `test/vibe-review-inputs.test.ts`
- `docs/context/harness-gaps.md`

---

## 3. Out of scope (do NOT implement)

- Statusline / token tick / permission preset (M9).
- End-to-end meta-smoke integration test (M10).
- `/vibe-review` 의 rubric 점수화·dashboard (backlog).
- 자동 `vibe-audit-clear` 호출 (명시적 사용자/Orchestrator 트리거 only).

---

## 4. Completion checklist (testable)

- [ ] `npx tsc --noEmit` 0 errors
- [ ] `npm test` — 기존 108 pass 유지 + 신규 `audit-counter.test.ts` + `vibe-review-inputs.test.ts` pass
- [ ] `node scripts/vibe-preflight.mjs` exit 0
- [ ] `node scripts/vibe-audit-clear.mjs --resolve-risks --note "manual smoke"` 실행 시:
  - exit 0
  - `sprint-status.json.sprintsSinceLastAudit === 0`
  - open 상태였던 `audit-after-*` 엔트리가 `resolved`
  - session-log 에 `[audit-clear]` 엔트리 append
- [ ] `.claude/skills/vibe-review/SKILL.md` 존재 + rubric 4종 + opt-in 자동 감지 체크리스트 포함
- [ ] `docs/context/harness-gaps.md` 존재 + 위 13개 seed entry 포함 + Update protocol 3줄
- [ ] `.vibe/agent/claude-md-delta-M8.md` 존재 (Orchestrator 수동 병합용)
- [ ] `sync-manifest.json` 신규 6개 파일 등록 + `vibe:sync --dry-run` (있으면) 에서 `new-file` 로 인식
- [ ] 기존 pendingRisks 내 `audit-sprint-M5-native-interview` / `audit-sprint-M6-pattern-shards` / `audit-sprint-M7-phase0-seal-and-utilities` 는 **레거시 id 포맷** — 본 Sprint 코드는 신규 `audit-after-*` prefix 만 생성하고, 레거시 엔트리는 건드리지 않는다. (legacy migration 은 backlog.)

---

## 5. Invariants (Generator 주의)

- Orchestrator 역할 제약: `.md` / `.json` 중 **Orchestrator 가 직접 편집하는 파일** — `CLAUDE.md`, `sprint-roadmap.md`, `claude-md-delta-M8.md` — 은 Generator 가 수정하지 않는다. 본 Sprint 에서 Generator 가 `claude-md-delta-M8.md` 를 **최초 생성** 하는 것은 허용 (비코드 템플릿 파일).
- `.vibe/agent/sprint-status.json` 은 런타임 state — Generator 가 직접 편집 금지. 로직은 `scripts/*.mjs` + `src/lib/sprint-status.ts` 를 통해서만.
- `docs/context/harness-gaps.md` 는 ledger — seed 데이터를 정확히 기록. 이후 Sprint 에서 `covered_by` 를 append-update 할 수 있도록 표 구조를 단순 유지.

---

## 6. Single-commit discipline

Sprint 종료 시 아래 파일을 **한 커밋** 에 묶는다:
- Generator 산출물: `scripts/vibe-audit-clear.mjs`, `.claude/skills/vibe-review/SKILL.md`, `src/lib/review.ts`, `src/lib/sprint-status.ts` (edit), `scripts/vibe-sprint-complete.mjs` (edit), `test/audit-counter.test.ts`, `test/vibe-review-inputs.test.ts`, `test/sprint-status.test.ts` (edit), `docs/context/harness-gaps.md`, `.vibe/agent/claude-md-delta-M8.md`, `.vibe/sync-manifest.json` (edit)
- Orchestrator 수동 병합 결과: `CLAUDE.md` (3개 delta 적용)
- state 3종: `.vibe/agent/sprint-status.json`, `.vibe/agent/handoff.md`, `.vibe/agent/session-log.md`
- commit message 말미에 `LOC +A/-D (net N)` 요약 포함.
