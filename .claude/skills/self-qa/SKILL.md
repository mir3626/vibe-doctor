---
name: self-qa
description: Run or design verification before declaring a task complete.
---

For a verified active Astra-profile model (GPT-6 Astra, Claude Opus 5.5, or a registry successor marked `harnessProfile: astra`), use `.vibe/agent/astra-rules.md`
unless the legacy comparison/rollback profile was explicitly selected. It replaces
mandatory role, interview, per-item goal, creative and repeated-QA ceremonies in
this runbook. Keep the concrete initialization, state, ownership and authorization
contracts. Read remaining shards on demand. Lower/unknown models use the full
workflow below; each child re-evaluates its own model.


Use this skill before saying work is complete.

Checklist:
- narrowest relevant test
- typecheck
- lint
- build
- smoke verification
- if not possible, create the minimum missing QA aid first
