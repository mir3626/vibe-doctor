# Sprint O3 — Planner Contract Polish + Commit LOC Hygiene + iter-3 Carryover Closure

- **Sprint id**: `sprint-O3-planner-contract-polish`
- **Iteration**: iter-4 (final slot)
- **Goal**: Review-6 P2/P3 수습 — Planner 공용 체크리스트에 component-integration 계약 3항목 삽입, `vibe-sprint-commit.mjs` actualLoc 계산에 lockfile basename blacklist 추가, iter-3 pending restoration 4건 delete 확정 기록 + v1.4.2 release note 보강.
- **LOC budget**: add ≤ 50 (strict). doc/test 위주, 신규 script 금지.
- **Mode**: Orchestrator 샌드박스 밖 검증. `run-codex.sh` wrapper verify skip 자동 적용.

## Rules (공용)

`(공용 규칙은 `.vibe/agent/_common-rules.md` 준수)` — 특히 §10 Role constraint / §14 Wiring Integration Checklist. 아래는 본 Sprint 추가 규칙.

- 신규 script 생성 절대 금지. 기존 파일 편집만.
- 신규 deps 금지. 테스트는 `node:test` + `node:assert/strict` 기반 (기존 프로젝트 패턴).
- UTF-8 (no BOM). Windows + macOS 라인엔딩은 `\n` 기본.
- run-codex.sh sandbox 안에서 `npx tsc --noEmit` / `npm test` 가 통과하지 않더라도 Final report 에 "sandbox-only failure, escalate" 로만 명시하고 영구 config 우회 금지.

## Context (필요할 때만 읽기)

- `.claude/agents/sprint-planner.md` — 현재 Planner sub-agent 정의. frontmatter + Responsibilities 본문.
- `.vibe/agent/_common-rules.md` §14 Wiring Integration — 공용 체크리스트 정의 (W1~W14 / D1~D6).
- `scripts/vibe-sprint-commit.mjs` — `computeLocSummary()` (현재 line 219-248) + `loadLocExtensions()` 주변에 lockfile blacklist 추가.
- `test/sprint-commit.test.ts` — 기존 LOC fixture 패턴 (`locExtensions: ['.ts']` scaffold 재사용 가능).
- `.vibe/audit/iter-3/rules-deleted.md` — iter-3 carryover 4건 (모두 `restoration_decision: pending`). **원본 수정 금지, 하단 append 만 허용**.
- `docs/release/v1.4.2.md` — O2 에서 작성된 iter-4 release note. O3 변경 사항 bullet 3개 append.

## AC (acceptance criteria — 모두 기계 검증 가능)

### AC-1 — Planner component-integration 계약 추가

`.claude/agents/sprint-planner.md` (또는 Planner 가 소환될 때 참조하는 공용 체크리스트 문서) 에 아래 3개 체크리스트 항목이 포함되어야 한다. framework-agnostic 문구 유지 (React/Vue/Svelte 등 특정 언급 금지).

1. Global-state provider (예: Toaster, ToastProvider, ThemeProvider 등) 는 root-level mount 위치를 검증 — 단독 마운트 누락 재발 방지.
2. 이벤트 핸들러는 null-safe — `event?.target?.xxx` optional chaining 또는 early-return guard 로 undefined 접근 방지.
3. Optimistic UI 업데이트 후 rollback 경로 (실패 시 원복) 검토.

**구현 위치 선택**: 아래 두 가지 중 하나 선택 (Codex 판단 + Final report 에 사유 기록).

- Option A (권장): `.claude/agents/sprint-planner.md` Responsibilities 하단에 `### Component integration contract (when UI components change)` 서브섹션으로 3항목 bullet 추가. 이유: Planner 가 매 Sprint 소환될 때 SKILL-level 계약으로 inline 된다.
- Option B: `.vibe/agent/_common-rules.md` §14 하단에 `### §14.6 Component integration contract` 서브섹션 추가. 이유: Planner 가 `_common-rules.md` 를 프롬프트 선두에 prepend 하므로 모든 Sprint 에 자동 적용.

둘 다 가능하지만 **Option A 가 scope 에 더 부합** (sprint-planner.md 자체가 Planner 계약 문서). Codex 가 B 를 선택한다면 Final report 에 근거 (§14 확장 쪽이 generic 하다는 argument) 명시.

### AC-2 — Planner 계약 regression test

신규 파일 `test/sprint-planner-contract.test.ts` — `node:test` 기반. 아래 assertion:

- Planner 계약 파일 (AC-1 에서 선택한 파일) 의 content 를 `readFile` 로 읽어 component-integration 키워드 검증.
- 3개 키워드 그룹 중 **최소 2개 그룹 match** 를 assert:
  - group1: `/toaster|toastprovider|global.?state provider/i`
  - group2: `/null.?safe|optional chaining|early.?return guard|\?\./i`
  - group3: `/optimistic|rollback/i`
- test 제목: `sprint-planner contract includes component-integration checklist`
- 파일 크기 목표: **≤ 25 lines** (import + 1 describe + 1 it).

### AC-3 — `vibe-sprint-commit.mjs` actualLoc lockfile blacklist

