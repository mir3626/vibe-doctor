# Sprint M2 — Platform wrappers + sandbox exclusions + retry visibility

> 공용 규칙은 `.vibe/agent/_common-rules.md` 준수. Sprint 고유 규칙만 아래에 기술.
>
> **상위 컨텍스트**: `docs/plans/sprint-roadmap.md` → §Sprint M2 slot.
> **직전 Sprint 결과 요약 (M1 passed)**: sprint-status schema 확장 (`pendingRisks`, `lastSprintScope[]`, `lastSprintScopeGlob[]`, `sprintsSinceLastAudit`, `stateUpdatedAt`, `verifiedAt`) + 신규 state 파일 `project-map.json` / `sprint-api-contracts.json` + 스키마 + `src/lib/sprint-status.ts` / `src/lib/project-map.ts` CRUD helper. `vibe-sprint-complete.mjs` 가 3종 state + audit counter 갱신. `vibe-preflight.mjs` 의 `handoff.stale` 를 `stateUpdatedAt` 기반(5min OK / 24h INFO / >24h WARN) 으로 재작성. `migrations/1.1.0.mjs` idempotent. 50/50 tests pass. **M1 Planner 경고**: `lastSprintScope` / `lastSprintScopeGlob` 는 `--scope` 입력을 verbatim 저장 → M3 는 이 포맷을 **확장** 해야 하며 rewrite 금지. 본 Sprint 는 이 state 필드들을 건드리지 않는다.
> **단일 커밋 원칙 (v1.1.1+)**: Generator 산출 파일 + 3종 state 파일을 한 커밋에 묶는다 (별도 `docs(sprint): close ...` 커밋 생성 금지).

---

## Goal

Generator runner wrapper 를 provider-agnostic 계약으로 확장한다. 구체적으로:

1. `scripts/run-codex.sh` 에 `--health` / `--version` 서브커맨드를 추가하여 exit code 기반 health check 를 제공하고, retry 로그를 stderr 로 가시화한다.
2. Windows 순수 `cmd.exe` / PowerShell 환경용 동등 계약 `scripts/run-codex.cmd` 를 신설한다.
3. `scripts/vibe-preflight.mjs` 의 `provider.codex` 체크가 config 의 raw `command --version` 이 아닌 wrapper 의 `--health` 를 호출하도록 전환한다.
4. `.vibe/agent/_common-rules.md` 에 "Sandbox-bound Generator invariants" 섹션을 추가하여 **어떤 Generator provider 든** 샌드박스 하 수행 금지 명령을 provider-agnostic 언어로 명문화한다.
5. 미래 비-Agent-tool provider 호출 경로를 위한 skeleton 템플릿 `scripts/run-claude.sh` / `scripts/run-claude.cmd` 를 **exit code 2 (not-wired) 플레이스홀더** 로 추가한다.

이 Sprint 로 M4 (model tier abstraction) 가 참조할 wrapper 패턴이 완성되고, M8 의 periodic audit 이 "공식 허용 명령" 을 판별할 계약 근거가 생긴다.

### Non-goals (defer)

- 모델 tier / registry 조회 → **M4**.
- `run-claude.*` / `run-gemini.*` 의 실제 provider 호출 로직 → **M4 이후**. 이번 Sprint 는 **stub 만** (exit 2 + 안내 메시지).
- `sprint-roadmap.md` Current pointer 갱신, prompts archive, session-log 정규화 → **M3**.
- 새 `--scope` 입력 포맷 → **M3**. `lastSprintScope` 필드 건드리지 않음.
- manifest glob 지원 → **M6**.
- browser smoke / bundle size → **M7**.

이 목록 바깥의 "개선"/"리팩터" 수행 금지 (§공용 규칙 5).

---

## Scope — files

### 생성 (ADD)

1. `scripts/run-codex.cmd` — Windows 네이티브 cmd.exe wrapper (new).
2. `scripts/run-claude.sh` — skeleton stub (exit 2 + message).
3. `scripts/run-claude.cmd` — skeleton stub (exit 2 + message).
4. `test/run-codex-wrapper.test.ts` — `--health` 및 retry 로깅 mock 단위 테스트.

