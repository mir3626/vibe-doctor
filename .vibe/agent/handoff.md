# Orchestrator Handoff — vibe-doctor

<!-- vibe:auto-state:start -->
> Auto-captured git snapshot (PreCompact); not a substitute for the narrative below.
> Captured: 2026-09-22T04:22:37.214Z
> Branch: main @ 5d5743c feat(harness): release v1.16.0 Stagehand browser automation
> Uncommitted: 47 file(s)
> - M .claude/skills/test-patterns/typescript-stagehand.md
> -  M .vibe/agent/handoff.md
> -  M .vibe/agent/iteration-history.schema.json
> -  M .vibe/agent/project-map.schema.json
> -  M .vibe/agent/session-log.md
> -  M .vibe/agent/sprint-api-contracts.schema.json
> -  M .vibe/agent/sprint-status.schema.json
> -  M .vibe/agent/tokens.json
> -  M .vibe/config.json
> -  M .vibe/harness/schemas/pro-roundtrip-alignment-brief.schema.json
> -  M .vibe/harness/schemas/pro-roundtrip-contract.schema.json
> -  M .vibe/harness/schemas/pro-roundtrip-event-complete.schema.json
> -  M .vibe/harness/schemas/pro-roundtrip-flow.schema.json
> -  M .vibe/harness/schemas/pro-roundtrip-operator-close.schema.json
> -  M .vibe/harness/schemas/pro-roundtrip-report-input.schema.json
> -  M .vibe/harness/schemas/sidecar-artifact.schema.json
> -  M .vibe/harness/schemas/sidecar-input.schema.json
> -  M .vibe/harness/scripts/vibe-gen-schemas-impl.ts
> -  M .vibe/harness/scripts/vibe-init-ready.mjs
> -  M .vibe/harness/scripts/vibe-preflight.mjs
> - ... +27 more
> Staged: none; Unstaged: 35 files changed, 568 insertions(+), 286 deletions(-)
> Recent commits:
> - 5d5743c feat(harness): release v1.16.0 Stagehand browser automation
> - f8737a5 docs: record v1.15.5 publication and verification
> - 7ad858f fix(harness): release v1.15.5 bounded review inputs
> - ddffb1d docs: record v1.15.4 publication and verification
> - 40114f4 fix(harness): release v1.15.4 Astra role and prompt alignment
<!-- vibe:auto-state:end -->

PROJECT NOT INITIALIZED.
This is the upstream template; downstream product work still requires /vibe-init.

## Current — v1.16.0 published, v1.17.0 prepared and held / 2026-09-22

- v1.16.0 is published: release commit `5d5743c7739ce9618647d5d0affe1c19fd7b471c`, annotated
  tag object `1c8ba07a23fc9d39f91d5f639eafa6362a98e09b`, atomic origin main+tag push verified.
  Keep the tag immutable. The user then asked to stop before any further deployment.
- v1.17.0 is prepared in the working tree and NOT committed (the earlier v1.16.1 draft was folded
  into it): (1) harness runtime on `zod@^4.6.5` with `zod-to-json-schema` removed; `vibe:gen-schemas`
  uses native `z.toJSONSchema` (draft-07, input side, inlined reuse, preprocess unwrapped) inside the
  old `$ref`/`definitions`/`$schema` envelope; 13 regenerated schemas are semantically equivalent
  (0 findings after `$ref` resolution), source changes limited to `z.record(z.string(), ...)` ×7 and
  `ZodType`; the three Pro protocol schema files changed bytes, so the protocol namespace derives a
  new generation downstream (by design). (2) `/vibe-sync` section-merge parses described markers
  (`BEGIN:SPRINT_ROLES (...)`), discovers nested blocks and re-applies preserved sections in a second
  pass (vibe-office role table loss). (3) `vibe-session-log-sync` keeps `[decision][tag]` clusters
  contiguous and canonicalizes spaced ones, with tolerant init-ready / preflight planner-skip gates.
  Dry-run merge of the real vibe-office CLAUDE.md preserved its role table and PROJECT:custom-rules
  while harness sections took upstream. Awaiting user approval to commit/tag/push v1.17.0 and then
  patch vibe-office (also needs `npm install zod@^4` there).
- vibe-office facts: harness 1.15.5 (installed field 1.8.3), 23 dirty files of product work,
  `@browserbasehq/stagehand` already in devDependencies, `vibe:test-ui` still points at the retired
  wrapper, browserSmoke enabled with `dist/web`, and its `origin` remote points at the vibe-doctor
  repository, so never push from vibe-office until its remote is corrected.
