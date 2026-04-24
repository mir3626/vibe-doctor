# Orchestrator Handoff

## 1. Identity

- **repo**: `vibe-doctor`
- **branch**: `main`
- **last pushed release**: `v1.6.10`
- **working target**: `v1.6.11`
- **current iteration**: iter-12 complete locally, push pending
- **harnessVersion**: `1.6.11`
- **language/tone**: Korean user-facing, concise engineering notes

## 2. Status

User reported GitHub Actions has failed since `195a91be51f3cefe4907f04759001e353a125c7b` (`v1.6.1`). Public Actions metadata shows the failing step is `Run npm test`. A clean WSL/Linux clone reproduced the failure in `test/run-codex-wrapper.test.ts`:

- `returns rc=1 when codex is missing`: test narrowed `PATH` so Linux could no longer resolve `bash`, producing `status=null`.
- `rejects Windows npm shim paths when running under WSL`: generic Ubuntu runners do not have a `/mnt/c/...` checkout path, so the synthetic WSL env did not actually exercise the Windows shim path.

v1.6.11 candidate fixes this by:

- resolving POSIX `bash` to an absolute path in the test harness,
- adding `CODEX_BIN` support to `scripts/run-codex.sh`,
- using `CODEX_BIN=/mnt/c/.../codex` in the WSL shim regression test.

## 3. Verification

Completed:

- `node --import tsx --test test/run-codex-wrapper.test.ts test/shell.test.ts` on Windows
- WSL `npm ci` then `node --import tsx --test test/run-codex-wrapper.test.ts test/shell.test.ts`
- Windows `npm ci` restored platform-local `node_modules`

Pending final release verification:

- `npm run typecheck`
- `npm run build`
- `npm test`
- `npm run test:ui`
- `git diff --check`
- `node scripts/vibe-preflight.mjs --bootstrap`
- `npm run vibe:checkpoint -- --json`

## 4. Preserved Value

- Actual WSL protection against Windows npm shims remains intact.
- Linux CI no longer depends on Windows-specific checkout path shape.
- `CODEX_BIN` gives advanced users and tests an explicit Codex binary override without changing default PATH behavior.

## 5. Next Action

Run final verification, commit/tag `v1.6.11`, then push `main` and the tag.

## 6. Pending Risks

- Existing open lightweight audit risk remains unrelated: `src/commands/init.ts has no test/init.test.ts`.
- Audit cadence risks are open because `sprintsSinceLastAudit >= 5`.
