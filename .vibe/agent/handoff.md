# Orchestrator Handoff

PROJECT NOT INITIALIZED.

This file is project-owned runtime state. Downstream projects must run `/vibe-init` before product work; init rewrites this placeholder with the current project's handoff.

## 1. Identity

- repo: `vibe-doctor`
- status: template placeholder
- harnessVersion: `1.7.16`

## 2. Status

The checked-in upstream template intentionally does not ship active project handoff state.

Maintenance checkpoint: upstream harness scripts were refactored, Codex Markdown auto-injection coverage was expanded, the Codex wrapper now supports Markdown injection diagnostics and explicit shard-block transitive injection, Codex skill wrappers now point at repository-root shared skill paths through injection shard markers, README release/guide content was sharded with wrapper injection coverage for the new guide/index files, vibe-init now keeps Phase 1 in the main skill while Phase 2, Phase 3, Phase 4, and global rules live in guarded phase shards with preflight/CI audit coverage plus a Codex wrapper diagnostic fixture, vibe-interview now lives in guarded section shards with invocation-step/order audit coverage and a Codex wrapper diagnostic fixture, vibe-iterate now lives in guarded phase shards with phase/order audit coverage and a Codex wrapper diagnostic fixture, vibe-review now lives in guarded section shards with its own preflight/CI audit and Codex wrapper diagnostic fixture, skill shard audits share a small common parser/path/effective-text helper while keeping skill-specific checks local, vibe-sprint-mode now has a permission audit that locks preset allow/deny drift, broad wildcard deny guards, docs/runtime signals, preflight, and CI, vibe-sync now has a boundary audit that locks sync manifest ownership, hybrid file contracts, post-sync verification signals, preflight/CI wiring, and Codex wrapper diagnostic coverage, Codex wrapper injection now has an all-skill audit covering wrapper/shared skill inventory, unsafe path rejection, transitive shard targets, compact skill injection targets, preflight, CI, and runtime diagnostic regression tests, `docs/context/md-injection-guarantees.md` now lists guaranteed wrapper MD injection scope plus current non-guarantees and improvement candidates, dashboard/report HTML renderers now live in dedicated `scripts/lib/*template.mjs` modules with a template split regression test while keeping synchronous render flow intact, final pre-commit cleanup aligned the README command inventory while adding a sync audit guard that keeps root `README.md` out of full harness ownership, and README/guide/sync-skill docs now match the `.vibe/harness/**` runtime layout, package script inventory, and root README sync boundary. This is template maintenance state only; downstream projects still start by running `/vibe-init`.

## 3. Next Action

Run `/vibe-init` in a downstream project to create project-specific context, sprint state, handoff, and session log.