`scripts/vibe-sprint-commit.mjs` `computeLocSummary()` 에서 LOC 집계 시 아래 4개 lockfile basename 을 자동 제외한다.

- `package-lock.json`
- `pnpm-lock.yaml`
- `yarn.lock`
- `bun.lockb`

구현 지침:

- 모듈 상단 상수 선언: `const LOCKFILE_BLACKLIST = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb']);` (파일 최상단 기존 상수 근처).
- `computeLocSummary()` 루프 내 `filePath` 의 basename 이 `LOCKFILE_BLACKLIST` 에 있으면 `continue`.
- `path.basename(filePath)` 으로 판별 (하위 디렉토리에 lockfile 이 있어도 포착).
- 기존 `codeExtensions` 필터 **앞에** 적용 (이미 확장자 필터로 제외되더라도 중복 방어는 무해).

### AC-4 — lockfile blacklist regression test

신규 파일 `test/sprint-commit-lockfile-blacklist.test.ts` — `node:test` 기반. 기존 `test/sprint-commit.test.ts` 의 `scaffoldRepo` / `runSprintCommit` 패턴을 참고하되, **상위 helper 를 import 하지 말고** 새 파일 안에 필요한 최소 fixture 만 선언 (LOC 절약 위해 `scaffoldRepo` 대신 manual scaffold 허용).

- 준비: git repo + `.vibe/config.json` (`loc.extensions: ['.json', '.ts']`) + `sprint-status.json` / `handoff.md` / `session-log.md` 초기 상태.
- 변경: `package-lock.json` 에 300 줄 append + `src/foo.ts` 에 10 줄 추가.
- 실행: `node scripts/vibe-sprint-commit.mjs <sprintId> passed --scope src/foo.ts --no-verify-gpg`.
- 검증: `git log -1 --format=%B` 출력의 commit body 가 `/LOC \+10\/-0 \(net \+10\)/` 에 match (package-lock.json 300 줄 제외됨).
- 파일 크기 목표: **≤ 90 lines** (기존 test 패턴 간소화).

helper 재사용이 더 효율적이면 `import { scaffoldRepo } from './sprint-commit.test.js'` 대신 최소 scaffold 만 인라인. Codex 판단.

### AC-5 — iter-3 pending restoration 4건 delete 확정 기록

`.vibe/audit/iter-3/rules-deleted.md` **하단에** `## iter-4 판정 (2026-04-19)` 섹션 append (iter-3 원본 본문 수정 금지, 새 디렉토리 `.vibe/audit/iter-4/` 생성 금지 — LOC 절약 + 위치 consistency 우선).

append 내용 (한국어, ≤ 20 lines):

- 판정 일자: 2026-04-19 (iter-4 O3 sprint 종결 시점)
- 4건 모두 `restoration_decision: delete-confirmed`
  - `two-tier-audit-convention` — gap-rule-only-in-md 커버리지 + iter-4 O2 `vibe-audit-skip-set.mjs` bootstrap 보강으로 자연 해소. **delete-confirmed**.
  - `실패-에스컬레이션` — tier-C, incident 0, gap-* 매핑 없음. **delete-confirmed**.
  - `항상-지킬-것` — tier-C, incident 0, 잔존 role constraint + sprint flow 섹션으로 중복 커버. **delete-confirmed**.
  - `필요할-때만-읽을-문서` — tier-C, incident 0, gap-* 매핑 없음. Context shards pointer 섹션이 현재 CLAUDE.md 에 포함되어 동등 기능 대체. **delete-confirmed**.
- 다음 감사 (`vibe-rule-audit.mjs`) 에서 본 4건은 closed-ledger 로 간주.

### AC-6 — existing regression touch

`test/vibe-rule-audit.test.ts` (또는 `test/rule-audit.test.ts`) 에 `rules-deleted.md` iter-4 판정 섹션 존재 여부를 1-line grep-style assertion 추가. 신규 test 파일 생성 금지.

- assertion 예시: `readFile('.vibe/audit/iter-3/rules-deleted.md', 'utf8')` 이 `/iter-4 판정/` match.
- 기존 `describe` 블록 하단에 1개 `it` 추가. ≤ 6 lines.

**주의**: 해당 파일이 존재하지 않으면 AC-6 skip + Final report 에 "rule-audit test 파일 미존재 → grep assertion skip" 명시. 새 test 파일 생성 금지.

### AC-7 — v1.4.2 release note append

`docs/release/v1.4.2.md` 하단에 `## iter-4 O3 planner-contract-polish` 섹션 3-bullet append:

- Planner contract 문서 (sprint-planner.md 또는 _common-rules.md §14.6) 에 component-integration 3항목 (global-state provider root mount / null-safe event handler / optimistic rollback) 추가.
- `vibe-sprint-commit.mjs` actualLoc 계산이 package-lock.json / pnpm-lock.yaml / yarn.lock / bun.lockb 를 basename blacklist 로 제외 — dep install PR 의 LOC noise 제거.
- iter-3 rules-deleted ledger 의 4건 (two-tier-audit-convention / 실패-에스컬레이션 / 항상-지킬-것 / 필요할-때만-읽을-문서) 을 iter-4 판정 섹션 append 로 delete-confirmed 처리.

