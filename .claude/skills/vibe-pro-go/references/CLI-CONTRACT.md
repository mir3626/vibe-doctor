# CLI Contract

## Commands

```text
npm run vibe:pro-go
npm run vibe:pro-go -- go [flow] [--date YYYYMMDD] [--slug <slug>]
npm run vibe:pro-go -- bootstrap [--repository <owner/repo>] --publish
npm run vibe:pro-go -- start design "<goal>" --slug <slug> --timezone <IANA> [--repository <owner/repo>] --publish
npm run vibe:pro-go -- start audit --goal "<goal>" --slug <slug> --timezone <IANA> [--repository <owner/repo>] --publish
npm run vibe:pro-go -- status [flow]
npm run vibe:pro-go -- sync [flow]
npm run vibe:pro-go -- report [flow] --evidence <input.json>
npm run vibe:pro-go -- report [flow] --publish
npm run vibe:pro-go -- continue [flow]
npm run vibe:pro-go -- brief [flow]
npm run vibe:pro-go -- accept-review [flow]
npm run vibe:pro-go -- accept-review [flow] --publish --user-approved [--reason "<text>"]
npm run vibe:pro-go -- close [flow] --publish
npm run vibe:pro-go -- confirm-skip on [--reason "<text>"] [--days <1-365>]
npm run vibe:pro-go -- confirm-skip off|status
npm run vibe:pro-go -- doctor
```

Bare `vibe:pro-go` is `go`: it selects the newest non-closed flow matching the
current repository and code branch by latest completed bridge event, syncs it,
and returns the next executable action. Date and slug filters narrow selection
without requiring a full flow path. Auto-selection skips flows pinned to a
superseded protocol generation and reports them as `skippedIncompatibleFlows`
(`[{ flowPath, pinnedVersion }]`) in the result; when only incompatible flows
remain, the selector error names each one. An explicit `go <flow>` target is
never skipped and fails closed with the precise generation-mismatch error.

`--publish` is the external-write capability. Never pass it before the user
authorizes the repository, branch, target, and file set. `bootstrap` is a
one-time protocol publication that enables Web-first entry through root
`bridge-runbook.md`.

`brief` prints the alignment-brief roster, declared intents, expected paths, and
a fill-in skeleton for the latest Pro design/feedback event. `report`,
`accept-review`, and `close` refuse while an armed Pro design/feedback event has
no valid alignment brief (`briefs/<event-id>/BRIEF.md|BRIEF.json`; arming is
recorded in `STATE.json` `briefRequiredEventIds` — events receipted before the
feature stay exempt). `accept-review` dry-run reports eligibility and the
findings table; the publish form additionally REQUIRES `--user-approved`, which
is never derivable from `proGoAutoPublish` (the directive covers only the
git-publish authorization wait). Schema pointer:
`.vibe/harness/schemas/pro-roundtrip-alignment-brief.schema.json` (generated).

`confirm-skip on` records the `userDirectives.proGoAutoPublish` directive in
`.vibe/config.local.json` (optionally expiring after `--days`) and appends a
session-log `[decision][pro-go-auto-publish]` entry. While the directive is
active, `go`/`status` report `autoPublish: true` and the agent may pass
`--publish` without waiting for per-write authorization, recording
`[decision][auto-approved]` per publication instead. `confirm-skip off`
disables it; a missing or malformed directive always falls back to requiring
confirmation.

## Durable packet

`sync` writes:

```text
.vibe/agent/pro-roundtrip/<date>/<NNN-slug>/
├─ FLOW.json
├─ STATE.json
├─ HANDOFF.md
├─ events/<event-id>/
├─ sprints/<SPR-ID-slug>/
│  ├─ SPRINT.md
│  ├─ REPORT.md
│  └─ CHECKPOINT.json
├─ remediation/<feedback-event>/<SPR-ID-slug>/
│  ├─ REPORT.md
│  └─ CHECKPOINT.json
├─ briefs/<event-id>/
│  ├─ BRIEF.md
│  └─ BRIEF.json
└─ FINAL-WORKFLOW-MATRIX.md
```

Receipts bind source bridge commit and Git blob IDs. `STATE.json` binds latest
event, bridge HEAD, design event, current Sprint, and code HEAD.
`.vibe/agent/pro-roundtrip/ACTIVE.json` identifies the flow currently owned by
`$vibe-pro-go`, including its next actor and whether an automatic Pro report is
still required. Goal/iterate/Sprint completion must honor this marker without
requiring another user skill invocation.

## Report input

Validate against
`.vibe/harness/schemas/pro-roundtrip-report-input.schema.json`.

```json
{
  "schemaVersion": "vibe-pro-report-input-v1",
  "flowPath": "flows/20260719/001-example",
  "designEventId": "0100--pro--design--r01",
  "sprintId": "SPR-001",
  "reportKind": "implementation",
  "baseSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "headSha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "completedContractIds": ["REQ-001", "NFR-001"],
  "changedFiles": ["src/example.ts"],
  "verification": [
    {
      "command": "npm test -- example",
      "status": "passed",
      "summary": "3 tests passed"
    }
  ],
  "workflowEvidence": [
    {
      "contractId": "REQ-001",
      "implementationEvidence": "src/example.ts:42",
      "testEvidence": "test/example.test.ts",
      "integrationEvidence": "entrypoint to output journey passed",
      "status": "complete",
      "notes": ""
    }
  ],
  "sprintGatePassed": true,
  "cumulativeGatePassed": true,
  "finalGatePassed": false,
  "resolvedFindingIds": [],
  "risks": [],
  "nextAction": "Start SPR-002 from its immutable envelope."
}
```

Use null design/Sprint IDs and `reportKind: "audit"` only for a design-less
audit. Use `reportKind: "remediation"` after feedback and list resolved finding
IDs.

Remediation inputs must reference IDs from the latest validated
`FINDINGS.json`. They cannot claim a `design-defect` or `scope-extension` as a
code remediation. Aggregate remediation publication fails while an actionable
P0/P1 finding remains unresolved.

Each Sprint input includes all owned IDs. Set the last input's final gate true
only after full QA and every workflow passes. Publication requires every Sprint
checkpoint and a complete row for every REQ, INV, WF, and NFR.

## Recovery

- Non-fast-forward: fetch, check collision, rebase, retry at most three times.
- Target collision: allocate a new flow/event revision; never overwrite.
- Dirty/unowned worktree: stop without reset/deletion.
- Stale reviewed HEAD: obtain a new Web event.
- Protocol mismatch/tamper: stop and preserve evidence.
- Context change: read packet `HANDOFF.md` and sync before continuing.
