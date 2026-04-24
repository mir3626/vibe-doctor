# Orchestrator Handoff

## 1. Identity

- **repo**: `vibe-doctor`
- **branch**: `main`
- **last pushed release**: `v1.6.5`
- **working target**: none
- **current iteration**: post-iter-7 maintenance
- **harnessVersion**: `1.6.5`
- **language/tone**: Korean user-facing, concise engineering notes

## 2. Status

v1.6.5 implements the high-priority follow-up from the dogfood11 harness review: remove contradictory Codex role instructions, align `/vibe-sync` skill guidance with current sync behavior, and stop overstating rule-audit enforcement coverage.

Key decisions:

- Split Codex into **Sprint Generator mode** and **Codex Orchestrator maintenance mode**. Sprint prompts/specs keep Generator constraints; direct upstream harness maintenance can use Codex as Orchestrator.
- Keep the Claude Orchestrator + Codex Generator table as the nominal harness mode, but document the direct Codex maintenance fallback.
- Keep `maintain-context` as the portable checkpoint discipline for Codex Orchestrator sessions.
- Treat exact `upstream.ref` values as intentional pins and caret refs as floating compatible updates.
- Treat `vibe-rule-audit` as a scanner/reporting tool unless a specific rule has a real script/hook exit-code gate.
- User directive: after verified harness changes, proceed directly with commit/tag/push when that is the natural next step; do not ask for a separate push confirmation.

Changed surfaces:

- `AGENTS.md`
- `CLAUDE.md`
- `.codex/skills/maintain-context/SKILL.md`
- `.claude/skills/vibe-sync/SKILL.md`
- `.vibe/agent/_common-rules.md`
- `docs/context/codex-execution.md`
- `docs/context/orchestration.md`
- `docs/context/harness-gaps.md`
- `README.md`
- `docs/release/v1.6.5.md`
- `package.json`
- `.vibe/config.json`

## 3. Verification

Windows verification for v1.6.5:

- `npm run typecheck`
- `node --import tsx --test test/codex-skills.test.ts test/checkpoint.test.ts test/sync.test.ts test/upstream-bootstrap.test.ts test/vibe-sync-bootstrap.test.ts test/rule-audit.test.ts`
- `git diff --check`
- `npm test`
- `npm run build`

Checkpoint status:

- This file, `session-log.md`, and `sprint-status.json` were updated for the v1.6.5 local patch after tests passed.
- `npm run vibe:checkpoint -- --json` passes with all checks OK.

## 4. Preserved Value

- v1.6.3 exact-vs-caret `upstream.ref` semantics remain intact.
- v1.6.4 Codex maintain-context checkpoint workflow remains intact.
- Windows/WSL-safe Codex wrapper behavior remains intact.
- Project-safe sync merge behavior remains intact.
- Agent TOML escaping regression coverage remains intact.

## 5. Next Action

No immediate follow-up required after `v1.6.5` is pushed. Continue with the next user-requested harness review or downstream dogfood issue.

## 6. Pending Risks

- Codex still cannot fire a real context-window threshold hook. The harness documents the portable approximation, but execution depends on Orchestrator process discipline.
- `gap-rule-only-in-md` is now accurately marked as pending enforcement; `vibe-rule-audit` still reports uncovered rules and does not enforce every imperative rule by itself.
- Existing open lightweight audit risk remains unrelated: `src/commands/init.ts has no test/init.test.ts`.
