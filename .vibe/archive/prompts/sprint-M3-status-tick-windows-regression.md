# Sprint M3 — status-tick Windows regression fix

- **Sprint id**: `sprint-M3-status-tick-windows-regression` (iter-6 final slot)
- **Goal**: `scripts/run-codex.sh` 의 토큰 추출 regex 가 실제 Codex CLI 출력(`tokens used <N>`)과 mismatch 해 Windows/macOS 모두에서 silent-skip → `.vibe/agent/tokens.json` 누적 0 유지. regex 수정 + regression test 로 재발 방지.
- **AC summary**: (1) 현행 `tokens?[: ]+[0-9]+` 가 `tokens used 12345` 와 일치하지 않음을 확인·수정, (2) Windows MINGW + macOS 양쪽 동작, (3) regression test 3 fixture (표준/숫자누락/CRLF), (4) `npx tsc --noEmit` + `npm test --silent` 전부 pass + 기존 251 테스트 미회귀, (5) M2 + iter-4 산출물 미변경.
- **LOC budget**: add ≤ 30, delete ~0. 초과 시 Final report 에 실측 + 사유.
- **0 new scripts**. `run-codex.sh`, `run-codex.cmd`(필요 시), `scripts/vibe-status-tick.mjs`(확인), `test/run-codex-wrapper.test.ts` 확장 또는 신규 `test/run-codex-status-tick.test.ts` 만 수정.
- **제약**: UTF-8 no-BOM. 기존 계약(input/output 포맷) 불변. `run-codex.sh` 가 자기 자신을 수정하는 Sprint 이므로 Codex self-verify 단계의 Windows 헤더 prepend 로직 불변.

---

## 0. 선행 조건

작업 시작 전 아래 파일을 **반드시 Read 로 먼저 읽는다**. blind fix 금지.

1. `scripts/run-codex.sh` — 토큰 추출 / status-tick 호출 로직 전체 (특히 `extract_token_count` 함수, line 170-183).
2. `scripts/run-codex.cmd` — Windows 네이티브 cmd 경로의 status-tick 호출 (line 41-54 근처).
3. `scripts/vibe-status-tick.mjs` — 인자 파싱 + tokens.json 갱신 로직. (현재는 정상 동작 확인됨 — blind 로 수정하지 말 것. 확인만.)
4. `test/run-codex-wrapper.test.ts` — 기존 stub 는 `echo "tokens: 1234"` 를 방출. 이것이 현재 테스트는 통과시키지만 **실제 Codex CLI 출력 포맷과 다르다** (문제의 핵심).
5. `test/status-tick.test.ts` — `vibe-status-tick.mjs` 단위 테스트.

---

## 1. 배경 — 확정된 root cause

iter-3 N2 (`2a229e3`) 시점엔 Codex CLI 가 `tokens: <N>` 포맷을 내던 것으로 추정. 이후 Codex CLI 출력 포맷이 `tokens used <N>` (literal word "used") 로 바뀌었으나 wrapper 의 추출 regex 는 업데이트되지 않음.

현재 `run-codex.sh` line 177:
```sh
grep -Eio 'tokens?[: ]+[0-9]+'
```
이 regex 는 `tokens` 다음에 `:` 또는 공백이 오고 **즉시** 숫자가 나오는 경우만 매치한다. 즉:

- ✅ `tokens: 1234` → match (기존 stub 이 쓰던 포맷, 따라서 테스트는 녹색)
- ❌ `tokens used 12345` → **match 실패** (실제 Codex CLI 가 내는 포맷)
- ❌ `Token usage: input=N output=N total=N` (대체 포맷이 있는 경우)

결과: `extract_token_count` 가 empty string 반환 → `status_tick_after_success` 가 `skipped reason=no-tokens` 분기로 가서 `vibe-status-tick.mjs` 호출 자체가 **발생하지 않음**. `tokens.json` 은 영원히 갱신되지 않음.

이 Sprint 는 이 regex 를 수정하고 regression test 를 추가해 재발 방지한다.

---

## 2. 작업 단계

### Step 2-1. 실제 Codex 출력 포맷 재확인 (필수, blind fix 금지)

현재 Orchestrator 환경에서 최근 Codex 호출 stderr 로그 또는 stdout tail 을 확인해 실제 방출 포맷을 검증한다. 확실한 루트는:

