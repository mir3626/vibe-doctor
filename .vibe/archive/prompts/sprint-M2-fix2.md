# Sprint M2 — 추가 수정 (execFile stdin hang)

## 진단

`test/run-codex-wrapper.test.ts` 5번째 테스트 "emits retry logging and gives up after the configured attempts" 가 Node test runner 에서 **무한 hang**. 

직접 검증 결과 `run-codex.sh "prompt text"` 자체는 retry 3회 +delay 0s 조건에서 0 초에 정상 종료.

**원인**: `execFile` 의 기본 stdio 가 stdin 을 pipe 로 열어두고 쓰기를 안 하면 EOF 가 오지 않음. run-codex.sh 내 `[[ ! -t 0 ]]` 가 true 가 되어 `stdin_buf=$(cat)` 이 EOF 대기하며 무한 블로킹.

또한 2번째 테스트 "returns rc=1 when codex is missing" 도 여전히 failing. PATH=`''` 처리에서 Windows Git Bash 가 여전히 어떤 PATH 를 보는 것으로 추정.

## 범위 (엄격 준수) — test 파일만 수정

### `test/run-codex-wrapper.test.ts` 오직 이 파일만 수정

1. **test 5 ("emits retry logging")** 를 `spawnSync` 로 전환. input 에 빈 문자열 `''` 명시적으로 전달하여 stdin 을 즉시 close. 기존 assertion 로직(attempt 로그 match) 은 유지. `spawnSync` 사용 예는 같은 파일 내 test 6/7 ("preserves stdin passthrough", cmd wrapper) 참고.

2. **test 2 ("returns rc=1 when codex is missing")** 수정:
   - Git Bash 가 `/usr/bin`, `/c/Windows/System32` 같은 기본 PATH 를 가지고 있을 수 있으므로, 단순 PATH='' 가 불충분.
   - 해결책: **temporary 디렉토리만을 PATH 로 하는 것**이 아니라, 실제 `codex` 바이너리가 없는 상황을 강제. 
     - 옵션 A: `shellEnv(binDir, { PATH: binDir })` 강제 (binDir 는 비어있음). `inheritedEnv` 에서 PATH 누출 없어야.
     - 옵션 B: `spawnSync` 로 전환 + 별도 `env` 객체 (process.env 미상속) 구성: `{ PATH: binDir, HOME: os.homedir(), ... minimal }`.
   - 현재의 `shellEnv` 는 process.env 의 PATH 를 필터링하지만, 다른 환경변수 (e.g., `WINDIR=C:\Windows`) 를 통해 Windows 가 자체 PATH 를 우회 resolve 할 수 있음. 
   - **확실한 방법**: `process.env` 를 일절 상속하지 않고 최소 env 만 사용.
     ```ts
     const minimalEnv = {
       PATH: binDir,
       HOME: process.env.HOME ?? process.env.USERPROFILE ?? '',
       USERPROFILE: process.env.USERPROFILE ?? '',
       SYSTEMROOT: process.env.SYSTEMROOT ?? '',
       TEMP: process.env.TEMP ?? '',
       TMPDIR: process.env.TMPDIR ?? '',
     };
     ```
   - 이걸 rc=1 테스트 전용으로 작성.

3. **다른 테스트 (1, 3, 4, 6, 7, 8, 9)** 는 건드리지 말 것.

### 범위 밖
- `scripts/run-codex.sh` 수정 금지 (이미 retry-delay fix 적용 완료, 본 hang 은 test 측 문제).
- 다른 파일 일체 수정 금지.

## 완료 기준

| 조건 | 검증 명령 |
|---|---|
| tsc 0 errors | `npx tsc --noEmit` |
| wrapper 9/9 pass in < 30s | `timeout 60 node --import tsx --test test/run-codex-wrapper.test.ts` |
| 전체 npm test 통과 | `npm test` |

## Final report format
§_common-rules §9. Verification 표에 3개 조건 결과.
