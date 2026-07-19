---
name: vibe-pro-go
description: Codex wrapper that resumes the newest matching Web Pro bridge flow and continues implementation, reporting, feedback remediation, approval, or close with minimal user prompting.
---

# vibe-pro-go for Codex

This repository keeps provider-neutral skill runbooks under `.claude/skills`.

<!-- BEGIN:VIBE-CODEX:SHARDS -->
- `.claude/skills/vibe-pro-go/SKILL.md`
<!-- END:VIBE-CODEX:SHARDS -->

When this skill is invoked in Codex, open the repository-root path and follow:

`.claude/skills/vibe-pro-go/SKILL.md`

Codex notes:

- Bare invocation runs `npm run vibe:pro-go` and follows its next action.
- Use the deterministic runtime; do not hand-edit its worktree.
- Treat Web GitHub writes and CLI pushes as user-visible external actions.
- Automatically prepare the Pro report at the final Sprint boundary.
