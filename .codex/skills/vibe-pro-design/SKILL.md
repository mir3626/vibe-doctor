---
name: vibe-pro-design
description: Codex-compatible wrapper for the shared vibe-doctor pro-design workflow. Use when a new feature goal must be sent to a web ChatGPT Pro session as a design request and the resulting design package installed under docs/plans.
---

# vibe-pro-design for Codex

This repository keeps provider-neutral skill runbooks under `.claude/skills`.

<!-- BEGIN:VIBE-CODEX:SHARDS -->
- `.claude/skills/vibe-pro-design/SKILL.md`
<!-- END:VIBE-CODEX:SHARDS -->

When this skill is invoked in Codex, open the repository-root path and follow:

`.claude/skills/vibe-pro-design/SKILL.md`

Codex notes:

- Treat Claude-specific UI references as references to the active agent session unless the source explicitly describes Claude-only behavior.
- Keep `.vibe/agent/handoff.md` and `.vibe/agent/session-log.md` current when the source skill requires context persistence.
- Never push branches or automate the ChatGPT browser session; the runbook's manual-transport boundaries apply verbatim.
