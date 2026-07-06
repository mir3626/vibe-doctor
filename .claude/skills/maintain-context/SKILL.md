---
name: maintain-context
description: Update durable context shards and run checkpoint validation when project rules, architecture, workflows, or long-running Orchestrator state changes.
---

# maintain-context

Use this skill when durable project context must survive a provider restart, chat compaction, or a handoff to another agent/session.

## When To Run

- After a meaningful Orchestrator decision, design review, release, tag, push, or sync.
- Before ending a long Orchestrator session after non-trivial work.
- Before starting a risky multi-file change if recent discussion contains state that is not yet in files.
- When a provider has no native compaction hook and the user asks to preserve or checkpoint context.
- When behavior, architecture, conventions, or workflow rules change.

Generator agents normally do not need this workflow. Sprint state is handed back through their completion report and the Orchestrator-owned sprint scripts.

## Workflow

1. Update only the relevant shard docs for behavior, architecture, conventions, QA, or workflow changes. Remove stale or duplicate guidance.
2. Modify or rewrite existing documents with the native Edit/Write tools only. Never rewrite an existing file through shell heredocs, redirects, or inline scripts, and never open a file in write mode while reading the same file inside one expression — evaluation order truncates the file before the read happens, so the "rewrite" silently writes back nothing. The Edit tool fails loudly on a mismatch and cannot empty a file; that guarantee is the point.
3. Rewrite `.vibe/agent/handoff.md` as compact active state: current branch/version, latest completed work, open risks, and exact restart steps only. Archive or summarize old history instead of appending another long section.
4. Append one concise entry to `.vibe/agent/session-log.md` with an ISO timestamp and a useful tag such as `[decision]`, `[harness-review]`, or `[checkpoint]`.
5. If sprint status changed, update `.vibe/agent/sprint-status.json` through the appropriate harness script rather than manual JSON edits.
6. Run `npm run vibe:checkpoint` when available. If the package script is absent, run `node .vibe/harness/scripts/vibe-checkpoint.mjs`.
7. If checkpoint fails, fix the stale/missing state files and rerun it. Do not report context as preserved until the check passes.
8. Before committing the pass, inspect `git diff --stat`. If a first-read document (CLAUDE.md, AGENTS.md, docs/context shards, handoff.md) shows an unintended mass deletion or a pure-deletion line count, stop, find the cause, and restore the file from git before continuing. A "successful rewrite" in memory and a pure-deletion diff cannot both be true — the diff is the truth.
9. Mention the context files and checkpoint result in the final report.

## Codex Orchestrator Note

Codex does not provide Claude Code's native `PreCompact` or context-threshold hooks. For Codex used as the main Orchestrator, this skill is the portable replacement: checkpoint at work boundaries, not token-percentage events. The goal is not to imitate an automatic 80% hook; it is to ensure a new session can resume by reading `handoff.md`, `session-log.md`, and `sprint-status.json`.
