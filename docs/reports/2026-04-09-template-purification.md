# Template purification — Sprints A → D3

**Date**: 2026-04-09
**Scope**: Full audit and cleanup of the vibe-doctor template (CI, docs,
skills, configs, command code, dead code).
**Outcome**: 6 commits, all on `main`, CI green on every step.

## Why

Fresh clones surfaced two problems:
1. `ouroboros` install instructions were wrong (`ouroboros-ai` + Python 3.12+).
2. GitHub Actions was silently failing on every push even though no one
   "set up CI" — the workflow was already committed and the `test` script
   had a dash-glob incompatibility.

Follow-up audit (three parallel Explore agents) found structural issues
across code, docs, skills, and configs. The user authorised a four-sprint
sweep to purify the template.

## What shipped

| Sprint | Commit | Focus | Files |
|---|---|---|---|
| A | `29c4beb` | CI hardening + cross-platform cleanup | 4 |
| B | `cc2bb14` | Skill canonicalisation, model naming, placeholder guard | 7 |
| C | `827648f` | Unit coverage for audit-config / qa / report | 5 |
| D1 | `daa2aa2` | Prune deprecated config fields, tighten internals | 3 |
| D2 | `5cc10ed` | `runMain` helper, 4 commands migrated, silent catch fix | 5 |
| D3 | `2e7bf2a` | Remaining 4 commands migrated to `runMain` | 4 |

### Sprint A — CI hardening
- Added `.gitattributes` forcing `eol=lf` baseline with targeted CRLF
  for `.bat`/`.cmd`/`.ps1` and forced LF for `.sh`. First commit under
  the rule auto-normalised two latent CRLF files.
- CI now runs `build` and `vibe:config-audit` in addition to
  `typecheck`/`test` — the template's own build was never verified
  before.
- Dropped `cmd /c` prefix from `.claude/settings.json` hooks.
- Fixed `audit-config.ts` false positive where `.env.example` matched
  the `.env` prefix. Slash-terminated patterns now use `startsWith`,
  everything else uses exact equality. Delegated to Codex CLI.

### Sprint B — Structural docs + skill cleanup
- Deleted `.agents/skills/` (4 byte-identical duplicates of
  `.claude/skills/`). Single source of truth.
- `docs/context/conventions.md`: removed the now-contradictory
  `cmd /c` rule, added an explicit **model naming policy** table
  (display name / config ID / API model ID).
- `README.md`: tagged orchestrator as "Claude Code (Opus 4.6)", added
  a placeholder warning pointing new users at `/vibe-init` before
  running any Sprint, removed stale `.agents/skills/` entry from the
  directory tree.
- `.vibe/config.local.example.json`: mirrored `config.json`'s
  `sprint` + `qa.preferScripts` sections so local overrides have a
  schema to copy from.

### Sprint C — Unit test coverage
Previously: only `args`, `config`, `usage` helpers had tests (7 cases).
After: 20 cases. Strategy was "extract pure logic, guard CLI entry
point, test the pure logic".

- `src/commands/audit-config.ts` — exports `findViolations` and
  `forbiddenPatterns`; CLI entry guarded by `isMain`.
- `src/commands/qa.ts` — exports `selectQaScripts` and
  `QA_SCRIPT_ORDER`; CLI entry guarded.
- `src/lib/report.ts` — extracted `renderReport(input): string` from
  `writeReport`, so markdown shape is testable without touching the
  filesystem.
- `test/commands.test.ts` (new, 13 cases) — `findViolations × 5`,
  `selectQaScripts × 5`, `renderReport × 3`. Includes a regression
  guard for the `.env` vs `.env.example` bug fixed in Sprint A.

### Sprint D — Code quality + purification
- **D1**: Deleted three `@deprecated` fields from `VibeConfig`
  (`defaultCoder`, `challenger`, `reviewer`) — grep confirmed zero
  readers. Wrapped `readJson`'s `JSON.parse` in try/catch so corrupt
  configs throw with the file path included. Dropped unused `export`
  from `logger.log` (internal facade target only).
- **D2**: New `src/lib/cli.ts` with `runMain(main, importMetaUrl)`
  helper. Replaces the duplicated `isMain` + `main().catch()`
  boilerplate that had started to accumulate in D1/C. Migrated
  `doctor`, `audit-config`, `qa`, `write-report`. Also fixed
  `write-report.ts`'s silent catch in `getUsageSummary` — it now logs
  a warn instead of swallowing errors.
- **D3**: Migrated the remaining 4 commands (`init`, `run-agent`,
  `escalate-on-test-failure`, `summarize-usage`). All 8 `vibe:*`
  commands now share one entry-point contract.

## Verification

Every Sprint was gated on the same local + CI checks:

- `npm run typecheck` ✓
- `npm run build` ✓
- `npm test` — **7 cases → 20 cases** (Sprint C)
- `npm run vibe:config-audit` ✓
- CI workflow on GitHub Actions ✓

CLI smoke tests were run for `doctor`, `audit-config`, and
`summarize-usage` to confirm `runMain` didn't regress actual
invocation.

## Changes by the numbers

- **Code touched**: 24 files across 6 commits
- **Commands unified**: 8/8 under `runMain`
- **Test cases**: 7 → 20 (+186%)
- **Dead code removed**: 3 config fields, 4 skill duplicates, 1 unused
  export
- **CI steps**: 2 → 4 (typecheck/test → typecheck/build/test/audit)

## Risks / follow-ups

- `readJson<T>` still uses a trust-boundary cast. For user-supplied
  JSON (if/when that becomes a thing), a schema library like `zod`
  would be the next step — intentionally deferred to avoid adding a
  runtime dep to a minimal template.
- `test` script lists files explicitly because CI Node version is 20
  (dash glob doesn't support `**`). Bumping to Node 22+ would let us
  restore glob matching; flagged as 🟢 nice-to-have.
- `src/commands/init.ts` uses `console.log` directly (interactive UI)
  instead of going through `logger`. Intentional; not flagged for
  change.
