# Sprint: M-harness-gates — MD→script rule promotion + release tag automation

> (공용 규칙은 `.vibe/agent/_common-rules.md` 준수 — §1 샌드박스 우회 금지, §2 의존성 설치 금지, §7 Sandbox × Orchestrator 계약, §13 Generator invariants, §14 Wiring Integration Checklist)

## Context & why

Iteration-2 review finding #7 (`gap-release-tag-automation`) showed that every `harnessVersion` bump in the past required a retroactive manual `git tag` push. Downstream `vibe:sync` then failed on `resolveUpstreamRef` because the tag did not yet exist. Iteration-2 also codified the meta-principle **"every MD rule must be promoted to a script gate within 30 sprints"** — anything that only lives in `CLAUDE.md` is a recommendation, not a rule. This Sprint closes both: the commit wrapper self-tags on a version delta, a new CLI surfaces un-gated MD rules as next-sprint candidates, and an `audit-skipped-mode` user directive gains a persistent, expiring store that preflight consults. These three pieces plus the `harness-gaps.md` ledger schema extension form the final iteration-2 slot before v1.4.0 ships.

**Previous Sprint summary (sprint-M-process-discipline)**: renamed `.claude/agents/planner.md` → `sprint-planner.md` + added `vibe-planner-skip-log.mjs` + added preflight `planner.presence` WARN + revised trivial-rule semantics. 187 tests pass, tsc 0 errors, `harnessVersionInstalled=1.4.0`, `sprintsSinceLastAudit=2/5`, one INFO pendingRisk (`lightweight-audit-sprint-M-process-discipline` — expected integration-test layout, do not resolve inside this Sprint).

## Prerequisites (already installed — do NOT npm install anything)

- `zod` + `zod-to-json-schema` (M-audit)
- Audit gates: `scripts/vibe-audit-lightweight.mjs`, `scripts/vibe-audit-clear.mjs`, preflight `audit.overdue` + `--ack-audit-overdue=<sprintId>:<reason>` (M-audit)
- `.claude/agents/sprint-planner.md` agent (M-process-discipline)
- `scripts/vibe-planner-skip-log.mjs` (M-process-discipline)
- `migrations/1.4.0.mjs` (existing — this Sprint **extends** the same file, does not create 1.4.1)
- `docs/release/v1.4.0.md` (existing — this Sprint **appends** to the same file)
- `.vibe/agent/_common-rules.md §14 Wiring Integration Checklist` (§14.1 W1–W14 + §14.2 D1–D6)
- `scripts/vibe-sprint-commit.mjs` (existing — this Sprint adds a post-commit tag-detection hook)

## harnessVersion policy for this Sprint (read carefully)

`.vibe/config.json` currently holds `harnessVersion: "1.3.1"` and `harnessVersionInstalled: "1.4.0"`. **Do NOT bump `harnessVersion` in this Sprint.** The v1.4.0 release cut is the Orchestrator's call after this Sprint lands; bumping here would pollute the self-validation story (the new auto-tagger would fire on its own Sprint commit, conflating "harness-gates self-test" with "v1.4.0 release"). Self-validation of the tagging logic must therefore go through tests that scaffold temporary repos with version deltas — never the live repo state.

## Deliverables

| id | intent |
|---|---|
| D1 | `scripts/vibe-sprint-commit.mjs` detects a bumped `harnessVersion` against the previous commit and creates an annotated tag; push is opt-in only. |
| D2 | `docs/context/harness-gaps.md` gains `script-gate` + `migration-deadline` columns; existing entries back-filled; `gap-rule-only-in-md` and `gap-release-tag-automation` flip to `covered`. |
| D3 | `scripts/vibe-rule-audit.mjs` scans `CLAUDE.md` for imperative rule phrases, joins against the ledger, and lists rules still un-gated. |
| D4 | `.vibe/config.local.json.userDirectives.auditSkippedMode` is a first-class, expiring store written by a new `scripts/vibe-audit-skip-set.mjs` helper with forced session-log decision entry. |
| D5 | `scripts/vibe-preflight.mjs` consults the directive and demotes `audit.overdue` FAIL→WARN only while still within `expiresAt`; expired directives are ignored, never auto-deleted. |

## File-level spec

### D1 — `scripts/vibe-sprint-commit.mjs` (modified)

