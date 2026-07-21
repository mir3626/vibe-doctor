# Vibe Pro Go setup

This feature connects Web ChatGPT Pro review/design work and Codex CLI
implementation through the official GitHub connector and an append-only
`vibe-pro-bridge` branch. It does not use a custom MCP server, browser automation,
copied credentials, or direct model-to-model calls.

## 1. Boundaries

- Code stays on the normal code/feature branch.
- Exchange artifacts stay on `vibe-pro-bridge`.
- The bridge is not merged and does not get a PR.
- Completed events and pinned protocol versions are immutable.
- CLI writes require `--publish`, which is passed only after user authorization —
  or without a per-write wait while the opt-in
  `vibe-pro-go confirm-skip on` directive (`userDirectives.proGoAutoPublish` in
  gitignored `.vibe/config.local.json`) is active; each auto-approved
  publication is recorded as a session-log `[decision][auto-approved]` entry.
- Web writes retain the GitHub app's visible confirmation.
- A CLI GitHub integration result cannot prove Web Pro connector behavior.

## 2. Prerequisites

1. Initialize downstream projects with `/vibe-init`.
2. Install Node 24+, npm, and Git.
3. Confirm `origin` points to the GitHub repository Web Pro is authorized to read.
4. Create `vibe-pro-bridge` once from the remote default branch through an
   explicitly authorized Git action.
5. Do not make the bridge orphan and never rewrite an existing bridge.
6. Configure a real IANA project timezone such as `Asia/Seoul`.
7. Run:

```text
npm run vibe:pro-go -- doctor
```

For Web-first use, authorize the one-time
`npm run vibe:pro-go -- bootstrap --publish` before opening the Web session.
CLI-first `start --publish` also bootstraps an absent protocol.
Commit the synced root `bridge-runbook.md` to the code branch that Web Pro will
read and push that branch at the exact local HEAD; the protocol itself remains
on `vibe-pro-bridge`.

The generated CLI prompt and both Web runbooks explicitly require GitHub
exact-ref actions and explicitly forbid Web Search, browser search, URL
browsing, generic search results, the GitHub search index, and default-branch
fallback.

## 3. Normal loop

```text
CLI start --publish or Web `bridge-runbook.md`
  → Web Pro design + COMPLETE.json
  → CLI sync
  → Codex implements immutable Sprint envelopes
  → CLI records each evidence checkpoint
  → CLI aggregate report --publish
  → Web Pro feedback/review
  → CLI remediation report when required
  → Web Pro approval
  → CLI sync + close --publish
```

Use bare `$vibe-pro-go` or `npm run vibe:pro-go` to select and sync the newest
non-closed flow for the current repository and code branch, ordered by the
latest completed bridge event rather than only by folder name. `status` is for
inspection; `continue` prints the exact GitHub-only Web prompt.

Typical Web-first prompt:

```text
@GitHub mir3626/osint-stock-screener 프로젝트에서 nnn 커밋 이후 구현을
리뷰하고 필요한 상세설계를 ./bridge-runbook.md 절차에 맞게 수행해줘.
```

Web Pro creates and commits the flow, Pro-origin goal, and design. Back in
Codex, this is enough:

```text
$vibe-pro-go
```

A natural qualifier is also accepted by the skill:

```text
$vibe-pro-go 7월 18일자 설계 불러와서 작업 안 된 항목 마저 진행해줘.
```

## 4. Archive and local state

Remote:

```text
flows/YYYYMMDD/NNN-slug/
├─ FLOW.json
├─ 0000--cli--goal--r01/ or 0000--pro--goal--r01/
├─ 0100--pro--design--r01/
├─ 0200--codex--implementation-report--r01/
├─ ...
└─ 9900--cli--closed--r01/
```

Local durable packet:

```text
.vibe/agent/pro-roundtrip/YYYYMMDD/NNN-slug/
```

Commit the local packet when it is meaningful project handoff state. Do not
commit `.vibe/worktrees/`; it is ignored, tool-owned transport state.

## 5. Web Pro M0 release gate

Run this manually in the actual Web Pro session against a private test repository
before relying on the workflow. Record the date, Web surface/model declaration,
repository, branch, commit SHA, result, and screenshot/receipt location.

| Check | Required evidence |
|---|---|
| Read exact non-default ref | content read from `vibe-pro-bridge`, not default |
| Nested create | new file under a unique M0 directory |
| Default branch unchanged | before/after default HEAD is identical |
| No PR created | repository PR list remains unchanged |
| Re-read and commit | created bytes and returned commit SHA verified |
| UTF-8 size | approximately 100 KiB Markdown created and re-read |
| Sequential convergence | multiple create actions build on latest bridge HEAD |
| Confirmation UI | every write keeps the user confirmation boundary |

Do not put secrets, production data, or user-identifying content in the M0
payload. Use a unique append-only path and retain it as audit evidence.

If exact non-default-branch creation is unavailable, mark M0 failed. Do not fall
back to the default branch or rewrite `vibe-pro-bridge`. Evaluate a separate
private exchange repository as a new design decision.

## 6. Report evidence

Use `.vibe/harness/schemas/pro-roundtrip-report-input.schema.json`. Each Sprint
checkpoint must bind the exact design event, Sprint ID, base/head SHA, owned IDs,
commands/results, workflow evidence, and Sprint/cumulative gates. Only the final
checkpoint sets `finalGatePassed: true`, after full project QA and all workflows.

Aggregate publication fails when a Sprint checkpoint, final gate, or complete
REQ/INV/WF/NFR evidence row is missing. Earlier Sprint checkpoints may bind older
HEADs; the final checkpoint and aggregate event must bind the current HEAD.

## 7. Recovery

| Failure | Action |
|---|---|
| bridge missing | stop; separately authorize branch creation |
| dirty or unowned worktree | stop; inspect it, do not reset/delete |
| non-fast-forward | bounded fetch/collision audit/rebase retry |
| existing target | allocate a new sequence/revision |
| incomplete Web event | ignore until payload is valid and marker is created |
| modified/deleted completed path | quarantine as tamper; do not import |
| stale reviewed HEAD | request a new Web event for the current HEAD |
| protocol mismatch | stop; never upgrade an active flow implicitly |
| repeated remediation | re-diagnose, revise design, or create a new flow |
| context compaction | re-read local `HANDOFF.md`, `STATE.json`, and Sprint envelope; sync |

## 8. Verification for harness changes

Run:

```text
node --import tsx --test .vibe/harness/test/pro-roundtrip-*.test.ts
npm run vibe:typecheck
npm run vibe:build
node .vibe/harness/scripts/vibe-gen-schemas.mjs
npm run vibe:codex-wrapper-audit
npm run vibe:sync-audit
npm run vibe:self-test
npm run vibe:checkpoint
```

The automated suite uses temporary bare Git remotes. It never writes the real
bridge branch and intentionally leaves the actual Web Pro M0 as a manual gate.

`FINDINGS.json` is validated against the protocol shape documented in the Web
runbook. Remediation evidence must cite actual finding IDs; design defects and
scope extensions cannot be closed by relabeling them as code fixes.
