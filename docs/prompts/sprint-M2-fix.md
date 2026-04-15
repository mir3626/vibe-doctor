# Sprint M2 — 긴급 수정

## 현상

`npm test` (Windows Git Bash, Node 24) 에서 `test/run-codex-wrapper.test.ts` 9개 테스트 중 5번째 테스트("emits retry logging and gives up after the configured attempts") 에서 **300초+ 무한 행** 발생. 4번째까지는 정상 실행. 그 이후 테스트는 시작조차 안 됨.

또한 2번째 테스트 "returns rc=1 when codex is missing" 은 **assertion failure** (✖).

M2 Sprint 의 다른 산출(scripts/run-codex.sh, .cmd, preflight 연동 등) 은 모두 유지. **본 프롬프트는 본 테스트 파일 + run-codex.sh 의 retry 경로 오류만 수정**.

## 범위 (엄격 준수)

### 1. `test/run-codex-wrapper.test.ts` 수정
- **retry 테스트를 환경변수로 가속**: `CODEX_RETRY_DELAY` 와 같은 env var 를 run-codex.sh 에 주입하여 retry 간 sleep 을 0 초(또는 1 이하) 로 강제. 기본값은 현재의 30/60s 유지. 테스트에서만 `CODEX_RETRY_DELAY: '0'` 혹은 적절한 env 를 전달.
- **rc=1 missing-codex 테스트 실패 원인 수정**: PATH 설정 또는 assertion 조정. 현재 `shellEnv(binDir, { PATH: '' })` 로 PATH 를 비우는 전략이 Windows Git Bash 에서는 Windows PATH 가 여전히 상속될 가능성. 해결 방법:
  - (a) `shellEnv` 가 `PATH: ''` 를 받으면 `...process.env` 로부터 PATH 를 누출시키지 않도록, 명시적으로 빈 PATH 를 강제 (`PATH: path.delimiter` 또는 소거).
  - (b) 또는 테스트에서 환경에 PATH 를 제거한 깨끗한 env 를 전달 (`const { PATH: _, ...rest } = process.env` 후 rest 사용).
  - 올바른 접근을 선택해 구현.
- **모든 9개 테스트가 동시에 10초 이내 완료** 되도록 전체 budget 재설정.

### 2. `scripts/run-codex.sh` retry 경로 수정
- 기본 30/60 초 sleep 을 `CODEX_RETRY_DELAY` env 로 오버라이드 가능하게. 명시 없으면 기존 30/60 유지.
- 값이 `0` 이면 sleep 자체를 스킵.
- 로그 포맷은 기존 유지: `attempt N/M retrying reason=exit=<rc> delay=<D>s`. 여기서 `<D>` 는 실제 적용된 delay 값(0 포함) 이 나와야 함.
- 테스트 `assert.match(stderr, /attempt 1\/3 retrying reason=exit=1 delay=30s/)` 같은 hardcoded 기대값을 필요시 테스트 쪽에서 조정 (env=0 이면 `delay=0s` 로).

### 3. `scripts/run-codex.sh` 의 health check / retry 경로 보호
- 어떤 경우에도 **bash 프로세스가 3 attempts 이후 반드시 종료** (while true 없음, 명시적 카운터).
- 현재 hang 원인을 분석: 아마 `sleep 30` 호출이 Git Bash 에서 signal 이 잘못 전달되거나 timeout 과 상호작용에서 멈추는 것으로 추정. 동일 증상이 있으면 `sleep` 을 `read -t <sec>` 패턴 또는 직접 `read -t $delay < /dev/null || true` 로 대체.

## 완료 기준 (기계적)

| 조건 | 검증 명령 |
|---|---|
| tsc 0 errors | `npx tsc --noEmit` |
| wrapper 테스트 9/9 pass in < 10s | `timeout 30 node --import tsx --test test/run-codex-wrapper.test.ts` |
| 전체 `npm test` pass | `npm test` 전체 |
| run-codex.sh 기본 동작 불변 (CODEX_RETRY_DELAY 미설정 시 30/60s retain) | 코드 리뷰 |

## 범위 밖
- 다른 M2 산출 파일 일절 손대지 않음 (run-codex.cmd, run-claude.*, _common-rules.md, sync-manifest.json 등)
- 새 파일 생성 금지. 오직 `test/run-codex-wrapper.test.ts` + `scripts/run-codex.sh` 2개만 수정.

## Final report format
§_common-rules §9. Verification 표에 위 4개 조건 수행 결과 명시.
