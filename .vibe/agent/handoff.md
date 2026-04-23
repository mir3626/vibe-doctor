# Orchestrator Handoff

## 1. Identity

- **repo**: `vibe-doctor`
- **branch**: `main`
- **last release**: v1.5.15 (agent-gated init and Codex skill wrappers)
- **current iteration**: post-iter-7 maintenance
- **harnessVersion**: `1.5.15`
- **language/tone**: Korean user-facing, concise engineering notes

## 2. Status

READY to commit/tag/push v1.5.15.

v1.5.15 changes the project initialization entrypoint so it is always mediated by an agent skill:

- Direct `npm run vibe:init` from bash/cmd/PowerShell now exits with guidance instead of partially bootstrapping a project without agent follow-through.
- Agent skills can still run the mechanical bootstrap with `npm run vibe:init -- --from-agent-skill`.
- Claude `/vibe-init` instructions now use the guarded command.
- Codex skill wrappers now exist under `.codex/skills/*/SKILL.md` and delegate to the shared `.claude/skills/*/SKILL.md` runbooks.
- Sync manifest includes the Codex skill wrappers and new regression tests.

Earlier local releases remain preserved:

- v1.5.14 lets partially bootstrapped projects run `/vibe-sync` without an existing `upstream` entry.
- v1.5.13 fixes WSL/Linux browser opener failures for dashboard/report.
- v1.5.12 restores `upstream.ref` as a real pin and adds an explicit update path.
- v1.5.11 scopes `/vibe-sync` post-verify typechecking to harness code.
- v1.5.9 fixes Windows CMD/PowerShell Claude statusline and hook command compatibility.
- v1.5.8 infers missing upstream config from `git remote origin` during session-start and `/vibe-init`.
- v1.5.2 hardens UTF-8 Markdown/editor defaults.
- v1.5.1 adds provider-neutral lifecycle hooks.

## 3. Verification

Windows verification for v1.5.15:

- `npm run typecheck`
- `node --import tsx --test test/init-guard.test.ts test/codex-skills.test.ts test/upstream-bootstrap.test.ts test/sync.test.ts`
- `npm run build`
- `npm test`

## 4. Preserved Value

- Provider-neutral lifecycle hooks remain intact.
- UTF-8 Markdown/editor hardening remains intact.
- WSL-safe Codex wrapper behavior remains intact.
- Project-safe sync merge behavior remains intact.
- Upstream bootstrap remains intact.
- Windows CMD/PowerShell statusline and hook compatibility remains intact.
- Pinned `upstream.ref` semantics and explicit update prompts remain intact.
- Legacy missing-upstream projects can bootstrap sync config without `/vibe-init`.

## 5. Next Action

Commit/tag/push v1.5.15 from `C:\Users\Tony\Workspace\vibe-doctor`.

After v1.5.15 is pushed, downstream projects should sync it when they need guarded init behavior or Codex skill parity.

## 6. Pending Risks

- Existing downstream projects may already have a product `tsconfig.json` that was previously touched by harness sync. v1.5.11 stops future harness ownership but does not automatically rewrite product tsconfig choices.
- Projects cloned from an older template may already contain `upstream.ref` as an accidental pin. v1.5.12 preserves it by default and exposes the update choice, but does not remove the pin automatically.
- Do not share one `node_modules` directory between Windows and WSL for packages with native binaries such as `esbuild`. Use per-platform installs or a clean Linux workspace.
