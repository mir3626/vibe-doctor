# Architecture Context

This repository is the upstream `vibe-doctor` template and harness source.

## Ownership Boundaries

- Harness runtime: `.vibe/harness/**`
- Harness state and schemas: `.vibe/agent/*.schema.json`, `.vibe/model-registry*.json`, `.vibe/sync-manifest.json`
- Shared provider skills: `.claude/skills/**`, `.codex/skills/**`
- Hybrid root memory: `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
- Project-owned downstream code: root `src/**`, `scripts/**`, `test/**`, `app/**`, `components/**`, `lib/**`

Root Markdown files remain hybrid because agents read them directly. Harness-owned sections are replaced by marker block merge; project sections remain untouched.

## Harness Runtime Layout

```text
.vibe/harness/
  src/commands/          # vibe:* CLI entrypoints
  src/lib/               # config, sync, review, report, schema, provider helpers
  src/providers/         # provider runner contracts
  scripts/               # executable harness scripts and Codex wrappers
  test/                  # node:test and Playwright harness tests
  migrations/            # sync migrations
  tsconfig*.json         # harness-only TypeScript projects
  playwright.config.ts   # harness UI test config
```

The root `scripts/vibe-sync-bootstrap.mjs` file is a compatibility bridge for legacy raw-URL bootstrap instructions. It is not the canonical runtime location.

## Execution Flow

1. `/vibe-init` creates product context and state.
2. `npm run vibe:sync` updates harness-owned files from upstream.
3. Claude remains the nominal Orchestrator; Codex is the Sprint Generator through `.vibe/harness/scripts/run-codex.sh`.
4. Codex can act as direct maintenance Orchestrator only when the user is interacting with Codex directly outside a sprint prompt.
5. `/vibe-review` is a template/harness review, not ordinary downstream product code review.

## Verification

- `npm run vibe:typecheck`
- `npm run vibe:self-test`
- `npm run vibe:build`
- `npm run vibe:test-ui`
- `npm run vibe:config-audit --silent`
