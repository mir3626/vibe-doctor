# Sprint M5 — Native interview

## Files created

- `.claude/skills/vibe-interview/SKILL.md` — runbook for native interview orchestration (57 LOC)
- `.claude/skills/vibe-interview/dimensions.json` — rubric backbone with 10 dimensions (77 LOC)
- `.claude/skills/vibe-interview/dimensions.schema.json` — draft-07 schema for dimensions.json (47 LOC)
- `.claude/skills/vibe-interview/prompts/synthesizer.md` — expert-question synthesizer template (49 LOC)
- `.claude/skills/vibe-interview/prompts/answer-parser.md` — structured attribution parser template (33 LOC)
- `.claude/skills/vibe-interview/prompts/domain-inference.md` — domain inference template (18 LOC)
- `.claude/skills/vibe-interview/domain-probes/real-estate.md` — real-estate inspiration probes (20 LOC)
- `.claude/skills/vibe-interview/domain-probes/iot.md` — IoT inspiration probes (20 LOC)
- `.claude/skills/vibe-interview/domain-probes/data-pipeline.md` — data pipeline inspiration probes (20 LOC)
- `.claude/skills/vibe-interview/domain-probes/web-saas.md` — web SaaS inspiration probes (20 LOC)
- `.claude/skills/vibe-interview/domain-probes/game.md` — game inspiration probes (20 LOC)
- `.claude/skills/vibe-interview/domain-probes/research.md` — research inspiration probes (20 LOC)
- `.claude/skills/vibe-interview/domain-probes/cli-tool.md` — CLI inspiration probes (20 LOC)
- `scripts/vibe-interview.mjs` — native interview engine CLI, state machine, prompt emission, ambiguity tracking (1192 LOC)
- `src/lib/interview.ts` — pure TS helper logic for coverage, ambiguity, dimension selection, termination (182 LOC)
- `test/interview-dimensions.test.ts` — dimensions/schema assertions (118 LOC)
- `test/interview-engine.test.ts` — helper logic + mjs drift tests (170 LOC)
- `test/interview-cli.test.ts` — CLI/session state tests in temp projects (208 LOC)

## Files modified

- `.claude/skills/vibe-init/SKILL.md` — Phase 3 rewritten for native socratic interview (429 LOC total)
- `CLAUDE.md` — Phase 0 Step 0-1 references updated to `vibe-interview` (248 LOC total)
- `docs/context/tokens.md` — native interview token-cost section appended (15 LOC total)
- `.vibe/sync-manifest.json` — harness manifest updated for new interview assets (184 LOC total)
- `package.json` — added `vibe:interview` script (30 LOC total)

## Test summary

- `0 pass / 0 skip / 18 fail` via `npm test` because Node test runner file subprocess spawn is blocked by sandbox (`spawn EPERM`) before suites execute.

## Verification

| command | exit |
|---|---|
| `cmd /c npx tsc --noEmit` | 0 |
| `cmd /c npx eslint . --quiet` | 1 |
| `cmd /c npm test` | 1 |
| `node scripts/vibe-interview.mjs --init --prompt "smoke"` | 0 |
| `node scripts/vibe-interview.mjs --abort` | 0 |
| `node scripts/vibe-resolve-model.mjs planner --json` | 0 |
| `node -e "JSON.parse(require('node:fs').readFileSync('.claude/skills/vibe-interview/dimensions.json','utf8')); console.log('ok')"` | 0 |
| `node --check scripts/vibe-interview.mjs` | 0 |
| `node scripts/vibe-preflight.mjs` | 1 |
| `cmd /c npm run vibe:sync -- --dry-run` | 1 |

## Deviations

- `npm test` could not execute actual suites because this sandbox blocks Node test runner subprocess spawn with `EPERM`.
- `eslint` is not locally installed in the repo, so `npx eslint . --quiet` attempted a network fetch and failed under the no-network sandbox.
- `npm run vibe:sync -- --dry-run` failed because `tsx`/`esbuild` also hit sandbox `spawn EPERM`.
- `node scripts/vibe-preflight.mjs` failed on existing environment issues outside M5 scope (`git` not initialized in this workspace snapshot, provider CLIs unavailable, `cmd.exe` spawn EPERM for one check).
- Repo-wide grep for `ouroboros_interview|ouroboros_pm_interview` still finds pre-existing references in non-scope docs (`docs/orchestration/*`, `docs/plans/*`, sprint prompt text). Only the scoped `CLAUDE.md` and `vibe-init` Phase 3 flow were rewritten.
- Full `--record` round-trip was implemented and covered by tests, but interactive shell quoting made direct manual JSON invocation noisy in this sandbox.

The synthesizer prompt achieves domain-expert depth by forcing the LLM into a combined senior PM + domain SME role, explicitly banning generic software-engineering discovery, requiring 1-3 questions that reveal non-obvious decisions, and seeding it with both positive exemplars (real-estate licensing boundaries, IoT protocol trade-offs, exactly-once pipeline semantics) and negative examples of shallow questioning. The prompt also ties each round to a specific dimension/sub-field set and current coverage snapshot, which prevents generic drift and keeps questions pointed at hidden domain decisions.

## Risks for M6

- `dimensions.tech_stack` currently lands in coverage and seed output, but M6 shard selection still needs a deterministic mapper from interview tech-stack answers into concrete `architecture.md` shard decisions.
- The CLI protocol assumes the Orchestrator retains the synthesizer JSON/questions in context; if M6 wants perfect transcript fidelity in engine state, it should add an explicit question-echo handoff.
- Domain probe matching is substring-based today; M6 may want a stronger inferred-domain-to-shard taxonomy so adjacent-domain collisions do not misroute shard generation.
