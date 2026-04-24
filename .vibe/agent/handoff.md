# Orchestrator Handoff

## 1. Identity

- **repo**: `vibe-doctor`
- **branch**: `main`
- **last pushed release**: `v1.6.8`
- **working target**: `v1.6.9`
- **current iteration**: iter-10 complete locally, push pending
- **harnessVersion**: `1.6.9`
- **language/tone**: Korean user-facing, concise engineering notes

## 2. Status

User identified that the v1.6.8 wiring drift candidates were dashboard attention scripts from an earlier dashboard sprint. v1.6.9 wires them instead of deleting them:

- Claude Code `Notification` hooks now call `scripts/vibe-attention-notify.mjs` for permission, idle, and elicitation notifications.
- `scripts/vibe-attention-notify.mjs` now reuses `appendAttentionEvent()` from `scripts/vibe-attention.mjs`.
- Codex `run-codex.sh` and `run-codex.cmd` now append dashboard attention events on wrapper success/failure.
- `collectReviewInputs().wiringDriftFindings` now returns `[]` for the current repo.

## 3. Verification

Focused verification completed:

- `node --import tsx --test test/attention-notify.test.ts test/run-codex-wrapper.test.ts test/statusline.test.ts test/vibe-review-inputs.test.ts`
- `node --import tsx -e "import { collectReviewInputs } from './src/lib/review.ts'; const inputs = await collectReviewInputs(); console.log(JSON.stringify(inputs.wiringDriftFindings, null, 2));"` -> `[]`

Full harness verification and push are the next actions.

## 4. Preserved Value

- Claude gets native notification-hook support.
- Codex stays honest: there is still no Claude-style native Codex permission hook, so support is wrapper-level completion/failure signaling.
- Dashboard notification UX remains opt-in through the browser's Notification permission.

## 5. Next Action

Run full harness verification, commit/tag `v1.6.9`, then push `main` and the tag.

## 6. Pending Risks

- Existing open lightweight audit risk remains unrelated: `src/commands/init.ts has no test/init.test.ts`.
