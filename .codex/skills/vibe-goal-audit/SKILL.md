---
name: vibe-goal-audit
description: Codex-compatible wrapper for the shared vibe-doctor goal-audit workflow. Use when the last goal implementation must be sent to a web ChatGPT Pro review session and the resulting design package installed under docs/plans.
---

# vibe-goal-audit for Codex

This repository keeps provider-neutral skill runbooks under `.claude/skills`.

<!-- BEGIN:VIBE-CODEX:SHARDS -->
- `.claude/skills/vibe-goal-audit/SKILL.md`
<!-- END:VIBE-CODEX:SHARDS -->

When this skill is invoked in Codex, open the repository-root path and follow:

`.claude/skills/vibe-goal-audit/SKILL.md`

Codex notes:

- Treat Claude-specific UI references as references to the active agent session unless the source explicitly describes Claude-only behavior.
- Keep `.vibe/agent/handoff.md` and `.vibe/agent/session-log.md` current when the source skill requires context persistence.
- Never push branches or automate the ChatGPT browser session; the runbook's manual-transport boundaries apply verbatim.
