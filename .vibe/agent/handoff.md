# Orchestrator Handoff — vibe-doctor

<!-- vibe:auto-state:start -->
> Auto-captured git snapshot (PreCompact); not a substitute for the narrative below.
> Captured: 2026-09-22T05:24:13.656Z
> Branch: main @ a95b4d5 fix(harness): release v1.17.1 zod 4 error-message assertion hotfix
> Uncommitted: 14 file(s)
> - M .vibe/agent/handoff.md
> -  M .vibe/agent/session-log.md
> -  M .vibe/agent/tokens.json
> - ?? .tmp/
> - ?? .vibe/archive/handoff-before-review-92-fixes-upstream-2026-09-22.md
> - ?? docs/plans/astra-harness-implementation.md
> - ?? docs/prompts/goal-vibe-goal-iterate-pro-decoupling.md
> - ?? docs/prompts/sprint-stagehand-migration.md
> - ?? docs/reports/astra-harness-implementation-2026-09-07.md
> - ?? docs/reports/astra-role-improvements-2026-09-09.md
> - ?? docs/reports/review-0-2026-09-07.md
> - ?? docs/reports/review-0-2026-09-09.md
> - ?? docs/reports/review-92-remediation-2026-09-22.md
> - ?? docs/reports/vibe-goal-iterate-pro-decoupling-handoff-20260831.md
> Staged: none; Unstaged: 3 files changed, 13 insertions(+), 5 deletions(-)
> Recent commits:
> - a95b4d5 fix(harness): release v1.17.1 zod 4 error-message assertion hotfix
> - 409e8e8 docs: record v1.17.0 publication and downstream syncs
> - ac705a4 feat(harness): release v1.17.0 zod 4 runtime and sync/session-log fixes
> - 5d5743c feat(harness): release v1.16.0 Stagehand browser automation
> - f8737a5 docs: record v1.15.5 publication and verification
<!-- vibe:auto-state:end -->

PROJECT NOT INITIALIZED.
This is the upstream template; downstream product work still requires /vibe-init.

## Current — v1.17.1 published; downstream osint + vibe-office on 1.17.1 / 2026-09-22

- v1.17.1 hotfix published (commit `a95b4d5b5b87634150723de88565ac8eabc3781e`, tag object
  `00299f51903e56947bda187b6f35c7871e0e1781`): v1.17.0 CI failed on one Pro roundtrip CLI test that
  asserted the zod 3 issue message for a missing classification key; the assertion now accepts the
  zod 4 code too. Full forced verify passed (622 / 621 / 1 skip / 0 fail). Downstream re-synced with the
  same recipe: osint `0294d756` (21 customizations restored) and vibe-office `8a06562`, both pushed.

- v1.16.0 is published: release commit `5d5743c7739ce9618647d5d0affe1c19fd7b471c`, annotated
  tag object `1c8ba07a23fc9d39f91d5f639eafa6362a98e09b`, atomic origin main+tag push verified.
  Keep the tag immutable. The user then asked to stop before any further deployment.
- v1.17.0 is published (commit `ac705a4361ebe7411896cfe7f0943af17a4369fc`, tag object
  `237e09bc47b21df0a4c68d3a9e6d06e2ef2138f5`, atomic main+tag push). Contents: (1) harness runtime on `zod@^4.6.5` with `zod-to-json-schema` removed; `vibe:gen-schemas`
  uses native `z.toJSONSchema` (draft-07, input side, inlined reuse, preprocess unwrapped) inside the
  old `$ref`/`definitions`/`$schema` envelope; 13 regenerated schemas are semantically equivalent
  (0 findings after `$ref` resolution), source changes limited to `z.record(z.string(), ...)` ×7 and
  `ZodType`; the three Pro protocol schema files changed bytes, so the protocol namespace derives a
  new generation downstream (by design). (2) `/vibe-sync` section-merge parses described markers
  (`BEGIN:SPRINT_ROLES (...)`), discovers nested blocks and re-applies preserved sections in a second
  pass (vibe-office role table loss). (3) `vibe-session-log-sync` keeps `[decision][tag]` clusters
  contiguous and canonicalizes spaced ones, with tolerant init-ready / preflight planner-skip gates.
  Dry-run merge of the real vibe-office CLAUDE.md preserved its role table and PROJECT:custom-rules
  while harness sections took upstream. Full forced verify was skipped by user directive for this release.
- Downstream smart-merge upgrades (run with the upstream v1.17.0 sync code so the fixed section-merge applied):
  osint-stock-screener 1.15.5->1.17.0 committed `7b2839b76e05c8d59852bb3541815d01b395c30f` and pushed to
  origin/improve/post-refactor-all (18 customizations restored, 3 files 3-way merged, Codex mirror re-synced,
  stagehand devDep added, @playwright/test kept for the product smoke); vibe-office ->1.17.0 committed
  `3b59cbc4ff06c6d3966dc0c231c1cea815e17f1e` and pushed to origin/main. Root zod stays ^3 in both; the user migrates product code to zod 4
  and `vibe:gen-schemas` works only after that. A zod/v4 subpath compatibility patch was drafted and dropped.
- vibe-office facts after the sync: harness 1.17.0, `@browserbasehq/stagehand` in devDependencies,
  `vibe:test-ui` on the Stagehand wrapper, browserSmoke enabled with `dist/web`, root zod ^3 (user
  migrates), and its `origin` remote now points at the vibe-office repository (it pointed at vibe-doctor
  earlier in the day; the user corrected it before the push).
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
  not template payload. No product experiment or Pro lifecycle write was made; the two downstream
  syncs above are the only downstream changes.
- Downstream sync recipe that worked (reuse for other projects): run the upstream sync code from the
  downstream root (`node --import tsx <vibe-doctor>/.vibe/harness/src/commands/sync.ts --dry-run --json`,
  then `--force`), snapshot conflicted files first, 3-way merge them afterwards
  (`.tmp/stagehand-20260922/downstream/smart-merge.mjs`: ours snapshot / base = previous tag / theirs =
  synced file), re-copy merged `.claude` shards to their `.codex` mirrors, then install
  `@browserbasehq/stagehand` (keep `@playwright/test` only for product suites); Chrome must be installed
  (or `CHROME_PATH` set). osint keeps browserSmoke.policy=off and ignores several `.claude/skills` dirs,
  so stage with `--ignore-errors --pathspec-from-file`.

## Next steps

1. Confirm remote CI for v1.17.1 (v1.16.0 CI passed incl. the Linux Stagehand UI run; v1.17.0 failed only on
   the zod-message assertion fixed in v1.17.1).
2. Downstream zod 4 migrations (product code + root `zod@^4`, drop `zod-to-json-schema` where only the
   harness used it) are user-owned; until then `vibe:gen-schemas` fails downstream with zod 3.
3. Do not recreate or move v1.17.1, v1.17.0, v1.16.0, v1.15.5 or any prior published tag.
