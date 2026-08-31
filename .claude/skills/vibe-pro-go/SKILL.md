---
name: vibe-pro-go
description: Safely inspect the local Web Pro pointer, or explicitly continue, review, force-close, or archive a selected GitHub-backed flow. Use when the user invokes $vibe-pro-go, asks to resume a Web Pro design by active pointer, date, slug, or exact flow, or wants Web Pro and Codex to exchange work through `vibe-pro-bridge` without custom MCP or browser automation.
---

# vibe-pro-go

Use the official Web GitHub app and the deterministic `vibe:pro-go` runtime.

<!-- BEGIN:VIBE-PRO-GO:SHARDS -->
- `docs/context/workflow-integrity.md`
- `.claude/skills/vibe-pro-go/references/CLI-CONTRACT.md`
- `.claude/skills/vibe-pro-go/references/WEB-RUNBOOK.md`
<!-- END:VIBE-PRO-GO:SHARDS -->

## Default action

On bare `$vibe-pro-go` with no additional user request, run:

```text
npm run vibe:pro-go
```

This is a local-only `ACTIVE.json` status check. Report the result and STOP this
skill invocation. Never prepare the bridge worktree, select a remote flow, sync
a packet, bootstrap the protocol, create a flow, or follow a reported next
action from a bare invocation.

Resume only when the same user request explicitly asks to continue work:

- exact flow path: `npm run vibe:pro-go -- go <flow>`;
- date/slug qualifier: `go --date YYYYMMDD` and/or `go --slug <slug>`;
- explicit request to continue the locally active flow: `go` with no selector,
  which succeeds only from a valid, checkout-owned, active local pointer.

If no valid pointer or explicit selector exists, stop with the CLI guidance.
Only `start` when the user supplies a concrete new goal. Never infer `start` or
`bootstrap` merely because status is idle or a pointer is mistaken.

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

## Alignment briefing

When `go`/`status` report an `alignmentBrief` status of `missing` or `invalid`,
author the brief BEFORE any state-changing command: run
`npm run vibe:pro-go -- brief <flow>` for the exact item roster, declared
intents, paths, and a skeleton. Author `BRIEF.md` in the session language
(Korean for this user) from a FRESH evaluator sub-agent context that reads only
the flow goal, declared intents, and the Pro document — not the accumulated main
context. Explain per item how it serves the user's original request, classify it
(core/supporting/hardening/speculative/off-track), and end with a proposal.
Briefs propose; users decide: record the user's answers into `BRIEF.json`
`decisions` (JSON artifact edit) with `confirmedBy: "user"` only after the user
actually ruled. Never fabricate rulings; `proGoAutoPublish` never covers brief
decisions.

## Accepting a review from the CLI

When Pro leaves a feedback whose findings are all non-blocking (zero P0/P1) and
the user judges them deferrable: run `accept-review [flow]` (dry-run), show the
user the findings table and recommendation, and only after the user explicitly
confirms run `accept-review [flow] --publish --user-approved`, then
`close --publish`. Never pass `--user-approved` without a fresh explicit user
confirmation — `proGoAutoPublish` does not cover this judgment. The CLI records
the `[decision][review-accepted]` session-log entry itself.

## Operator force-close

Use this only when the user explicitly wants one exact flow abandoned, including
a flow whose event chain or old protocol generation prevents normal close.
Force-close is terminal control state, not successful approval or normal flow
completion.

First run the dry-run and show its exact flow, repository, branch, target, and
reason:

```text
npm run vibe:pro-go -- force-close <flow> --reason "<one-line reason>"
```

Only after the user confirms that exact flow and reason, publish:

```text
npm run vibe:pro-go -- force-close <flow> --reason "<same reason>" --publish --user-approved
```

Never supply `--user-approved` from an inferred instruction, a handoff note, or
`proGoAutoPublish`. The append-only `OPERATOR-CLOSE.json` record makes current
selectors treat the flow as terminal without forging an approval or `closed`
event. A repeated command with the identical reason is idempotent and reconciles
a matching local pointer; a different reason is an immutable conflict. A
force-closed member also blocks a later coordinated normal close for the whole
set.

## Writes and safety

`bootstrap --publish`, `start --publish`, `report --publish`,
`accept-review --publish --user-approved`, and
`close --publish` write to GitHub. `force-close --publish --user-approved` is a
separate user-authorized terminal write. Show repository, branch, target, and files
before passing `--publish`. Never create a PR, modify the default branch, rewrite
completed events, force-push, or hand-edit `.vibe/worktrees/pro-roundtrip`.

`confirm-skip on|off|status` toggles the `userDirectives.proGoAutoPublish`
directive in `.vibe/config.local.json`. While `go`/`status` report
`autoPublish: true`, skip the per-write user authorization wait: still show
repository, branch, target, and files, then pass `--publish` and record one
session-log `[decision][auto-approved]` entry per publication. Toggle the
directive only on an explicit user instruction.

Bare `status` is local-only. Explicit `go`, `status <flow>`, `sync`, `continue`,
and `brief` may prepare/read the bridge but do not publish; `doctor` is diagnostic.
Reject protocol drift, stale HEAD, tamper, unsafe paths, and ambiguous targets.