### 수정 (MODIFY)

5. `scripts/run-codex.sh` — `--health` / `--version` 서브커맨드 추가 + retry 가시화 로깅 + 기존 stdin pipe 경로 유지.
6. `scripts/vibe-preflight.mjs` — `provider.*` 체크의 codex 경로를 wrapper `--health` 로 전환 (+ fallback).
7. `.vibe/agent/_common-rules.md` — `§13 Sandbox-bound Generator invariants` 섹션 추가 (기존 §1~§12 유지, §12 단일 커밋 원칙 다음 번호).
8. `.vibe/sync-manifest.json` — 신규 harness 파일 4종 등록.

### Do NOT modify

- `.vibe/config.json` (codex provider command 는 현행 유지 — wrapper 경유는 preflight 에서만 판정)
- `.vibe/config.local.example.json`
- `CLAUDE.md` (§Generator 호출 규칙 유지; provider-agnostic 언어 변경은 M4/M5 로 연기)
- `docs/context/codex-execution.md` (§3.2 표에 `--health` 언급은 Orchestrator 메타 편집 허용 범위이므로 Generator 는 건드리지 않는다)
- `.vibe/agent/sprint-status.json` / `handoff.md` / `session-log.md` (state 3종은 `vibe-sprint-complete` 전담)
- `src/lib/*` — 본 Sprint 는 shell + .mjs + test 만 변경
- M1 에서 도입된 신규 state 파일 / 스키마 / helper 전체
- 기존 `migrations/*.mjs`

---

## Technical spec

### 1. `scripts/run-codex.sh` — 서브커맨드 + retry 가시화

#### 1.1 진입 분기

스크립트 맨 앞 `set -euo pipefail` 직후, 환경 강제 (chcp / LC_ALL) **이전** 에 인자 파싱을 수행한다. bash 3.2-safe 패턴 (`[[ ... ]]` + `case`) 사용, array `${arr[@]}` 확장 시 빈 배열 보호 (bash 3.2 는 `set -u` + 빈 배열에서 unbound 에러).

```bash
# ---------- 0. Subcommand dispatch ----------
# Must run BEFORE locale forcing / chcp / stdin buffering so --health returns fast.
if [[ $# -ge 1 ]]; then
  case "$1" in
    --health|--version)
      run_health_check
      exit $?
      ;;
    --help|-h)
      print_usage
      exit 0
      ;;
  esac
fi
```

`run_health_check` 구현:

```bash
run_health_check() {
  # Exit code contract:
  #   0  = codex CLI present AND --version succeeds
  #   1  = codex CLI binary not found in PATH
  #   2  = codex CLI found but authentication/config missing
  #        (detected by --version timing out OR stderr containing "auth"/"login"/"not authenticated")
  #   3  = other (unexpected non-zero exit)
  #
  # Must be fast: hard timeout 5s. Stdin is NOT consumed.
  if ! command -v codex >/dev/null 2>&1; then
    echo "run-codex: codex CLI not found in PATH" >&2
    return 1
  fi

  local tmp_stdout tmp_stderr rc
  tmp_stdout="$(mktemp "${TMPDIR:-/tmp}/run-codex-health.XXXXXX")"
  tmp_stderr="$(mktemp "${TMPDIR:-/tmp}/run-codex-health.XXXXXX")"
  # Guard against hang on missing auth: bounded wait via background + kill.
  # (bash 3.2 has no `timeout` builtin; use coreutils `timeout` if present, else fall back.)
  if command -v timeout >/dev/null 2>&1; then
    timeout 5 codex --version >"$tmp_stdout" 2>"$tmp_stderr"
    rc=$?
  else
    codex --version >"$tmp_stdout" 2>"$tmp_stderr" &
    local pid=$!
    ( sleep 5; kill -TERM "$pid" 2>/dev/null || true ) &
    local watchdog=$!
    wait "$pid" 2>/dev/null
    rc=$?
    kill -TERM "$watchdog" 2>/dev/null || true
  fi

  if [[ $rc -eq 0 ]]; then
    # stdout usually: "codex 0.x.y" — normalize to `codex-cli <version>`
    local v
    v="$(head -n 1 "$tmp_stdout" | awk '{ for (i=1;i<=NF;i++) if ($i ~ /[0-9]+\.[0-9]+/) { print $i; exit } }')"
    if [[ -z "$v" ]]; then
      v="unknown"
    fi
    echo "codex-cli $v"
    rm -f "$tmp_stdout" "$tmp_stderr"
    return 0
  fi

  local stderr_tail
  stderr_tail="$(tail -n 20 "$tmp_stderr" 2>/dev/null || true)"
  rm -f "$tmp_stdout" "$tmp_stderr"

  # Auth-missing heuristic (exit 2)
  if echo "$stderr_tail" | grep -qiE '(not authenticated|login required|auth|OPENAI_API_KEY|unauthorized)'; then
    echo "run-codex: codex CLI present but authentication missing — run 'codex auth login' or set OPENAI_API_KEY" >&2
    return 2
  fi

  # Timeout (124 from GNU timeout) → assume auth/config hang
  if [[ $rc -eq 124 || $rc -eq 143 ]]; then
    echo "run-codex: codex --version hung (>5s) — likely auth or config issue" >&2
    return 2
  fi

  echo "run-codex: codex --version failed (rc=$rc)" >&2
  if [[ -n "$stderr_tail" ]]; then
    echo "$stderr_tail" >&2
  fi
  return 3
}
```

