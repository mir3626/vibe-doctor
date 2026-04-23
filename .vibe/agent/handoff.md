# Orchestrator Handoff

## 1. Identity

- **repo**: `vibe-doctor`
- **branch**: `main`
- **last release**: v1.5.13 (WSL browser opener error handling)
- **current iteration**: post-iter-7 maintenance
- **harnessVersion**: `1.5.13`
- **language/tone**: Korean user-facing, concise engineering notes

## 2. Status

IDLE after v1.5.13 dashboard/report browser opener hardening.

v1.5.13 fixes WSL/Linux browser opener failures:

- `npm run vibe:dashboard` now catches async child process `error` events from `xdg-open`/browser launchers and logs a warning instead of crashing the server.
- `npm run vibe:report` uses the same handling for report auto-open.
- Regression coverage is in `test/dashboard-server.test.ts` and `test/project-report.test.ts`.

Earlier local releases remain preserved:

- v1.5.12 restores `upstream.ref` as a real pin and adds an explicit update path.
- v1.5.11 scopes `/vibe-sync` post-verify typechecking to harness code.
- v1.5.10 attempted stale semver `upstream.ref` auto-update behavior; v1.5.12 supersedes it with explicit pinned-ref prompts.
- v1.5.9 fixes Windows CMD/PowerShell Claude statusline and hook command compatibility.
- v1.5.8 infers missing upstream config from `git remote origin` during session-start and `/vibe-init`.
- v1.5.7 tracks executable shell wrappers in Git.
- v1.5.6 makes synced `.sh` harness wrappers executable on POSIX.
- v1.5.5 expands project-safe sync behavior for env/CI/editor/agent-memory files.
- v1.5.4 keeps `.gitignore` project entries through line-union merge.
- v1.5.3 hardens WSL Codex wrapper stdin/locale behavior.
- v1.5.2 hardens UTF-8 Markdown/editor defaults.
- v1.5.1 adds provider-neutral lifecycle hooks.

## 3. Verification

Windows verification for v1.5.13:

- `npm run typecheck`
- `node --import tsx --test test/dashboard-server.test.ts test/project-report.test.ts`
- `npm run build`
- `npm test`

## 4. Preserved Value

- Provider-neutral lifecycle hooks remain intact.
- UTF-8 Markdown/editor hardening remains intact.
- WSL-safe Codex wrapper behavior remains intact.
- Project-safe sync merge behavior remains intact.
- Executable wrapper handling remains intact.
- Upstream bootstrap remains intact.
- Windows CMD/PowerShell statusline and hook compatibility remains intact.
- Pinned `upstream.ref` semantics and explicit update prompts remain intact.
- WSL/Linux browser opener failures no longer crash dashboard/report processes.

## 5. Next Action

Commit/tag/push v1.5.13 from `C:\Users\Tony\Workspace\vibe-doctor`.

After v1.5.13 is pushed, downstream projects should sync and rerun `npm run vibe:dashboard`. If `xdg-open` is blocked, the dashboard URL should still print and the server should keep running.

## 6. Pending Risks

- Existing downstream projects may already have a product `tsconfig.json` that was previously touched by harness sync. v1.5.11 stops future harness ownership but does not automatically rewrite product tsconfig choices.
- Projects cloned from an older template may already contain `upstream.ref` as an accidental pin. v1.5.12 preserves it by default and exposes the update choice, but does not remove the pin automatically.
- Do not share one `node_modules` directory between Windows and WSL for packages with native binaries such as `esbuild`. Use per-platform installs or a clean Linux workspace.
