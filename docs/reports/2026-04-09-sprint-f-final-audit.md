#  Sprint F — final audit of remaining unaudited surfaces

**Date**: 2026-04-09
**Scope**: Close every audit gap that survived Sprints A→E — context/
orchestration shards, agent memory files, `.vibe/config.json` sanity,
provider runner test coverage, deferred Tier-3 items.
**Outcome**: 3 commits on `main`, CI green, test count 20 → 27.

## Why

After the worktree-purge report I enumerated remaining work in three
tiers. The user asked for all of it. This sprint executes Tier 1 and
Tier 2, and makes explicit decisions on Tier 3 deferrals.

## What shipped

| Sprint | Commit | Focus | Files |
|---|---|---|---|
| F1 | `93d0736` | Codex invocation canonicalization | 5 |
| F2 | `938278e` | Propagate canon to provider docs + skill | 2 |
| F3 | `6713010` | `buildExecutionPlan` tests + glob test script | 2 |

## Findings from the audit

### The Codex invocation was defined three different ways

Three authoritative files described three different ways to call
Codex, and none of them agreed:

1. `.vibe/config.json` → `codex exec --json {prompt}` (inline)
2. `CLAUDE.md` example → `codex exec -c 'sandbox_permissions=[...]' - < prompt.md` (stdin redirect + -c flag)
3. `docs/context/codex-execution.md` §3.2 → `./scripts/run-codex.sh -` via stdin, and claimed this was "the ONLY supported Codex invocation path"
4. `scripts/run-codex.sh` header → same claim ("ONLY supported")

The wrapper exists specifically to prevent Korean-Windows mojibake,
force UTF-8 across every subshell spawned by `codex`, and retry on
capacity errors. The claim that it's mandatory is the correct
position — but the default config and the most-read doc (`CLAUDE.md`)
were bypassing it.

### Sprint F1 — canonicalized on the wrapper (5 files)

- `.vibe/config.json` — codex provider now points at
  `./scripts/run-codex.sh` with `["{prompt}"]`. The wrapper's inline
  positional form works with `run-agent.ts`'s
  stdin-ignore spawn (shell.ts `stdio: ['ignore', ...]`), so no code
  change was needed.
- `.vibe/config.local.example.json` — mirrored.
- `CLAUDE.md` — Generator invocation example and the "항상 지킬 것"
  delegation rule both reference the wrapper now. The user's custom
  "기계적 오버라이드" section was left untouched.
- `docs/context/codex-execution.md` — §3.2 standard call pattern
  stripped its aspirational `run-parallel` reference (E2 killed the
  underlying code), §7 checklist's "병렬 금지" re-phrased as "Sprint는
  sequential 진행", §8 history logged the 2026-04-09 canonicalization.
- `scripts/run-codex.sh` — header comment dropped `run-parallel`,
  pointed at `vibe:run-agent --provider codex` as the actual caller.

### Sprint F2 — doc/skill follow-through (2 files)

- `docs/orchestration/providers.md` — codex row in the provider table
  + the call-method bullet list now both reference the wrapper and
  explicitly forbid raw `codex exec` on Korean Windows.
- `.claude/skills/vibe-init/SKILL.md` — the `config.local.json`
  example inside Phase 2-3 was missing the `sprint` field (Sprint B
  added it to the actual example file but the skill example drifted)
  and listed `codex` with the pre-wrapper args. Both fixed so
  downstream `/vibe-init` runs generate schema-correct configs on
  first try.

### Sprint F3 — test coverage + glob restore (2 files)

- `test/providers.test.ts` (new, **7 cases**) — covers
  `buildExecutionPlan` template substitution for `{prompt}`,
  `{promptFile}`, `{role}`, `{taskId}`, `{cwd}` (in env values),
  `filter(Boolean)` dropping empty resolutions, undefined `runner.env`
  default, and a wrapper-style command shape
  (`./scripts/run-codex.sh`). This was the largest remaining
  coverage gap — `buildExecutionPlan` is pure and powers every
  `vibe:run-agent` invocation, but had zero tests.
- `package.json` — `test` script: explicit file list →
  `test/*.test.ts`. The original template-purification report said
  "dash doesn't support `**`", which is true, but **single-star
  `*` is POSIX** and works in dash, bash, and Node 20's own CLI.
  All tests live in flat `test/`, so the single-star glob suffices.
  New `*.test.ts` files no longer need manual registration.

