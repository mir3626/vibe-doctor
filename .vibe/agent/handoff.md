# Orchestrator Handoff

## 1. Identity

- **repo**: `vibe-doctor`
- **branch**: `main`
- **last release**: v1.5.11 (post-sync harness-only typecheck scope)
- **current iteration**: post-iter-7 maintenance
- **harnessVersion**: `1.5.11`
- **language/tone**: Korean user-facing, concise engineering notes

## 2. Status

IDLE after v1.5.11 `/vibe-sync` post-verify scope hardening.

v1.5.11 fixes downstream product typecheck leakage during harness sync:

- Added `tsconfig.harness.json` as the syncable harness-only TypeScript project.
- `src/commands/sync.ts` post-verify now runs `npx tsc -p tsconfig.harness.json --noEmit` when that file exists.
- `tsconfig.json` is no longer a hybrid harness merge target, so product app tsconfig remains project-owned.
- The template `typecheck` script now uses the harness tsconfig.
- Regression coverage is in `test/sync.test.ts` under `resolvePostSyncTypecheckArgs`.

Earlier local releases remain preserved:

- v1.5.10 fixes stale semver `upstream.ref` pinning during `/vibe-sync`.
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

Windows verification for v1.5.11:

- `npm run typecheck`
- `node --import tsx --test test/sync.test.ts`
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
- Latest tag ref resolution remains intact.

## 5. Next Action

Commit/tag/push v1.5.11 from `C:\Users\Tony\Workspace\vibe-doctor`.

After v1.5.11 is pushed, downstream `/vibe-sync` post-verify should no longer fail just because product app `tsconfig.json` does not typecheck. Product QA remains a separate project concern.

## 6. Pending Risks

- Existing downstream projects may already have a product `tsconfig.json` that was previously touched by harness sync. v1.5.11 stops future harness ownership but does not automatically rewrite product tsconfig choices.
- Do not share one `node_modules` directory between Windows and WSL for packages with native binaries such as `esbuild`. Use per-platform installs or a clean Linux workspace.
