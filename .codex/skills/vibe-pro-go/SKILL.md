---
name: vibe-pro-go
description: Codex wrapper that safely inspects the local Web Pro pointer on bare invocation and explicitly resumes, reports, remediates, approves, force-closes, or normally closes a selected bridge flow.
---

# vibe-pro-go for Codex

This repository keeps provider-neutral skill runbooks under `.claude/skills`.

<!-- BEGIN:VIBE-CODEX:SHARDS -->
- `.claude/skills/vibe-pro-go/SKILL.md`
<!-- END:VIBE-CODEX:SHARDS -->

When this skill is invoked in Codex, open the repository-root path and follow:

`.claude/skills/vibe-pro-go/SKILL.md`

Codex notes:

- Bare invocation runs `npm run vibe:pro-go`, reports the local-only pointer
  status, and stops. It never infers a flow, syncs, or creates scaffolding.
- Resume only from an explicit user request and the deterministic selector rules
  in the shared skill. Never turn a bare invocation into `go`, `bootstrap`, or
  `start`.
- Use the deterministic runtime; do not hand-edit its worktree.
- Treat Web GitHub writes and CLI pushes as user-visible external actions.
- `force-close --publish --user-approved` always requires fresh user approval;
  auto-publish does not authorize it.
- Automatically prepare the Pro report at the final Sprint boundary.
