# Orchestrator Handoff

## 1. Identity

- **repo**: `vibe-doctor`
- **branch**: `main`
- **last release**: v1.5.9 (Windows CMD/PowerShell statusline and hook compatibility)
- **current iteration**: post-iter-7 maintenance
- **harnessVersion**: `1.5.9`
- **language/tone**: Korean user-facing, concise engineering notes

## 2. Status

IDLE after v1.5.9 Windows hook compatibility hardening.

v1.5.9 fixes Claude Code launch from Windows CMD/PowerShell:

- `.claude/statusline.mjs` is now the canonical cross-platform statusline implementation.
- `.claude/settings.json` uses `node .claude/statusline.mjs`, so it no longer depends on POSIX inline env syntax.
- `SessionStart` uses `node scripts/vibe-agent-session-start.mjs` without `2>/dev/null || true`.
- `.claude/statusline.sh` and `.claude/statusline.ps1` remain as compatibility wrappers around the Node implementation.
- `test/statusline.test.ts` now verifies settings command portability and direct Node statusline behavior.
- `docs/context/harness-gaps.md` records `gap-windows-hook-command-portability` as covered.

Earlier local releases remain preserved:

- v1.5.8 infers missing upstream config from `git remote origin` during session-start and `/vibe-init`.
- v1.5.7 tracks executable shell wrappers in Git.
- v1.5.6 makes synced `.sh` harness wrappers executable on POSIX.
- v1.5.5 expands project-safe sync behavior for env/CI/editor/agent-memory files.
- v1.5.4 keeps `.gitignore` project entries through line-union merge.
- v1.5.3 hardens WSL Codex wrapper stdin/locale behavior.
- v1.5.2 hardens UTF-8 Markdown/editor defaults.
- v1.5.1 adds provider-neutral lifecycle hooks.

## 3. Verification

Windows verification for v1.5.9:

- `npm run typecheck`
- `node --import tsx --test test/statusline.test.ts`
- `npm run build`
- `npm test`
- `node scripts/vibe-rule-audit.mjs`
- `cmd /c "node .claude\statusline.mjs"`
- `node scripts/vibe-version-check.mjs`
- `npm run vibe:qa --silent`

## 4. Preserved Value

- Provider-neutral lifecycle hooks from v1.5.1 remain intact.
- UTF-8 Markdown/editor hardening from v1.5.2 remains intact.
- WSL-safe Codex wrapper behavior from v1.5.3 remains intact.
- Project-safe sync merge behavior from v1.5.4-v1.5.5 remains intact.
- Executable wrapper handling from v1.5.6-v1.5.7 remains intact.
- Upstream bootstrap from v1.5.8 remains intact.

## 5. Next Action

Commit/tag/push v1.5.9 from `C:\Users\Tony\Workspace\vibe-doctor`.

Do not touch downstream project `/home/tony/workspace/telegram-local-ingest` in this session; the user said another session is working there.

After v1.5.9 is pushed, downstream can dry-run sync later:

```bash
cd /home/tony/workspace/telegram-local-ingest
source "$HOME/.nvm/nvm.sh"
npm run vibe:sync -- --from /mnt/c/Users/Tony/Workspace/vibe-doctor --dry-run
```

## 6. Pending Risks

- The remaining `/dev/null` and `|| true` patterns found by search are inside POSIX shell scripts or historical documentation, not Claude settings command strings.
- Do not share one `node_modules` directory between Windows and WSL for packages with native binaries such as `esbuild`. Use per-platform installs or a clean Linux workspace.
