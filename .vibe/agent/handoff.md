# Orchestrator Handoff

## 1. Identity

- **repo**: `vibe-doctor`
- **branch**: `main`
- **working release**: `v1.7.11` candidate (LTS baseline remains `v1.7.3-lts`)
- **current mode**: Codex Orchestrator maintenance
- **harnessVersion**: `1.7.11`
- **language/tone**: Korean user-facing, concise engineering notes

## 2. Status

Prepared the v1.7.11 upstream sidecar dogfood hardening patch from downstream `codex-widget-for-desktop` evidence at commit `4b4648a`.

- Fixed Windows/Codex sidecar execution by resolving the npm-installed `@openai/codex/bin/codex.js` entrypoint and invoking it via `process.execPath` on Windows. Non-Windows remains direct `codex`.
- Hardened sealed packet handling: `--input-file` resolves relative to `--cwd`, recomputes `inputHash`, and rejects mismatches before artifact creation.
- Made sidecar artifact coverage wrapper-owned from the sealed input packet; reviewer stdout cannot override counters or clear truncation.
- Added reviewer-output semantic validation: `pass` requires zero findings, `advisory` requires low/medium findings with no high findings, and `fail` requires at least one high finding.
- Resolved relative `--prompt-file`, `--input-file`, and `--mock-output-file` against `--cwd`.
- Rejected `--artifact-root` outside `--cwd`.
- Added secret-safe diff collection: sensitive tracked paths/extensions are omitted, untracked contents are omitted by default, `--include-untracked-content` is explicit local-debug opt-in, and non-text/unsafe-control untracked bytes are still omitted.
- Changed omission placeholders to neutral blocks instead of synthetic new-file patches.
- Removed file-reading tools from the Claude `diff-reviewer` adapter metadata.
- Kept `gap-sidecar-review-coverage` as `under-review | partial | +3 sprints`; sidecars remain manual/advisory only.

## 3. Verification

Completed on Windows for the v1.7.11 candidate:

- `node --import tsx --test .vibe/harness/test/sidecar.test.ts`
- `npx tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --module NodeNext --moduleResolution NodeNext --target ES2022 --lib ES2023 --types node --esModuleInterop --skipLibCheck .vibe/harness/scripts/vibe-sidecar-run-impl.ts .vibe/harness/test/sidecar.test.ts`
- `npm run vibe:typecheck`
- `npm run build`
- `npm run vibe:gen-schemas -- --check`
- `node .vibe/harness/scripts/vibe-preflight.mjs --bootstrap`
- `npm test` (375 tests: 374 pass, 1 skipped)
- `git diff --check`
- strict UTF-8 decode and mojibake grep over touched files
- `npm run vibe:context-audit` (report-only; known noisy baseline)
- `npm run vibe:rule-audit` (report-only; existing 27 undisposed CLAUDE.md rules remain)
- Real Windows Codex sidecar smoke: `npm run vibe:sidecar-run -- diff-reviewer --sprint-id dogfood-v1711-codex-final3 --provider codex --timeout-ms 120000 --max-input-bytes 64000` produced a validated `status: "pass"` artifact before ignored artifacts were removed.

## 4. Expected Downstream Behavior

Downstream projects syncing to `v1.7.11` should be able to run Codex sidecars on Windows without `spawnSync codex ENOENT`. Sidecar artifacts should remain ignored and non-durable, while tampered/stale input packets, contradictory reviewer outputs, artifact-root escapes, and unsafe diff content are rejected or omitted by the wrapper.

`codex-widget-for-desktop` should sync to `v1.7.11`, rerun the v1.7.9 sidecar dogfood, and confirm Windows Codex sidecar execution plus the sealed-packet hardening regressions.

## 5. Next Action

Commit the v1.7.11 patch, tag `v1.7.11`, push `main` and the tag, then update this handoff with the pushed commit hash.

## 6. Pending Risks

- `gap-sidecar-review-coverage` remains partial because sidecars are still manual/advisory and not consumed by `/vibe-review`, preflight, sprint-complete, or sprint-commit.
- `--include-untracked-content` is intentionally opt-in local debugging only; default behavior omits untracked contents.
- Existing report-only `context-audit` and `rule-audit` noise is unchanged.
