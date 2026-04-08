#!/usr/bin/env bash
#
# run-codex.sh — UTF-8-safe wrapper for `codex exec` on Korean Windows.
#
# WHY THIS EXISTS
# ---------------
# Korean Windows defaults to CP949 (chcp 949). When `codex exec` runs
# without UTF-8 forced, the Rust binary, its spawned subprocesses, and any
# .NET/Python tooling underneath fall back to system ANSI. The result: any
# non-ASCII string literal (Korean, Japanese, emoji, …) gets round-tripped
# through CP949 and unmappable bytes are silently replaced with `?`
# (e.g. "상점" → "?\x81\xec\xa0\x90"). This wrapper prevents that by
# forcing UTF-8 at every layer AND telling codex to propagate UTF-8 into
# every subshell it spawns via `shell_environment_policy`.
#
# It also handles transient model "at capacity" errors with backoff
# retries, and buffers stdin so retries work even when the prompt is
# piped in.
#
# USAGE
# -----
#   cat docs/prompts/task.md | ./scripts/run-codex.sh -
#   ./scripts/run-codex.sh "implement X per docs/prompts/task.md"
#
# ENV OVERRIDES
# -------------
#   CODEX_MODEL=gpt-5-codex        -> pass `-m <name>` to codex
#   CODEX_RETRY=3                  -> max retry attempts (default 3)
#   CODEX_SANDBOX=workspace-write  -> sandbox mode
#   CODEX_EXTRA_CONFIG="-c k=v"    -> extra `-c` overrides
#
# This wrapper is the ONLY supported Codex invocation path. Orchestrator
# sprint calls, run-parallel, and manual debugging must all go through
# this script by piping a prompt file into `run-codex.sh -`.
# See docs/context/codex-execution.md for the full rationale.

set -euo pipefail

# ---------- 1. Force UTF-8 in the parent shell ----------
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8
export LANGUAGE=en_US.UTF-8
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8
export DOTNET_SYSTEM_GLOBALIZATION_USENLS=false

# ---------- 2. Flip Windows console code page to UTF-8 ----------
if command -v chcp.com >/dev/null 2>&1; then
  chcp.com 65001 >/dev/null 2>&1 || true
fi

# ---------- 3. Build codex argv ----------
sandbox="${CODEX_SANDBOX:-workspace-write}"

codex_args=(
  exec
  -s "$sandbox"
  -c 'shell_environment_policy.inherit=all'
  -c 'shell_environment_policy.set.LC_ALL="en_US.UTF-8"'
  -c 'shell_environment_policy.set.LANG="en_US.UTF-8"'
  -c 'shell_environment_policy.set.LANGUAGE="en_US.UTF-8"'
  -c 'shell_environment_policy.set.PYTHONUTF8="1"'
  -c 'shell_environment_policy.set.PYTHONIOENCODING="utf-8"'
  -c 'shell_environment_policy.set.DOTNET_SYSTEM_GLOBALIZATION_USENLS="false"'
)

if [[ -n "${CODEX_MODEL:-}" ]]; then
  codex_args+=(-m "$CODEX_MODEL")
fi

if [[ -n "${CODEX_EXTRA_CONFIG:-}" ]]; then
  # shellcheck disable=SC2206
  extra=( $CODEX_EXTRA_CONFIG )
  codex_args+=( "${extra[@]}" )
fi

# ---------- 4. Buffer stdin so retries can replay it ----------
stdin_buf=""
if [[ ! -t 0 ]]; then
  stdin_buf=$(cat)
fi

# ---------- 5. Retry loop ----------
retries="${CODEX_RETRY:-3}"
attempt=0
while :; do
  attempt=$((attempt + 1))

  set +e
  if [[ -n "$stdin_buf" ]]; then
    printf '%s' "$stdin_buf" | codex "${codex_args[@]}" "$@"
  else
    codex "${codex_args[@]}" "$@"
  fi
  rc=$?
  set -e

  if [[ $rc -eq 0 ]]; then
    exit 0
  fi

  if [[ $attempt -ge $retries ]]; then
    echo "[run-codex] giving up after $attempt attempt(s) (last exit $rc)" >&2
    exit $rc
  fi

  delay=$(( attempt * 30 ))
  echo "[run-codex] attempt $attempt failed (rc=$rc); retrying in ${delay}s..." >&2
  sleep "$delay"
done
