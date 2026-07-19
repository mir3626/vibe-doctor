# Independent re-audit — Vibe Pro Bridge remediation

## A. Review authority and scope

This review evaluates whether `mir3626/vibe-doctor` implemented the remediation goal registered as `AUD-20260715-3vw8nv`.

- Base: `60511059e787301216b4ece7706c4c7b1328e6a7`
- Reviewed HEAD: `e63d9d3d2a596a77c171337bf9be0dbadc0ed58f`
- Branch: `main`
- Commit range: exactly three commits, with HEAD ahead by 3 and behind by 0
  - `16923cce57e63ac3d964cfd80307173985309261` — authority binding
  - `3a79cf9dd1424fc42453a26475b9417b5973c9f0` — lifecycle durability
  - `e63d9d3d2a596a77c171337bf9be0dbadc0ed58f` — contract polish

The GitHub compare result matched the request’s changed-file roster. Repository inspection was read-only. No branches, commits, issues, pull requests, tags, comments, settings, or repository files were created or changed.

## B. Method and limitations

The review reconstructed the intended contract from:

- `docs/plans/2026-07-15-web-pro-bridge-goal-audit-pro-review/FINDINGS.json`
- `docs/plans/2026-07-15-web-pro-bridge-goal-audit-pro-review/REVIEW.md`
- `docs/plans/2026-07-15-web-pro-bridge-goal-audit-pro-review/prompt/CLI_MAIN_SESSION_PROMPT.md`
- `docs/plans/web-pro-bridge/design.md`
- `docs/plans/archive/roadmaps/iter-2.md`
- `.vibe/agent/handoff.md`

The implementation and tests were then traced through the mailbox store, MCP server and tools, importer, sync command, schemas, transports, and focused test suites.

Limitations:

- Exact-ref GitHub connector reads succeeded, but an isolated local clone failed because outbound DNS could not resolve `github.com`.
- No test, build, race, crash injection, tunnel, or release command was executed by this reviewer.
- GitHub reports no combined-status entries and no workflow runs for the reviewed HEAD.
- The request’s patch bytes were not exposed separately for independent hash recomputation; base/head ancestry and the file roster were independently confirmed through GitHub compare.
- No repository artifact at the reviewed HEAD proves all required real Web Pro acceptance journeys.

Accordingly, this report separates observed code evidence, inference, and unverified repository claims.

## C. Verdict

**Disposition: remediation-required**

| Severity | Count |
|---|---:|
| P0 | 0 |
| P1 | 2 |
| P2 | 3 |
| P3 | 0 |

The three remediation sprints are not equivalent to completion of the original 13-phase goal. `sprint-vpb-09` explicitly excludes phases 11–13. `iter-2.md` still requires the real three journeys, a fresh independent audit with P0/P1 zero, pristine restoration, and a v1.8.1 release. At the reviewed HEAD, `package.json` remains `version=0.1.0` and `harnessVersion=1.7.30`; `.vibe/agent/handoff.md` still declares an active iteration and pending real connector/MCP confirmation; the head commit states `Verification: pending`.

## D. Prior-finding closure matrix

| Prior finding | Re-audit status | Basis |
|---|---|---|
| VPB-AUD-P1-001 mailbox serialization/fencing | **Partially addressed; P1 remains** | Per-request queues, nonce temporary names, and lock files exist, but reviewer ownership is not persisted or required by result mutations; time-only lease reclamation is not a durable fencing epoch. |
| VPB-AUD-P1-002 finalize crash window | **Structurally addressed, execution unverified** | Durable finalize journal, phased commits, replay, and reconciliation are present with crash-injection tests. |
| VPB-AUD-P1-003 install-before-ack recovery | **Structurally addressed, execution unverified** | Same-result no-op returns installed provenance and mailbox sync can acknowledge it idempotently. |
| VPB-AUD-P1-004 current repository identity | **Addressed for normal mailbox sync** | Current origin is resolved independently and compared for positional and latest sync; failure is closed unless a high-friction override is supplied. |
| VPB-AUD-P1-005 real acceptance and release | **Open** | Required phases 11–13 are absent from the reviewed snapshot. |
| VPB-AUD-P2-001 Codex App Server stub | **Acceptably narrowed** | Provider remains unavailable but is explicitly documented and reconstruction is not represented as exact. |
| VPB-AUD-P2-002 unbound manual trust | **Partially addressed; P2 remains** | Fully requestless Web-origin bundles are gated, but request-associated bundles without a result manifest bypass the gate. |
| VPB-AUD-P2-003 semantic package contract | **Structurally addressed** | Versioned findings schema, severity/count reconciliation, prompt headings, repository, and reviewed SHA checks are implemented. |
| VPB-AUD-P2-004 token in query URL | **Open** | Query name changed to `code`, but it remains replayable for the session TTL and no real exchange returns the generated session token. |
| VPB-AUD-P3-001 corrupt entries hidden | **Addressed** | Health diagnostics distinguish empty, healthy, recovering, corrupt/quarantined, and migration-required states. |
| VPB-AUD-P3-002 revision materialization limited to rev2 | **Partially addressed; P2 provenance defect remains** | Lowest free `revN` is selected, but gap filling can point backward-numbered revisions to later predecessors. |

