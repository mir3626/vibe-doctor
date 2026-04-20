---
sprint-id: sprint-M2-generator-scope-discipline
iteration: iter-7
finding: dogfood10 review-4 Finding D — Generator scope-discipline (자발적 unit test 생성 차단)
loc-budget: 22 (buffered 28)
new-scripts: 0
scope-glob:
  - .vibe/agent/_common-rules.md
  - test/run-codex-wrapper.test.ts
  - docs/context/harness-gaps.md
---

# Sprint M2 — Generator scope discipline (unit test 자발 생성 차단)

(공용 규칙은 `.vibe/agent/_common-rules.md` 준수. 본 Sprint 는 그 파일 자체를 §15 섹션으로 확장한다.)

## 직전 Sprint 결과 요약 (Orchestrator 주입)

- M1 (`sprint-M1-codex-unavailable-signal`) 완료. `scripts/run-codex.sh` 최종 실패 경로에
  `.vibe/agent/codex-unavailable.flag` touch + stderr `CODEX_UNAVAILABLE` 블록 + 성공 시
  `rm -f` 복구. `test/run-codex-wrapper.test.ts` 에 신규 shell stub mode `'fail-403'` + 1 case
  추가. LOC +17 code. 모든 self-QA 통과.
- M2 는 **동일 test file** 을 1 case 더 확장하고, `_common-rules.md` 에 §15 를 신설한다.
  `run-codex.sh` 는 **절대 건드리지 않는다** (M1 가 확정한 흐름 유지).

---

## Goal

dogfood10 Codex Generator 는 Planner prompt 가 test 파일을 전혀 언급하지 않았는데도
unit test 를 3회 자발 생성했다 (`test/seed.test.ts` @ M2, `test/cache.test.ts` +
`test/sources-index.test.ts` @ M3). 매번 Orchestrator 가 `rm` 으로 사후 cleanup 했고,
dogfood10 `conventions.md` 는 이미 "MVP 단계에서 unit test 없이 smoke + type check 만"
을 명시했지만 Generator 는 그 규칙을 무시했다. 같은 규칙을 Generator prompt 에
**매번** 자동 prepend 되는 `.vibe/agent/_common-rules.md` 로 hoist 하여 **Generator
context 레벨에서 차단**한다.

본 Sprint 는 다음 두 산출을 만든다:

1. `_common-rules.md` 에 §15 신규 섹션 — literal 문구로 강제.
2. `test/run-codex-wrapper.test.ts` 에 §15 가 run-codex.sh 의 prepend 결과물에 살아
   남는지 1 case 회귀 방지.

그리고 `docs/context/harness-gaps.md` ledger 에 본 gap 을 `closed` 로 기록한다.

---

## 제약 (core invariants)

### Scope in

- `.vibe/agent/_common-rules.md` §14 바로 뒤 (§14.5 근거 섹션 다음) 에 §15 신규 섹션 추가.
- `test/run-codex-wrapper.test.ts` 에 신규 case 1개 추가.
- `docs/context/harness-gaps.md` 에 신규 id `gap-generator-test-scope-creep` row 1개 append.

### Scope out (건드리면 즉시 revert)

- `scripts/run-codex.sh`, `scripts/run-codex.cmd` — M1 확정 흐름 유지.
- `.vibe/agent/_common-rules.md` §1~§14 본문 (§14.5 포함).
- 기존 `test/run-codex-wrapper.test.ts` case 의 계약 (17 cases, skip 1 포함) — 신규 case
  추가만. 기존 case 의 assert·이름·구조 수정 금지. `'fail-403'` 모드 케이스도 그대로.
- `package.json` (harnessVersion bump 는 iter-7 마지막 Sprint M3 가 담당).
- `scripts/*.mjs`, `src/**/*.ts`, `.claude/skills/` 전체.
- `docs/context/*.md` (harness-gaps 제외).
- `CLAUDE.md` 훅 테이블 — 행위 변화 없음 (§15 는 이미 prepend 되는 파일 내용 확장에
  불과). 본 Sprint 는 신규 row 추가 없음.

### 공용 규칙

