# Orchestrator Handoff

## 1. Identity

- **repo**: `vibe-doctor`
- **branch**: `main`
- **last pushed release**: `v1.6.6`
- **working target**: none
- **current iteration**: iter-8 complete
- **harnessVersion**: `1.6.6`
- **language/tone**: Korean user-facing, concise engineering notes

## 2. Status

v1.6.6 closes dogfood10 Finding C: the prototype Evaluator exemption depended on `LOC < 2000`, but the harness only tracked audit cadence. Lightweight audit now computes app-code LOC and raises `LOC_THRESHOLD_BREACH` when the configured threshold is exceeded.

Key decisions:

- Default app-code roots are `["src"]`; projects can override with `audit.projectRoots`.
- Default prototype threshold is `2000`; projects can override with `audit.prototypeLocThreshold`.
- `.vibe/config.local.json` can locally override roots/threshold without changing synced project config.
- `LOC_THRESHOLD_BREACH` pendingRisk includes `level`, `code`, and `message` metadata; the schema now allows those optional fields.
- An open `LOC_THRESHOLD_BREACH` invalidates the prototype Evaluator exception.
- `.vibe/config.json` sync ownership treats `audit` as project-owned, so sync does not overwrite downstream-specific roots/thresholds.

Changed surfaces:

- `scripts/vibe-audit-lightweight.mjs`
- `test/audit-lightweight.test.ts`
- `src/lib/config.ts`
- `src/lib/schemas/sprint-status.ts`
- `.vibe/agent/sprint-status.schema.json`
- `.vibe/sync-manifest.json`
- `test/config.test.ts`
- `test/sync.test.ts`
- `CLAUDE.md`
- `docs/context/orchestration.md`
- `docs/context/harness-gaps.md`
- `docs/plans/sprint-roadmap.md`
- `.vibe/agent/iteration-history.json`
- `README.md`
- `docs/release/v1.6.6.md`
- `package.json`
- `.vibe/config.json`

## 3. Verification

Windows verification for v1.6.6:

- `node --import tsx --test test/audit-lightweight.test.ts test/config.test.ts test/sync.test.ts test/schemas.test.ts`
- `npm run typecheck`
- `node scripts/vibe-gen-schemas.mjs --check`
- `git diff --check`
- `npm run build`
- `npm test`
- `node scripts/vibe-preflight.mjs --bootstrap`
- `npm run vibe:checkpoint -- --json`

## 4. Preserved Value

- Exact-vs-caret `upstream.ref` semantics remain intact.
- Project-owned `.vibe/config.json.audit` settings are preserved by sync.
- Existing lightweight audit checks for spec keyword mismatch, missing tests, LOC outliers, and tmp scripts remain intact.
- Windows/WSL-safe Codex wrapper behavior remains untouched.

## 5. Next Action

No immediate follow-up required after `v1.6.6` is pushed. Continue with the next user-requested harness review or downstream dogfood issue.

## 6. Pending Risks

- Existing open lightweight audit risk remains unrelated: `src/commands/init.ts has no test/init.test.ts`.
- Codex still cannot fire a real context-window threshold hook; maintain-context remains the portable fallback.