## E. Detailed findings

### P1 — VPB-REAUD-P1-001: Claim ownership and cross-process fencing are not durably bound

**Observed evidence**

- `claim_request`, `begin_result`, `put_result_file`, and `finalize_result` accept only `requestId` plus operation data. No claim ID, reviewer ID, session ID, owner epoch, or fencing token is returned or required.
- `MailboxStore.claimRequest` only transitions `status.json` to `claimed`; `StoredStatus` contains `state`, `updatedAt`, and `detail`, not an owner.
- After a request is claimed, any client holding the server credential and request ID can invoke `begin_result`, upload chunks, and finalize the result. The store cannot distinguish the claimant from another caller.
- The cross-process lease is a lock file containing a random fingerprint and fixed `acquiredAt`. There is no heartbeat or renewal. A second process deletes the lock once its age reaches the default 30 seconds.
- `assertLease` checks the fingerprint before rename, but the check and rename are separate filesystem operations. A competing process can reclaim the lock between them; the fingerprint is not embedded in the destination state as a monotonic fencing epoch.
- The test named “stale claimant after ownership transfer” replaces the temporary lock file during one operation. It does not model two independent review sessions, persistent claim authority, or an operation that remains active beyond the stale timeout.

**Inference**

A replaying or independently authorized client can continue a request claimed by another review session. A legitimate long-running finalize can also be treated as stale and overlapped by another process. The per-request queue protects only one store instance; the age-based lock reduces overlap but does not establish durable reviewer ownership or strict cross-process fencing.

**Impact**

The mailbox’s core authority invariant remains incomplete. Result authorship, revision ownership, and stale-owner rejection cannot be proven under multiple clients, credential replay, process stalls, slow filesystems, or operations longer than the stale threshold.

**Required remediation**

1. Persist a versioned claim record containing an unguessable claim/session token and a monotonically increasing fencing epoch.
2. Return the claim token from `claim_request`; require it on `begin_result`, `put_result_file`, `finalize_result`, and revision creation. Use a versioned tool migration rather than silently weakening compatibility.
3. Bind journal, upload descriptor, and result revision to the claim epoch. Reject any operation whose epoch is not current.
4. Replace delete-by-age locking with a renewable lease or an atomic storage primitive. An active owner must renew before expiry; reclaim must advance an epoch that is checked atomically by durable mutations.
5. Remove the check-then-rename fencing gap, for example through epoch-bound compare-and-swap state or a storage transaction whose commit verifies the epoch.
6. Test two independent clients, restart and reclaim, operations exceeding the lease TTL, delayed fsync/rename, and stale token replay.

### P1 — VPB-REAUD-P1-002: The mandatory real-acceptance and release boundary is absent

**Observed evidence**

- The remediation contract requires: three real ChatGPT Web Pro journeys, actual GitHub connector use, actual Bridge MCP write use, a fresh independent whole-workflow audit with no P0/P1, pristine restoration, sync audits, a new version, a release commit, and an exact tag.
- `docs/plans/archive/roadmaps/iter-2.md` retains those as the iteration exit conditions.
- The sprint-vpb-09 scope explicitly states that phases 11–13 are not part of that sprint.
- `.vibe/agent/handoff.md` still marks Iteration 2 active and says GitHub connector/MCP write confirmation is pending.
- `package.json` at the reviewed HEAD reports `version: 0.1.0` and `harnessVersion: 1.7.30`, not v1.8.1.
- Each remediation commit message states `Verification: pending`.
- GitHub exposes no status checks and no workflow runs for the reviewed HEAD.

**Inference**

