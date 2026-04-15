# Sprint M2 — 최종 수정 (cmd wrapper 테스트)

## 현상
`test/run-codex-wrapper.test.ts` 의 cmd wrapper 테스트 `returns normalized version output for healthy codex` 가 실패. `run-codex.cmd` `--health` 경로 자체가 Windows Git Bash 에서 cmd.exe 호출 시 **출력이 공백**. 수동 invocation 에서도 재현.

원인 추정: `where codex` 가 PATH 전달 과정에서 경로 변환 문제로 stub `codex.cmd` 를 못 찾거나, 혹은 `set /p _first=<...` 에서 PATHEXT 관련 resolution 실패.

## 범위 (엄격)

**옵션 A 선호**: `test/run-codex-wrapper.test.ts` 의 해당 한 테스트 케이스만 `it.skip` 처리 + TODO 주석 `TODO(M10): cmd health output empty — investigate where/set.p behavior on Git Bash-spawned cmd.exe`. 다른 cmd 테스트 (`forwards stdin through the native cmd wrapper`) 는 통과하므로 유지.

**옵션 B (시도 가치)**: `scripts/run-codex.cmd` 의 `:health` 분기를 간소화 — `codex --version 2>nul` 결과를 `for /f "delims=" %%I in ('codex --version 2^>nul') do ...` 패턴으로 capture, `where` 분기 제거 후 `codex --version` rc 검사로 대체. 이게 성공하면 옵션 A 필요 없음.

먼저 옵션 B 시도. 실패(수동 smoke 여전히 empty) 시 옵션 A 로 폴백.

## 완료 기준

| 조건 | 검증 명령 |
|---|---|
| tsc 0 errors | `npx tsc --noEmit` |
| `npm test` 전체 58/58 pass | `npm test` |

옵션 B 성공 시 테스트 skip 없이 모두 green.
옵션 A 적용 시 테스트 1개 skip 으로 통과.

## Final report
§_common-rules §9. 옵션 A/B 중 어떤 것을 적용했는지 명시.
