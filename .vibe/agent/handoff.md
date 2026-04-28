# Orchestrator Handoff

## 1. Identity

- **repo**: `vibe-doctor`
- **branch**: `main`
- **working release**: `v1.7.2`
- **current mode**: Codex Orchestrator maintenance
- **harnessVersion**: `1.7.2`
- **language/tone**: Korean user-facing, concise engineering notes

## 2. Status

Codex `/vibe-init --mode=agent` downstream failure follow-up is implemented and verified as the `v1.7.2` patch candidate.

- Agent delegation prompt rendering now extracts only the real prompt body between the start marker and `## (Template 끝)`.
- The canonical delegation template now contains the live `<ONE_LINER>` placeholder only once.
- Wrapped Korean/Unicode one-liners are normalized before rendering.
- Tests render the real `.claude/templates/agent-delegation-prompt.md` for both Codex and Claude runtimes, and the CLI agent-mode test uses the canonical template.
- `/vibe-review` now delegates helper input collection to `.vibe/harness/scripts/vibe-review-inputs.mjs`, with deterministic `tsx`/`zod` preflight and `--install` handling.
- Review input collection tolerates missing sprint status for explicit init/bootstrap/harness failure reviews in partial checkouts.
- `.claude/templates/**` is now shipped by the sync manifest.

## 3. Verification

Completed on Windows for this patch:

- `npm run typecheck`
- `node --import tsx --test .vibe/harness/test/init-guard.test.ts .vibe/harness/test/vibe-review-inputs.test.ts .vibe/harness/test/codex-skills.test.ts .vibe/harness/test/sync.test.ts`
- `npm test` (342 tests: 341 pass, 1 skipped)
- `npm run build`
- `git diff --check`
- UTF-8 file classification and mojibake grep over touched Markdown/TypeScript/JavaScript/JSON files

## 4. Expected Downstream Behavior

After syncing `tvd-extension` to `v1.7.2`, Codex `$vibe-init` with `mode=agent` should print the Codex delegation prompt for long Korean one-liners and exit before creating `.env`, `.vibe/config.local.json`, `.vibe/agent/*`, or `.vibe/interview-log/*`.

## 5. Next Action

Commit, annotated-tag, and push `v1.7.2`, then in `tvd-extension` run:

```bash
npm run vibe:sync -- --ref v1.7.2
```

Then retry Codex `$vibe-init` Step 1-0 with `mode=agent`.

## 6. Pending Risks

- This patch fixes the delegation boundary and review helper. It does not implement fully autonomous Codex Phase 2-4 execution beyond the printed delegation prompt contract.
- Historical release notes and logs still mention older wrapper paths as history.