- Original v1.16.0 context: user directive to replace Playwright with Stagehand. The Codex quota
  was exhausted, so the Orchestrator (Claude Fable 5.1) wrote the source directly under the
  recorded `[decision][orchestrator-hotfix]`; the Planner (fable, fresh context) prompt at
  `docs/prompts/sprint-stagehand-migration.md` served as the self-QA checklist and caught three
  corrections (sprint-mode retirement list, 1.7.0 fixture, conventions marker rewrite).
- v1.16.0 shipped 38 tracked changes, 5 retired Playwright files and 7 new files (shared
  `scripts/lib/stagehand-browser.mjs`, `vibe-stagehand-test.mjs`, `test/stagehand/dashboard-report.test.ts`,
  `stagehand-wrapper.test.ts`, `migrations/1.16.0.mjs`, `test-patterns/typescript-stagehand.md`,
  `docs/release/v1.16.0.md`); devDependencies swapped `@playwright/test` for `@browserbasehq/stagehand@^4.1.0`.
- v1.16.0 was verified outside any sandbox: harness typecheck, build, generated-schema check, forced
  `vibe:verify` (9 groups, 618 tests / 617 pass / 1 conditional skip / 0 fail incl. 59 Pro), sync /
  sprint-mode / four shard / codex-wrapper (working-tree) / config / rule audits, real `vibe:test-ui`
  on system Chrome (2/2, 12.8 s, screenshots in `.tmp/stagehand-20260922/evidence/`), real
  `vibe:browser-smoke` against a local fixture (pass, console-error fail, missing-selector timeout,
  HTTP 404, unreachable server, disabled, not-installed exit 2), zero leftover Chrome processes.
  `vibe:codex-wrapper-audit -- --tracked` and remote CI need the files staged/committed first.
- Stagehand v4 facts that shaped the code (verified): `browser.context` needs `Stagehand.create`
  (no `model` required, `logging: off`); Chrome auto-detected per platform or `CHROME_PATH`; console
  events are raw CDP `Runtime.consoleAPICalled`; `waitForSelector` is CSS/XPath only, so the smoke
  runner polls `locator().count()/isVisible()`; a refused connection resolves `goto` with a
  `chrome-error://` page instead of throwing. See `.tmp/stagehand-20260922/stagehand-v4-api.md`.

## Scope and preservation

- Historical artifacts intentionally still mention Playwright: old release notes, migrations
  1.7.0/1.7.13, the 1.7.0 migration fixture in `sync.test.ts`, the legacy clause in `qa.ts`, the
  retirement list in `vibe-sprint-mode.mjs`, and the 1.16.0 migration itself.
- Local reports, plans, prompts, archive, tokens.json and `.tmp/` evidence remain unstaged and are
  not template payload. No downstream sync, product experiment or Pro lifecycle write was made.
- Downstream note for the eventual sync: after `vibe:sync`, run
  `npm uninstall @playwright/test && npm install -D @browserbasehq/stagehand`; Chrome must be
  installed (or `CHROME_PATH` set); migration 1.16.0 removes retired files only when unmodified and
  re-points the conventions `VIBE:TEST-PATTERNS` block. Preserve the installed
  browserSmoke.policy=off customization in any later authorized sync.

## Next steps

1. User decides whether to commit/tag/push v1.17.0 (release commit + annotated `v1.17.0`). The
   full forced `vibe:verify` was skipped by user directive for this release; if it is wanted before
   publication, run `npm run vibe:verify -- --force` on the final tree. Before committing, stage the
   payload (exclude `tokens.json`, drafts, reports, `.tmp/`) and run
   `npm run vibe:codex-wrapper-audit -- --tracked`, then confirm remote CI after the push
   (`verify` job relies on the runner's system Chrome; `chromiumSandbox: false` is the documented
   fallback if the Linux launch is sandbox-blocked).
2. vibe-office patch (held): fix its `origin` remote first (it points at vibe-doctor), then
   `vibe:sync` from the v1.17.0 tag, `npm install zod@^4`, confirm `vibe:test-ui` points at the
   Stagehand wrapper, run the migration report check, and re-run its init-ready gate. Never push
   from vibe-office while its remote is wrong.
3. Do not recreate or move v1.16.0, v1.15.5 or any prior published tag.