`print_usage`: 3~6줄로 `--health`, stdin pipe (`cat prompt.md | run-codex.sh -`), positional arg (`run-codex.sh "prompt"`) 를 명시.

#### 1.2 기존 stdin / positional 경로 유지

- `-` positional → 현행 stdin 버퍼 경로 그대로.
- 인자 없음 + stdin tty → `print_usage` + exit 1.
- 이미 존재하는 common-rules prepend / UTF-8 forcing / `shell_environment_policy` 는 변경 금지 (M1 이후 stable).

#### 1.3 Retry 가시화 로깅

현재 retry 루프는 실패 시 `[run-codex] attempt N failed (rc=X); retrying in Ys...` 만 stderr 로 남긴다. 확장:

- 매 시도 시작 전: `[run-codex] attempt <N>/<M> starting (sandbox=<sandbox>, model=<model|default>)` (stderr)
- 실패 후 재시도 시: `[run-codex] attempt <N>/<M> retrying reason=<brief> delay=<D>s` (stderr). `brief` 규칙:
  - rc 가 stderr 에 "at capacity" 포함 → `reason=capacity`
  - rc 가 124/143/timeout → `reason=timeout`
  - rc != 0 + 그 외 → `reason=exit=<rc>`
- 성공 종료 시 마지막 라인: `[run-codex] total attempts=<X> elapsed=<Y>s` (stderr). 토큰 정보는 codex stdout 에서 발견 못 할 수도 있으므로 **optional**: stdout 마지막 10 줄에서 정규식 `tokens?[: ]+([0-9]+)` 매치 시 `tokens=<N>` suffix 추가, 없으면 omit.
- 최종 실패 종료 시: `[run-codex] giving up after <X> attempts elapsed=<Y>s last_exit=<rc>` (기존 "giving up" 메시지 대체).

elapsed 측정: 최초 attempt 루프 진입 전 `start_ts="$(date +%s)"`, 종료 시 `elapsed=$(( $(date +%s) - start_ts ))`. `date +%s` 는 macOS bash 3.2 포함 POSIX.

#### 1.4 bash 3.2 / cross-platform 주의

- `mapfile` / `readarray` 금지 (bash 4+).
- `${var,,}` 소문자화 금지 (bash 4+). 필요 시 `tr '[:upper:]' '[:lower:]'`.
- `local -n` 레퍼런스 금지.
- 연상 배열 (`declare -A`) 금지.
- `[[ =~ ]]` 는 3.2 OK, 캡처 그룹 `${BASH_REMATCH[@]}` 3.2 OK.
- 이미 스크립트는 3.2-safe. 신규 코드도 동일 규칙.

### 2. `scripts/run-codex.cmd` — Windows native 동등 계약

