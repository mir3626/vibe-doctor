# Orchestrator Handoff

## 1. Identity

- **repo**: `vibe-doctor`
- **branch**: `main`
- **last release**: v1.5.8 (provider-neutral upstream bootstrap)
- **current iteration**: post-iter-7 maintenance
- **harnessVersion**: `1.5.8`
- **language/tone**: Korean user-facing, concise engineering notes

## 2. Status

IDLE after v1.5.8 harness sync/update hardening.

v1.5.8 closes the dogfood clone upstream gap:

- `scripts/vibe-version-check.mjs` now best-effort infers `.vibe/config.json.upstream.url` from `git remote get-url origin` before version-check no-op decisions.
- `src/commands/init.ts` invokes the same upstream bootstrap path during `/vibe-init`.
- Existing upstream settings are preserved unchanged.
- Missing or unreadable `origin` remotes skip quietly and do not fail init/session-start.
- `src/commands/sync.ts` skips template self-sync when a `vibe-doctor` source checkout points at the default harness upstream, unless `--from` is supplied.
- Regression coverage lives in `test/upstream-bootstrap.test.ts`.

Earlier local releases remain preserved:

- v1.5.7 tracks executable shell wrappers in Git.
- v1.5.6 makes synced `.sh` harness wrappers executable on POSIX.
- v1.5.5 expands project-safe sync behavior for env/CI/editor/agent-memory files.
- v1.5.4 keeps `.gitignore` project entries through line-union merge.
- v1.5.3 hardens WSL Codex wrapper stdin/locale behavior.
- v1.5.2 hardens UTF-8 Markdown/editor defaults.
- v1.5.1 adds provider-neutral lifecycle hooks.

## 3. Verification

Windows verification for v1.5.8:

- `npm run typecheck`
- `node --import tsx --test test/upstream-bootstrap.test.ts`
- `npm run build`
- `npm test`

## 4. Preserved Value

- Provider-neutral lifecycle hooks from v1.5.1 remain intact.
- UTF-8 Markdown/editor hardening from v1.5.2 remains intact.
- WSL-safe Codex wrapper behavior from v1.5.3 remains intact.
- Project-safe sync merge behavior from v1.5.4-v1.5.5 remains intact.
- Executable wrapper handling from v1.5.6-v1.5.7 remains intact.

## 5. Next Action

Commit/tag/push v1.5.8 from `C:\Users\Tony\Workspace\vibe-doctor`.

Do not touch downstream project `/home/tony/workspace/telegram-local-ingest` in this session; the user said another session is working there.

After v1.5.8 is pushed, downstream can dry-run sync later:

```bash
cd /home/tony/workspace/telegram-local-ingest
source "$HOME/.nvm/nvm.sh"
npm run vibe:sync -- --from /mnt/c/Users/Tony/Workspace/vibe-doctor --dry-run
```

## 6. Pending Risks

- Template self-detection intentionally uses a conservative runtime heuristic: folder basename `vibe-doctor` plus the default upstream URL. Dogfood clones named `dogfoodX` or product-specific names still bootstrap upstream from origin.
- Do not share one `node_modules` directory between Windows and WSL for packages with native binaries such as `esbuild`. Use per-platform installs or a clean Linux workspace.