The code sprints are an intermediate remediation checkpoint, not the original goal’s release-closed state. No exact-HEAD evidence proves the required live journeys, repeated independent audit, full suite, pristine state, version consistency, release commit, or tag.

**Impact**

Marking this snapshot complete or release-authorized would violate the user’s explicit closure contract and could ship unresolved P1 authority defects.

**Required remediation**

1. Resolve all P1 findings first.
2. Execute the real CLI-origin manual, CLI-origin mailbox, and Web-origin design journeys using actual ChatGPT Web Pro, GitHub connector grounding, and Bridge write tools where required.
3. Persist bounded receipts with exact request/result hashes, reviewed refs, `surface=chatgpt-web`, `requestedMode=pro`, `githubConnectorUsed=true`, tool-use evidence, terminal state, and limitations. Do not persist credentials or private conversation content.
4. Freeze the implementation and run a fresh-context independent audit. Any implementation change after that audit requires another audit.
5. Run all maintained verification commands and preserve exit codes and test counts.
6. Restore project-owned runtime/template state, update all version surfaces to the next non-colliding semver, create one release commit, and create a tag pointing exactly to it.
7. Do not push without explicit active-user authorization.

### P2 — VPB-REAUD-P2-001: The advertised one-time connector code is replayable

**Observed evidence**

- `runMcpServer` prints `.../mcp?code=<connectCode>` and describes it as a one-time exchange code.
- `createSessionAuth.authorize` keeps `connectCode` after first use. Every subsequent request presenting that same code is accepted until `sessionTtlMs` expires, by default 12 hours.
- A random `sessionToken` is generated but is never returned to the client by an exchange response or public handshake result.
- The MCP server test explicitly sends the same `?code=` for initialize and a follow-up `tools/list` request and expects both to succeed.
- Another test sends eight concurrent first requests with the same code and expects all to succeed.

**Inference**

There is no one-time exchange. The code in the query URL is the reusable session bearer. A URL leak through connector configuration, tunnel telemetry, proxy logs, browser history, or support screenshots grants mailbox access for the session lifetime.

**Impact**

The security property promised to users and relied on by the prior remediation is false. Combined with ownerless result mutations, credential replay can affect an already claimed request.

**Required remediation**

1. Atomically invalidate the bootstrap code on first successful exchange.
2. Return a client-usable short-lived credential through a verified connector-compatible mechanism such as OAuth, Authorization-based configuration, or a protocol session identifier that the client demonstrably echoes.
3. If the connector cannot rotate credentials, stop representing the URL code as one-time; use an accurately documented bounded bearer with a much shorter TTL, explicit revocation, and tunnel/log controls until a real exchange is available.
4. Add tests proving second-use rejection, concurrent exchange single-winner behavior, expired/revoked credential rejection, and absence of reusable credentials in logs.

### P2 — VPB-REAUD-P2-002: Request-associated manual bundles bypass the unbound-result gate

**Observed evidence**

- `runBundleSync` defines `unbound` solely as `request === null`.
- A manual vibe-bundle can be associated with a stored request by request ID, or a `web-origin` bundle can use `--latest`; the command then rewrites the bundle request ID to the selected request ID.
- The manual bundle does not carry a `ReviewResultManifest`. The importer records that result manifest, request hash, result hash, repository binding, reviewed-head binding, file roster, file SHA, and reviewer declaration validations were skipped.
- Because request metadata exists, `--accept-unbound-web-origin` is not required and the skipped validations are printed only after installation.
- The command can then acknowledge the mailbox request out of band and transition it to `imported`.
- Tests label this path “bound web-origin” and expect installation/import even though result-manifest and per-file binding are absent.

**Inference**

An arbitrary syntactically compliant result package can be attached to the newest nonterminal request and installed without cryptographic result binding or reviewer identity. Request association is being treated as result authority.

**Impact**

The high-friction manual trust boundary remains bypassable. A wrong, stale, truncated, or substituted result can become an installed and acknowledged package for a valid request.

**Required remediation**

1. Define a bound result as request metadata plus a result manifest or exported receipt that binds repository, reviewed HEAD, request payload hash, result payload hash, exact file roster, per-file hashes, and reviewer declaration.
2. Treat any missing result binding as unbound even when a request ID is found.
3. Display every skipped validation before any write and require explicit acceptance. Record acceptance in provenance and prohibit mailbox acknowledgement to `imported` unless the receipt contract explicitly permits an unbound terminal state distinct from authoritative import.
4. Do not rewrite `web-origin` to a mailbox request ID without a bound receipt proving that association.
5. Add adversarial tests: forged bundle against `--latest`, stale bundle against a newer request, same repository/SHA but wrong request hash, changed file bytes, absent reviewer declaration, and acceptance output ordering.

