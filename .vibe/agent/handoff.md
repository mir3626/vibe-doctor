# Orchestrator Handoff

## 1. Identity

- **repo**: `vibe-doctor`
- **branch**: `main`
- **last release**: v1.5.12 (pinned upstream ref prompt semantics)
- **current iteration**: post-iter-7 maintenance
- **harnessVersion**: `1.5.12`
- **language/tone**: Korean user-facing, concise engineering notes

## 2. Status

IDLE after v1.5.12 `/vibe-sync` pinned-ref semantics hardening.

v1.5.12 restores `upstream.ref` as a real pin and adds an explicit update path:

- Semver `upstream.ref` is preserved by default during `/vibe-sync`.
- If cached `latestVersion` is newer and no `--ref` was supplied, interactive sync asks whether to keep the pin, update once, or cancel.
- Non-interactive sync keeps the pin and tells the user to use `--ref <tag>` to bypass it.
- Unpinned projects still track cached latest tags.
- `scripts/vibe-sync-bootstrap.mjs` preserves existing pins but no longer auto-creates a semver `upstream.ref` for unpinned projects.
- Regression coverage is in `test/sync.test.ts` and `test/vibe-sync-bootstrap.test.ts`.

Earlier local releases remain preserved:

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

Windows verification for v1.5.12:

- `npm run typecheck`
- `node --import tsx --test test/sync.test.ts test/vibe-sync-bootstrap.test.ts`
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

## 5. Next Action

Commit/tag/push v1.5.12 from `C:\Users\Tony\Workspace\vibe-doctor`.

After v1.5.12 is pushed, downstream projects with pinned `upstream.ref` values should see an update choice during interactive `/vibe-sync`; non-interactive jobs should keep the pin unless they pass `--ref`.

## 6. Pending Risks

- Existing downstream projects may already have a product `tsconfig.json` that was previously touched by harness sync. v1.5.11 stops future harness ownership but does not automatically rewrite product tsconfig choices.
- Projects cloned from an older template may already contain `upstream.ref` as an accidental pin. v1.5.12 preserves it by default and exposes the update choice, but does not remove the pin automatically.
- Do not share one `node_modules` directory between Windows and WSL for packages with native binaries such as `esbuild`. Use per-platform installs or a clean Linux workspace.
