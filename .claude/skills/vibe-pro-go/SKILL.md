---
name: vibe-pro-go
description: Continue the latest GitHub-backed Web Pro design, implementation, review, remediation, approval, or archive flow with one invocation. Use when the user invokes $vibe-pro-go, asks to resume a Web Pro design by date or flow, or wants Web Pro and Codex to exchange work through `vibe-pro-bridge` without custom MCP or browser automation.
---

# vibe-pro-go

Use the official Web GitHub app and the deterministic `vibe:pro-go` runtime.

<!-- BEGIN:VIBE-PRO-GO:SHARDS -->
- `docs/context/workflow-integrity.md`
- `.claude/skills/vibe-pro-go/references/CLI-CONTRACT.md`
- `.claude/skills/vibe-pro-go/references/WEB-RUNBOOK.md`
<!-- END:VIBE-PRO-GO:SHARDS -->

## Default action

On bare `$vibe-pro-go`, immediately run:

```text
npm run vibe:pro-go -- go
```

Select the newest non-closed flow for the current repository and code branch,
sync it, read the returned durable packet, and perform the returned next action.
Do not stop after merely reporting the flow, binding, or Sprint list unless the
user explicitly requested status only.

Translate a natural qualifier such as “7월 18일자 설계” to `--date YYYYMMDD`.
Use an explicit flow path when supplied. Never guess between multiple equally
matching targets; show the candidates then.

## Continue autonomously

- `nextActor=codex`: implement the current immutable Sprint, run targeted and
  cumulative workflow gates, record evidence, and continue remaining Sprints.
- `nextActor=pro`: return the generated GitHub-only prompt for Web Pro.
- feedback requiring remediation: fix only implementation defects or missing
  tests named by finding ID, then record remediation evidence.
- approval for the current HEAD: sync and prepare close.

Use goal/iteration/Sprint workflows as implementation machinery when useful, but
keep this flow's contract IDs, Sprint order, invariants, and final gate
authoritative. Re-read `docs/context/workflow-integrity.md` at every Sprint and
use `maintain-context` at long-session boundaries.

## Automatic report terminal

A flow started or resumed by this skill remains active until Pro handoff or
close. After every Sprint, create its validated report checkpoint without
requiring another user skill invocation. After the last Sprint, automatically
prepare the complete Web Pro report and workflow matrix. Before the GitHub write,
show the exact bridge target/files and obtain authorization — unless the CLI
output reports `autoPublish: true`, in which case proceed without waiting and
record one session-log `[decision][auto-approved]` entry; then publish and
return the next Web prompt.

Do not claim completion while a checkpoint, contract row, cumulative journey,
final gate, or actionable P0/P1 finding is missing.

## Writes and safety

`bootstrap --publish`, `start --publish`, `report --publish`, and
`close --publish` write to GitHub. Show repository, branch, target, and files
before passing `--publish`. Never create a PR, modify the default branch, rewrite
completed events, force-push, or hand-edit `.vibe/worktrees/pro-roundtrip`.

`confirm-skip on|off|status` toggles the `userDirectives.proGoAutoPublish`
directive in `.vibe/config.local.json`. While `go`/`status` report
`autoPublish: true`, skip the per-write user authorization wait: still show
repository, branch, target, and files, then pass `--publish` and record one
session-log `[decision][auto-approved]` entry per publication. Toggle the
directive only on an explicit user instruction.

`go`, `status`, `sync`, `continue`, and `doctor` are read/local operations.
Reject protocol drift, stale HEAD, tamper, unsafe paths, and ambiguous targets.
