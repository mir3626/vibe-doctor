# run-codex.sh — Windows sandbox verify skip header

## Background

`run-codex.sh` 매 호출 시 Codex 가 sandbox 내부에서 `npx tsc / npm test / preflight / gen-schemas --check` 등을 시도하여 **spawn EPERM** 으로 실패. 각 시도 4~10초 × 여러 번 누적 **60~120초 waste per call**. Orchestrator 는 이미 sandbox 밖에서 재검증하므로 Codex 의 이 시도는 불필요.

## Fix

`scripts/run-codex.sh` 의 `_common-rules.md` prepend 지점 (현재 line 391-396 근처) 을 확장:

- **Host OS 감지**: `uname -s` + `$OS` env 로 Windows 여부 판정.
  - `MINGW*`, `MSYS*`, `CYGWIN*` prefix 중 하나이거나 `$OS == "Windows_NT"` → Windows.
- **Windows 일 때만** 추가 header 를 `_common-rules.md` 앞에 prepend. 다른 OS 는 기존 동작 유지.

Header 내용 (한국어 + 영어 혼용):

```md
## Host OS sandbox limitation (auto-injected)

현 호스트는 Windows. Codex sandbox 는 Windows 에서 child process spawn 을 대부분 차단 (spawn EPERM). 다음 명령은 Codex self-verify 단계에서 시도 금지 — 실패 확정이며 wall-clock 만 소모한다:

- `npx tsc --noEmit`, `npm test`, `node --test`
- `node scripts/vibe-preflight.mjs`
- `node scripts/vibe-gen-schemas.mjs --check`
- `tsx` / `esbuild` 또는 기타 child process spawn 을 필요로 하는 명령

대신 **static inspection** (파일 read + 타입/패턴 분석) 만으로 Acceptance Criteria 판정. 실제 실행 검증은 Orchestrator 가 sandbox 밖에서 수행.

Final report `## Sandbox-only failures` 섹션에 위 명령 언급 불필요 — Windows 는 기본값.

---
```

이 header 를 `_common-rules.md` content 앞에 붙인 뒤 기존 prepend 흐름으로 prompt 에 합류.

## Non-Windows 보존

macOS / Linux 에서는 **header 미주입**. 기존 Codex 가 sandbox 에서 tsc/test 를 정상 실행할 수 있는 환경에서는 이 최적화 필요 없음.

## 로그 line 추가

```
[run-codex] injected Windows sandbox limitation header
```

(Windows 감지 시에만 stderr 출력.)

## Acceptance

1. `npx tsc --noEmit` 0 errors.
2. `npm test` 0 failures (기존 210 pass / 0 fail / 1 skip 유지).
3. macOS / Linux 에서 `run-codex.sh` 실행 시 OS 감지 분기가 header 를 **추가하지 않음** (verify 는 shell inspection — bash script 분기 조건만 확인).
4. Windows 에서는 stderr 에 `injected Windows sandbox limitation header` 출력 확인.

## Files

- `scripts/run-codex.sh` (수정 ~20 lines add)
- `test/run-codex-wrapper.test.ts` 확장 — OS 감지 분기 mock 또는 spawnEnv override 로 prepend 여부 검증 1~2 test.

## Non-goals

- `run-codex.cmd` 수정 금지 — Windows 전용이므로 PowerShell 에서는 항상 이 header 추가 (또는 그냥 skip). 이번 scope 밖.
- `_common-rules.md` 자체 수정 금지 — 공통 규칙은 OS 무관.
- Codex CLI 의 sandbox config 변경 금지.
- 다른 OS 에서의 sandbox 동작 검토 금지 — 현재 Windows 만 증거 있음.