### P2 — VPB-REAUD-P2-003: Revision-gap filling creates inverted provenance

**Observed evidence**

- Revision slots are sorted ascending and the lowest free `revN` is selected.
- After selecting the gap, the importer sets `predecessor = revisionSlots.at(-1)`, which is the highest occupied revision, not the greatest occupied revision less than the selected revision.
- With rev1 and rev3 present and rev2 free, the new rev2 provenance records `revisionOf = <folder>-rev3` and the rev3 result hash as predecessor.
- The focused test explicitly asserts that rev2 points to rev3, institutionalizing the reversed relationship.

**Inference**

The revision number and predecessor graph disagree. Consumers following provenance can encounter forward references, non-monotonic lineage, or cycles after further gap fills.

**Impact**

Immutable packages remain on disk, but their audit lineage is misleading. Automated importers, review history, and rollback tooling cannot reliably reconstruct the actual correction order.

**Required remediation**

1. Define lineage semantics explicitly. If revision numbers represent order, the predecessor of selected revN must be the highest occupied revision less than N; for rev2 in a rev1/rev3 gap, the predecessor is rev1.
2. Alternatively, prohibit gap filling and append only after the current highest revision. Do not combine lowest-gap naming with latest-result predecessor semantics.
3. Validate that `revisionOf` always refers to an existing lower revision and that `predecessorResultSha256` matches its immutable provenance.
4. Add tests for rev1+rev3 gap, multiple gaps, malformed legacy chains, no forward references, no cycles, and deterministic no-op lookup.

## F. Workflow reconstruction

### Request creation and authority

The request packet remains hash-bound to repository and refs. Repository origin resolution in mailbox sync is independently performed through Git and generally fails closed. This is a meaningful improvement over the prior snapshot.

### Claim and review

The request transitions to `claimed`, but the claimant is not represented in durable state. The API description says “one review session,” while the storage and tools only know the request ID. This discrepancy is the main remaining P1 implementation defect.

### Upload and finalize

Per-request in-process queues serialize mutations within one store. Cross-process lock files, nonce temporary paths, chunk idempotency, finalize journals, and reconciliation substantially improve durability. The journal ordering now writes result-ready before marking the journal committed and removes staging only after the commit marker. These are strong structural fixes.

### Import and acknowledgement

Mailbox imports validate current repository, request, manifest, file roster, hashes, findings summary, and prompt contract. Same-result no-op recovery can acknowledge an installed result. Manual transport remains weaker: request lookup is incorrectly treated as sufficient result binding.

### Release closure

The exact reviewed snapshot is pre-acceptance and pre-release by its own roadmap and metadata. It must not be labeled release-closed.

## G. Positive implementation changes

The following changes are supported by code inspection and should be preserved:

- independent current-repository identity resolution and fail-closed normal sync;
- per-request mutation queues;
- cryptographically unique temporary filenames;
- chunk duplicate/conflict handling;
- durable finalize journal and restart reconciliation;
- installed/no-op provenance verification before acknowledgement;
- idempotent import acknowledgement;
- versioned findings schema and manifest count reconciliation;
- semantic implementation-prompt checks;
- mailbox health diagnostics without silent deletion;
- revN scanning beyond rev2;
- explicit narrowing of unavailable Codex App Server support;
- no implicit GitHub write or automatic implementation start.

## H. Verification status

| Verification | Status |
|---|---|
| GitHub repository and exact commits | Executed and confirmed |
| Base → head ancestry and three-commit range | Executed and confirmed |
| Changed-file roster | Executed and confirmed |
| Exact-ref source/test inspection | Executed |
| GitHub combined status | Executed; no statuses |
| GitHub workflow runs | Executed; none |
| Local checkout | Attempted; blocked by DNS |
| Typecheck/build/test suites | Not executed by reviewer |
| Race/crash-injection tests | Not executed by reviewer |
| Real Web Pro three journeys | No exact-HEAD evidence observed |
| Pristine worktree/version/tag | Not demonstrated at reviewed HEAD |

## I. Final disposition

`remediation-required`

Release authorization is denied for the reviewed snapshot. The next implementation should fix the five findings, execute the full verification and live acceptance contract, and then submit a new exact-HEAD independent audit package.
