# Orchestrator Handoff — vibe-doctor

PROJECT NOT INITIALIZED.
This is the upstream template; downstream product work still requires /vibe-init.

## Current — v1.20.1 release and downstream sync in progress / 2026-10-20

- Release base: upstream `main` at `5a12182`, latest published tag `v1.20.0`.
  The user authorized publishing `v1.20.1` and syncing `vibe-office` plus
  `osint-stock-screener`, preserving their project-specific work.
- Changed `C:/Users/Tony/.codex/skills/limit-break/SKILL.md` and
  `references/domain-playbook.md`: select useful outcome/depth/adjacent methods,
  connect primary inputs and assumptions to evidence, distinguish measured
  outcomes from model review, and keep compact proposals free of exemplar quotas.
- `.vibe/agent/astra-rules.md` now applies deeper evidence planning only to
  material uncertainty or outcome claims. Known-cause repairs and routine edits
  retain targeted checks; no new phase, document, reviewer, tool, or approval gate.
- Verification: `npm run vibe:verify` with the Astra profile passed eight selected
  groups, including typecheck; 558 tests / 556 pass / 2 test skips / 0 fail.
  Unrelated Pro roundtrip was not selected. Skill validation and fresh app-server
  `skills/list` passed: one enabled user skill at the expected path, zero errors.
- An independent six-case proposal/interpretation check exposed an ambiguous
  compact-briefing quota; the two quality-gate bullets now explicitly exempt
  compact proposals. This is instruction validation, not a product-quality A/B.
- Release metadata is aligned to `1.20.1`; all eight release-owned files are staged.
  Full forced release verification passed all nine groups: 625 tests / 624 pass /
  1 conditional skip / 0 fail. Build, Stagehand UI 2/2, tracked wrapper/shard/sync/
  config audits, checkpoint and encoding checks passed.
- Next: publish main plus an annotated tag atomically, then sync from that exact
  tag and verify/push each downstream branch.
- Preserve Claude's global skill/playbook, explicit-only Codex invocation metadata,
  the upstream tokens edit and unrelated inputs. `vibe-office` started clean at
  `a5f9aee`; osint started at `a2e96d08` with existing session-log/sprint-status edits
  and an untracked owner-decisions JSON. Preserve local hooks and document shards.
- Evidence and before-copies: `.tmp/ambition-update-20261020/` and
  `.tmp/release-1.20.1/`. Existing release
  history remains below; unrelated downstream work remains in
  `docs/plans/downstream/vibe-office-queue.md`.

## Previous — v1.20.0 published; vibe-office on 1.20.0 / 2026-10-13

- Source: vibe-office dogfooding. After its v1.17.1 sync, vibe-office classified all 34 harness-owned
  changes it had made (A: general, B: needs generalizing, C: project-only). The user chose no fork:
  general fixes go upstream as releases. The queue for what remains is
  `docs/plans/downstream/vibe-office-queue.md` (B1 rm guard, B2 CLAUDE.md sharding, B3 Claude-session
  env, B4 silent hybrid overwrite on sync).
- v1.18.0 (commit `7994e38d3d1d2cad220ca3d5f3e0501665af23b8`, tag object `8336e38bcb7090007dc1874bef4ea43626035012`):
  group A — Claude Opus 5.5 Astra eligibility, astra-rules state contract, PreCompact snapshot to
  git-ignored `.vibe/runs/`, config-audit only after git add/commit, Astra statusline risk count,
  downstream `scripts.test` test fix, vibe-init lite start, iteration carryover, harness-gaps rows.
  Remote CI failed on template hygiene (queue doc at the top of `docs/plans/`; the local release check
  ran before the file was tracked).
- v1.18.1 (commit `4a08575de16ea78239879d992e6da948a5666dc0`, tag object `2c3de32f38fa7f03289e877f66382883504b0410`):
  queue doc moved to `docs/plans/downstream/`; CI green.
- v1.19.0 (commit `76e5e5fdeb7748b94206445c1333f5b08ccd80bc`, tag object `d08080625d35a25db36c75b05665ac62eb398e5b`):
  answers the osint-stock-screener handoff (converged sync files are not conflicts, statusline
  model-switch warning, unregistered strong Claude models stay legacy), `vibe:sync --json` stdout clean,
  Stagehand ^4.2.1. Forced release verify neutral 626/625/1 skip, Opus 5.5 Astra session 618/616/2 skips,
  vibe:test-ui 2/2; CI green.
- v1.20.0 (commit `2a5b53ee633f9ec06175e6c6a868819b080f8dc2`, tag object `6873019b61f872e5cd64e80197759bc0d8a1f497`): deterministic
  PowerShell runs (`vibe:ps`, the user's request from vibe-office): code from a file, data only through env JSON,
  code read as UTF-8, typographic quotes/dashes outside comments refused with exit 65. Forced release verify
  neutral 640/639/1 skip, Opus 5.5 Astra session 632/630/2 skips; CI green (verify, astra, windows-contracts).
  After the tag, `vibe-ps.mjs` was found in the `core` test group's patterns too (an edit-script slip);
  removed on main, ships with the next release.
- Downstream: vibe-office synced to 1.20.0 at `42d28c1` (6 conflicts merged; CLAUDE.md sharding and the
  rm-guard PreToolUse hook restored again — B4). Earlier: vibe-office synced to 1.19.0 at `415afaf` with the upstream v1.19.0 sync code from the GitHub
  tag (14 conflicts merged; CLAUDE.md sharding and the rm-guard PreToolUse hook restored by hand — B4).
  osint-stock-screener is still on its own A1 copy and has not synced.
- Pitfalls found: this working tree holds 21 harness files with stale CRLF line endings (the index is LF),
  so `--from <this checkout>` copies CRLF bytes downstream; sync from the tag instead. Stage every
  release file before `vibe:verify:release`; template-hygiene checks tracked files only.

## Previous — v1.17.1 published; downstream osint + vibe-office on 1.17.1 / 2026-09-22

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