목표: Git Bash 미설치 Windows (pure cmd.exe / PowerShell) 에서도 `run-codex.cmd --health` 및 stdin 파이프가 동작. 계약:

```batchfile
@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem --- UTF-8 code page ---
chcp 65001 >nul 2>&1

rem --- Subcommand dispatch ---
if "%~1"=="--health"  goto :health
if "%~1"=="--version" goto :health
if "%~1"=="--help"    goto :usage
if "%~1"=="-h"        goto :usage

rem --- Normal path: pipe stdin or forward args to codex exec ---
set "CODEX_SANDBOX_OPT=workspace-write"
if not "%CODEX_SANDBOX%"=="" set "CODEX_SANDBOX_OPT=%CODEX_SANDBOX%"

set "MAX_ATTEMPTS=3"
if not "%CODEX_RETRY%"=="" set "MAX_ATTEMPTS=%CODEX_RETRY%"

set /a _attempt=0
set /a _start=%TIME:~0,2%*3600 + %TIME:~3,2%*60 + %TIME:~6,2%

:attempt_loop
set /a _attempt+=1
>&2 echo [run-codex] attempt !_attempt!/%MAX_ATTEMPTS% starting (sandbox=%CODEX_SANDBOX_OPT%)

rem Forward stdin transparently; codex handles both piped and arg modes
codex exec -s %CODEX_SANDBOX_OPT% %*
set _rc=%ERRORLEVEL%

if !_rc! EQU 0 goto :done_ok
if !_attempt! GEQ %MAX_ATTEMPTS% goto :done_fail

set /a _delay=!_attempt! * 30
>&2 echo [run-codex] attempt !_attempt!/%MAX_ATTEMPTS% retrying reason=exit=!_rc! delay=!_delay!s
timeout /t !_delay! /nobreak >nul
goto :attempt_loop

:done_ok
>&2 echo [run-codex] total attempts=!_attempt!
endlocal & exit /b 0

:done_fail
>&2 echo [run-codex] giving up after !_attempt! attempts last_exit=!_rc!
endlocal & exit /b !_rc!

:health
where codex >nul 2>&1
if errorlevel 1 (
  >&2 echo run-codex: codex CLI not found in PATH
  endlocal & exit /b 1
)
rem Bounded wait: use `start /wait` + external timeout is flaky on cmd,
rem so rely on codex --version being fast when healthy.
for /f "usebackq tokens=* delims=" %%L in (`codex --version 2^>^&1`) do set "_first=%%L" & goto :health_parse
:health_parse
if "%_first%"=="" (
  >&2 echo run-codex: codex --version returned no output
  endlocal & exit /b 3
)
echo codex-cli %_first:codex =%
endlocal & exit /b 0

:usage
echo run-codex.cmd [--health^|--version^|--help] or: codex prompt via stdin/args
endlocal & exit /b 0
```

> 주의: cmd batch 는 헬스체크의 auth-missing (exit 2) 판정이 .sh 대비 거칠다. `codex --version` 이 즉시 실패하면 exit 3 으로 떨어진다. 허용. `.sh` 만 정밀 판정.

- Exit code 계약: **0/1/3 은 .sh 와 일치**. 2 (auth-missing) 는 .sh 전용 정밀 판정. .cmd 는 auth 문제도 3 으로 떨어질 수 있음을 주석으로 남긴다.
- Stdin 파이프: `codex exec` 가 직접 stdin 을 받도록 forwarding 한다 (cmd 는 `%*` 가 stdin 을 건드리지 않음).
- `timeout /t <sec> /nobreak` 로 retry backoff.

### 3. `scripts/vibe-preflight.mjs` — provider health check wrapper 전환

기존 §"4. Provider health" 블록에서 `sh(`${p.command} --version`)` 직접 호출을 다음으로 교체:

