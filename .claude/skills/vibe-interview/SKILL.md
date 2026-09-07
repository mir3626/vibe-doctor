---
name: vibe-interview
description: Native socratic interview runbook for `/vibe-init` Phase 3. The Orchestrator hosts the LLM internally and pipes structured prompts through `.vibe/harness/scripts/vibe-interview.mjs`.
---

For a verified active GPT-6 Astra model, use `.vibe/agent/astra-rules.md`
unless the legacy comparison/rollback profile was explicitly selected. It replaces
mandatory role, interview, per-item goal, creative and repeated-QA ceremonies in
this runbook. Keep the concrete initialization, state, ownership and authorization
contracts. Read remaining shards on demand. Lower/unknown models use the full
workflow below; each child re-evaluates its own model.


## When To Invoke

Use this skill in `/vibe-init` Phase 3. It replaces the previous Ouroboros interview flow.

The sections below are mandatory and ordered. Codex wrapper injection follows
only explicit shard blocks, so every section shard must stay listed here.

<!-- BEGIN:VIBE-INTERVIEW:SECTION-SHARDS -->
- `.claude/skills/vibe-interview/sections/invocation-protocol.md`
- `.claude/skills/vibe-interview/sections/operating-modes.md`
- `.claude/skills/vibe-interview/sections/termination-consensus.md`
- `.claude/skills/vibe-interview/sections/output-artifacts.md`
<!-- END:VIBE-INTERVIEW:SECTION-SHARDS -->
