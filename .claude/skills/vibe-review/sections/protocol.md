## Protocol

1. Load reproducible helper inputs:

```bash
node .vibe/harness/scripts/vibe-review-inputs.mjs --install
```

The `--install` flag runs `npm install` first when local `tsx`/`zod`
dependencies are missing, then prints the reproducible review input JSON. Omit
`--install` only when dependencies are already installed. This helper is allowed
to run in a partial or uninitialized downstream checkout when the explicit
review target is an init/bootstrap/harness process failure.

Default stdout is bounded to 64 KiB of UTF-8 JSON, including metadata. The helper
omits the full `sessionLog`, limits the handoff prefix to 8 KiB and recent complete
entries to 16 KiB of serialized JSON, and bounds other fields. `output.fields`
records source references, original/returned sizes, truncation and omitted array
counts. An oversized entry is omitted whole; a shortened handoff is not the full
current-state contract. Read the needed line ranges before deciding on missing
evidence; do not load entire historical logs or concatenate all omitted ranges.
`collectReviewInputs` still returns full source text for programmatic consumers,
and `detectOptInGaps` runs before output projection on the original recent entries.
`sessionLogFormatWarnings` identifies unsupported active dated headings and bullets
without a space, with 1-based source lines. Inspect those ranges for missed terminal
events; append a canonical `- <full ISO timestamp with timezone> [tag] text` record
referencing the original instead of rewriting history. Warnings are diagnostics,
not incident counts or inferred goal/experiment status.

2. Also read:
   - current `.vibe/agent/handoff.md` state; use targeted ranges when the helper reports truncation
   - recent `.vibe/agent/session-log.md` entries, default `50` or `.vibe/config.json.review.recentEntries`; the helper sorts active entries and legacy timestamped preamble entries without changing their text or reading archives. Partial timestamps use UTC for sorting only; undated entries follow dated entries in their original order. Use the original log/handoff when chronology is uncertain.
   - `git log --oneline`, default latest `20` commits, or since the latest `review-*.md`
   - open `.vibe/agent/sprint-status.json.pendingRisks`
   - relevant `.vibe/agent/project-decisions.jsonl` records through bounded extraction, not a full ledger dump
   - `docs/context/harness-gaps.md`
   - `.vibe/archive/rules-deleted-*.md` and `.vibe/audit/iter-*/rules-deleted.md`

3. Write the report to:
   - `docs/reports/review-<sprintCount>-<YYYY-MM-DD>.md`
   - `<sprintCount>` is `sprint-status.json.sprints.filter(s => s.status === 'passed').length`

For a release/sync/checkout-parity review, also run
`npm run vibe:codex-wrapper-audit -- --tracked` from the Git checkout. The default
audit proves local file existence only; tracked mode checks every declared
transitive target against the Git index and fails if Git is unavailable. It does
not prove unstaged text was committed; verify the final clean checkout separately.