```js
function checkProviderHealth(name, p) {
  // Preferred: wrapper --health (exit code + normalized stdout)
  // Fallback: direct `${p.command} --version` if wrapper not found.
  const isWin = process.platform === 'win32';
  const wrapperSh = name === 'codex' ? resolve('scripts/run-codex.sh') : null;
  const wrapperCmd = name === 'codex' ? resolve('scripts/run-codex.cmd') : null;
  // Only 'codex' uses a wrapper right now. Claude/Gemini still direct.
  // Future M4+ may add run-claude.*/run-gemini.* wrappers — detect by filename convention.
  const candidateWrappers = [];
  if (name === 'codex') {
    if (isWin && existsSync(wrapperCmd)) candidateWrappers.push({ path: wrapperCmd, exec: (q) => `"${q}"` });
    if (existsSync(wrapperSh)) candidateWrappers.push({ path: wrapperSh, exec: (q) => `bash "${q}"` });
  }

  for (const w of candidateWrappers) {
    try {
      const out = sh(`${w.exec(w.path)} --health`);
      return { ok: true, detail: out.split('\n')[0], level: 'ok' };
    } catch (err) {
      // capture exit code if available
      const rc = err && typeof err.status === 'number' ? err.status : null;
      if (rc === 1) return { ok: false, detail: `${name} CLI not found in PATH (wrapper --health rc=1)`, level: 'fail' };
      if (rc === 2) return { ok: false, detail: `${name} CLI present but authentication missing (wrapper --health rc=2)`, level: 'fail' };
      // rc === 3 or unknown → fall through to direct fallback (maybe wrapper itself is broken)
    }
  }

  // Fallback: direct command
  try {
    const v = sh(`${p.command} --version`);
    return { ok: true, detail: `${v.split('\n')[0]} (direct; wrapper not used)`, level: 'warn' };
  } catch {
    return {
      ok: false,
      detail: `${p.command} CLI not found or not authenticated - check: ${p.command} --version`,
      level: 'fail',
    };
  }
}
```

- `sh` 는 현재 execSync 래퍼 → `err.status` 로 exit code 접근.
- 결과를 `record(`provider.${name}`, ...)` 에 매핑. rc=1/2 는 기존과 마찬가지로 fail, 메시지만 명확화.
- bash wrapper 호출 경로는 Windows 에서 Git Bash PATH 에 bash 있다고 가정 (CI / 로컬 모두 true). bash 없으면 cmd wrapper fallback.
- `level: 'warn'` — wrapper 경유 실패했지만 direct 로 성공한 경우 (wrapper 자체 문제 가능성) INFO/WARN 으로 노출하여 Orchestrator 가 wrapper 수리를 인지.

기존 `needed.size === 0` / no-config 분기는 그대로.

### 4. `.vibe/agent/_common-rules.md` — §13 신설

기존 §12 (Sprint 완료 단일 커밋 원칙) 뒤에 다음 섹션을 **그대로** 추가. 기존 §1~§12 및 그 내부 하위 항목은 건드리지 않는다.

