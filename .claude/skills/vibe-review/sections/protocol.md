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

2. Also read:
   - `.vibe/agent/handoff.md`
   - recent `.vibe/agent/session-log.md` entries, default `50` or `.vibe/config.json.review.recentEntries`; the helper sorts active entries and legacy timestamped preamble entries without changing their text or reading archives. Partial timestamps use UTC for sorting only; undated entries follow dated entries in their original order. Use the original log/handoff when chronology is uncertain.
   - `git log --oneline`, default latest `20` commits, or since the latest `review-*.md`
   - open `.vibe/agent/sprint-status.json.pendingRisks`
   - `.vibe/agent/project-decisions.jsonl`
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