**New CLI flag**: `--push-tag` (boolean, default false). Optional.

**Behavior — post-commit hook** (fires AFTER `commitStaged()` succeeds, before the final `[vibe-sprint-commit] committed <sha>` stdout line):

1. Read the version in the just-created commit: `git show HEAD:.vibe/config.json | <JSON.parse>.harnessVersion`. If missing or not a string of the form `/^\d+\.\d+\.\d+$/`, log `[vibe-sprint-commit] harness-tag: skipped (current harnessVersion not parseable)` and return.
2. Read the previous commit's version: `git show HEAD~1:.vibe/config.json`. If `HEAD~1` does not exist (single-commit repo) OR the file is missing there OR it cannot be parsed, log `[vibe-sprint-commit] harness-tag: skipped (no previous config.json to compare)` and return.
3. Compare via **tuple-compare on the three semver numeric components** (no npm package). Reuse `compareVersions()` pattern already present in `migrations/1.4.0.mjs` (do NOT import it — inline a copy, mark it `CROSS-REF (migrations/1.4.0.mjs:compareVersions)` so drift is traceable).
4. If `current <= previous` (no bump OR downgrade): log `[vibe-sprint-commit] harness-tag: skipped (no upward version delta: <prev> → <cur>)` and return. Downgrade must not silently tag.
5. If `current > previous`:
   - Candidate tag name: `v<current>`.
   - Check `git rev-parse --verify "refs/tags/<tag>" -- 2>/dev/null`. If already exists (idempotent replay): log `[vibe-sprint-commit] harness-tag: skipped (tag <tag> already exists)` and return.
   - Create annotated tag on HEAD: `git tag -a <tag> -m "auto-tag from sprint-commit <sprintId>"`. Use `execFileSync('git', [...])` with `stdio` capture; on non-zero exit, log `[vibe-sprint-commit] harness-tag: FAILED to create <tag>: <stderr>` but **do not** fail the overall commit (tag creation is best-effort relative to an already-successful commit).
   - Log `[vibe-sprint-commit] harness-tag: created <tag> (prev=<prev>)`.
   - If `--push-tag` was passed: `git push origin refs/tags/<tag>`. On error, log the stderr and continue (no auto-retry). Never run `git push --tags` (blast-radius too wide).

**Edge cases — enumerated**:

| case | expected |
|---|---|
| `HEAD~1` does not exist (first commit in repo) | skip tag, log reason |
| `config.json` absent in `HEAD` | skip, log |
| `config.json` absent in `HEAD~1` | skip, log |
| `harnessVersion` unparseable (not `x.y.z`) in either side | skip, log |
| `current == previous` | skip, log "no upward version delta" |
| `current < previous` (downgrade) | skip, log "no upward version delta" — explicit downgrade branch |
| Tag `v<current>` already exists | skip, log (idempotent re-run safe) |
| `git tag -a` itself errors (e.g. gpg mis-config) | log the stderr; commit remains valid; function returns normally |
| `--push-tag` omitted | never push |
| `--push-tag` passed + push errors | log stderr, do not retry, do not fail the commit |

**Do NOT**:
- Import `compareVersions` from `migrations/1.4.0.mjs` (migrations directory must remain optional downstream).
- Call `git push --tags` — always target the specific tag ref.
- Create lightweight (non-annotated) tags.
- Mutate `config.json`, `sprint-status.json`, or any file. Pure git metadata operation.
- Bump `harnessVersion` yourself in this Sprint's own commit (see policy section above).

### D2 — `docs/context/harness-gaps.md` (modified, schema extension)

**New header row** (replaces current 4-column header):

```markdown
| id | symptom | covered_by | status | script-gate | migration-deadline |
```

- `script-gate` column: enum `covered` | `pending`. A gap is `script-gate: covered` when a hook in CLAUDE.md §훅 강제 메커니즘 table enforces it via exit code; `pending` otherwise.
- `migration-deadline` column: either `—` (no deadline) or an explicit phrase such as `+3 sprints` / `v1.5.0` / `M-harness-gates` (free-form, single-cell). Used by `/vibe-review` cadence to flag overdue promotions.