```markdown
## 13. Sandbox-bound Generator invariants

Generator (현 Codex / 향후 다른 provider 도 해당) 는 공급자·모델과 무관하게 다음 명령을 샌드박스 내에서 실행하지 않는다. 하네스가 보장하는 Generator 의 책임 ceiling 은 "파일 작성 + 정적 분석 + self-contained 단위 smoke" 까지다. 그 너머는 Orchestrator 가 샌드박스 밖에서 수행할 post-handoff 검증 영역이다.

### 13.1 Generator MUST NOT attempt

- **패키지 매니저 네트워크 설치**: `npm install`, `npm ci`, `pnpm install`, `yarn`, `pip install`, `pipx install`, `cargo add`, `cargo install`, `go get`, `apt-get install`, `brew install` 등. (§2 중복 강조 — provider-agnostic 재언급.)
- **Integration / E2E / property 테스트 러너**: `vitest run` (watch 모드 제외), `jest --runInBand`, `pytest` (단위 스모크 아닌 전체 디렉토리), `cargo test` (release 프로파일), `go test ./...`, `playwright test`, `cypress run`.
- **프로덕션 빌드**: `vite build`, `webpack --mode production`, `next build`, `cargo build --release`, `go build -ldflags` (배포용 최적화), `tsc -p tsconfig.build.json` (빌드 산출 생성 목적), `pyinstaller`, `docker build`.
- **브라우저 / 실제 런타임 smoke**: Playwright / Puppeteer headed 혹은 headless, Selenium, Electron headed, devtools 연결.
- **장기 실행 watch**: 위 러너의 `--watch` 형태 포함 (프로세스 미종료로 Sprint 지연).

### 13.2 Generator responsibility ceiling (MAY do)

- 정적 타입 체크: `tsc --noEmit`, `mypy <path>`, `ruff check`, `cargo check`, `go vet`, `pyright` (network-free 버전), `eslint . --quiet` (로컬 설정 범위).
- Self-contained 단위 smoke: `node --experimental-strip-types test/foo.test.ts` 형태, `pytest tests/unit/test_foo.py -k single`, `cargo test --lib <module>` (단일 모듈). 외부 네트워크 / DB / 브라우저 의존 0.
- 생성된 스모크 스크립트를 한 번 실행해 exit 0 확인.

### 13.3 Orchestrator post-handoff verifications

Generator report 를 받은 뒤 Orchestrator 가 샌드박스 밖에서 수행:

- 전체 테스트 (`npm test`, `pytest`, `cargo test` 등)
- 프로덕션 빌드 + bundle size 게이트 (M7 이후)
- 브라우저 smoke (M7 이후)
- E2E / integration (`playwright test`, `cypress run`)
- `npm install` 을 포함한 네트워크 설치
- 런타임 배포 smoke (dev 서버 기동 포함)

### 13.4 근거 (왜 이 분리인가)

- Generator 샌드박스 는 네트워크 차단 + 프로세스 시간 제한 + 워크스페이스 외부 쓰기 금지. 위 "MUST NOT" 명령은 거의 필연적으로 이 제약에 부딪혀 **Generator 가 우회 패치를 남기거나 (§1 위반) 혹은 반복 실패로 Sprint 를 지연** 시킨다.
- Orchestrator 는 하네스 host 환경에서 제약 없이 실행 가능하며, 실패 시 Sprint 를 BLOCKED 로 리턴하고 Planner/Evaluator 를 소환해 적절히 분기한다.
- 본 섹션은 §1 (샌드박스 우회 금지) / §2 (의존성 설치 금지) / §7 (Sandbox × Orchestrator 계약) 의 단편들을 **명령 레벨 whitelist/blacklist** 로 구체화한 것이다. 충돌 시 §1/§2/§7 원칙이 우선.
```

### 5. `scripts/run-claude.sh` — skeleton stub

```bash
#!/usr/bin/env bash
# run-claude.sh — placeholder for future non-Agent-tool Claude invocation path.
#
# Currently, Claude-family providers (claude-opus / claude-sonnet) are invoked
# via Claude Code's Agent tool (model parameter). No wrapper needed.
#
# This stub exists so the wrapper contract (run-<provider>.sh) is uniform across
# providers for tooling (preflight health check, vibe-sync manifest scan) that
# assumes a wrapper per sprintRole. It exits with code 2 to signal "not wired".
#
# Do NOT implement real invocation here without a corresponding Sprint plan
# (M4+). If you need to call Claude CLI from shell today, use:
#   claude -p "<prompt>"
# directly per .vibe/config.json providers.claude-opus.command.

set -eu

case "${1:-}" in
  --health|--version)
    echo "run-claude: not wired — Claude is invoked via Claude Code Agent tool" >&2
    exit 2
    ;;
  *)
    echo "run-claude.sh is a placeholder (exit code 2). See comment at top of file." >&2
    exit 2
    ;;
esac
```

### 6. `scripts/run-claude.cmd` — skeleton stub

```batchfile
@echo off
setlocal
if "%~1"=="--health"  goto :stub
if "%~1"=="--version" goto :stub
>&2 echo run-claude.cmd is a placeholder (exit code 2). See run-claude.sh header comment.
endlocal & exit /b 2
:stub
>&2 echo run-claude: not wired — Claude is invoked via Claude Code Agent tool
endlocal & exit /b 2
```

### 7. `.vibe/sync-manifest.json`

`files.harness` 배열 끝에 다음 4 entry 를 추가 (기존 항목 순서/값 유지):

```json
"scripts/run-codex.cmd",
"scripts/run-claude.sh",
"scripts/run-claude.cmd",
"test/run-codex-wrapper.test.ts"
```

