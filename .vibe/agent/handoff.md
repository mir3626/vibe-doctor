# Orchestrator Handoff — vibe-doctor

<!-- vibe:auto-state:start -->
> Auto-captured git snapshot; refreshed by `npm run vibe:checkpoint`.
<!-- vibe:auto-state:end -->

PROJECT NOT INITIALIZED.

This repository is the upstream `vibe-doctor` template. Downstream product work still requires `/vibe-init`; this handoff covers harness maintenance only.

## Status

- Branch: `main` (commit마다 즉시 push).
- Current maintenance: fix `vibe-pro-go go` automatic flow selection so malformed event history owned by another repository/code branch cannot block the current branch.
- Existing user-local `.vibe/agent/tokens.json` modification is unrelated and must remain uncommitted.
- No release, tag, default-branch rewrite, or `vibe-pro-bridge` publication is authorized by this maintenance task.

## Latest change — Pro flow prefilter

- Added an immutable `FLOW.json`-only read boundary at a pinned bridge commit.
- Bare automatic selection now filters repository and code-branch ownership before loading and validating a flow's complete event chain.
- Matching/current-branch flows and explicit flow selection still use `loadFlowSnapshot` and remain fail-closed on malformed events.
- This closes downstream dogfood where a historical `quant-existing-data-v1` flow with an invalid duplicate `design -> design` chain blocked bare `go` on `improve/post-refactor-all`.

## Verification

- Focused automatic-selection regressions: 4/4 PASS.
- Harness TypeScript check: PASS.
- `git diff --check`: PASS.
- Scoped ESLint is unavailable in this upstream checkout because it has no ESLint dependency/config; do not treat an `npx eslint` auto-install failure as product evidence.

## Risks and boundaries

- The selector still validates every matching flow completely before ranking it. The new prefilter does not weaken current-branch, explicit-target, protocol-generation, or immutable Git-blob validation.
- Do not hand-edit `.vibe/worktrees/pro-roundtrip` or merge `vibe-pro-bridge` into `main`.
- No downstream product behavior changes are included.

## Exact restart

1. Read this handoff and `.vibe/agent/session-log.md`; inspect `git status --short --branch`.
2. Preserve the unrelated `.vibe/agent/tokens.json` modification.
3. Run the focused Pro CLI selection tests and `npm run vibe:typecheck` after any further selector change.
4. Commit only the intended harness/context files and push `main`; do not publish a release/tag unless separately requested.
