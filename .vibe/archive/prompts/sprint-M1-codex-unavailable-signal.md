# Sprint M1 — Codex unavailable signal

> 공용 규칙은 `.vibe/agent/_common-rules.md` 준수 (§1~§14 전체, 특히 §14 Wiring
> Integration W1~W14 / D1~D6 체크리스트는 Final report 에 필수 포함).

## 메타

- **sprint-id**: `sprint-M1-codex-unavailable-signal`
- **iteration**: iter-7 (vibe-doctor upstream, target harnessVersion **v1.5.0 은 M3 에서 bump — 본 Sprint 에서는 `package.json` harnessVersion 수정 금지**)
- **finding**: dogfood10 review-4 Finding B — Codex 403 single-point-of-failure
- **LOC budget**: 예상 ~40 LOC, 15% buffer 50 LOC (합계 **≤50 net LOC**). 신규 스크립트 0건. 신규 npm script 0건. 신규 외부 의존성 0건. 기존 파일 확장만.
- **mode**: Generator (Codex) 위임. 본 prompt 는 `cat docs/prompts/sprint-M1-codex-unavailable-signal.md | ./scripts/run-codex.sh -` 로 pipe 된다.

## Goal

dogfood10 iter-1 hotfix 중 Codex CLI 가 `https://chatgpt.com/backend-api/codex/responses` 로부터 **403 Forbidden 을 3회 연속** 반환해 Generator pipeline 이 halt 됐다. 사용자 토큰은 98% 여유였으므로 rate-limit 이 아니라 edge block / CF 차단 / 계정 fingerprint 중 하나로 추정되나 원인 불명. Generator 가 막혀있던 사실을 Orchestrator 가 기계적으로 인식할 **명확한 signal 이 없어서** charter 의 "Orchestrator 는 `.ts` 직접 편집 금지" 상수를 1회 깨고 hotfix 를 진행했다 (session-log `[decision][orchestrator-hotfix]`).

본 Sprint 는 그 **signaling gap 만** 보강한다. Generator 교체 / provider fallback 같은 구조 변경은 scope out — charter 는 "Generator = Codex 상수" 를 선언한다. `scripts/run-codex.sh` 의 최종 실패 경로에서 `.vibe/agent/codex-unavailable.flag` 를 touch 하고 stderr 에 정형 블록을 출력하며, 다음 성공 호출 시 flag 를 자동 제거한다. Orchestrator 는 flag 존재를 check 해서 Generator 위임 대신 "사용자 승인 하에 직접 편집" 분기에 진입할 수 있다.

## 제약

- **상위 공용 규칙 우선**: `.vibe/agent/_common-rules.md` §1 (샌드박스 우회 금지), §2 (의존성 설치 금지), §3 (수정 금지 목록 존중), §5 (범위 준수), §6 (검증 출력), §9 (Final report 형식), §14 (Wiring Integration) 모두 적용.
- **scope out / do NOT modify**:
  - `scripts/run-codex.sh` 의 **UTF-8 locale / `chcp.com 65001` / `shell_environment_policy.*` / 기본 3회 retry / `--rules-include` 자동 주입 / `--health`/`--version` 서브커맨드 / `status_tick_after_success` / `emit_sandbox_only_summary`** 블록은 원 동작 그대로 유지 (line shift 허용, 로직 변경 금지).
  - `scripts/run-codex.cmd` 는 본 Sprint **전면 scope 제외**. 편집 금지. Windows cmd wrapper 로의 포팅 여부는 다음 iter 에서 재평가.
  - `package.json` 의 `harnessVersion` 필드 편집 금지 (iter-7 M3 에서 v1.5.0 bump).
  - `.vibe/agent/iteration-history.json`, `.vibe/sync-manifest.json`, `.claude/settings.json`, `CLAUDE.md` 의 본 Sprint scope 외 섹션 편집 금지.
  - 기존 `test/run-codex-wrapper.test.ts` 의 기존 case 계약 보존 (회귀 금지).