migrations map / hybrid / project 섹션은 건드리지 않는다.

---

## Test strategy

### 8. `test/run-codex-wrapper.test.ts`

vitest + `child_process.spawn` mocking. 테스트 환경은 이미 node 24 + vitest 설정됨. 목적: **shell 스크립트 자체의 flag 파싱 / exit code / stderr 포맷** 을 Node 레이어에서 검증하여 cross-platform 회귀 방지.

접근:

1. `execFileSync('bash', ['scripts/run-codex.sh', '--health'])` 로 실제 스크립트 실행. `codex` 바이너리를 PATH 에서 stub 으로 대체하기 위해 임시 디렉토리에 `codex` 실행 파일 (bash 스크립트) 을 만들고 `PATH` 를 override.
   - 정상 시나리오: stub 이 `codex 0.9.1` 출력 + exit 0 → wrapper stdout `codex-cli 0.9.1`, exit 0.
   - not-found 시나리오: 빈 디렉토리를 PATH 로 → exit 1, stderr 에 "not found".
   - auth-missing 시나리오: stub 이 stderr "not authenticated" + exit 1 → wrapper exit 2.
   - timeout 시나리오: stub 이 `sleep 30` → wrapper exit 2 (timeout 경로).
2. retry 로깅: stub 이 exit 1 을 3회 반환 → stderr 에 `attempt 1/3 retrying reason=exit=1`, `attempt 2/3 retrying`, `giving up after 3 attempts` 모두 포함. `CODEX_RETRY=3` 환경에서 확인.
3. stdin 파이프 보존: stub 이 stdin 을 그대로 반환 → `echo "hello" | run-codex.sh -` 결과 stdout 에 "hello" 포함, 기존 common-rules prepend 동작 유지.
4. Windows 스킵: `describe.skipIf(process.platform !== 'win32' && !process.env.CI_TEST_CMD)` 로 cmd 테스트는 CI Windows runner 에서만 실행 (로컬 개발 skip). cmd 스크립트는 `cmd /c scripts\\run-codex.cmd --health` 로 invoke.

최소 test case 수: **6** (health-ok / not-found / auth-missing / timeout / retry-logging / stdin-passthrough). cmd 변형은 1~2개 skipIf 로.

### 9. 기존 테스트 회귀

- `test/sync.test.ts` — manifest 에 신규 4 파일이 등록되어 있는지 스냅샷성 assertion 이 있다면 업데이트. 없다면 이번 Sprint 에서 추가하지 않는다 (M6 glob 작업에서 전면 재작성 예정).

### 10. 수동 검증 (Orchestrator side)

Generator report 이후 Orchestrator 가 샌드박스 밖에서:

- `bash scripts/run-codex.sh --health` → 0 + `codex-cli <version>`
- `node scripts/vibe-preflight.mjs` → `provider.codex` detail 이 wrapper 경유 ("wrapper --health" 혹은 "direct; wrapper not used") 확인
- `bash scripts/run-claude.sh --health` → exit 2
- Windows 환경 있으면 `cmd /c scripts\\run-codex.cmd --health` → 0

이 항목들은 Generator 의 체크리스트가 아니다 (§13.2 ceiling 외). Generator report 에는 **tsc + wrapper 테스트만** 실행하도록 한정.

---

## Module API (보존 / 신규 없음)

본 Sprint 는 새 TypeScript 모듈을 추가하지 않는다. `src/lib/*` 변경 없음.

---

## 완료 체크리스트 (Generator 준수)

