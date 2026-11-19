---
name: vibe-sync
description: Sync vibe-doctor harness/template updates while preserving project-owned code and rules. Use when the statusline or preflight reports a newer or mismatched harness version, or the user asks for /vibe-sync or npm run vibe:sync.
---

`/vibe-sync` updates harness-owned files from upstream according to `.vibe/sync-manifest.json`. It must preserve project-owned source, product context, local provider settings, and `PROJECT:*` marker blocks.

## When To Run

- Session start or statusline reports that a harness update is available.
- The user explicitly asks for `/vibe-sync` or `npm run vibe:sync`.
- Preflight reports a harness version mismatch.

## Flow

1. Run `npm run vibe:sync -- --dry-run` and inspect the plan.
2. Explain any `conflict` rows to the user unless they already authorized forceful sync. Without a terminal to answer in, run with `--keep-local` (keep local edits) unless the user chose `--force` (take upstream).
3. Run `npm run vibe:sync`.
4. Let post-sync verification run:
   - harness-only typecheck via `.vibe/harness/tsconfig.harness.json`
   - bootstrap preflight via `.vibe/harness/scripts/vibe-preflight.mjs --bootstrap`
5. If sync fails, use `.vibe/sync-backup/<timestamp>/` for recovery context.

## Hybrid files

`CLAUDE.md`, `AGENTS.md`, `GEMINI.md` (section-merge) and `.claude/settings.json`, `package.json`, `.vibe/config.json` (json-deep-merge) keep their project sections and keys. For the harness-owned sections and keys, sync records each one's hash in `.vibe/sync-hashes.json` (`regions`) and compares what upstream shipped last time, the local text and the new upstream:

- Only the project changed it: the local text stays, and the plan says `kept local: …`.
- Both changed it: a `conflict` row names the sections or keys. Accepting takes upstream there and still keeps the project sections and keys; skipping keeps the local text there and reports it again on the next sync.
- No history yet (the first sync with this code): sync clones the installed version once as the base. If that fails, a section or key that differs from upstream is a conflict.

The same base settles harness-owned files that have no recorded hash (a project made from the template): a file identical to the installed version's copy is replaced, and only one that differs from it is a conflict "without sync history".

## Safety Gate

Run this before and after changing sync boundaries or the sync runbook:

```bash
npm run vibe:sync-audit
```

The audit must pass before release because `/vibe-sync` is allowed to replace
harness-owned files across downstream projects. It verifies that the manifest
does not move project-owned source, context, runtime state, provider settings,
or product scripts into harness ownership.

## Options

| Flag | Purpose |
|---|---|
| `--dry-run` | Print the plan only. |
| `--force` | Take upstream for every conflict: harness files are replaced; hybrid files take upstream only in the conflicting sections or keys. |
| `--keep-local` | Keep the local side of every conflict and apply the rest; each kept conflict is reported again on the next sync. Use it for non-interactive runs (agents, CI) unless the user chose upstream. |
| `--from <path>` | Use a local upstream checkout instead of cloning. |
| `--ref <tag>` | Override the upstream git ref for this run. |
| `--no-backup` | Skip backup creation. |
| `--no-verify` | Skip post-sync typecheck/preflight. |
| `--json` | Print the plan as JSON. |

## Legacy Bootstrap

For old projects that cannot run the normal sync path yet, run the standalone bootstrap once from the project root. It understands current glob-based manifests and copies `.vibe/harness/**` before normal `/vibe-sync` is available.

Local clone:

```bash
git clone --depth 1 https://github.com/mir3626/vibe-doctor /tmp/vibe-doctor
node /tmp/vibe-doctor/.vibe/harness/scripts/vibe-sync-bootstrap.mjs
```

Compatibility raw URL, kept for legacy docs:

```bash
curl -sL https://raw.githubusercontent.com/mir3626/vibe-doctor/main/scripts/vibe-sync-bootstrap.mjs | node --input-type=module -
```

The root `scripts/vibe-sync-bootstrap.mjs` file is only a compatibility bridge. The canonical harness runtime lives under `.vibe/harness/**`.

## Upstream Ref Contract

- exact `vX.Y.Z` or `X.Y.Z`: hard pin
- caret `^vX.Y.Z` or `^X.Y.Z`: floating compatible range
- branch names such as `main`: use as-is
- missing `upstream.ref`: use cached latest when newer than installed, then current `harnessVersion`, then `main`

Default templates use caret refs so plain `/vibe-sync` advances to the latest compatible harness version. Use exact refs only when an intentional pin is needed.

## Boundaries

- Root `src/**`, `scripts/**`, `test/**`, `app/**`, `components/**`, and `lib/**` are project-owned after v1.7.0.
- Harness runtime, tests, migrations, and configs live under `.vibe/harness/**`.
- Root agent-memory Markdown files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) stay hybrid through marker blocks. Root `README.md` is not full harness-owned; use a future marker strategy before syncing project README content.
- `package.json` sync owns `scripts.vibe:*` and `engines`; product scripts such as `test`, `build`, `typecheck`, and `test:ui` are project-owned.
