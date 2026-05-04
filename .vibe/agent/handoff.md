# Orchestrator Handoff

## 1. Identity

- **repo**: `vibe-doctor`
- **branch**: `main`
- **working release**: `v1.7.2`
- **current mode**: Codex Orchestrator maintenance
- **harnessVersion**: `1.7.2`
- **language/tone**: Korean user-facing, concise engineering notes

## 2. Status

`/vibe-init` bootstrap preflight follow-up is implemented, verified, and pushed on top of `v1.7.2`.

- Investigation found no `vibe.configSchema.json` / `vibe.schema.json` init blocker; the repo has no config schema file and config schema validation is not part of init.
- The dogfood12 init friction was reproduced from session history as `vibe-preflight --bootstrap` reporting `provider.codex` failure after the v1.7 runtime move to `.vibe/harness/scripts/run-codex.sh`.
- `vibe-preflight.mjs` now recognizes provider-command wrapper paths, prefers `.vibe/harness/scripts/run-<provider>.<ext>`, preserves legacy `scripts/run-*`, and on Windows maps `.sh` provider commands to adjacent `.cmd --health`.
- `preflight-wrapper-generalized.test.ts` covers the v1.7 harness-wrapper Codex path.
- The preflight wrapper-path fix was pushed to `origin/main` at `a5b64dd`.
- Previous project report duplicate-open fix remains pushed to `origin/main` at `44188b6`.

## 3. Verification

Completed on Windows for this patch:

- `npm run typecheck`
- `node --import tsx --test .vibe/harness/test/preflight-wrapper-generalized.test.ts`
- Patched preflight smoke against `C:\Users\Tony\Workspace\dogfood12`: `provider.codex` passed with `codex-cli 0.128.0`
- `npm test` (344 tests: 343 pass, 1 skipped)
- `npm run build`
- `git diff --check`
- Strict UTF-8 decode and mojibake regex checks over touched JavaScript/TypeScript files

## 4. Expected Downstream Behavior

Downstream projects using Codex provider commands like `./.vibe/harness/scripts/run-codex.sh` should pass `vibe-preflight --bootstrap` on Windows by invoking the adjacent `run-codex.cmd --health` wrapper instead of trying to execute the shell wrapper directly.

## 5. Next Action

No immediate action required. Sync downstream projects that hit the `/vibe-init` bootstrap false negative when they need this behavior.

## 6. Pending Risks

- PowerShell PATH on this machine does not expose `file` or `grep`; equivalent strict UTF-8 and regex checks passed.
- dogfood12 had pre-existing dirty context/report files during investigation; they were not edited by this upstream patch.
