# Harness Verification Reuse

The harness keeps local development fast by reusing a successful verification
result only while that result's semantic inputs remain identical. This is a
harness regression facility; it does not replace project-owned product tests or
the final entrypoint-to-output workflow gate.

## Commands

| Command | Boundary |
|---|---|
| `npm run vibe:self-test` | Execute every root harness test and refresh test-group receipts. Never reuses a prior result. |
| `npm run vibe:self-test:fast` | Run or reuse the `fast` node-test groups. |
| `npm run vibe:self-test:smart` | Run or reuse node-test groups affected by the current harness worktree diff. |
| `npm run vibe:self-test:plan` | Print the smart node-test plan without executing it. |
| `npm run vibe:verify` | Run or reuse affected typecheck and node-test groups. |
| `npm run vibe:verify:plan` | Print the affected typecheck/test plan without executing it. |
| `npm run vibe:verify:release` | Force typecheck and every harness test group for release, tag, or compatibility boundaries. |

For a multi-Sprint goal, bind selection to the exact goal base so committed work
from earlier Sprints remains in the cumulative impact set:

```bash
npm run vibe:verify -- <goal-base-sha>
```

`VIBE_VERIFY_BASE=<sha>` provides the same binding. An active `$vibe-pro-go`
packet supplies its `baseSha` automatically. Without a base, smart verification
uses the current worktree diff against `HEAD`.

The underlying verifier also accepts `--base <sha>` when invoked directly.
The package command uses a positional SHA because some npm versions consume
unknown `--base` options before forwarding script arguments.

## Groups and ownership

`.vibe/harness/test/groups.json` is the authoritative map. It currently defines
seven root-test lanes plus a typecheck lane:

- `core`
- `static-audits`
- `orchestration`
- `provider-process`
- `reporting`
- `git-sync`
- `pro-roundtrip`
- `typecheck`

Every root `.vibe/harness/test/*.test.ts` file must have exactly one node-test
owner. A new, missing, duplicate, or stale test entry fails before execution.
The nested `test/integration/` lane remains outside the root self-test contract.

Known changed inputs select their owning groups. Shared library/schema inputs and
global invalidators select all applicable groups. A changed harness-owned path
that has no known runtime group fails closed to all applicable groups. A
project-owned path is ignored by this harness runner and remains the
responsibility of project QA.

## Receipt validity

Successful receipts are content-addressed under the ignored runtime directory:

```text
.vibe/runs/verification-receipts/<group>/<input-hash>.json
```

The input hash binds:

- the group definition and command;
- the group's test files and declared source/config inputs;
- shared inputs and lockfiles;
- the verifier, TypeScript configuration, and Windows child-process preload;
- Node version, executable, platform, architecture, and relevant environment.

Unknown harness paths are included as extra hashed inputs before a receipt can
be reused. Receipts are success-only. A failed forced rerun removes the matching
receipt, and a missing or malformed receipt is a cache miss.

The receipt records the observed `HEAD`, goal base, changed paths, duration, and
timestamp for audit. Reuse is decided by the recomputed group input hash, not by
branch name or timestamp.

## Stop QA integration

The Stop hook still performs harness-ownership detection, detached scheduling,
failure reporting, and concurrent-work deduplication. On a fully synced harness
it invokes `vibe:verify`, so a manual or Sprint verification can satisfy the
same group receipts. A partially synced downstream without `vibe:verify`
continues to use the deterministic `vibe:typecheck` plus `vibe:self-test`
fallback.

Product-only changes do not schedule Stop harness QA. Stop never invokes
project-owned `vibe:qa`.

## Required boundaries

- Item/Sprint work: use `vibe:verify -- <goal-base-sha>` and retain its
  run/reuse reasons in the verification record.
- Goal completion: recompute the same base-bound plan at the final tree. Every
  impacted group must be successful at its current input hash.
- Release, tag, sync migration, test-runner policy change, or compatibility
  certification: use `vibe:verify:release`.
- Project completion: still run the project-owned final QA and cumulative
  workflow journeys required by `docs/context/workflow-integrity.md`.

Do not copy receipts between repositories or treat them as release artifacts.
They are local, ignored execution evidence.

## Pro E2E execution boundary

The Pro lifecycle suite keeps behavior, transport, and process wiring as separate
cost boundaries:

- `pro-roundtrip-cli.test.ts` invokes the exported `executeProRoundtrip()` command
  boundary in-process for lifecycle behavior. It still creates real bare Git
  remotes, commits, pushes, worktrees, packet files, feedback, approval, and
  close events.
- The lifecycle fixture may pass one already validated `WorktreeContext` through
  serialized operations. The command rejects a context whose repository,
  worktree, or owner-marker paths do not match the requested checkout.
- One spawned `vibe-pro-go.mjs help` smoke remains so the shipped JavaScript
  wrapper, TSX loader, command entrypoint, stdout, and exit status cannot drift
  unnoticed.
- `pro-roundtrip-transport.test.ts` independently owns append-only publication,
  collision, tamper-range, branch-isolation, and worktree-marker behavior. These
  checks are not replaced with mocks.
- Immutable completed-event history is read with one flow-scoped `git log`.
  Every required path must still have exactly one history entry and that entry
  must be `A`; modify, delete, rename, duplicate-add, or missing history fails.

Use the following isolated command when comparing this lane across revisions:

```bash
node --import tsx --test --test-reporter tap \
  .vibe/harness/test/pro-roundtrip-cli.test.ts
```

Do not place a fixed wall-clock assertion in the test because filesystem,
antivirus, and Git process latency differ substantially across hosts. Preserve
the structural guards above and record before/after durations in the handoff or
review evidence. Remove a real Git or spawned-process test only when another
named test owns the same failure boundary and the forced release lane remains
green.