- **Core invariant 보존**: run-codex.sh 는 여전히 **성공 경로에서 exit 0 / 실패 경로에서 원래 exit code** 를 유지해야 한다. flag 관리 로직이 exit code 를 overwrite 해선 안 된다.
- **신규 파일 생성 금지** (단 런타임 artifact `.vibe/agent/codex-unavailable.flag` 는 스크립트 실행 시 동적으로 생성되는 것이므로 commit 대상 아님 — `.gitignore` 에 등록하여 commit 차단).
- **평소와 동일한 Sandbox-bound Generator invariants** (§13): `npm install` 금지, 프로덕션 빌드 / E2E / 브라우저 smoke 금지. `npx tsc --noEmit` 과 self-contained `node --test` 는 허용.

## Files Generator may touch

| 파일 | 변경 유형 |
|------|----------|
| `scripts/run-codex.sh` | 수정 (append) |
| `test/run-codex-wrapper.test.ts` | 수정 (신규 case 1개 append, 기존 case 보존) |
| `.gitignore` | 수정 (1줄 추가) |
| `CLAUDE.md` | 수정 (훅 강제 메커니즘 표에 row 1줄 append) |
| `docs/context/codex-execution.md` | 수정 (말미 신규 섹션 append) |

위 5개 파일 외 편집 시 `## BLOCKED` 로 처리하고 exit 0 으로 종료 (`docs/context/codex-execution.md §4` BLOCKED 패턴 참조).

## 변경 지점

### (1) `scripts/run-codex.sh` — 실패/성공 경로에 flag 관리 추가

**의도**: 3회 retry 모두 소진 후 exit !=0 가 확정되는 지점에서 `.vibe/agent/codex-unavailable.flag` 를 touch 하고 정형 stderr 블록을 출력한다. 성공 경로에서는 flag 가 존재하면 제거한다. 기존 로직 라인들은 건드리지 않는다.

