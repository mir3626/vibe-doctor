# Orchestrator Handoff — vibe-doctor

<!-- vibe:auto-state:start -->
> Auto-captured git snapshot (PreCompact); not a substitute for the narrative below.
> Captured: 2026-09-22T03:49:22.050Z
> Branch: main @ f8737a5 docs: record v1.15.5 publication and verification
> Uncommitted: 57 file(s)
> - M .claude/agents/sprint-planner.md
> -  M .claude/settings.json
> -  M .claude/skills/test-patterns/_index.md
> -  M .claude/skills/test-patterns/canvas-dom-isolation.md
> -  D .claude/skills/test-patterns/typescript-playwright.md
> -  M .claude/skills/vibe-interview/prompts/answer-parser.md
> -  M .claude/skills/vibe-review/sections/automatic-checks.md
> -  M .github/workflows/ci.yml
> -  M .gitignore
> -  M .vibe/agent/_common-rules.md
> -  M .vibe/agent/handoff.md
> -  M .vibe/agent/session-log.md
> -  M .vibe/agent/tokens.json
> -  M .vibe/config.json
> -  D .vibe/harness/playwright.config.ts
> -  M .vibe/harness/scripts/vibe-browser-smoke.mjs
> -  D .vibe/harness/scripts/vibe-playwright-test.mjs
> -  M .vibe/harness/scripts/vibe-sprint-mode.mjs
> -  M .vibe/harness/scripts/vibe-sync-audit.mjs
> -  M .vibe/harness/src/commands/qa.ts
> - ... +37 more
> Staged: none; Unstaged: 39 files changed, 1027 insertions(+), 690 deletions(-)
> Recent commits:
> - f8737a5 docs: record v1.15.5 publication and verification
> - 7ad858f fix(harness): release v1.15.5 bounded review inputs
> - ddffb1d docs: record v1.15.4 publication and verification
> - 40114f4 fix(harness): release v1.15.4 Astra role and prompt alignment
> - 7b0d824 Record v1.15.3 publication and downstream verification results
<!-- vibe:auto-state:end -->

PROJECT NOT INITIALIZED.
This is the upstream template; downstream product work still requires /vibe-init.

## Current — v1.16.0 prepared, uncommitted / 2026-09-22

- User directive: replace Playwright with Stagehand (browserbase/stagehand). The Codex quota
  was exhausted, so the Orchestrator (Claude Fable 5.1) wrote the source directly under the
  recorded `[decision][orchestrator-hotfix]`; the Planner (fable, fresh context) prompt at
  `docs/prompts/sprint-stagehand-migration.md` served as the self-QA checklist and caught three
  corrections (sprint-mode retirement list, 1.7.0 fixture, conventions marker rewrite).
- Working tree holds the complete migration, NOT committed, tagged or pushed: 38 tracked files
  changed, 5 retired Playwright files deleted, 7 new files (shared `scripts/lib/stagehand-browser.mjs`,
  `vibe-stagehand-test.mjs`, `test/stagehand/dashboard-report.test.ts`, `stagehand-wrapper.test.ts`,
  `migrations/1.16.0.mjs`, `test-patterns/typescript-stagehand.md`, `docs/release/v1.16.0.md`).
  `harnessVersion` is set to 1.16.0 in package.json, `.vibe/config.json`, README and the release
  index; devDependencies swap `@playwright/test` for `@browserbasehq/stagehand@^4.1.0` (lockfile updated,
  root zod stays 3.x).
- Verified outside any sandbox: harness typecheck, build, generated-schema check, forced
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

1. User decides whether to commit/tag/push v1.16.0 (release commit + annotated `v1.16.0`); before
   that, stage and run `npm run vibe:codex-wrapper-audit -- --tracked`, then confirm remote CI
   (`verify` job now relies on the runner's system Chrome; `chromiumSandbox: false` is the documented
   fallback if the Linux launch is sandbox-blocked).
2. Do not recreate or move v1.15.5 or any prior published tag. No downstream sync follows
   automatically.