- `codex exec --help` 출력에 tokens 관련 언급은 없음 (help 에는 안 나옴).
- 실제 출력: Codex CLI 가 최종 stdout 에 `tokens used <N>` 형태로 요약 라인을 낸다고 가정한다 (session-log 의 `total Codex tokens: 444K` 근거 + sprint-roadmap.md line 449 의 기대 포맷 근거).
- **추가 안전장치**: regex 를 복수 포맷에 관대하게 — `tokens` word boundary 뒤 공백/콜론/`used`/`total` 등 word 가 0~2 개 오고 그다음 정수. 예:
  - `tokens: 1234`
  - `tokens used 1234`
  - `tokens total 1234`
  - `Tokens used: 1234`

### Step 2-2. `scripts/run-codex.sh` 의 `extract_token_count` 수정

현 함수 (line 170-183) 를 아래와 유사하게 수정. 정확한 awk/grep 조합은 Generator 가 Windows MINGW bash + macOS bash 둘 다에서 동작하도록 결정한다. 핵심 요건:

- `tokens` (대/소문자 무관) 단어 뒤에 optional word (`used`, `total`, `usage`, `:` 등) 가 0~2 개 오고 숫자가 나오는 모든 경우를 캡처.
- tail 10 라인 내의 **마지막** 매치를 사용 (기존 동작과 동일).
- CRLF 라인 엔딩 중립 (input 이 CRLF 여도 동작).
- 숫자만 stdout 에 print. 매치 실패면 empty print (기존 계약).

권장 접근 예 (Generator 재량):
```sh
extract_token_count() {
  local tokens
  tokens="$(
    tail -n 10 "$attempt_output" 2>/dev/null |
      tr -d '\r' |
      grep -Eio '\btokens?\b[^0-9]{0,20}[0-9]+' |
      tail -n 1 |
      grep -Eo '[0-9]+' || true
  )"
  if [[ -n "$tokens" ]]; then
    printf '%s' "$tokens"
  fi
}
```
- `\b` word boundary 로 `tokens` 가 독립 단어일 때만.
- `[^0-9]{0,20}` 로 최대 20 non-digit char (콜론·공백·`used`·`total` 등) 를 허용.
- `tr -d '\r'` 로 Windows CRLF 중립화.

단, 정확한 regex 는 Generator 가 실제 Codex 출력 샘플을 고려해 결정. 최소 3 fixture (아래 test) 통과가 필수.

### Step 2-3. `scripts/run-codex.cmd` 처리

현 `.cmd` wrapper (line 47,49) 는 `--add-tokens 0` 고정 호출 — 즉 토큰 추출 자체를 안 한다 (이미 Windows 네이티브 cmd 에서는 token 파싱을 포기한 설계). 이 Sprint 의 AC-2 는 bash wrapper 의 Windows MINGW 호환이 목표이지 .cmd 개선이 아니다.

**결론**: `.cmd` 는 out-of-scope. 수정 금지. Final report 에 "cmd wrapper 는 `--add-tokens 0` 고정 설계 유지 (separate decision)" 명시.

### Step 2-4. `scripts/vibe-status-tick.mjs` 확인

현재 로직 (line 53-60) 은 `--add-tokens` 값을 `Number()` + `Number.isInteger()` + `>= 0` 체크. regex 가 `1234` 같은 깨끗한 정수를 넘기면 정상 동작한다. 단, wrapper 가 `"1234\n"` 같이 trailing newline 을 붙여 전달하면 `Number("1234\n")` → `1234` 이므로 OK. **무수정 예상**. 단, Read 로 확인하고 blind fix 하지 말 것. 문제가 발견되면 최소 수정 후 기록.

### Step 2-5. regression test

`test/run-codex-wrapper.test.ts` 의 기존 `'invokes status-tick after successful codex run when VIBE_SPRINT_ID is set'` 테스트는 stub 이 `echo "tokens: 1234"` 로 **이미 올바른 포맷** 을 쓰고 있어서 녹색. 이 테스트는 regex 변경으로 깨지면 안 되며, **추가로** 실제 Codex 포맷 `tokens used <N>` + CRLF 커버리지를 더한다.

