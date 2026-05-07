# Orchestrator Handoff

## 1. Identity

- **repo**: `vibe-doctor`
- **branch**: `main`
- **working release**: `v1.7.9` (LTS baseline remains `v1.7.3-lts`)
- **current mode**: Codex Orchestrator maintenance
- **harnessVersion**: `1.7.9`
- **language/tone**: Korean user-facing, concise engineering notes

## 2. Status

Current mainline release is `v1.7.9`, pushed to `origin/main` at `8ed2be0`; tag `v1.7.9` is also pushed. LTS baseline remains immutable tag `v1.7.3-lts`.

- v1.7.9 adds a manual `diff-reviewer` sidecar foundation for Codex and Claude Orchestrators.
- Sidecar input is a sealed packet containing prompt summary, changed files, current git diff, checklist snippets, evidence refs, coverage, and `sha256:` input hash.
- Sidecar stdout is accepted only as strict JSON validated by generated Zod-backed schemas.
- Wrapper-written artifacts live under ignored `.vibe/sidecars/artifacts/<sprintId>/diff-reviewer.json` and are non-durable.
- Sidecars cannot update handoff, session-log, sprint-status, reports, commits, tags, or pass/fail decisions.
- Provider auto-detection follows `.vibe/config.json.orchestrator`; Codex defaults to `gpt-5.5`, Claude defaults to `opus`.
- Default effort is `high`; `--importance critical|very-important` or `--effort xhigh` selects `xhigh`.
- `.codex/agents/diff-reviewer.toml` and `.claude/agents/diff-reviewer.md` are shipped as provider adapters, while the canonical prompt lives at `.vibe/harness/sidecars/diff-reviewer.md`.
- `docs/context/sidecars.md` records the dogfood-gated follow-up path: `wiring-reviewer`, `test-auditor`, `evidence-reviewer`, command sidecars, report/handoff drafts, write-capable sidecars, parallel lanes, and `/vibe-review` rollup remain deferred.
- `docs/context/harness-gaps.md` now tracks `gap-sidecar-review-coverage` as `under-review | partial | +3 sprints`.

## 3. Verification

Completed on Windows for the v1.7.9 sidecar foundation:

- `npx tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --module NodeNext --moduleResolution NodeNext --target ES2022 --lib ES2023 --types node --esModuleInterop --skipLibCheck .vibe/harness/scripts/vibe-sidecar-run-impl.ts`
- `npm run vibe:gen-schemas -- --check`
- `node --import tsx --test .vibe/harness/test/sidecar.test.ts .vibe/harness/test/codex-agents.test.ts`
- `npm run typecheck`
- `npm run build`
- `npm test` (366 tests: 365 pass, 1 skipped)
- `git diff --check`
- `npm run vibe:context-audit` (report-only; no new sidecar path ambiguity after adapter wording cleanup)
- `npm run vibe:rule-audit` (report-only; existing 27 undisposed CLAUDE.md rules remain)
- `npm run vibe:sidecar-run -- diff-reviewer --sprint-id local-smoke --mock-output-file <temp>` then removed `.vibe/sidecars/`

## 4. Expected Downstream Behavior

Downstream projects syncing to `v1.7.9` can run:

```bash
npm run vibe:sidecar-run -- diff-reviewer --sprint-id <sprint-id>
```

The command should write one ignored artifact path to stdout. It must not mutate `.vibe/agent/handoff.md`, `.vibe/agent/session-log.md`, `.vibe/agent/sprint-status.json`, reports, or product code.

## 5. Next Action

Dogfood in `codex-widget-for-desktop` by syncing `v1.7.9`, running the sidecar against a real downstream diff, then checking:

- artifact schema validates
- provider auto-selection follows the downstream Orchestrator
- `high`/`xhigh` effort selection is visible in artifact metadata
- no durable state files are modified unless the Orchestrator manually cites accepted findings
- `/vibe-review` can later follow up on `gap-sidecar-review-coverage`

## 6. Pending Risks

- `diff-reviewer` is manual only; no sprint-complete, preflight, dashboard, or `/vibe-review` wiring yet.
- Real Claude/Codex sidecar invocations are dogfood targets; local release verification used mock mode plus CLI help/contract checks.
- Sidecar findings are advisory and may add triage burden if false positives are high.
- Artifact expiration is metadata-only in this foundation; no cleanup command exists yet.
- `wiring-reviewer` and command/test sidecars are intentionally deferred until at least three dogfood runs show stable signal.