- §1~§14 모두 적용.
- §14 Wiring Integration 체크리스트 W1~W14 / D1~D6 을 Final report 에 명시 보고.
- §8 "최소 테스트 요구" 는 테스트 파일 자체를 수정하는 이 Sprint 에 자명하게 만족.
- 새 npm script / scripts/`*.mjs` 신설 금지.

---

## 변경 지점

### 1) `.vibe/agent/_common-rules.md` — §15 섹션 신설

파일 말미 (§14.5 근거 섹션 바로 뒤) 에 공백 한 줄 유지 후 **정확히 다음 블록** 을
literal 로 추가한다. 제목 / 구두점 / 코드 fence / 인용 없음 / 문단 줄바꿈 위치 모두
일치시켜라. 한 글자 re-word 하면 self-QA #2~#4 가 깨진다.

```md
## §15 Scope discipline (unit test 생성 금지 default)

Planner prompt 가 명시적으로 unit test 파일 생성을 요구하지 **않는 한**, Generator 는
`test/**/*.test.ts`, `src/**/*.test.ts`, `__tests__/` 디렉터리 등 unit test 파일을
스스로 만들지 않는다. Test 가 필요하다고 판단되면 Final report `## Wiring Integration`
섹션의 W12 에 "propose: test file X — blocked by §15" 로 기록만 남기고 stop.

이 규칙은 프로토타입/MVP 가 명시적으로 smoke + type check 만으로 충분하다고 선언한
conventions.md 의 테스트 섹션을 Generator 레벨로 hoist 한 것이다. 해제는 Planner 가
"Tests to add: [...]" 섹션을 Sprint prompt 에 명시했을 때만.
```

조건:

- 섹션 앞뒤 **공백 한 줄씩** 유지 (기존 §14 블록 스타일과 일관).
- §14.5 근거 블록의 마지막 줄 (`Codex 출력물에 ... Sprint 미완료.`) 다음 빈 줄을
  유지한 뒤 위 §15 블록 삽입.
- `## §15` 헤더가 파일 마지막 섹션이 되어야 하며 §16 이상 추가 금지.
- 파일 말미 trailing newline 1개 유지.

### 2) `test/run-codex-wrapper.test.ts` — 신규 case 1건

기존 case `'preserves stdin passthrough and common rules injection'` (line 307 근처) 는
`_common-rules.md` 의 첫 줄이 prepend 결과에 존재하는지 검증한다. 본 Sprint 는 그
계약을 **건드리지 않고** §15 고유 문자열이 prepend 결과물에 포함되는지 직접 assert 하는
case 1개를 추가한다.

- **case 이름 (literal)**: `'injects §15 scope discipline rule into Generator context'`
- **위치**: `describe('run-codex.sh wrapper', ...)` 블록 내부, 기존
  `'preserves stdin passthrough and common rules injection'` case 바로 뒤가 자연스럽다
  (같은 stub mode 재사용하므로 가독성 좋음). 다른 위치도 허용하되 `run-codex.cmd`
  블록으로 넘기지 말 것.
- **스텁 모드**: 기존 `'stdin'` ShellStubMode 그대로 사용 (success path, cat 으로 stdin
  echo). 신규 ShellStubMode 도입 금지.
- **환경변수**: `VIBE_SPRINT_ID` 를 세팅하지 않아 status-tick 분기 영향 제거. 필요 시
  `VIBE_SPRINT_ID: ''` 명시.
- **검증 방법**:
  1. `spawnSync(bashCommand ?? 'bash', [bashScriptPath, '-'], { env, input: 'hello',
     encoding: 'utf8' })` 로 실행.
  2. `assert.equal(child.status, 0)`.
  3. `assert.match(child.stdout, /## §15 Scope discipline/)` — literal 헤더 존재 확인.
     (`§` 는 UTF-8 기준으로 2바이트. test 파일도 UTF-8 저장 필수.)
- **skip 정책**: 기존 `describe` 블록의 `{ skip: bashCommand === null }` 를 그대로
  상속. 별도 skip 조건 금지.
- 전체 테스트 카운트: 기존 17 → 18 (skip 1 건 그대로).
- 기존 case `'preserves stdin passthrough and common rules injection'`,
  `'exhausts retries and emits CODEX_UNAVAILABLE signal + flag file'` 의 contract 는
  절대 수정하지 말 것.

