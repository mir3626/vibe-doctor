# Goal

> Historical implementation prompt. References to `$vibe-pro-roundtrip` use the
> pre-rename public name; the implemented entrypoint is `$vibe-pro-go`.

Implement the GitHub Pro Roundtrip design in this repository.

The feature lets Web ChatGPT Pro and Codex CLI exchange detailed designs,
implementation reports, code-review feedback, remediation reports, and approvals
through the official GitHub app and the append-only
`origin/vibe-pro-bridge` branch. Do not use a custom MCP server, tunnel, browser
DOM automation, model automation, or copied credentials.

## Authoritative design

Read all of these files before planning or editing:

- `docs/plans/github-pro-roundtrip/DESIGN.md`
- `docs/plans/github-pro-roundtrip/COMMON-HARNESS.md`
- `docs/plans/github-pro-roundtrip/WEB-RUNBOOK.md`
- `docs/plans/github-pro-roundtrip/schemas/flow.schema.json`
- `docs/plans/github-pro-roundtrip/schemas/contract.schema.json`
- `docs/plans/github-pro-roundtrip/schemas/event-completion.schema.json`
- repository `AGENTS.md`
- relevant `docs/context/*.md`

Treat the design package as the settled contract. Do not rediscover the product
goal. Escalate only a material product decision or a scope boundary that cannot
be resolved from the package and repository evidence.

## Required delivery

Implement a repo-owned `$vibe-pro-roundtrip` skill and deterministic harness
runtime with these user operations:

```text
start design "<goal>"
start audit
status [flow]
sync [flow]
report [flow]
continue [flow]
close [flow]
doctor
```

Support:

- `flows/YYYYMMDD/NNN-slug`
- immutable `FLOW.json`
- append-only events with `COMPLETE.json` publication barriers
- `vibe-pro-bridge` protocol bootstrap
- detached tool-owned worktree
- non-force push with bounded non-fast-forward recovery
- protocol hash pinning
- design/contract/event validation
- Sprint envelope generation
- cumulative and final workflow gates
- implementation/remediation reports
- stale-HEAD and tamper fail-closed behavior
- Web Runbook materialization
- downstream sync and setup documentation

## Implementation shape

Prefer the repository's existing command, schema, test, skill-wrapper, and sync
patterns. Expected areas include:

```text
.vibe/harness/src/pro-roundtrip/**
.vibe/harness/src/lib/schemas/**
.vibe/harness/schemas/**
.vibe/harness/scripts/vibe-pro-roundtrip.mjs
.vibe/harness/test/pro-roundtrip-*.test.ts
.claude/skills/vibe-pro-roundtrip/**
.codex/skills/vibe-pro-roundtrip/SKILL.md
docs/context/pro-roundtrip-setup.md
package.json
```

Do not change `.vibe/sync-manifest.json` merely to enumerate files already
covered by its harness and skill globs.

## Sprint constraint

Use exactly three sequential implementation Sprints unless repository evidence
shows a real blocking dependency:

### SPR-001 Contract and branch store

- Zod source schemas and generated JSON Schemas
- path parser and daily sequence allocator
- append-only/tamper validation
- detached worktree Git transport
- protocol bootstrap and focused tests

### SPR-002 CLI roundtrip loop

- commands and skill UX
- design/feedback importer
- Sprint envelope and checkpoint integration
- report/workflow matrix generation
- Claude/Codex skill wiring

### SPR-003 Cross-surface completion

- Web Runbook materialization
- cumulative/final verification enforcement
- failure recovery and stale-head coverage
- setup and M0 manual checklist
- final full verification and sync audit

Do not create extra Sprints for file organization, documentation, or isolated
test cleanup. If scope must expand, record the exact reason before changing the
Sprint structure.

## Verification contract

Per Sprint:

- run targeted unit/component tests
- run cumulative integration checks for every shared seam changed so far
- persist a compact handoff and exact next action
- bind completion to design event, Sprint ID, and code HEAD

Before final completion, regardless of whether the change is classified as
product or harness work:

- run `npm run vibe:typecheck`
- run `npm run vibe:build`
- run all focused Pro Roundtrip tests
- run `npm run vibe:self-test`
- run `npm run vibe:sync-audit`
- run relevant skill/wrapper audits
- run `npm run vibe:checkpoint`
- validate generated JSON Schemas
- verify encoding integrity for every touched text file
- inspect the full base..head diff for workflow wiring omissions

Do not mark the flow complete merely because each Sprint's unit tests pass.

## External action boundary

- Do not push or create the remote bridge branch without user authorization.
- Do not create a PR for `vibe-pro-bridge`.
- Do not modify the default branch through GitHub connector actions.
- Do not force push.
- Do not run a live Web Pro write test without the user's explicit participation.
- Keep the live private-repository M0 checklist as a release gate if it cannot be
  completed in the implementation session.

## BLOCKED rule

If the implementation cannot satisfy an item inside the active Sprint scope:

1. Stop modifying code for that item.
2. Record:

```text
## BLOCKED
- Item:
- Reason:
- Required scope expansion or user decision:
```

3. Do not add a hardcoded bypass or silently broaden file scope.

## Completion report

Report:

- completed Sprint IDs and contract coverage
- changed files
- commits/pushes, if authorized
- targeted, cumulative, and final verification
- M0 live status
- residual risks and deferred work
- exact next action