**Back-fill rule** — every existing row MUST get both new columns populated. Use these defaults unless a row's `status` dictates otherwise:
- Rows with `status: covered` → `script-gate: covered`, `migration-deadline: —`.
- Rows with `status: partial` or `open` → `script-gate: pending`, `migration-deadline: —` unless this Sprint specifically addresses it.

**State flips performed by this Sprint**:

| id | before | after | reason |
|---|---|---|---|
| `gap-rule-only-in-md` | `partial` | `covered` + `script-gate: covered` + `migration-deadline: —` | `vibe-rule-audit.mjs` now mechanically enumerates un-gated rules (D3). |
| `gap-release-tag-automation` | `open` | `covered` + `script-gate: covered` + `migration-deadline: —` | `vibe-sprint-commit.mjs` auto-tagger (D1). Update `covered_by` column to mention `vibe-sprint-commit.mjs harness-tag hook (M-harness-gates)`. |
| `gap-review-catch-wiring-drift` | `open` | **unchanged**, but set `script-gate: pending`, `migration-deadline: +3 sprints` | out of scope for this Sprint; deadline anchors a future Planner scope. |

**Documentation change**: extend the `Update protocol` list (currently 3 items) with:

> 4. `script-gate` is `covered` only when a `scripts/vibe-*.mjs` or hook exit code (documented in CLAUDE.md §훅 강제 메커니즘 table) enforces the rule. Mere mention in an MD file counts as `pending`.
> 5. `migration-deadline` is free-form but MUST be either `—` or reference a concrete target (Sprint id, version, or `+N sprints`). `/vibe-review` flags overdue deadlines.

**Do NOT**:
- Remove or reorder existing rows.
- Rewrite existing `symptom` / `covered_by` text on rows not listed in the flip table.
- Touch the `## Process` section at the bottom (keep as-is).

### D3 — `scripts/vibe-rule-audit.mjs` (new)

**CLI contract**:
```
node scripts/vibe-rule-audit.mjs [--format=text|json] [--claude-md=<path>] [--gaps=<path>]
```

- `--format` — default `text`. `json` emits a single JSON array on stdout.
- `--claude-md` — default `./CLAUDE.md`. Override for tests.
- `--gaps` — default `./docs/context/harness-gaps.md`. Override for tests.
- Exit code: always `0` (informational tool — never a gate).

**Behavior**:

