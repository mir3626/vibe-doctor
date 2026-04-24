# Orchestrator Handoff

## 1. Identity

- **repo**: `vibe-doctor`
- **branch**: `main`
- **last pushed release**: `v1.6.11`
- **working target**: `v1.6.12`
- **current iteration**: downstream hardening patch complete locally, push pending
- **harnessVersion**: `1.6.12`
- **language/tone**: Korean user-facing, concise engineering notes

## 2. Status

User asked to proceed with all reviewed upstream harness fixes and to avoid section-exclusion parsing for Non-Goals/capture-channel prose.

v1.6.12 candidate implements:

- provider command lookup now honors `cwd` and provider `env.PATH` during `commandExists()`;
- Codex downstream initialization boundary in `AGENTS.md`, `_common-rules.md`, and Codex `vibe-init` skill guidance;
- `/vibe-review` frontend opt-in detection now uses explicit `platform`, `PROJECT/HARNESS:review-signals`, or explicit `Platform:` lines instead of arbitrary product prose scanning;
- `/vibe-init` guidance now writes explicit `PROJECT:review-signals` and no longer treats `mobile` alone as a browser/frontend signal;
- `npm run test:ui` now uses `scripts/vibe-playwright-test.mjs`, with actionable install guidance when `@playwright/test` is absent and normal Playwright delegation when present.

## 3. Verification

Completed on Windows:

- `npm run typecheck`
- `node --import tsx --test test/shell.test.ts test/vibe-review-inputs.test.ts test/codex-skills.test.ts test/playwright-wrapper.test.ts test/sync.test.ts`
- `npm test`
- `npm run build`
- `npm run test:ui -- --version`
- `npm run test:ui`
- `npm run vibe:config-audit --silent`

## 4. Preserved Value

- Product-owned `devDependencies` remain project-owned; Playwright local UX is handled by a harness wrapper instead of forcing package.json dependency sync.
- Product prose can mention Telegram mobile capture or a public web dashboard non-goal without seeding browser/bundle findings unless explicit platform markers say it is a frontend.
- Downstream clones that still contain copied template state are instructed to run `/vibe-init` before Codex Generator or maintenance work.

## 5. Next Action

Commit/tag `v1.6.12`, push `main` and the tag, then downstream can sync from `v1.6.12`.

## 6. Pending Risks

- `telegram-local-ingest` product issues remain separate: `pdftotext` readiness, PDF output policy, DOCX XML sanitizing.
- Existing audit cadence state is unrelated to this patch.
