---
name: maintain-context
description: Codex-compatible wrapper for the shared vibe-doctor context maintenance and Orchestrator checkpoint workflow.
---

# maintain-context for Codex

This repository keeps provider-neutral skill runbooks under `.claude/skills`.

<!-- BEGIN:VIBE-CODEX:SHARDS -->
- `.claude/skills/maintain-context/SKILL.md`
<!-- END:VIBE-CODEX:SHARDS -->

When this skill is invoked in Codex, open the repository-root path and follow:

`.claude/skills/maintain-context/SKILL.md`

Codex notes:

- Use this for Codex main Orchestrator sessions that need a manual checkpoint; Sprint Generator invocations normally hand state back through their completion report.
- Invoking this skill means the session is in Codex Orchestrator maintenance mode, not Sprint Generator mode.
- Treat Claude-specific UI references as references to the active agent session unless the source explicitly describes Claude-only behavior.
- Keep `.vibe/agent/handoff.md` and `.vibe/agent/session-log.md` current when the source skill requires context persistence.
- Apply the source runbook's document-edit rules verbatim: rewrite existing docs with native editing tools only (no shell heredocs/redirects, never read-and-write the same file in one expression), and check `git diff --stat` for unintended mass deletions in first-read documents before committing.