Test count: **20 → 27** (+35%).

## Tier 3 — explicit decisions

**zod schema validation for `readJson<T>`** — intentionally **NOT
done**. The original deferral rationale ("avoid runtime dep in a
minimal template") is still correct: every `readJson` call reads one
of `config.json` / `config.local.json` / `package.json`-style files
that we ship ourselves. The D1 fix already wraps `JSON.parse` in
try/catch and surfaces the file path on corruption, which is the
actual failure mode. zod would only pay off against *third-party*
input, which this template does not ingest. Adding a runtime
dependency for a hypothetical threat model is the opposite of
purification.

**Node 22+ bump to restore `**` glob** — also **NOT done**. The
original flag was "nice-to-have" for test-script glob support. Sprint
F3 found a strictly better fix: single-star `*` works on Node 20 and
every POSIX shell, so there is no need to burn a breaking change on
downstream users (Node 20 LTS is still widely deployed).

**Parallel Sprint execution** — **not in scope** for purification.
The old worktree-based design was aspirational and is now gone (E2).
If the capability is ever put on the roadmap it should be a real
Planner → Generator × N → Evaluator pipeline, not a git-worktree
trick. Flagged as a future feature, not a cleanup item.

## Clean bill of health — surfaces audited this sprint

| Surface | State |
|---|---|
| `docs/context/product.md` | filled (pre-F) |
| `docs/context/architecture.md` | filled + trimmed (pre-F, E2) |
| `docs/context/conventions.md` | current (Sprint B) |
| `docs/context/qa.md` | Sprint-model language (pre-F) |
| `docs/context/tokens.md` | read, evergreen, no changes needed |
| `docs/context/secrets.md` | read, current, no changes needed |
| `docs/context/codex-execution.md` | **F1** — 2 dead refs removed, history updated |
| `docs/orchestration/roles.md` | read, matches `.vibe/config.json` |
| `docs/orchestration/escalation.md` | read, matches Sprint D0/qa.md flow |
| `docs/orchestration/providers.md` | **F2** — wrapper canon propagated |
| `CLAUDE.md` | **F1** — Generator example + delegation rule updated; user-custom section untouched |
| `AGENTS.md` | read, current, no changes needed |
| `GEMINI.md` | current (E2) |
| `.vibe/config.json` | **F1** — codex → wrapper |
| `.vibe/config.local.example.json` | **F1** — mirrored |
| `.claude/skills/*/SKILL.md` (5 files) | read, **F2** — vibe-init example drift fixed, others evergreen |
| `src/providers/runner.ts` | pure, **F3** — 7 test cases added |
| `scripts/run-codex.sh` | **F1** — header comment updated |

## Verification

- `npm run typecheck` ✓
- `npm run build` ✓
- `npm test` — **27/27** passing
- `npm run vibe:config-audit` ✓
- GitHub Actions CI on `6713010` → success

## Cumulative results — Sprints A → F

- **Commits**: 12 (A, B, C, D1-D3, E1, E2, purge-report, context-docs, F1-F3, final-report to come)
- **Test cases**: 7 → 27 (+286%)
- **Dead code removed**: 3 config fields, 4 skill duplicates, 1 unused
  export, `escalate-on-test-failure.ts`, `src/lib/worktree.ts`,
  `vibe:escalate` script, `.worktrees/` ignore rule, entire
  "run-parallel" documented-but-never-implemented layer
- **Invocation patterns unified**: 3 different Codex call styles → 1
  canonical wrapper path
- **CI steps**: 2 → 4 (typecheck / build / test / audit)
- **All 8 `vibe:*` commands** share one `runMain` entry contract
- **grep 잔재**: `worktree` 0건, `challenger`/`reviewer` 0건 (외:
  test 예제 문자열 1건, 과거 보고서 기록)

## Risks / follow-ups

- `actions/checkout@v4` and `actions/setup-node@v4` trigger a Node 20
  deprecation warning in GitHub Actions (force-switch to Node 24
  runners lands 2026-06-02). Bump both to their Node 24-compatible
  versions when the template is next touched. 🟢 nice-to-have.
- `run-codex.sh` is bash-only and Windows users need git-bash. This
  is already the de facto requirement (CLAUDE.md says `Shell: bash`)
  but is not documented in README's prerequisites. Worth a one-line
  add if a non-git-bash Windows user reports confusion.
