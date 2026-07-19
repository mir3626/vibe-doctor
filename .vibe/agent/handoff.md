# Orchestrator Handoff

PROJECT NOT INITIALIZED.

This is the upstream `vibe-doctor` template, so downstream product work still requires `/vibe-init`.

## 1. Identity

- repo: `vibe-doctor`
- mode: Codex Orchestrator maintenance
- harnessVersion: `1.8.2`
- publication branch/base: rewritten `main` lineage from `f2f9512aeee62f0d13537e8b5fe99c8947a4bdd5`
- remote state: `origin/main` carries the verified GitHub-only Pro workflow and `v1.8.2`; preserved `origin/vibe-pro-bridge` remains at `abd624a050fc274da90e1c003fbac3843dce7058`
- publication state: the user corrected the target to `main`; the accidental `origin/agent/vibe-pro-go` publication branch was removed after main/tag verification, and no PR was created

## 2. Active Work

- Public entrypoint is now `$vibe-pro-go` / `npm run vibe:pro-go`.
- Bare invocation selects the newest non-closed flow for the current repo/branch by latest completed bridge event, syncs its durable packet, and returns paths plus the next executable action.
- Web-first entry is supported through root `bridge-runbook.md`: GitHub exact-ref actions only, no Web Search/index/default fallback, Pro-origin goal + design creation, then normal CLI continuation.
- `bootstrap --publish` verifies the root runbook is already committed/pushed on the bound code branch before publishing immutable `protocol/v1` plus `PROTOCOL.json`.
- `docs/context/workflow-integrity.md` is the shared anti-overengineering and cross-Sprint contract. Planner, goal-to-plan, goal-iterate, iterate, write-report, common Generator rules, and orchestration docs all reference it.
- `sync` writes `.vibe/agent/pro-roundtrip/ACTIVE.json`. An active Pro Sprint cannot pass `vibe-sprint-complete` without a design/Sprint/current-HEAD checkpoint whose Sprint/cumulative gates pass; the final Sprint also needs the final workflow gate.
- A Pro-origin goal/iterate/Sprint automatically prepares its Web implementation/remediation report without another skill invocation. GitHub publication still stops at the explicit external-write authorization boundary.
- Internal schema/source/local packet identifiers keep `pro-roundtrip` for durable-format compatibility. Historical design documents retain the old public name with a history note.
- Release migration `1.8.2` removes proven-unmodified legacy MCP bridge harness files and exact default config/scripts while preserving customized files, historical `.vibe/pro-bridge/**` results, and project-owned designs.

## 3. Verification and Risks

- Full `npm run vibe:self-test`: 489 tests, 488 pass, 0 fail, 1 intentional skip.
- Focused Pro tests include Web-origin goal/design, root-runbook bootstrap gate, bare latest-flow resume, manifest, report/remediation/approval/close, stale HEAD, tamper, collision, and branch isolation.
- `vibe:typecheck`, `vibe:build`, schema drift check, both skill validations, Codex wrapper audit, iterate shard audit, sync audit, `git diff --check`, and `vibe:pro-go doctor` passed.
- Migration regression tests and live detached-worktree application against the preserved MCP lineage passed: 53 legacy harness files removed, 40/40 historical artifacts and 6/6 project plan files preserved.
- User completed the live Web M0 on `mir3626/vibe-pro-bridge-m0`: exact non-default read, nested small and ~98 KiB UTF-8 creates, re-read/blob/commit receipts, and sequential convergence all passed without main/PR/update/delete mutation.
- No real protocol or operational flow was published by this implementation session. Integration writes used temporary bare remotes only.
- `origin/main` was replaced with the user-authorized GitHub-only lineage using an exact-SHA force-with-lease; do not reconstruct or merge the former MCP lineage back into main unless explicitly requested.

## 4. Restart Steps

1. Read `.claude/skills/vibe-pro-go/SKILL.md`, `docs/context/pro-go-setup.md`, and `docs/context/workflow-integrity.md`.
2. Inspect `main`, tag `v1.8.2`, and `origin/vibe-pro-bridge` before new edits. Keep the preserved MCP implementation isolated unless the user explicitly requests otherwise.
3. Run `npm run vibe:pro-go -- doctor`; do not pass `--publish` without a fresh explicit external-write authorization.
4. For usage, Web starts with `@GitHub <owner/repo> ... ./bridge-runbook.md`; Codex resumes with bare `$vibe-pro-go`.
5. Use `origin/vibe-pro-bridge` only as the append-only shared-drive branch defined by the new protocol; do not merge it into `main`.
