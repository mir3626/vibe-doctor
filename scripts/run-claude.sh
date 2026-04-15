#!/usr/bin/env bash
# run-claude.sh - placeholder for future non-Agent-tool Claude invocation path.
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
    echo "run-claude: not wired - Claude is invoked via Claude Code Agent tool" >&2
    exit 2
    ;;
  *)
    echo "run-claude.sh is a placeholder (exit code 2). See comment at top of file." >&2
    exit 2
    ;;
esac