1. Read `CLAUDE.md`. For every non-empty, non-code-fence line, detect a rule match if the line (case-insensitive for English; exact-match for Korean) contains any of:
   `MUST`, `MUST NOT`, `NEVER`, `반드시`, `절대`, `금지`, `필수`.
   Ignore lines inside fenced code blocks (```).
2. For each match, capture `{ line: <1-based line number>, text: <trimmed line>, kind: <matched keyword> }`.
3. Read `harness-gaps.md`. Parse the table rows (any line matching `^\|\s*(gap-[\w-]+)\s*\|`). Build the set of gap ids with `script-gate: covered`.
4. For each rule, determine coverage:
   - If `text` contains any `gap-*` id token that appears in the covered set → mark `covered: true`, include the matching id in the result.
   - Otherwise → `covered: false`, and classify as "next-sprint candidate".
   - Rule-of-thumb: keyword matching is enough; full NLP is out of scope. The tool's job is surfacing candidates, not final judgment.
5. Output contract:

**`text` format**:
```
# CLAUDE.md rule audit (N rules found; K uncovered)

## Uncovered (candidates for next Sprint)
- CLAUDE.md:<line> [<kind>] <text>
  hint: no matching gap-* id with script-gate=covered

## Covered
- CLAUDE.md:<line> [<kind>] <text>
  covered-by: gap-<id>
```

**`json` format** (stdout, pretty-printed, one object):
```json
{
  "summary": { "total": <N>, "covered": <K>, "uncovered": <N-K> },
  "rules": [
    { "line": <1-based>, "text": "...", "kind": "MUST", "covered": true, "coveredBy": "gap-foo" },
    { "line": <1-based>, "text": "...", "kind": "금지",  "covered": false, "coveredBy": null }
  ]
}
```

**Read-only**: no writes, no mutations, no network. Pure stdout.

**Do NOT**:
- Modify `CLAUDE.md` or `harness-gaps.md`.
- Invoke any LLM / provider.
- Parse Markdown beyond the two responsibilities above (code-fence tracking + table row splitting).
- Exit non-zero — the Orchestrator treats non-zero as "harness broke".

### D4 — `.vibe/config.local.json.userDirectives.auditSkippedMode` + `scripts/vibe-audit-skip-set.mjs` (new)

**Schema extension** of `.vibe/config.local.json` (do NOT overwrite existing keys — merge):

```jsonc
{
  "orchestrator": "claude-opus",
  // ... existing keys ...
  "userDirectives": {
    "auditSkippedMode": {
      "enabled": true,
      "reason": "<single-line string, 1..500 chars>",
      "expiresAt": "<ISO 8601 UTC string, required when enabled=true>",
      "recordedAt": "<ISO 8601 UTC string, set by the CLI helper>"
    }
  }
}
```

`userDirectives` is a new top-level key; if the file already has one, preserve any sibling keys inside it. If `enabled === false`, the other sub-fields are ignored by preflight (but kept around for audit trail).

**CLI helper — `scripts/vibe-audit-skip-set.mjs`**:

```
node scripts/vibe-audit-skip-set.mjs <reason> <duration-days>
node scripts/vibe-audit-skip-set.mjs --clear
```

- `<reason>` — single-line string, 1–500 chars. Reject multi-line or empty.
- `<duration-days>` — positive integer, 1–90. `expiresAt` = now + N days (UTC).
- `--clear` flag — sets `enabled: false`, leaves `reason` / `expiresAt` / `recordedAt` intact for the audit trail, appends a single `[decision][audit-skipped-mode-clear]` session-log entry.
- On set:
  1. Read `.vibe/config.local.json` (must exist — else fail with `config.local.json not found; run /vibe-init first`).
  2. Deep-merge the `userDirectives.auditSkippedMode` object. Preserve `orchestrator`, `sprintRoles`, `providers`, and any sibling `userDirectives.*` keys.
  3. Write JSON with `\n` trailing newline, 2-space indent.
  4. Append to `session-log.md` a single line:
     `- <ISO> [decision][audit-skipped-mode] reason=<reason> expiresAt=<iso> durationDays=<N>`
     Use the same `## Entries` anchor pattern as `vibe-planner-skip-log.mjs` (reject if anchor missing). Idempotent by fingerprint — if the exact line already exists, exit 0 with `already recorded`.
  5. Exit 0 on success, non-zero on validation failure.
- On `--clear`: overwrite only `.userDirectives.auditSkippedMode.enabled = false`, append the clear decision entry.

**Do NOT**:
- Delete sibling keys inside `userDirectives` or elsewhere in `config.local.json`.
- Auto-clear an expired directive — expiration is a *read-time* filter (D5), never a write-time side effect.
- Call any network (no clock API — use `Date.now()` / `new Date().toISOString()`).
- Accept a negative `duration-days` or `>90` (keeps blast radius bounded).
- Mutate `.vibe/config.json` (harness-shared; this helper writes only the local override).

### D5 — `scripts/vibe-preflight.mjs` (modified)

**Extend the existing `audit.overdue` block** (currently around lines 484–526). The directive is checked **before** the current branching on `auditAck` (i.e. the existing `--ack-audit-overdue` CLI flag remains the highest-priority escape hatch; `auditSkippedMode` is a persistent lower-priority second escape hatch).

**New sequence** when `overdueByCount || overdueByRisks`:

1. If `auditAck` provided via CLI → existing behavior (append session-log entry, record WARN). Unchanged.
2. Else, read `.vibe/config.local.json` (if present). Extract `userDirectives.auditSkippedMode`.
3. If `enabled === true` AND `expiresAt` is a valid ISO string AND `Date.parse(expiresAt) > Date.now()`:
   - Compute `daysLeft = Math.ceil((expiresAt - now) / 86400000)`.
   - `record('audit.overdue', true, `skipped by user directive "${reason}" (expires=${expiresAt}, ${daysLeft} day(s) left)`, 'warn')`.
   - Do NOT append to session-log (the `vibe-audit-skip-set.mjs` CLI already recorded it once; re-running preflight must not spam the log).
4. If `enabled === true` but expired OR missing/invalid `expiresAt`:
   - Ignore the directive entirely.
   - `record('audit.overdue', false, `${reason}. audit required - run vibe-audit-clear or acknowledge with --ack-audit-overdue=<sprintId>:<reason>`, 'fail')` — existing FAIL path.
   - Do NOT mutate the directive. Expired entries remain until the user re-runs `vibe-audit-skip-set` or migration.
5. If `enabled === false` OR no `userDirectives` key: existing FAIL path.

**Resilience**: a malformed `config.local.json` must not crash preflight. Wrap the read/parse in a `try` and on error, fall through to the FAIL path with an `info`-level trailing note (do not add a new top-level check — keep the count of records identical to prior behavior + 0).

**Do NOT**:
- Auto-delete the expired directive.
- Touch `.vibe/config.json` (the shared harness file).
- Change the existing `--ack-audit-overdue` behavior, the `runStateValidation()` flow, or the `planner.presence` block.

## File inventory (summary)

| path | type | status |
|---|---|---|
| `scripts/vibe-sprint-commit.mjs` | modify | D1 post-commit hook + `--push-tag` |
| `scripts/vibe-rule-audit.mjs` | new | D3 rule-coverage scanner |
| `scripts/vibe-audit-skip-set.mjs` | new | D4 directive setter + session-log |
| `scripts/vibe-preflight.mjs` | modify | D5 directive-aware audit demotion |
| `docs/context/harness-gaps.md` | modify | D2 schema extension + 3 row updates |
| `.vibe/config.local.example.json` | modify | D4 example showing userDirectives shape |
| `migrations/1.4.0.mjs` | modify | extend with one idempotent step: back-fill `harness-gaps.md` schema columns for downstream repos (best-effort string transform, skip gracefully on parse mismatch) |
| `.vibe/sync-manifest.json` | modify | W6 — register `vibe-rule-audit.mjs`, `vibe-audit-skip-set.mjs`, new tests |
| `package.json` | modify | W9 — add `vibe:rule-audit` script alias (optional but recommended) |
| `docs/release/v1.4.0.md` | modify | W10 — append `## M-harness-gates` section |
| `CLAUDE.md` | modify — append only | W1 — two new rows in §훅 강제 메커니즘 table; in §Two-tier audit convention, add one line about `audit-skipped-mode` directive |
| `test/sprint-commit.test.ts` | modify | extend with harness-tag scenarios (≥3 cases) |
| `test/preflight-audit-gate.test.ts` | modify | extend with auditSkippedMode scenarios (≥2 cases) |
| `test/rule-audit.test.ts` | new | D3 coverage (≥2 cases) |
| `test/vibe-audit-skip-set.test.ts` | new | D4 coverage (≥2 cases) |

**Do NOT touch**:
- `.vibe/archive/prompts/**` — historical prompts are immutable.
- `docs/plans/sprint-roadmap.md` — roadmap is Orchestrator-maintained.
- Existing rows in `harness-gaps.md` beyond the 3 flips listed in D2.
- `CLAUDE.md` existing text — only **append** to the hook-enforcement table and the two-tier audit paragraph; do not rewrite prose elsewhere.
- `.vibe/config.json` `harnessVersion` value (keep `1.3.1`).

## Acceptance criteria (testable)

Every row below is machine-checkable. Report exit codes in the Final report Verification table.

| # | Command / check | Expected |
|---|---|---|
| AC1 | `npx tsc --noEmit` | exit 0 |
| AC2 | `npm test` | 0 failures, **new-test-count ≥ 8** across the 4 test files (sprint-commit +3, preflight-audit-gate +2, rule-audit.test.ts +2, vibe-audit-skip-set.test.ts +2 — note the last two lower bounds sum to 9, floor is 8 to give one swap margin) |
| AC3 | `node scripts/vibe-rule-audit.mjs --format=json` on the live repo | exit 0, JSON parses, `summary.total > 0`, `rules` is a non-empty array |
| AC4 | `node scripts/vibe-rule-audit.mjs` on the live repo | exit 0, both `## Uncovered` and `## Covered` headers rendered even if one section is empty (renders `(none)`) |
| AC5 | Temp-repo test: scaffold a fixture with two commits — commit A has `harnessVersion:"1.0.0"`, commit B bumps to `"1.1.0"` — run `vibe-sprint-commit` for commit B; assert `git tag -l "v1.1.0"` returns the tag | tag created |
| AC6 | Temp-repo test: identical version across both commits; run `vibe-sprint-commit` | no tag created; stderr/stdout contains `"no upward version delta"` |
| AC7 | Temp-repo test: tag `v1.1.0` pre-exists; bump triggers would create the same tag | skipped with `"already exists"` log, exit 0 |
| AC8 | `node scripts/vibe-audit-skip-set.mjs "temporary skip during iteration-3 planning" 14` against a fixture repo | `.vibe/config.local.json` gains `userDirectives.auditSkippedMode.enabled=true`, `expiresAt` 14 days ahead (±1 minute tolerance), session-log has one new `[decision][audit-skipped-mode]` entry |
| AC9 | Same command re-run | exit 0, session-log unchanged (idempotent fingerprint), config timestamps unchanged |
| AC10 | `node scripts/vibe-audit-skip-set.mjs --clear` | `enabled=false`, other fields intact, session-log has `[decision][audit-skipped-mode-clear]` entry |
| AC11 | Preflight on a fixture with `sprintsSinceLastAudit >= everyN` and an **active** auditSkippedMode | `audit.overdue` emits `[WARN]` with reason + days-left; exit 0 (no other failures) |
| AC12 | Preflight on a fixture with `sprintsSinceLastAudit >= everyN` and an **expired** auditSkippedMode | `audit.overdue` emits `[FAIL]`; exit 1 |
| AC13 | `harness-gaps.md` parses with new 6-column header | `gap-rule-only-in-md` row status = `covered`, `script-gate = covered`; `gap-release-tag-automation` row status = `covered`, `script-gate = covered`; `gap-review-catch-wiring-drift` row `script-gate = pending`, `migration-deadline = +3 sprints` |
| AC14 | Every data row in `harness-gaps.md` has exactly 6 pipe-separated cells (plus header+separator = 2 meta rows) | lint pass |
| AC15 | `node scripts/vibe-gen-schemas.mjs --check` | exit 0 (no Zod schema drift reintroduced) |
| AC16 | `grep -c "harness-tag" scripts/vibe-sprint-commit.mjs` | ≥ 3 (log prefix references) |
| AC17 | No file under `.vibe/archive/prompts/` modified | `git diff --name-only HEAD~1 HEAD -- .vibe/archive/prompts/` empty |
| AC18 | `.vibe/config.json` `harnessVersion` unchanged | still `"1.3.1"` post-commit |

**Sandbox-note for AC5–AC7, AC11–AC12**: Codex may need to run these tests inside the Generator sandbox. If the test harness cannot spawn child git processes inside the sandbox (a known Codex constraint), mark the relevant AC row as "sandbox-only failure" in the Final report — Orchestrator will re-run outside. This is an allowed escape under `_common-rules.md §7` / §13; not a blocker for Sprint completion.

## Wiring Integration Checklist (mandatory — fill the template in Final report)

Codex's Final report MUST include a `## Wiring Integration` section. Required minimum rows:

| Checkpoint | Expected Status | Expected Evidence |
|---|---|---|
| W1 CLAUDE.md hook table | touched | Two new rows (`vibe-rule-audit.mjs`, `vibe-audit-skip-set.mjs`) under §훅 강제 메커니즘; add one line to §Two-tier audit convention describing the `audit-skipped-mode` directive |
| W2 CLAUDE.md 관련 스킬 | n/a | No new slash command or skill |
| W3 CLAUDE.md role table | n/a | No new role |
| W4 `.claude/settings.json` hooks | n/a | No new event hook |
| W5 `.claude/settings.json` statusLine | n/a | No statusline change |
| W6 sync-manifest `files.harness[]` | touched | Append `scripts/vibe-rule-audit.mjs`, `scripts/vibe-audit-skip-set.mjs`, `test/rule-audit.test.ts`, `test/vibe-audit-skip-set.test.ts` |
| W7 sync-manifest `hybrid.*.harnessKeys` | optional | If you modify the shape of `.vibe/config.json`'s schema family, update; otherwise `n/a` |
| W8 README.md | n/a | Unless the new CLIs warrant a user-facing blurb — Orchestrator's call post-hand-off |
| W9 package.json scripts | touched | Add `"vibe:rule-audit": "node scripts/vibe-rule-audit.mjs"` (optional but strongly recommended); do NOT add an alias for `vibe-audit-skip-set` (Orchestrator calls it directly during user dialog) |
| W10 release notes v1.4.0.md | touched | Append `## M-harness-gates` with bullets for D1–D5 |
| W11 migrations/1.4.0.mjs | touched | Add one idempotent step that back-fills the `harness-gaps.md` schema columns for downstream repos (no-op if already 6-column) |
| W12 test regression | touched | ≥8 new tests total across the 4 test files named in File Inventory |
| W13 harness-gaps.md | touched | Schema + 3 row state flips per D2 |
| W14 .gitignore | n/a | No runtime artifact file |
| D1 grep `planner.md` | n/a | Not touching the old agent filename |

**`verified-callers` (required in Final report)** — for each new script, list the registered call-sites:

```
scripts/vibe-rule-audit.mjs → CLAUDE.md:<line> hook table / .vibe/sync-manifest.json harness[] / package.json scripts.vibe:rule-audit
scripts/vibe-audit-skip-set.mjs → CLAUDE.md:<line> hook table / .vibe/sync-manifest.json harness[] / docs/release/v1.4.0.md
```

## Non-goals / out of scope

- Evaluator audit Sprint run (backstop for `sprintsSinceLastAudit` counter is `M-audit`; running the audit itself is a dogfood8 concern).
- `v1.4.1` or any version bump to `harnessVersion`. Leave at `"1.3.1"`; Orchestrator decides the cut after this Sprint.
- `gap-review-catch-wiring-drift` actual implementation — this Sprint only sets its `migration-deadline`.
- `git push` automation beyond the opt-in `--push-tag` flag on the specific ref.
- Changing `--ack-audit-overdue` CLI semantics.
- Any `vite build`, `next build`, browser smoke, or integration run under the Generator sandbox. Those are Orchestrator post-handoff work (`_common-rules.md §7`, §13.1).
- Rewriting the pre-existing `compareVersions()` in `migrations/1.4.0.mjs` — this Sprint inlines its own copy.
- Touching `.vibe/archive/prompts/**` — historical record, immutable.

## Estimated LOC

~500 total (roadmap budget).
- Production: ~300 (D1 +80 / D3 +120 / D4 +60 / D5 +30 / migrations 1.4.0 extension +10)
- Tests: ~200 (sprint-commit harness-tag suite +80 / preflight-audit-gate extension +40 / rule-audit +50 / audit-skip-set +30)

Anything substantially over this budget must be surfaced in the Final report's `Deviations` section with the scope-expansion rationale. The `_common-rules.md §5` scope rule still applies.

## Final report contract

Codex's Final report MUST end with, in this order:

1. `## Files added` — path + one-line description for every new file.
2. `## Files modified` — path + one-line description for every modified file.
3. `## Verification` — table with columns `command | exit`. Include at minimum: `npx tsc --noEmit`, `npm test`, `node scripts/vibe-gen-schemas.mjs --check`, `node scripts/vibe-rule-audit.mjs --format=json` (pipe to `node -e "JSON.parse(require('fs').readFileSync(0,'utf8'))"`), and the four AC5–AC12 temp-repo fixture tests.
4. `## Sandbox-only failures` — enumerate any AC whose failure is solely due to Generator sandbox constraints (network / child-git-process / long-running). Empty section is fine; write `none` explicitly.
5. `## Deviations` — either `none` or a numbered list explaining scope/budget/approach drift.
6. `## Wiring Integration` — the table from the Wiring Integration Checklist section, with `Status` and `Evidence` filled in, followed by the `verified-callers` block.
7. `## harness-gaps.md diff` — a 10-line-or-less before/after snippet showing the header row change + the three row flips (D2). Use a triple-backtick diff fence.

## Style reminders (Common rules section + Planner guard-rails)

- Intent-first prose in all documentation sections; types/CLI signatures are contracts, function bodies are Generator territory.
- No hex color codes anywhere.
- No pseudocode function bodies in this prompt.
- Absolute-in-repo paths throughout (e.g. `scripts/vibe-rule-audit.mjs`, never `./scripts/...` unless CLI shell form).
- Every acceptance criterion is a command or a grep / file-state assertion — no "it should work well" fluff.
- `_common-rules.md §14.4` applies: missing `## Wiring Integration` → Sprint incomplete → re-delegate.
