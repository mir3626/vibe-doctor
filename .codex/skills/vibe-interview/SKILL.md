---
name: vibe-interview
description: Codex-compatible wrapper for the shared vibe-doctor interview workflow.
---

# vibe-interview for Codex

For a verified active GPT-6 Astra model, first read `.vibe/agent/astra-rules.md`.
Use that workflow for this skill: act on settled requirements, keep a durable
queue/design/handoff, and select relevant checks. The legacy role, interview,
per-item goal, creative, report-opening and repeated-QA ceremonies below do not
apply. Consult the remaining shards only for concrete state/command contracts;
preserve init, exact executionBinding and approval boundaries. Lower/unknown
models follow the full runbook below. Re-evaluate eligibility for each child.

This repository keeps provider-neutral skill runbooks under `.claude/skills`.

<!-- BEGIN:VIBE-CODEX:SHARDS -->
- `.claude/skills/vibe-interview/SKILL.md`
<!-- END:VIBE-CODEX:SHARDS -->

When this skill is invoked in Codex, open the repository-root path and follow:

`.claude/skills/vibe-interview/SKILL.md`

Codex notes:

- Treat Claude-specific UI references as references to the active agent session unless the source explicitly describes Claude-only behavior.
- Keep `.vibe/agent/handoff.md` and `.vibe/agent/session-log.md` current when the source skill requires context persistence.
