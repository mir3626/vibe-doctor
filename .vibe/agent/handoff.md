# Orchestrator Handoff

## 1. Identity

- **repo**: `vibe-doctor`
- **branch**: `main`
- **working release**: `v1.7.2`
- **current mode**: Codex Orchestrator maintenance
- **harnessVersion**: `1.7.2`
- **language/tone**: Korean user-facing, concise engineering notes

## 2. Status

Referenced-MD wrapper guard is implemented and verified as a local patch on top of `v1.7.2`.

- `run-codex.sh` still prepends `.vibe/agent/_common-rules.md`, and now also scans the original stdin prompt for explicitly referenced rule/context Markdown paths.
- When an allowed referenced MD file exists, the wrapper injects its body under `# Referenced MD Context (auto-injected)` before the Generator prompt. This prevents "read this MD file" rules from being silently skipped without turning the rule into a hard behavioral constraint.
- The guard is intentionally non-recursive and non-blocking: references introduced by `_common-rules.md` do not trigger extra injection; missing or disallowed paths do not fail the Generator run.
- Allowed paths are limited to `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, selected `docs/context/*` rule shards, `.claude/agents/*.md`, `.claude/skills/**/*.md`, and `.codex/skills/**/*.md`.
- `run-codex-wrapper.test.ts` covers both default non-injection and explicit `docs/context/qa.md` auto-injection.
- Previous pushed patches remain on `origin/main`: project report duplicate-open at `44188b6`, preflight wrapper-path at `a5b64dd`.

## 3. Verification

Completed on Windows for this patch:

- `npm run typecheck`
- `node --import tsx --test .vibe/harness/test/run-codex-wrapper.test.ts`
- `npm test` (345 tests: 344 pass, 1 skipped)
- `npm run build`
- `git diff --check`
- `npm run vibe:checkpoint`
- Strict UTF-8 decode and mojibake regex checks over touched shell, Markdown, and TypeScript files

## 4. Expected Downstream Behavior

If a Sprint prompt explicitly references an allowed rule/context MD file, Codex receives that file content in its initial prompt context. Agents remain free to choose implementation details, but they no longer skip a rule merely because the MD file was not separately opened.

## 5. Next Action

Commit and push the referenced-MD wrapper guard when ready, then sync downstream projects that rely on MD rule references in Generator prompts.

## 6. Pending Risks

- PowerShell PATH on this machine does not expose `file` or GNU `grep`; equivalent strict UTF-8 and regex checks passed.
- This guard only covers stdin-based `run-codex.sh -` prompts. The native `run-codex.cmd` remains a Windows health/debug wrapper and does not perform prompt augmentation.