- [ ] `scripts/run-codex.sh` 에 `--health` / `--version` / `--help` 서브커맨드 분기 추가. 기존 stdin pipe / positional arg / common-rules prepend / UTF-8 환경 변수 / `shell_environment_policy` / retry 루프 모두 보존.
- [ ] `scripts/run-codex.sh` 의 retry 로깅이 §1.3 포맷을 따른다 (attempt starting / retrying reason=/giving up / total attempts).
- [ ] `run_health_check` exit code: 0=healthy / 1=not-found / 2=auth-or-timeout / 3=other.
- [ ] `scripts/run-codex.cmd` 신규, Windows cmd/PowerShell 에서 `--health` / stdin pipe / 3회 retry 동작. Exit code 0/1/3 은 .sh 와 일치.
- [ ] `scripts/run-claude.sh` / `scripts/run-claude.cmd` skeleton 신규, 항상 exit 2 + "not wired" stderr 메시지.
- [ ] `scripts/vibe-preflight.mjs` 의 `provider.codex` 체크가 wrapper `--health` 경유 + 실패 시 direct fallback (WARN). 기타 provider (claude-opus 등) 는 현행 direct 경로 유지.
- [ ] `.vibe/agent/_common-rules.md` 에 §13 "Sandbox-bound Generator invariants" 섹션 추가. §1~§12 수정 금지.
- [ ] `.vibe/sync-manifest.json` harness 배열에 4 entry 추가. 다른 섹션 변경 금지.
- [ ] `test/run-codex-wrapper.test.ts` 최소 6 test case (4 scenarios + retry + stdin passthrough). cmd 변형은 `skipIf` 로 platform gate.
- [ ] `npx tsc --noEmit` 0 errors.
- [ ] `npm test` 신규 + 기존 모두 pass. 기존 test 회귀 없음.
- [ ] Encoding integrity (§ codex-execution.md): 수정/신규 파일 모두 UTF-8. cmd 파일은 UTF-8 without BOM 으로 저장 (cmd.exe 가 BOM 에 민감).
- [ ] Do NOT modify 목록의 어떤 파일도 diff 에 포함되지 않는다 (특히 `CLAUDE.md`, `.vibe/config.json`, M1 state 파일들).

---

## 검증 명령 (Final report Verification 표 필수)

| command | 기대 exit |
|---|---|
| `npx tsc --noEmit` | 0 |
| `npm test` | 0 |
| `bash scripts/run-codex.sh --help` | 0 |
| `bash scripts/run-claude.sh --health` | 2 |

> `bash scripts/run-codex.sh --health` 는 Generator 샌드박스에서 codex CLI 가용성에 의존하므로 **실행하지 않는다** (§13.1 — 외부 CLI 네트워크/auth 의존). 대신 `test/run-codex-wrapper.test.ts` 의 stub 기반 단위 테스트로 계약을 검증하고, 실 binary 검증은 Orchestrator post-handoff 몫. Sandbox-only failures 섹션에 "run-codex.sh --health against real codex binary — Orchestrator verify" 로 기록.

---

## Out of scope (reminder)

- 모델 tier / registry 해석 → **M4**
- Native interview / Ouroboros 제거 → **M5**
- stack/framework pattern shards + manifest glob → **M6**
- Phase 0 seal / README skeleton / bundle size / browser smoke → **M7**
- Periodic audit / /vibe-review skill → **M8**
- Statusline / permission presets → **M9**
- Integration smoke / v1.2.0 릴리스 → **M10**

---

## Final report 형식

공용 규칙 §9 준수 + 다음 필수 섹션:

```markdown
## Files added
- scripts/run-codex.cmd — …
- scripts/run-claude.sh — …
- scripts/run-claude.cmd — …
- test/run-codex-wrapper.test.ts — …

## Files modified
- scripts/run-codex.sh — …
- scripts/vibe-preflight.mjs — …
- .vibe/agent/_common-rules.md — §13 추가
- .vibe/sync-manifest.json — harness 4 entry 추가

## Verification
| command | exit |
|---|---|
| npx tsc --noEmit | 0 |
| npm test | 0 |
| bash scripts/run-codex.sh --help | 0 |
| bash scripts/run-claude.sh --health | 2 |

## Sandbox-only failures
- bash scripts/run-codex.sh --health against real codex binary — Orchestrator verify
- cmd /c scripts\\run-codex.cmd --health on Windows native shell — Orchestrator verify (Git Bash WSL 샌드박스에서 재현 불가)

## Deviations
- (있으면 이유와 함께. 없으면 "none".)

## Risks raised for later Sprints
- (선택. M3/M4 에 전달할 risk 가 있으면 기록 — `pendingRisks` 주입은 M8 에서 자동화되므로 본 Sprint 는 텍스트로만.)
```

