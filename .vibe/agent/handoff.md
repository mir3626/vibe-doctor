# Orchestrator Handoff

## 1. Identity

- **repo**: `vibe-doctor`
- **branch**: `main`
- **last release**: v1.5.10 (sync latest tag resolution for stale pinned refs)
- **current iteration**: post-iter-7 maintenance
- **harnessVersion**: `1.5.10`
- **language/tone**: Korean user-facing, concise engineering notes

## 2. Status

IDLE after v1.5.10 `/vibe-sync` ref-resolution hardening.

v1.5.10 fixes the dogfood10-style stale `upstream.ref` trap:

- `src/commands/sync.ts` now refreshes `.vibe/sync-cache.json` best-effort before resolving the upstream ref.
- If cached `latestVersion` is newer than `harnessVersionInstalled`, default `/vibe-sync` uses that latest tag.
- Existing semver refs such as `v1.4.3` no longer pin downstream projects to the installed version after version-check has found a newer tag.
- Explicit `--ref` remains highest priority.
- Non-version refs such as `main` or feature branches remain preserved.
- Regression coverage is in `test/sync.test.ts` under `resolveUpstreamRef`.

Earlier local releases remain preserved:

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

Windows verification for v1.5.10:

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

## 5. Next Action

Commit/tag/push v1.5.10 from `C:\Users\Tony\Workspace\vibe-doctor`.

Do not touch downstream project `/home/tony/workspace/telegram-local-ingest` unless explicitly requested.

After v1.5.10 is pushed, dogfood/downstream projects with `upstream.ref: v1.4.3` should be able to run normal `/vibe-sync` once their version-check cache has a newer `latestVersion`. The new sync command also refreshes that cache best-effort.

## 6. Pending Risks

- If a project intentionally uses a semver `upstream.ref` as a hard pin, default `/vibe-sync` will now advance when cached latest is newer. Use explicit `--ref <tag>` for a one-off pinned sync, or a non-version branch ref for branch-based workflows.
- Do not share one `node_modules` directory between Windows and WSL for packages with native binaries such as `esbuild`. Use per-platform installs or a clean Linux workspace.
