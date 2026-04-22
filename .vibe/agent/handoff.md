# Orchestrator Handoff

## 1. Identity

- **repo**: `vibe-doctor`
- **branch**: `main`
- **last release**: v1.5.6 (sync executable-mode correction)
- **current iteration**: post-iter-7 maintenance
- **harnessVersion**: `1.5.6`
- **language/tone**: Korean user-facing, concise engineering notes

## 2. Status

IDLE after v1.5.6 harness sync hardening.

v1.5.5 expanded project-safe sync behavior beyond `.gitignore`:

- Added `replace-if-unmodified` for `.env.example` and `.github/workflows/ci.yml`.
- Added `json-array-union` for `.vscode/extensions.json`.
- Moved `.vscode/settings.json` to `json-deep-merge`.
- Moved `.editorconfig` and `.gitattributes` to `line-union`.
- Converted `AGENTS.md` and `GEMINI.md` to marker-based `section-merge` with `PROJECT:custom-rules` preserved.
- Added marker bootstrap behavior: unmodified legacy section files are replaced once to add markers; modified legacy files are skipped.
- Made synced file copies preserve existing file mode or default new files to `0644`, preventing Windows-mounted templates from turning regular files executable under Linux/WSL.

v1.5.6 corrects the executable-mode edge case from v1.5.5:

- Synced `.sh` harness wrappers are explicitly written as `0755`.
- Regular synced files still preserve existing mode or default to `0644`.
- This keeps `scripts/run-codex.sh` runnable as `./scripts/run-codex.sh` on Linux/WSL without reintroducing executable-bit noise for Markdown, JSON, TypeScript, and config files.

Windows verification:

- `npm run typecheck`
- `npm run build`
- `npm test`

WSL verification:

- Direct `/mnt/c/.../vibe-doctor` typecheck/build passed.
- Direct `/mnt/c` WSL `npm test` failed because Windows-installed `node_modules` contains `@esbuild/win32-x64`; this is a native dependency platform mismatch, not a test/code failure.
- Clean Linux temp copy excluding `node_modules`, followed by `npm ci`, passed `npm run typecheck`, `npm run build`, and `npm test`.

## 3. Preserved Value

- Provider-neutral lifecycle hooks from v1.5.1 remain intact.
- UTF-8 Markdown/editor hardening from v1.5.2 remains intact.
- WSL-safe Codex wrapper behavior from v1.5.3 remains intact.
- Project-safe `.gitignore` line merge from v1.5.4 remains intact.

## 4. Next Action

Sync downstream project `/home/tony/workspace/telegram-local-ingest` from this local template after v1.5.6 is committed/tagged/pushed:

```bash
cd /home/tony/workspace/telegram-local-ingest
source "$HOME/.nvm/nvm.sh"
npm run vibe:sync -- --from /mnt/c/Users/Tony/Workspace/vibe-doctor --dry-run
```

Expected dry-run behavior:

- `.env.example` should be skipped if customized by the project, not conflict.
- `.gitignore`, `.editorconfig`, and `.gitattributes` should line-merge.
- `.vscode/settings.json` should JSON deep-merge.
- `.vscode/extensions.json` should JSON array-union.
- `AGENTS.md` and `GEMINI.md` should bootstrap or section-merge markers depending on downstream state.

## 5. Pending Risks

- Do not share one `node_modules` directory between Windows and WSL for packages with native binaries such as `esbuild`. Use per-platform installs or a clean Linux workspace.