## Files Generator may touch

- `.claude/agents/sprint-planner.md` (AC-1 Option A) **또는** `.vibe/agent/_common-rules.md` (AC-1 Option B) — 둘 중 하나만.
- `scripts/vibe-sprint-commit.mjs` — LOCKFILE_BLACKLIST 상수 + computeLocSummary basename skip.
- `test/sprint-planner-contract.test.ts` — **신규** (≤ 25 lines).
- `test/sprint-commit-lockfile-blacklist.test.ts` — **신규** (≤ 90 lines).
- `.vibe/audit/iter-3/rules-deleted.md` — 하단 append 만.
- `test/vibe-rule-audit.test.ts` 또는 `test/rule-audit.test.ts` — 1 `it` append (존재 시).
- `docs/release/v1.4.2.md` — 하단 섹션 append.

## Do NOT modify

iter-4 O1/O2 산출물 일체 수정 금지. 다음 파일은 **읽기 전용**.

- `scripts/vibe-interview.mjs`, `src/lib/interview.ts`, `test/interview-coverage.test.ts`
- `scripts/vibe-audit-skip-set.mjs`, `test/audit-skip-set-bootstrap.test.ts`
- `scripts/vibe-preflight.mjs`, `src/lib/preflight-roadmap.ts`, `test/preflight-roadmap-iteration.test.ts`
- `src/lib/config.ts`, `test/config-path-resolution.test.ts`
- `scripts/vibe-browser-smoke.mjs`, `src/commands/bundle-size.ts`
- `scripts/vibe-sprint-complete.mjs` — LOC blacklist 는 commit 쪽에만 적용.
- `CLAUDE.md` — §14 수정 금지 (읽기만). Planner 계약 확장은 sprint-planner.md 또는 _common-rules.md 중 택일.

수정이 필수적으로 요구되면 **scope out + Final report 에 pendingRisk 로 기록**.

## Verification

**Orchestrator 샌드박스 밖에서 수행**:

1. `npx tsc --noEmit` — 0 errors.
2. `npm test --silent` — 기존 전체 pass + 신규 2 테스트 (`sprint-planner-contract`, `sprint-commit-lockfile-blacklist`) 통과.
3. `node --test test/sprint-commit-lockfile-blacklist.test.ts` — lockfile blacklist 단독 스모크.
4. grep 검증 — `.vibe/audit/iter-3/rules-deleted.md` 에 `iter-4 판정` 섹션 존재.
5. LOC 계산 — `node scripts/vibe-sprint-commit.mjs sprint-O3-planner-contract-polish passed --dry-run` 로 actualLoc 이 budget ≤ 50 내인지 확인 (선택적 smoke).

**Codex 샌드박스 안 제약**: `run-codex.sh` wrapper 가 sandbox verify skip 자동 적용. Codex 가 `npm test` 를 샌드박스 안에서 직접 실행하지 않아도 됨 — "sandbox-only failure, escalate" 로 Final report 에 명시.

## Wiring Integration (§14 공용 규칙 근거)

Final report 에 아래 테이블을 반드시 포함.

| Checkpoint | Status (예상) | Evidence |
|---|---|---|
| W1 CLAUDE.md hook 테이블 | n/a | 신규 script 없음 |
| W2 관련 스킬 | n/a | 신규 skill 없음 |
| W6 sync-manifest harness[] | n/a | 신규 하네스 파일 없음 (test 는 sync 대상 아님) |
| W8 README 사용자 섹션 | n/a | user-visible 기능 변경 없음 |
| W10 release note | touched | docs/release/v1.4.2.md 하단 append |
| W12 test 회귀 방지 | touched | test/sprint-planner-contract.test.ts + test/sprint-commit-lockfile-blacklist.test.ts |
| W13 harness-gaps 갱신 | n/a | 본 Sprint 는 기존 gap 해소 아님 |
| D1~D6 | n/a | 삭제/이름변경 없음 |

`verified-callers` 신규 파일:

- `test/sprint-planner-contract.test.ts` → `npm test` 가 `test/*.test.ts` glob 으로 자동 pickup.
- `test/sprint-commit-lockfile-blacklist.test.ts` → 동일.

## Final report 요구 사항

Final report 에 아래 섹션을 모두 포함:

1. `## Summary` — 1-2 문단.
2. `## Files changed` — 경로별 `add/modify/delete + LOC` 테이블.
3. `## actualLoc` — `npx tsc --noEmit` + `npm test --silent` 결과 요약 + LOC +add/-delete (budget 50 대비 체크).
4. `## Wiring Integration` — 위 §14 체크리스트 테이블 + verified-callers.
5. `## AC status` — AC-1 ~ AC-7 각각 `pass / partial / blocked` + 근거 1 줄.
6. `## Selection rationale` — AC-1 에서 Option A 또는 B 를 선택한 이유 1-2 문단.
7. `## Remaining risks` — open pendingRisk 목표 0. 있으면 `.vibe/agent/sprint-status.json.pendingRisks` append 대상으로 명시.

끝.
