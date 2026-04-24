# Orchestrator Handoff

## 1. Identity

- **repo**: `vibe-doctor`
- **branch**: `main`
- **last pushed release**: `v1.6.3`
- **working target**: `v1.6.4` local patch, not committed/tagged yet
- **current iteration**: post-iter-7 maintenance
- **harnessVersion**: `1.6.4`
- **language/tone**: Korean user-facing, concise engineering notes

## 2. Status

v1.6.4 implements the Codex Orchestrator context-persistence adjustment requested after confirming Codex has no native `PreCompact` or context-threshold hook.

Key decision:

- Do not over-invest in Generator-side token-threshold automation. Generator Codex runs are short-lived per Sprint and return state through completion reports.
- Treat Codex used as the main Orchestrator as the risky path.
- Use an explicit `maintain-context` workflow at work boundaries: update `handoff.md`, append `session-log.md`, then run `npm run vibe:checkpoint`.
- Keep `vibe-checkpoint` as a verifier, not an updater.

Changed surfaces:

- `.claude/skills/maintain-context/SKILL.md`
- `.codex/skills/maintain-context/SKILL.md`
- `.vibe/agent/_common-rules.md`
- `docs/context/codex-execution.md`
- `scripts/vibe-checkpoint.mjs`
- `test/checkpoint.test.ts`
- `test/codex-skills.test.ts`
- `test/sync.test.ts`
- `.vibe/sync-manifest.json`
- `docs/context/harness-gaps.md`
- `docs/release/v1.6.4.md`
- `package.json`
- `.vibe/config.json`

## 3. Verification

Windows verification for v1.6.4:

- `node --import tsx --test test/checkpoint.test.ts test/codex-skills.test.ts test/sync.test.ts`
- `npm run typecheck`
- `npm run build`
- `npm test`
- `npm run vibe:qa`
- `npm run vibe:sync -- --dry-run --from .`
- `node scripts/vibe-preflight.mjs --bootstrap`
- `npm run vibe:rule-audit` (exit 0, existing uncovered rule list remains)
- `git diff --check`

Checkpoint status:

- First explicit `npm run vibe:checkpoint -- --json` correctly failed because this handoff was stale.
- This file, `session-log.md`, and `sprint-status.json` were then updated for the v1.6.4 local patch.
- `npm run vibe:checkpoint -- --json` now passes with all checks OK.

## 4. Preserved Value

- v1.6.3 exact-vs-caret `upstream.ref` semantics remain intact.
- Provider-neutral lifecycle scripts remain intact.
- UTF-8 Markdown/editor hardening remains intact.
- WSL-safe Codex wrapper behavior remains intact.
- Project-safe sync merge behavior remains intact.
- Upstream bootstrap remains intact.

## 5. Next Action

If the user asks to release, commit/tag/push:

1. Rerun `npm run vibe:checkpoint -- --json`.
2. Commit as `fix(context): document Codex orchestrator checkpoint workflow`.
3. Create annotated tag `v1.6.4`.
4. Push `main` and `v1.6.4`.

## 6. Pending Risks

- Codex still cannot fire a real context-window threshold hook. The harness now documents the best portable approximation, but execution depends on Orchestrator process discipline.
- Existing downstream projects must sync v1.6.4 before their Codex `maintain-context` skill description and runbook improve.
- Existing open lightweight audit risk remains unrelated: `src/commands/init.ts has no test/init.test.ts`.