### 3) `docs/context/harness-gaps.md` — gap row 1건 append

기존 표 구조 `| id | symptom | covered_by | status | script-gate | migration-deadline |`
를 따라 **정확히 1 row** append. 다른 row 수정 금지.

필드:

- **id**: `gap-generator-test-scope-creep`
- **symptom**: `Generator 가 Planner prompt 비지정 상태에서 test/*.test.ts 를 자발 생성. dogfood10 M2/M3 에서 3회 발생.`
- **covered_by**: `_common-rules.md §15 (sprint-M2-generator-scope-discipline). 재발 시 run-codex.sh post-process diff grep 으로 enforcement 승격.`
- **status**: `closed`
- **script-gate**: `covered`
- **migration-deadline**: `—`

원문 작성 시 파이프(`|`) 안에 포함되는 콤마·마침표 그대로 유지. 표 alignment 는
기존 행 패턴 따라 자연스럽게 정렬.

### 4) 그 외

- `CLAUDE.md` 훅 테이블 **신규 row 추가 없음** — 기존 `run-codex.sh | _common-rules.md
  자동 prepend + UTF-8 + 재시도` row 가 이미 §15 포함 파일을 prepend 하므로 행위 변화
  없다. 본 판단을 Final report Wiring Integration W1 에 `n/a — §15 는 prepend 되는
  파일 내용 확장이므로 훅 동작 변경 없음` 으로 명시.
- `docs/context/*.md` (harness-gaps 외) 수정 불필요.
- `README.md`, `.vibe/sync-manifest.json`, `package.json`, `.claude/settings.json` 모두 touch 금지.

---

## 테스트 지침

### 실행

샌드박스 안:

- `npx tsc --noEmit` — clean.
- `node --import tsx --test test/run-codex-wrapper.test.ts` — 18 pass / 1 skip 예상
  (Windows bash 환경에서 기존 16 pass + fail-403 1 pass + 신규 §15 1 pass + cmd skip 1).
  bash 부재 환경이면 `describe` 전체 skip 동작은 기존과 동일.

### Sandbox-only failures

- 없음. 본 Sprint 는 네트워크 / 외부 프로세스 / 브라우저 의존 0.

### Deviations

- 없음. 있으면 Final report Deviations 에 기록.

---

## 최종 self-QA 체크리스트 (Orchestrator 대조)

Final report 에 각 항목 pass/fail + evidence 1줄 기록.

1. `.vibe/agent/_common-rules.md` 에 `## §15 Scope discipline` 헤더가 존재.
   `grep -n '§15 Scope discipline' .vibe/agent/_common-rules.md` ≥ 1 hit.
2. §15 본문에 `test/**/*.test.ts`, `src/**/*.test.ts`, `__tests__/` 3 개 패턴 전부
   literal 포함. 각 패턴 `grep -c` ≥ 1.
3. §15 본문에 `propose: test file X — blocked by §15` 문구 literal 포함.
4. §15 본문에 `Tests to add: [...]` (opt-in 경로) literal 포함.
5. `_common-rules.md` 의 섹션 헤더 순서 점검: 마지막 두 섹션이 `## §14.5 근거` → `## §15 Scope discipline`. `## §16` 문자열은 존재하지 않음 (`grep -c '^## §16' == 0`).
6. `test/run-codex-wrapper.test.ts` 에 literal case 이름
   `'injects §15 scope discipline rule into Generator context'` 존재
   (`grep -c "injects §15 scope discipline rule into Generator context" test/run-codex-wrapper.test.ts == 1`).
7. `node --import tsx --test test/run-codex-wrapper.test.ts` 전량 pass. 이전
   총 case 수 +1 (17 → 18), skip 1 유지 허용.
8. `npx tsc --noEmit` clean (에러 0).
9. `docs/context/harness-gaps.md` 에 `gap-generator-test-scope-creep` id 가 정확히
   1 회 존재 (`grep -c 'gap-generator-test-scope-creep' docs/context/harness-gaps.md == 1`). status 필드 `closed`, script-gate `covered`.
10. LOC 합계 `git diff --stat HEAD` code (test + rules) 기준 ≤ 30 (buffered 예산).

---

## 리포트 형식 (Final report template)