선택지 A (권장) — 기존 test 확장:
- `createShellStubBin` 의 `tokens` mode 옆에 **새 mode** `tokens-used`, `tokens-crlf`, `tokens-malformed` 추가.
- `tokens-used` → `echo "tokens used 12345"` + exit 0.
- `tokens-crlf` → `printf 'tokens used 99\r\n'` + exit 0.
- `tokens-malformed` → `echo "tokens used"` (숫자 누락) + exit 0.
- 테스트 3 개 추가:
  1. `tokens-used` → tokens.json sprintTokens['sprint-example'] = 12345, stderr 에 `ticked tokens=12345`.
  2. `tokens-crlf` → sprintTokens = 99, CRLF 이 pipe 에서 정상 처리됨.
  3. `tokens-malformed` → stderr 에 `skipped reason=no-tokens`, tokens.json 미생성 (기존 `skips status-tick when sprint status handoff is idle` 패턴 재활용).

선택지 B — 신규 파일 `test/run-codex-status-tick.test.ts`:
- 기존 wrapper test 의 stub helper 를 재사용하려면 export 가 필요해 파일 분할 비용이 더 큼.
- LOC budget 초과 위험.
- **권장하지 않음**. 다만 wrapper test 가 400 줄로 커서 파일 분할이 설계상 더 깔끔하다고 Generator 가 판단하면 선택지 B 허용.

필수 요건 (둘 중 어느 경로든):
- fixture 3 종 (표준 `tokens used N` / CRLF / 숫자 누락) 전부 assert.
- 기존 "tokens: 1234" 테스트는 **미삭제·미수정** (하위 호환 보장).
- `npm test --silent` 전체 pass.

### Step 2-6. 재검증 (Generator 사후)

Generator 작업 완료 후 Orchestrator (Windows 샌드박스 밖) 가:
```
npx tsc --noEmit                     # 0 errors
npm test --silent                    # 기존 251 + 신규 3 pass
```
을 수행. Generator 는 Windows sandbox 제약 때문에 `npx tsc` / `npm test` 를 Codex sandbox 안에서 실행할 수 없다 — static inspection + wrapper auto-prepend 된 `## Host OS sandbox limitation` 헤더 지침대로 Final report 에 sandbox-only failure 를 적지 않는다.

### Step 2-7. 릴리스 노트 append

`docs/release/v1.4.3.md` 의 `(M3 status-tick Windows regression will append to this document in a follow-up Sprint.)` placeholder 를 실제 M3 섹션으로 교체:

```md
## iter-6 M3 - run-codex status-tick token-extract regex fix

- `scripts/run-codex.sh` 의 `extract_token_count` regex 를 `tokens used <N>` / `tokens: <N>` / CRLF 모든 Codex CLI 출력 포맷에 관대한 패턴으로 교체. Windows MINGW bash 와 macOS bash 양쪽에서 `.vibe/agent/tokens.json` 누적 갱신이 복구.
- dogfood9 review-14 structural finding `review-tokens-json-not-updating` 해결.
- `test/run-codex-wrapper.test.ts` 에 fixture 3 종 (표준 / CRLF / 숫자 누락) regression 테스트 추가.
```

(placeholder 줄 삭제, 섹션 자리 교체. M2 섹션은 손대지 말 것.)

---

## 3. 파일 변경 범위

| 파일 | 변경 | 예상 LOC |
|------|------|---------|
| `scripts/run-codex.sh` | `extract_token_count` 함수 regex/로직 수정 | +5 ~ +10 |
| `scripts/run-codex.cmd` | **미변경** (out-of-scope) | 0 |
| `scripts/vibe-status-tick.mjs` | **미변경 기본** (문제 발견 시만) | 0 |
| `test/run-codex-wrapper.test.ts` | stub mode 3 종 + 테스트 3 개 추가 | +15 ~ +20 |
| `docs/release/v1.4.3.md` | placeholder → M3 섹션 교체 | +6 / -1 |
| **합계** | | **+26 ~ +35** (budget ≤ 30 ± 여유) |

LOC 30 을 넘으면 Final report 에 실측 + 사유. 넘기지 않으면 단순 보고.

---

## 4. Acceptance Criteria (기계 검증)

### AC-1. Root cause 진단 명시
- Final report `## Root cause` 섹션에 현 regex `tokens?[: ]+[0-9]+` 가 `tokens used <N>` 과 matching 실패하는 매커니즘을 1 문단 기술.
- 수정 후 regex 가 `tokens: N`, `tokens used N`, `Tokens used: N` 3 포맷 모두 매치함을 fixture test 로 증명.

### AC-2. Windows MINGW + macOS 호환
- `tr -d '\r'` 또는 동등한 CRLF 중립화.
- `awk` / `grep -E` 만 사용 (GNU extension 금지 — Windows MINGW bash 기본 지원 이진만).
- bash `[[ ]]`, `$(...)`, POSIX arithmetic 허용 (기존 스크립트 이미 사용).