**위치 힌트**:
- 현재 실패 최종 분기는 `if [[ $attempt -ge $retries ]]` 블록 (파일 말미의 while 루프 안, `exit $rc` 호출 직전). 이 블록 내 `echo "[run-codex] giving up after ..."` 와 `exit $rc` 사이에 flag touch + stderr 블록 출력을 삽입.
- 성공 경로는 `if [[ $rc -eq 0 ]]` 블록 (`exit 0` 직전). 이 블록 안에 `rm -f` 를 호출.
- `FLAG_FILE` 같은 상수는 파일 상단 (§3 Build codex argv 전후) 에 한 번만 선언하면 grep 대조가 쉽다. 하드코딩도 무방하지만 grep hit 기준을 만족해야 함 (self-QA 체크리스트 #1 참조 — `.vibe/agent/codex-unavailable.flag` 문자열이 run-codex.sh 안에 **최소 2 hit**).

**구현 계약**:

1. **실패 경로** (최종 `if [[ $attempt -ge $retries ]]` 블록, `exit $rc` 전):
   - `.vibe/agent/` 디렉토리 부재 가능성을 대비해 `mkdir -p .vibe/agent` 선행.
   - `.vibe/agent/codex-unavailable.flag` 파일을 생성 / 덮어쓴다. 내용은 다음 2~3줄:
     - ISO8601 UTC timestamp (예: `date -u +"%Y-%m-%dT%H:%M:%SZ"`)
     - `last_exit=<rc>` 값
     - `reason_hint=<hint>` — `$attempt_stderr` tail 에서 **"403" / "401" / "429" / "5xx"** 패턴을 grep 으로 간단 매핑. 매칭 없으면 `unknown`.
       - 매핑 예: `403 Forbidden` 포함 시 `403-forbidden`, `401` 포함 시 `401-unauthorized`, `429` 포함 시 `429-rate-limit`, `5[0-9][0-9]` 포함 시 `5xx-server-error`, 나머지 `unknown`.
       - 단순 `grep -Eio` 수준이면 충분. awk 복잡화 금지.
   - stderr 에 아래 **정확한 literal 블록** 을 출력 (마지막 줄 포함, 공백/들여쓰기 그대로):

     ```
     [run-codex] CODEX_UNAVAILABLE — 3 retries exhausted (last exit=<code>, <reason-hint>).
                   Orchestrator 는 아래 중 하나 선택:
                   (1) 시간차 재시도 (quota 아닌 edge block 일 수 있음)
                   (2) 사용자 승인 하에 Orchestrator 직접 편집
                       → session-log 에 [decision][orchestrator-hotfix] 기록 필수
                   (3) `.vibe/config.json.providers` 에 fallback provider 추가 후 재시도
     ```

     - `<code>` 자리에 실제 `$rc` 값, `<reason-hint>` 자리에 위 매핑된 문자열이 interpolation 되어야 한다. 나머지 텍스트는 **한 문자도 바꾸지 말 것**.
   - 이후 `exit $rc` 는 원래대로 유지. **exit code 를 overwrite 하지 않는다**.
   - 기존 `emit_sandbox_only_summary` 및 `echo "[run-codex] giving up ..."` 호출은 그대로 유지하고, 그 뒤에 새 블록을 추가하는 형태가 line shift 최소.

2. **성공 경로** (`if [[ $rc -eq 0 ]]` 블록, `exit 0` 전):
   - `rm -f .vibe/agent/codex-unavailable.flag` 한 줄만 추가. 존재하지 않을 때 에러 억제를 위해 `-f` 필수.
   - 위치는 `emit_sandbox_only_summary` 이후, `status_tick_after_success` 전후 아무 곳이나 무방하되 **`exit 0` 직전**을 권장.

3. **reason_hint 매핑 헬퍼** (선택):
   - inline `grep -qi` 분기 몇 줄로 충분. 별도 함수로 뽑아도 되지만 LOC 예산 안에서.
   - stderr tail 범위는 `tail -n 20 "$attempt_stderr"` 정도면 충분.

**영향 격리**: 위 추가 외의 라인은 줄 번호가 shift 될 수 있으나 로직 변경 금지. 특히 `windows_sandbox_limitation_header`, `trim_section_body`, `emit_sandbox_only_summary`, UTF-8 export 블록은 **절대 수정 금지**.

### (2) `.gitignore` — 런타임 flag artifact 등록

파일 말미에 다음 2줄 append (주석 1줄 + 경로 1줄):

```
# run-codex.sh unavailable signal (runtime artifact, auto-cleared on next success)
.vibe/agent/codex-unavailable.flag
```

기존 라인 순서 / 기존 엔트리 편집 금지. 중복 체크 후 추가.

### (3) `test/run-codex-wrapper.test.ts` — 실패 시 signal 방출 검증 case 1개 추가

**기존 case 전부 유지**. `describe('run-codex.sh wrapper', { skip: bashCommand === null }, () => { ... })` 블록 **안**에 case 1개를 append 한다.

**case 이름**: `'exhausts retries and emits CODEX_UNAVAILABLE signal + flag file'`

**수행 내용 (의도)**:
1. 기존 `createShellStubBin('fail')` 패턴을 재활용 가능하지만, stderr 에 `403 Forbidden` 이 포함되도록 확장이 필요. 두 가지 방식 중 하나 선택:
   - **방식 A** (권장, 최소 변경): `ShellStubMode` 에 `'fail-403'` 추가 + 해당 분기에서 `echo "403 Forbidden" >&2; exit 1`. 기존 `'fail'` 모드는 그대로 보존.
   - **방식 B**: 테스트 내부에서 임시 bin dir 에 커스텀 codex stub 을 직접 `writeExecutable` 로 주입. `createShellStubBin` 확장을 피함.
   - 방식 A 가 패턴 일관성이 좋아 권장. 단, `createShellStubBin` 만 최소 수정하고 helper signature 변경 금지.
2. `CODEX_RETRY='3'`, `CODEX_RETRY_DELAY='0'` 로 `spawnSync` 실행. `makeTempDir` 로 cwd 를 격리 (flag 파일이 실제 워크스페이스 `.vibe/agent/` 를 오염시키지 않도록).
3. assert:
   - `child.status !== 0` (정확한 값: `assert.notEqual(child.status, 0)` 또는 `assert.equal(child.status, 1)`).
   - `child.stderr` 가 문자열 `CODEX_UNAVAILABLE` 을 포함 (`assert.match(child.stderr, /CODEX_UNAVAILABLE/)`).
   - `child.stderr` 에 reason hint `403-forbidden` (혹은 구현이 선택한 literal) 포함.
   - `path.join(cwd, '.vibe', 'agent', 'codex-unavailable.flag')` 파일이 존재 (`readFile` 로 읽어 내용에 ISO8601 날짜 패턴 `/\d{4}-\d{2}-\d{2}T/` 및 `last_exit=` 포함 확인).

**플랫폼 skip 정책**:
- 최상위 `describe('run-codex.sh wrapper', { skip: bashCommand === null }, ...)` 스킵 조건을 이미 따른다. 별도 `it.skip` 로 추가 스킵을 걸지 **않는다**. Windows 에서 Git Bash 가 있다면 정상 실행, 없다면 상위 describe 가 통째로 skip.
- Windows 특이 path issue 등으로 assertion 이 실패한다면 구현 쪽에서 해결 (path 는 `path.join` 사용, 개행은 `/\r?\n/` 로 관용). `it.skip` 사용은 최후 수단.

**flag auto-remove case 는 추가하지 않는다** — 예산 절감. 제거 동작은 코드 리뷰 + 수동 smoke 로 계약 보증.

**확장하지 말 것**: tokens.json 관련 기존 case, Windows header case, status-tick 계열 case, cmd wrapper describe 블록 전혀 수정 금지. helper 함수 signature 변경 금지 (단 `ShellStubMode` union 에 `'fail-403'` 한 항목 추가만 허용).

### (4) `CLAUDE.md` — 훅 강제 메커니즘 표에 row 1줄 append

**위치**: `## 훅 강제 메커니즘 — MD보다 스크립트` 섹션의 표. 마지막 row (`| Audit skip directive | ... |`) **바로 아래**, `**원칙**:` 문단 **바로 위** 에 아래 1줄 append:

```
| Codex 호출 실패 시 | `scripts/run-codex.sh` + `.vibe/agent/codex-unavailable.flag` | 3회 retry 소진 시 flag touch + stderr CODEX_UNAVAILABLE 블록 출력. Orchestrator 는 flag 존재 시 Generator 위임 대신 사용자 승인 분기 진입. 다음 성공 호출 시 flag auto-remove. |
```

- 표 앞뒤 header 변경 금지. 기존 row 순서 변경 금지. 열 구분자 `|` 와 공백은 기존 표 패턴 그대로.
- `<!-- END:HARNESS:hook-enforcement -->` 마커는 표의 `**원칙**:` 문단 **뒤에** 있으므로 건드리지 않는다.

### (5) `docs/context/codex-execution.md` — 403 troubleshooting 섹션 append

파일 **말미** (`## 8. 변경 이력` 블록 **뒤**) 에 신규 섹션 하나를 추가한다. 섹션 제목은 **정확히** 아래와 같이:

```
## Codex 403 Forbidden troubleshooting
```

**내용 요구사항 (의도 중심, 정확한 wording 은 Generator 재량이지만 아래 bullet 전부 포함)**:

- **증상**: `backend-api/codex/responses` 403 Forbidden 연속 반환. dogfood10 iter-1 hotfix 시점에 관측됨.
- **감지 메커니즘**: `run-codex.sh` 가 3회 retry 소진 후 `.vibe/agent/codex-unavailable.flag` 파일을 touch 한다. 동시에 stderr 에 `CODEX_UNAVAILABLE` 블록이 출력된다. flag 파일 내용은 ISO8601 timestamp + last exit code + reason hint (403-forbidden / 401-unauthorized / 429-rate-limit / 5xx-server-error / unknown).
- **Orchestrator 대응 3단계** (stderr 블록 의 (1)(2)(3) 과 동일한 순서 · 문구):
  1. 시간차 재시도 — edge block 인 경우 수십 분 후 복구 관찰됨 in dogfood10.
  2. 사용자 승인 하에 Orchestrator 직접 편집 + `[decision][orchestrator-hotfix]` session-log 기록 필수.
  3. `.vibe/config.json.providers` 에 fallback provider 추가 후 재시도.
- **자동 복구**: 다음 성공 호출 시 `scripts/run-codex.sh` 가 flag 파일을 `rm -f` 로 제거. flag 는 "현재 Codex 가 계속 unreachable 한가" 의 snapshot.
- **알려진 root causes (판별 불가)**: rate-limit / CF edge block / 계정 fingerprint. 명확한 판별 방법 없음. 사용자 토큰이 98% 여유였음에도 403 이 반환된 dogfood10 사례 기록.

섹션 아래에 추가 bullet / code sample 은 LOC 예산 안에서만 허용. 기존 §1~§8 수정 금지.

## 테스트 지침

- 신규 case 이름: **`'exhausts retries and emits CODEX_UNAVAILABLE signal + flag file'`** (정확히 이 문자열. self-QA grep 대상).
- 실행 명령 (Orchestrator 가 샌드박스 밖에서 돌림): `node --import tsx --test test/run-codex-wrapper.test.ts`.
- 기존 case 전부 pass 유지. retry `fail` 케이스에 영향이 가지 않도록 `ShellStubMode` 에 `'fail-403'` 한 가지만 새로 추가.
- 신규 case 는 **cwd 를 tmp dir 로 격리** 하여 진짜 워크스페이스의 `.vibe/agent/` 를 더럽히지 않는다. `makeTempDir('run-codex-unavailable-')` 패턴 재활용.
- Generator 가 샌드박스 안에서 `node --test` 호출 불가 → §13 invariants 따라 Generator 는 test 파일 작성만. 실행은 Orchestrator 가 sandbox 밖에서 수행. Final report 의 `## Sandbox-only failures` 섹션에 `node --import tsx --test test/run-codex-wrapper.test.ts` 를 명시적으로 기록 (§13.1 참조).

## 최종 self-QA 체크리스트

Final report 끝에 10개 항목 전체를 명시적으로 pass/fail 로 기록:

1. `grep -n 'codex-unavailable\.flag' scripts/run-codex.sh` 결과 **≥2 hit** (실패 경로 touch + 성공 경로 `rm -f`).
2. `grep -n 'rm -f .*codex-unavailable\.flag' scripts/run-codex.sh` 결과 ≥1 hit.
3. `grep -n 'CODEX_UNAVAILABLE' scripts/run-codex.sh` 결과 ≥1 hit + 해당 stderr 블록이 위 (1)번 정의된 literal 과 문자 단위로 일치.
4. `grep -n '.vibe/agent/codex-unavailable.flag' .gitignore` 결과 1 hit.
5. `grep -n 'exhausts retries and emits CODEX_UNAVAILABLE signal + flag file' test/run-codex-wrapper.test.ts` 결과 1 hit. (Orchestrator 재검증 시 `node --import tsx --test` 로 해당 case pass.)
6. `grep -n 'codex-unavailable' CLAUDE.md` 결과 1 hit, 위치는 훅 강제 메커니즘 표 내부.
7. `grep -n '## Codex 403 Forbidden troubleshooting' docs/context/codex-execution.md` 결과 1 hit, 위치는 파일 말미 (§8 변경 이력 이후).
8. `npx tsc --noEmit` clean — 기존 테스트 타입이 `ShellStubMode` 확장과 호환되는지 재확인.
9. 기존 `test/run-codex-wrapper.test.ts` 의 기존 모든 case pass 유지 (회귀 방지, 특히 retry `fail` / stdin / Windows header / status-tick 계열 5+ case).
10. `git diff --stat HEAD` 기준 **net LOC ≤ 50**. 초과 시 범위 축소.

(8)~(10) 은 Generator 가 Final report 에 명시, Orchestrator 가 밖에서 재검증.

## 리포트 형식

Final report 는 `.vibe/agent/_common-rules.md` §9 형식 + §14.4 Wiring Integration 섹션을 반드시 포함. template:

```markdown
## Files added
- (none — 본 Sprint 는 기존 파일 확장만)

## Files modified
- scripts/run-codex.sh — 실패 경로 flag touch + stderr CODEX_UNAVAILABLE 블록, 성공 경로 flag 제거
- test/run-codex-wrapper.test.ts — 신규 case 1개 + ShellStubMode 'fail-403' 추가
- .gitignore — codex-unavailable.flag 경로 등록
- CLAUDE.md — 훅 강제 메커니즘 표에 row 1줄
- docs/context/codex-execution.md — ## Codex 403 Forbidden troubleshooting 섹션 추가

## Verification
| command | exit |
|---|---|
| grep -c 'codex-unavailable\.flag' scripts/run-codex.sh | ≥2 |
| grep -c 'CODEX_UNAVAILABLE' scripts/run-codex.sh | ≥1 |
| grep -c '.vibe/agent/codex-unavailable.flag' .gitignore | 1 |
| grep -c 'codex-unavailable' CLAUDE.md | 1 |
| grep -c '## Codex 403 Forbidden troubleshooting' docs/context/codex-execution.md | 1 |
| (sandbox-only) npx tsc --noEmit | deferred to Orchestrator |
| (sandbox-only) node --import tsx --test test/run-codex-wrapper.test.ts | deferred to Orchestrator |

## Sandbox-only failures
- npx tsc --noEmit — §13 무결성 유지 차원; Orchestrator 재실행
- node --import tsx --test test/run-codex-wrapper.test.ts — Generator 샌드박스에서 `node --test` 미허용

## Deviations
- none  (or: 이유와 함께 명시)

## Wiring Integration

| Checkpoint | Status | Evidence |
|---|---|---|
| W1 CLAUDE.md hook 테이블 | touched | CLAUDE.md:<line> (row `Codex 호출 실패 시`) |
| W2 CLAUDE.md 관련 스킬 | n/a | 신규 슬래시 커맨드 없음 |
| W3 Sprint flow 번호 | n/a | 사이클 절차 변경 없음 |
| W4 .claude/settings.json hook | n/a | 이벤트 기반 신규 스크립트 없음 |
| W5 .claude/settings.json statusLine | n/a |  |
| W6 sync-manifest files.harness[] | n/a | 신규 하네스 파일 없음 (기존 scripts/run-codex.sh 확장만) |
| W7 sync-manifest files.hybrid{}.harnessKeys | n/a | settings.json / package.json / config.json 신규 top-level key 없음 |
| W8 README.md 사용자 가시 섹션 | n/a | npm script / 슬래시 커맨드 / 사용자 대면 기능 변경 없음 |
| W9 package.json scripts.vibe:* | n/a | 신규 npm script 없음 |
| W10 docs/release/vX.Y.Z.md | n/a | harnessVersion bump 는 M3 |
| W11 migrations/X.Y.Z.mjs | n/a | schema / state file 구조 변경 없음 |
| W12 test 회귀 방지 | touched | test/run-codex-wrapper.test.ts (case `exhausts retries and emits CODEX_UNAVAILABLE signal + flag file`) |
| W13 docs/context/harness-gaps.md | n/a (or: touched — finding-b cover 상태 갱신 필요 시 Orchestrator 판단) | — |
| W14 .gitignore 런타임 artifact | touched | .gitignore:<line> `.vibe/agent/codex-unavailable.flag` |
| D1~D6 삭제/이름변경 | n/a | 본 Sprint 는 기존 파일 확장만, 파일/심볼 제거·리네임 없음 |

verified-callers:
- scripts/run-codex.sh (flag write/read) → CLAUDE.md 훅 강제 메커니즘 표:<line> (Orchestrator 가 "flag 존재 시 사용자 승인 분기 진입" 문서화로 인식), docs/context/codex-execution.md `## Codex 403 Forbidden troubleshooting` 섹션 (대응 절차), test/run-codex-wrapper.test.ts (회귀 테스트)
- .vibe/agent/codex-unavailable.flag (runtime artifact) → .gitignore:<line> (commit 차단), scripts/run-codex.sh 양쪽 경로 (생성/제거)
```

- §14.4 규정대로 `## Wiring Integration` 섹션이 **없으면 Sprint 미완료** 로 간주되어 Codex 재위임. 반드시 포함.
- `<line>` 자리는 실제 diff 를 기준으로 Generator 가 채운다.
- W13 (harness-gaps.md) 은 관련 gap 상태 갱신이 필요할 수도 있으므로 **파일 존재 여부만 확인 후** 상태 미확실이면 `n/a — Orchestrator 판단 위임` 으로 기록해도 된다 (상위 Orchestrator 가 후속 편집).

## BLOCKED 처리 규칙 (`docs/context/codex-execution.md §4`)

- 위 "Files Generator may touch" 외부 파일 수정 시도 금지.
- Sprint 범위 내에서 fix 불가 판단 시 STOP 후 Final report 의 `## BLOCKED` 섹션에 (Item / Reason / Required scope expansion) 기재 + 정상 종료 (exit 0). Orchestrator 가 spec 수정 후 재투입한다.
- "어떻게든 동작하게" 식 runtime hardcoded bypass 금지.