Generator 는 다음 구조 그대로 Final report 를 출력한다.

```markdown
## Files added
- (none)

## Files modified
- .vibe/agent/_common-rules.md — §15 Scope discipline 섹션 신설
- test/run-codex-wrapper.test.ts — 신규 case 'injects §15 scope discipline rule into Generator context'
- docs/context/harness-gaps.md — gap-generator-test-scope-creep row append (status=closed)

## Verification
| command | exit |
|---|---|
| npx tsc --noEmit | 0 |
| node --import tsx --test test/run-codex-wrapper.test.ts | 0 |

## Sandbox-only failures
- none

## Deviations
- none

## Wiring Integration

| Checkpoint | Status | Evidence |
|---|---|---|
| W1 CLAUDE.md 훅 테이블 | n/a | §15 는 prepend 되는 파일 내용 확장이므로 훅 행위 변화 없음 |
| W2 CLAUDE.md 관련 스킬 | n/a | 신규 슬래시 커맨드 없음 |
| W3 CLAUDE.md Sprint flow | n/a | 절차 변경 없음 |
| W4 settings.json hooks | n/a | 이벤트 스크립트 신규 없음 |
| W5 settings.json statusLine | n/a | 상태바 변경 없음 |
| W6 sync-manifest harness[] | n/a | 신규 하네스 파일 없음 |
| W7 sync-manifest hybrid harnessKeys | n/a | hybrid 파일 key 추가 없음 |
| W8 README 사용자 섹션 | n/a | 사용자 대면 기능 변화 없음 |
| W9 package.json scripts | n/a | npm script 신규 없음 |
| W10 release notes | n/a | harnessVersion bump 는 M3 담당 |
| W11 migrations | n/a | schema / state file 변경 없음 |
| W12 test 회귀 방지 | touched | test/run-codex-wrapper.test.ts: 'injects §15 scope discipline rule into Generator context' |
| W13 harness-gaps 갱신 | touched | docs/context/harness-gaps.md: gap-generator-test-scope-creep (closed) |
| W14 .gitignore 런타임 artifact | n/a | 신규 artifact 없음 |
| D1~D6 | n/a | 파일 삭제·이름변경 없음 |

verified-callers:
- .vibe/agent/_common-rules.md §15 → scripts/run-codex.sh `--rules-include` 자동 prepend 경로 (CLAUDE.md 훅 테이블 `Generator 호출 시 | ./scripts/run-codex.sh | _common-rules.md 자동 prepend + UTF-8 + 재시도` row 가 이미 호출처)
- test/run-codex-wrapper.test.ts 신규 case → `npm test` / CI 에 통상 수집
- docs/context/harness-gaps.md gap row → `/vibe-review` ledger 스캔
```

보고가 위 구조에서 벗어나면 Orchestrator 는 Sprint 를 incomplete 로 간주하고 재위임한다.

---

## 확인된 사실 (Planner fresh context 기록)

- `.vibe/agent/_common-rules.md` 현재 §14.5 까지. 파일 총 약 273 줄. §15 이상 존재 안 함.
- `scripts/run-codex.sh` 는 `--rules-include .vibe/agent/_common-rules.md` 경로로
  stdin 에 rules 를 prepend (M1 이전 확립, M1 에서도 유지). §15 는 같은 파일에 추가하므로
  prepend 흐름에 자동 편입된다.
- `test/run-codex-wrapper.test.ts` 는 M1 에서 `'fail-403'` ShellStubMode 가 추가된
  상태. M2 신규 case 는 기존 `'stdin'` mode 재사용.
- `docs/context/harness-gaps.md` 는 `| id | symptom | covered_by | status | script-gate | migration-deadline |` 표 구조.
- iter-7 currentIteration = `iter-7`. M1 completed, M2 current, M3 pending.
- harnessVersion bump 는 M3 담당 — M2 는 `package.json` 건드리지 말 것.

---

Generator 는 본 prompt 만 참조하고 Planner / Orchestrator 에게 되묻지 않는다. 완료 후
Final report 를 위 template 그대로 출력. Orchestrator 가 받아서 샌드박스 밖 재검증
→ self-QA → single-commit 흐름으로 Sprint 를 닫는다.