### AC-3. Regression test
- fixture 1 (`tokens used 12345`) → tokens.json cumulative +12345, sprintTokens['sprint-*'] = 12345.
- fixture 2 (`printf 'tokens used 99\r\n'` CRLF) → tokens.json cumulative +99.
- fixture 3 (`tokens used` 숫자 누락) → stderr `skipped reason=no-tokens`, tokens.json 미생성.
- 기존 `tokens: 1234` 테스트 미회귀.

### AC-4. 전체 회귀 없음
- `npx tsc --noEmit` → 0 errors.
- `npm test --silent` → 기존 251 + 신규 3 = 254 pass.
- M2 산출물 (`src/lib/review.ts`, `scripts/vibe-sprint-complete.mjs`, `test/vibe-review-inputs.test.ts`, `test/sprint-commit.test.ts`) 미변경.
- iter-4 O1/O2/O3 산출물 미변경.

### AC-5. 실측 검증 (Orchestrator 관찰)
- 본 Sprint 종료 후 **다음** Codex 위임 (iter-6 closure 또는 이후 Sprint) 에서 `[run-codex] status-tick: ticked tokens=N sprint=<id>` stderr 메시지 출력 + `.vibe/agent/tokens.json` cumulative 증가 관찰. Orchestrator 책임, Generator Sprint 내 수행 불가.

---

## 5. 검증 명령 (Orchestrator 샌드박스 밖)

```
npx tsc --noEmit
npm test --silent
```

- `tsc` 0 errors 필수.
- `npm test` 254 pass (또는 251 + 추가된 테스트 수) 필수. skip 증가 금지.

추가 spot-check:
```
bash -c 'printf "tokens used 12345\n" | tail -n 10 | tr -d "\r" | grep -Eio "\\btokens?\\b[^0-9]{0,20}[0-9]+" | tail -n 1 | grep -Eo "[0-9]+"'
# 12345 출력 기대
```

---

## 6. 공용 규칙 (Wiring Integration)

`.vibe/agent/_common-rules.md §14` 체크리스트 적용 범위:

| Item | Status | 근거 |
|------|--------|------|
| W1 (CLAUDE.md hook 테이블) | n/a | 스크립트 계약 불변, 신규 스크립트 없음 |
| W10 (`docs/release/v1.4.3.md`) | touched | M3 섹션 append (M2 placeholder 교체) |
| W12 (test 회귀 방지) | touched | `test/run-codex-wrapper.test.ts` fixture 3 추가 |
| D1~D6 (deletion) | n/a | 삭제 없음 |

Final report `## Wiring Integration` 섹션에 위 표 그대로 또는 더 상세히 보고.

---

## 7. Generator Final report 요구 사항

보고 파일 형식은 기존 Sprint 와 동일 (Codex 가 stdout 에 Markdown 으로 출력). 최소 아래 섹션 포함:

1. `## Root cause` — regex mismatch 메커니즘 1 문단.
2. `## Changes` — 파일별 diff 요약 (LOC 증감 실측 포함).
3. `## Verification` — static inspection 결과 (Windows sandbox 제약 때문에 Codex 내부에서 `npx tsc` / `npm test` 실행 금지. Orchestrator 가 밖에서 실행).
4. `## Wiring Integration` — 위 §6 표.
5. `## Sandbox-only failures` — `- none` (Windows 기본 제약이므로 특이 사항 없으면).
6. `## Notes` — .cmd wrapper out-of-scope 결정 기록, LOC budget 준수 여부.

---

## 8. 금지 사항

- `scripts/run-codex.cmd` 수정 금지.
- `scripts/vibe-status-tick.mjs` blind 수정 금지 (문제 발견 시 최소 수정 후 명시).
- M2 산출물 (`src/lib/review.ts`, `scripts/vibe-sprint-complete.mjs`, 관련 테스트 2 종) 미변경.
- iter-4 O1/O2/O3 산출물 미변경.
- 신규 스크립트 생성 금지.
- 기존 `tokens: 1234` 테스트 삭제·수정 금지 (하위 호환).
- Windows sandbox 안에서 `npx tsc` / `npm test` 실행 금지 (wrapper 헤더 지침 준수).
- 커밋 / push 금지 — Orchestrator 가 `vibe-sprint-commit.mjs` 로 처리.

끝.
