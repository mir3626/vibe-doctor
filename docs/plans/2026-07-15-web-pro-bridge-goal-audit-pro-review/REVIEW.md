Repository-Grounded Implementation Review
1. Scope, evidence model, and verdict
1.1 Reviewed scope

This review evaluates:

repository: mir3626/vibe-doctor
base:       64ffad48e01eeab1b0c73389cc809c008b11fe32
head:       9b002fe3235185a9a27dddec51bfc4248f768549
branch:     main
patch:      78f9696e5bc30a86ac3224514c9848acdeb1f0883e2a00cee5d0f8d201dc84d0

The supplied patch is the authoritative local-only delta. Its actual bytes were not exposed to the reviewer. Public commit 47219847626cde24d2307c2773b5e15fce14b903 is a direct child of 9b002fe3235185a9a27dddec51bfc4248f768549 and changes the same command, mailbox-tool, manual-transport, test, setup, design, and dogfood-package areas listed in the supplied patch roster. It was therefore used as a corroborating code view, not as proof that its byte stream equals the supplied patch.

1.2 Evidence classifications

Observed evidence means source, tests, manifests, or state artifacts directly visible in the repository or corroborating patch commit.

Inference means a consequence derived from the observed control flow, ordering, or absence of recovery logic. Inferences are identified explicitly.

Limitation means evidence that could not be obtained, including local execution, the original patch bytes, authenticated GitHub-connector behavior, and actual ChatGPT MCP tool invocation.

1.3 Overall verdict

Remediation required before original-goal closure.

The implementation is architecturally substantial and preserves the most important safety boundaries. It is not a placeholder. However, it does not yet provide restart-safe and concurrency-safe mailbox lifecycle semantics, fail-closed current-repository identity, or non-synthetic acceptance evidence for the user’s requested Web Pro/GitHub/MCP workflow.

There is no P0 finding because the fully bound importer has meaningful path, size, UTF-8, manifest, hash, and atomic-staging controls, and no inspected path automatically writes GitHub or starts implementation. The remaining P1 findings are still sufficient to block completion and release.

2. Original design intent

The Hybrid v2 design requires four immutable user outcomes:

reconstruct the last CLI /goal or vibe-goal-iterate implementation;
use GitHub grounding rather than embedding the repository in the prompt;
install the Pro review/design package under docs/plans/<folder>;
use the same modular protocol for audit and bidirectional feature design.

It also requires:

a structured request/result lifecycle and SHA-bound manifests;
structured P0–P3 findings;
a required implementation prompt;
immutable result materialization;
exact repository and reviewed-ref validation;
common transport and importer interfaces;
real round-trip dogfood at each implementation phase;
no implicit push, no repository-content authority escalation, and no browser-automation dependency.

The implementation follows this architecture in broad shape, but several seams do not yet uphold the lifecycle and authority invariants under concurrency, restart, or explicit-request selection.

3. End-to-end workflow reconstruction
3.1 Entry and configuration

User-facing entry points are the vibe:pro-* scripts and the $vibe-goal-audit / $vibe-pro-design skills. They dispatch through .vibe/harness/scripts/vibe-pro-bridge.mjs into .vibe/harness/src/commands/pro-bridge.ts.

runProBridge resolves project configuration, selects manual or mailbox transport, interprets audit/design/status/list/sync/cancel commands, and preserves explicit opt-in for the optional adapters. The design intentionally keeps this path out of Stop hooks, sprint gates, and automatic review cadence.

User-visible effect: an audit/design command either creates a request, reports status, emits a manual handoff, or starts a sync. It does not modify product implementation code.

3.2 Goal-source reconstruction

The goal-source resolver is intended to rank:

Codex App Server persisted goal
→ vibe-goal-iterate durable state
→ handoff/history/archive reconstruction
→ Git reconstruction

The durable-state and reconstruction providers supply the practical current path. CodexAppServerGoalProvider.discover, however, is a stub that always returns codex-app-server-api-unverified, so the highest-authority direct /goal source is not implemented.

Persistence read: .vibe/agent/*, roadmaps, archived prompts, session records, and Git metadata.

Failure behavior: provider unavailability falls through to lower-authority providers and should be declared reconstructed rather than exact.

3.3 Repository scope and visibility

The scope resolver determines repository identity, base/head, branch, commit roster, changed files, and expansion hints. It distinguishes changes visible on GitHub from local-only changes and supports a bounded, secret-safe patch.

The composed review prompt carries the exact refs, design intent, review dimensions, patch roster/hash, output contract, and repository-content trust boundary. This matches the design’s GitHub-visibility gate and prohibition on implicit push.

External side effect: GitHub is read by the Web reviewer; the Bridge does not carry a GitHub write token.

3.4 Request publication
Manual transport

ManualDirectoryTransport writes an outbox package under .vibe/pro-bridge/outbox, copies the handoff text when clipboard support is available, and may open ChatGPT as a convenience.

The Web reviewer returns one complete vibe-bundle; CLI sync parses it and calls the common importer.

MCP mailbox transport

The mailbox persists immutable request content and mutable lifecycle status under .vibe/pro-bridge. A session-bound HTTP server exposes mailbox tools through JSON-RPC. The design uses the same transport interface for CLI-origin and Web-origin requests.

Persistence:

.vibe/pro-bridge/requests/<requestId>/
.vibe/pro-bridge/results/<requestId>/
.vibe/pro-bridge/cache/
.vibe/pro-bridge/outbox/

These are local/shadow artifacts rather than public product state.

3.5 Web review and result upload

The intended mailbox sequence is:

list/get request
→ claim
→ begin result
→ put result-file chunks
→ finalize result

putResultFile validates path, chunk indexes, chunk count, decoded size, and per-chunk SHA. It then writes the chunk and updates per-file metadata.

finalizeResult:

parses the result manifest;
verifies the request/result binding;
assembles staged files;
runs the common importer into the mailbox revision directory;
writes the revision manifest;
writes the result index;
deletes the open upload;
changes the request status to result-ready.

This sequence is not one durable transaction, which creates P1 restart and concurrency findings.

3.6 CLI result selection

For sync --latest, the command attempts to filter ready requests by kind and current GitHub origin. If current origin cannot be parsed, filtering is skipped with a warning. If the user supplies a positional request ID, current-repository filtering is not performed at all.

The selected request and result manifest are then fetched. Web-origin results receive a local-HEAD check, but current repository identity is not independently revalidated at this stage.

3.7 Validation and materialization

The importer validates:

allowed relative paths and canonical containment;
folder-name grammar;
text/JSON media;
UTF-8 decoding;
file and aggregate size limits;
required files;
non-empty implementation prompt;
JSON parseability of FINDINGS.json;
request/result/repository/head/file bindings when the relevant manifests exist;
same-result no-op and different-result conflict behavior.

It writes all files to a temporary folder, writes .bridge/provenance.json, fsyncs where supported, and renames the staging folder into its final docs/plans location.

Durable user-visible completion:

docs/plans/<folder>/
  README.md
  REVIEW.md or DESIGN.md
  FINDINGS.json
  prompt/CLI_MAIN_SESSION_PROMPT.md
  .bridge/provenance.json

The importer deliberately prints a next action rather than automatically starting implementation.

3.8 Acknowledgement

After a newly installed mailbox result, the command calls acknowledgeImport, which verifies the request ID and current result-files hash, writes imported.json, and changes the lifecycle state to imported.

A retry that returns importer status no-op does not acknowledge the result. This makes the install/ack boundary restart-unsafe.

3.9 Web-origin design

Web-origin requests use the same mailbox and importer. When local request metadata or a result manifest is absent in manual fallback, the importer accepts request ID web-origin and records the missing bindings as skipped validations.

That is an honest trust declaration, but it is not a cryptographically or repository-bound result path.

4. Review-dimension assessment
Dimension	Assessment	Material result
Implementation versus design	Partial	Core Hybrid v2 architecture exists; exact closure conditions do not.
End-to-end workflow	Partial	Normal-path mock/manual/mailbox flows exist; restart-safe terminal completion does not.
Persistence/materialization	Partial pass	Result installation is atomic; mailbox lifecycle commits are not.
Authority and temporal ordering	Fail	Current local repository identity can be skipped or bypassed; finalize and ack ordering have crash windows.
Cache/warm/cold parity	Partial	Disk-backed finalized state survives restart, but intermediate finalize and install/ack states do not reconcile.
Concurrency/retry/restart	Fail	No per-request serialization/CAS/fencing; same-process temp names collide; critical crash paths are untested.
Provenance and identity	Partial	Fully bound mailbox path is strong; manual Web-origin and sync selection contain authority gaps.
Operational scheduling	Pass as designed	Explicit commands and process-bound server; no unwanted hooks or automatic cadence.
Migration/rollback	Partial	Additive local footprint and easy disablement; no explicit state-reconciliation migration for interrupted mailbox operations.
Observability	Partial	Status and provenance exist; corrupt entries are silently hidden and no transaction journal exposes repair state.
Existing versus missing tests	Partial	Broad unit/E2E mocks exist; race, crash, identity-bypass, semantic-contract, and real Web acceptance tests are missing.
Public/shadow/forbidden side effects	Mostly pass	No implicit GitHub write or auto implementation; query-string bearer capability remains a security concern.
5. Material findings
P1-001 — Mailbox mutations are not serialized, fenced, or compare-and-swapped

Paths and symbols

.vibe/harness/src/pro-bridge/mailbox/store.ts
writeJson
writeBytes
claimRequest
beginResult
putResultFile
finalizeResult
.vibe/harness/src/pro-bridge/mailbox/server.ts
createMcpRequestListener
.vibe/harness/test/pro-bridge-mailbox.test.ts

Relevant implementation state

Mailbox implementation scope: 410bd594c83559d141a87e6f401152e7726553c0
Reviewed state: 9b002fe3235185a9a27dddec51bfc4248f768549
Conceptual patch: 78f9696e5bc30a86ac3224514c9848acdeb1f0883e2a00cee5d0f8d201dc84d0

Design connection

The design adopts claim-race, chunk-ordering, duplicate-chunk, idempotency, immutable-result, and restart-safe mailbox expectations. The HTTP server is a correctness-bearing transport, not merely a UI wrapper.

Observed evidence

writeJson and writeBytes derive a temporary filename only from the destination and process.pid. Two same-process writes to the same destination therefore share the same temporary path.

claimRequest performs an unlocked read/check/write transition. beginResult performs multiple status writes and then creates upload state. putResultFile reads metadata, writes a chunk, constructs metadata from the earlier read, and overwrites meta.json.

The HTTP listener is asynchronous and awaits tool invocations independently for each request; no global or per-request queue is visible around store mutations.

Inference

Two concurrent tool calls can:

both claim the same request;
collide on a shared .pid.tmp file;
lose one uploaded chunk from meta.json;
create conflicting initial/revision upload state;
race result-index or lifecycle updates.

Hash validation may turn some races into explicit finalize failures, but it does not prevent lost work, duplicate ownership, or inconsistent status/index state.

Impact

The mailbox is not reliable under legitimate MCP retries, parallel tool calls, duplicated delivery, or concurrent Web actions. This violates the core bridge lifecycle rather than an optional adapter.

Required remediation

Add a per-request single-writer queue, lockfile with fencing token, or storage-level compare-and-swap.
Use unique temporary names containing a cryptographic nonce, not only PID.
Make lifecycle transition and related artifact mutation one serialized operation.
Make chunk metadata append idempotent under parallel calls.
Reject stale owners/tokens after claim transfer.
Add deterministic recovery or conflict diagnostics instead of relying on last-writer-wins.

Missing tests

Promise.all concurrent claims;
same-file parallel chunk indexes;
duplicate same-index and conflicting-index calls;
simultaneous begin_result;
finalize racing with chunk upload;
two server connections mutating one request;
restart after lock acquisition and stale-owner rejection.
P1-002 — Result finalization has an unrecoverable crash window

Paths and symbols

.vibe/harness/src/pro-bridge/mailbox/store.ts
finalizeResult
readResultIndex
findOpenUpload
writeStatus
.vibe/harness/test/pro-bridge-mailbox.test.ts

Relevant implementation state

410bd594c83559d141a87e6f401152e7726553c0
9b002fe3235185a9a27dddec51bfc4248f768549
patch 78f9696e5bc30a86ac3224514c9848acdeb1f0883e2a00cee5d0f8d201dc84d0

Design connection

The lifecycle contract requires immutable result finalization, idempotent replay, retry, and restart-safe transition to result-ready.

Observed evidence

The idempotent replay branch is accepted only when status is already result-ready, an index exists, and no upload exists. Otherwise, absence of an upload produces finalize-conflict.

During a successful initial finalize, the implementation writes the revision manifest and result index, removes the upload directory, and only afterward writes request status result-ready.

Inference

If the process stops after upload removal but before the status write:

result index exists
upload no longer exists
status remains result-uploading

A retry cannot enter the idempotent branch because status is not result-ready, and it cannot continue normal finalize because the upload is gone. The result is durable but the lifecycle is stranded.

Other interruption points can similarly leave status, revision manifest, result index, and upload descriptor out of agreement.

Impact

A power loss, process crash, forced server restart, or filesystem error can permanently prevent result publication without manual filesystem surgery. The user cannot reach normal sync completion.

Required remediation

Introduce a durable finalize transaction/journal with explicit phases.
On startup and before every status/read operation, reconcile:
complete revision + matching index + absent upload → promote to result-ready;
complete revision + stale upload → remove or quarantine stale upload;
incomplete revision → roll back to a resumable upload.
Alternatively, derive readiness from the immutable index and manifest rather than a separately committed mutable status.
Preserve idempotency for the exact manifest hash at every interruption point.
Never delete the only resumable upload state before a durable commit marker exists.

Missing tests

Inject failure after each of:

assembled-file import;
revision-manifest write;
result-index write;
upload removal;
status write.

Restart the store and prove that exact-manifest replay reaches one immutable result-ready revision without duplicate files or manual repair.

P1-003 — Install-before-acknowledgement failure cannot self-heal

Paths and symbols

.vibe/harness/src/commands/pro-bridge.ts
runMailboxSync
.vibe/harness/src/pro-bridge/importer.ts
importReviewResult
existingIdentity
.vibe/harness/src/pro-bridge/mailbox/store.ts
acknowledgeImport
.vibe/harness/test/pro-bridge-command.test.ts

Relevant implementation state

Importer scope: 38a9ba26db54887f88ad957affc922a5bde41545
Web-origin/sync scope: 9b002fe3235185a9a27dddec51bfc4248f768549
patch 78f9696e5bc30a86ac3224514c9848acdeb1f0883e2a00cee5d0f8d201dc84d0

Design connection

The end-to-end terminal state is not only “files happened to appear”; it is an atomically installed result plus an exact import receipt acknowledged to the Bridge. Repeated sync must be idempotent.

Observed evidence

The importer returns no-op when a folder with the same result identity already exists.

runMailboxSync acknowledges only the installed outcome. A no-op outcome prints that nothing changed and returns without calling acknowledgeImport.

acknowledgeImport is a separate operation that writes imported.json and then changes status to imported.

Inference

If the process stops after the atomic folder rename but before acknowledgement:

the review package is already installed;
mailbox status remains result-ready;
the next sync returns importer no-op;
the command again omits acknowledgement.

The request remains indefinitely visible as a ready result, and --latest can repeatedly select it.

There is a second smaller crash window inside acknowledgeImport between imported.json and status write, although getStatus derives imported from the receipt and partially mitigates that specific ordering.

Impact

The workflow lacks a restart-safe terminal transition and produces persistent false pending state after an otherwise successful import.

Required remediation

For a same-identity no-op, load and verify installed provenance against the current request and current result-files hash, then call acknowledgeImport.
Persist a local import receipt or import-intent before the final rename and reconcile it on restart.
Make acknowledgement idempotent for the same receipt hash.
Refuse acknowledgement if installed provenance does not match the current immutable result.
Ensure sync --latest cannot starve newer results behind an already installed but unacknowledged request.

Missing tests

terminate after rename and before acknowledgement;
rerun sync and assert one acknowledgement and imported;
duplicate acknowledgement;
no-op with mismatched provenance must not acknowledge;
crash between imported.json and status update;
multiple ready requests where the oldest is already installed.
P1-004 — Current-repository identity can fail open or be bypassed

Paths and symbols

.vibe/harness/src/commands/pro-bridge.ts
runMailboxSync
parseGitHubFullName
.vibe/harness/src/pro-bridge/importer.ts
importReviewResult
.vibe/harness/test/pro-bridge-command.test.ts

Relevant implementation state

9b002fe3235185a9a27dddec51bfc4248f768549
patch 78f9696e5bc30a86ac3224514c9848acdeb1f0883e2a00cee5d0f8d201dc84d0

Design connection

Repository full name and reviewed refs are authority boundaries. A result for another repository must never materialize in the current repository merely because its internal request and result agree with each other.

Observed evidence

Repository filtering is performed only when no positional request ID is supplied. If origin cannot be parsed, the command emits a warning and skips filtering. A positional request checks only that its state is result-ready.

After selection, importer context sets expectedRepositoryFullName from request.repository.fullName. It therefore proves that the result agrees with the selected request, not that either agrees with the current local origin.

The Web-origin guard checks local HEAD against manifest.reviewedHeadSha, but it does not independently bind the current local repository full name.

Inference

A mailbox request for repository B can be explicitly selected while the CLI is running in repository A. If its result is internally consistent and the HEAD value happens to match or the user approves a Web-origin mismatch, it can be installed under repository A’s configured result root.

The same risk exists for --latest when current origin is missing, malformed, non-GitHub, or otherwise unparsable.

Impact

This is a cross-repository materialization flaw. It weakens provenance and can place a valid but unrelated implementation prompt into the wrong project.

Required remediation

Resolve current repository identity before every mailbox sync, including positional request IDs.
Fail closed when GitHub identity is required and cannot be resolved.
Compare current origin full name to:
request repository;
result-manifest repository;
installed provenance on no-op.
Permit any override only through an explicit, separately named, high-friction flag that records the old and new identities in provenance.
Do not use the selected request as the source of truth for expectedRepositoryFullName.
Add repository identity to the import receipt and acknowledgement validation.

Missing tests

positional request for another repository;
unparseable origin;
missing origin;
non-GitHub origin;
request/result agreeing with each other but not current repository;
Web-origin HEAD collision across repositories;
explicit audited override, if retained.
P1-005 — The exact original completion and release condition is not demonstrated

Paths and artifacts

docs/plans/web-pro-bridge/design.md
docs/plans/2026-07-15-web-origin-live-design/.bridge/provenance.json
docs/plans/2026-07-15-web-pro-bridge-pro-review/REVIEW.md
docs/plans/2026-07-15-web-pro-bridge-pro-review/.bridge/provenance.json
package.json
.vibe/sync-manifest.json
release commit/tag state

Relevant implementation state

Base: 64ffad48e01eeab1b0c73389cc809c008b11fe32
Commit roster:
38a9ba26db54887f88ad957affc922a5bde41545
5fd1806c82b14ef03d607815975a56e7e5e34512
410bd594c83559d141a87e6f401152e7726553c0
9b002fe3235185a9a27dddec51bfc4248f768549
patch 78f9696e5bc30a86ac3224514c9848acdeb1f0883e2a00cee5d0f8d201dc84d0

Design connection

The user’s explicit terminal condition was:

repeat whole-workflow audit until it passes
+ restore pristine state
+ sync-manifest closure
+ version bump
+ release tag

The design also requires real round-trip dogfood at each phase and identifies actual Pro MCP/connector coverage as a measurement item.

Observed evidence

The checked-in Web-origin provenance calls the run synthetic and reports githubConnectorUsed: false.

The manual review says approved-with-remediation (synthetic) and states that it only validates the installation path.

Its provenance has no result-manifest hash or reviewer declaration and skips repository, request, result, reviewed-HEAD, roster, and file-SHA bindings.

At the corroborating patch state, package.json still contains version: 0.1.0 and harnessVersion: 1.7.30.

A later, out-of-scope commit declares v1.8.0 and test/live-E2E completion, but its own handoff says actual Pro ChatGPT GitHub-connector and MCP-write-tool measurement remained pending.

Inference

The repository demonstrates local/synthetic protocol dogfood, not the exact external Web Pro review journey requested by the goal. The release operation occurred, if at all, only after the requested reviewed snapshot and cannot be imported into this audit as proof of exact-HEAD completion.

Impact

The implementation may be deployable for controlled local testing, but the original goal cannot honestly be marked completed or release-closed at this snapshot.

Required remediation

Resolve P1-001 through P1-004.
Run three real journeys:
CLI-origin manual review using actual Pro mode and GitHub connector;
CLI-origin mailbox review using actual Pro mode, GitHub connector, and Bridge write tools;
Web-origin design result through the same mailbox and importer.
Persist exact request/result hashes, reviewed refs, connector declaration, limitations, and skipped validations.
Repeat a fresh-context whole-workflow audit after every P1-changing patch.
Close all P1 findings before release.
Restore project-owned transient state to its intended pristine template form.
run sync-manifest and wrapper audits;
bump to a new non-conflicting version;
create a release commit and tag only at the verified commit;
never move or overwrite an existing v1.8.0 tag if it already exists;
do not push without explicit authorization.

Missing evidence

actual ChatGPT conversation/tool receipts;
connector-grounded repository citations;
MCP tool calls authored by the Web session;
exact-HEAD full command logs;
worktree-pristine receipt;
sync-manifest receipt;
version/tag binding for the reviewed commit.
P2-001 — Direct Codex App Server /goal discovery remains a stub

Paths and symbols

.vibe/harness/src/pro-bridge/goal-source/codex-app-server.ts
CodexAppServerGoalProvider.discover
goal-source resolver and provider tests

Relevant implementation state

Base/provider state: 64ffad48e01eeab1b0c73389cc809c008b11fe32
Reviewed state: 9b002fe3235185a9a27dddec51bfc4248f768549

Observed evidence

discover contains the planned JSON-RPC steps as a TODO and always returns unavailable with reason codex-app-server-api-unverified.

Inference and impact

When the latest authoritative goal exists only in an active or persisted Codex App Server thread, the bridge cannot retrieve it directly. Lower-priority providers may reconstruct a useful goal, but cannot guarantee exact parity with the original /goal.

This is P2 rather than P1 because the design explicitly permits provider fallback when the App Server API cannot be verified, and the user’s supplied request demonstrates successful high-confidence durable reconstruction.

Required remediation

Implement the verified API adapter with strict repository selection and no private-reasoning extraction, or formally narrow the supported contract and surface the limitation before publication.

Missing tests

active /goal;
completed persisted /goal;
two repositories with recent threads;
stale thread;
App Server unavailable;
private-reasoning fields ignored;
exact-versus-reconstructed confidence labeling.
P2-002 — Manual Web-origin import is intentionally unbound but insufficiently gated

Paths and symbols

.vibe/harness/src/pro-bridge/importer.ts
importReviewResult
.vibe/harness/src/commands/pro-bridge.ts
manual bundle sync
.vibe/harness/src/pro-bridge/transports/manual.ts
docs/context/pro-bridge-setup.md
importer and command tests

Relevant implementation state

5fd1806c82b14ef03d607815975a56e7e5e34512
9b002fe3235185a9a27dddec51bfc4248f768549
patch 78f9696e5bc30a86ac3224514c9848acdeb1f0883e2a00cee5d0f8d201dc84d0

Observed evidence

When request metadata is absent, request ID web-origin is accepted. When a result manifest is absent, eight material validations are recorded as skipped rather than enforced.

The checked-in manual dogfood provenance demonstrates that exact behavior.

Inference and impact

Any syntactically valid copied Web-origin bundle can be installed after user transfer without repository, reviewed-ref, request, result, roster, per-file hash, or reviewer binding.

The explicit user copy step is a meaningful trust boundary, which keeps this at P2. However, the CLI does not require a high-friction acknowledgement that this is an unbound import.

Required remediation

Prefer an exported request receipt or Web-origin manifest that binds repository and reviewed HEAD.
Require an explicit flag such as --accept-unbound-web-origin when material bindings are absent.
Print the exact skipped validations before installation, not only afterward.
Record the operator acknowledgement and current repository identity in provenance.
Never use an unbound manual import as release or acceptance proof.
P2-003 — Importer validates package syntax but not the required semantic contract

Paths and symbols

.vibe/harness/src/pro-bridge/importer.ts
required-file validation
prompt validation
findings validation
.vibe/harness/src/lib/schemas/pro-bridge.ts
.vibe/harness/test/pro-bridge-importer.test.ts

Relevant implementation state

38a9ba26db54887f88ad957affc922a5bde41545
9b002fe3235185a9a27dddec51bfc4248f768549

Design connection

The design requires structured P0/P1/P2/P3 findings and requires the implementation prompt to contain repository/SHA, mandatory reading, implementation order, immutable boundaries, prohibited operations, exact verification, stop condition, and final-report requirements.

Observed evidence

The importer checks only that the prompt is non-empty and that FINDINGS.json can be parsed by JSON.parse. It does not validate the P0–P3 structure or mandatory prompt sections.

Inference and impact

A package can pass validation while containing:

an empty findings schema such as an unrelated object;
a one-line implementation prompt;
findings-summary counts that disagree with FINDINGS.json;
no repository/ref or safety boundary in the prompt.

The CLI may then present an unusable or unsafe package as successfully installed.

Required remediation

Add a versioned Zod schema for FINDINGS.json.
Require P0, P1, P2, and P3 arrays and validate severities/counts.
Reconcile manifest findingsSummary with file contents.
Parse the implementation prompt for mandatory normalized headings/fields.
Require exact repository and reviewed HEAD in the prompt.
Add compatibility handling for older manual bundles without silently accepting them as fully valid.
P2-004 — Session bearer capability is placed in a query URL

Paths and symbols

.vibe/harness/src/pro-bridge/mailbox/server.ts
suppliedToken
.vibe/harness/src/pro-bridge/mailbox/tunnel.ts
docs/context/pro-bridge-setup.md

Relevant implementation state

410bd594c83559d141a87e6f401152e7726553c0
patch 78f9696e5bc30a86ac3224514c9848acdeb1f0883e2a00cee5d0f8d201dc84d0

Observed evidence

The server accepts either an Authorization bearer header or a token query parameter.

Setup documentation says the command prints a connector URL containing the token and correctly instructs the user to keep it session-only and not store or share it.

The server’s own logger records only the URL pathname, which is a useful local mitigation.

Inference

The query URL still passes through browser/app configuration, tunnel infrastructure, proxies, endpoint telemetry, and potentially provider logs outside the local logger. A leaked token authorizes the mailbox namespace for the lifetime of that server session.

Bearer-token guidance recommends headers rather than page/query URLs because URLs may be retained in browser history and logs.

Impact

This is a bounded, session-scoped capability leak risk rather than a repository credential leak, so it is P2.

Required remediation

Prefer OAuth or an Authorization header if the ChatGPT connector supports it.
Otherwise exchange a single-use bootstrap code for a short-lived scoped token.
Bind tokens to audience, server instance, and expiration.
Add replay protection and immediate revocation on server shutdown.
Document tunnel-provider logging requirements.
Avoid printing a reusable full capability URL where possible.
P3-001 — Corrupt or partial mailbox entries disappear from list/status observability

Paths and symbols

.vibe/harness/src/pro-bridge/mailbox/store.ts
listRequests

Relevant implementation state

410bd594c83559d141a87e6f401152e7726553c0
9b002fe3235185a9a27dddec51bfc4248f768549

Observed evidence

listRequests catches any failure reading a request directory and silently omits that entry.

Impact

Partial writes, disk corruption, schema drift, or interrupted migrations appear as “no request” rather than a repairable mailbox-health problem.

Required remediation

Emit structured diagnostics, quarantine invalid entries, expose a health command, and preserve request IDs and parse failures without presenting them as valid requests.

P3-002 — Filesystem revision installation stops at -rev2

Paths and symbols

.vibe/harness/src/pro-bridge/importer.ts
importReviewResult
revision-folder selection

Relevant implementation state

38a9ba26db54887f88ad957affc922a5bde41545
9b002fe3235185a9a27dddec51bfc4248f768549

Observed evidence

When a conflicting folder is explicitly approved, the importer selects exactly <folder>-rev2. If that slot contains a different result, it returns revision-slot-occupied; it does not search for -rev3 or later.

Impact

The mailbox supports immutable revision chains, but the project materialization path cannot install a third corrected result under the same proposed folder.

Required remediation

Select the lowest free -revN, bind the new folder to revisionOf, preserve all prior folders, and test at least three revisions plus same-result idempotency.

6. Existing tests versus missing tests
6.1 Existing coverage

The repository contains meaningful tests for:

schemas and payload hashing;
provider fallback behavior;
scope and visibility composition;
required files, traversal, UTF-8, size, hash, and atomic import behavior;
manual sentinel parsing;
mailbox authentication and lifecycle transitions;
chunk SHA and duplicate handling;
result-manifest validation;
revision creation;
Web-origin HEAD mismatch gating;
repository/kind filtering for sync --latest;
disabled-by-default optional adapters;
mock end-to-end request/result/import flows.

For example, command tests prove the normal sync --latest path filters current repository and kind and reaches imported.

Mailbox tests also cover server-filled finalize hashes and rejection of incorrect reviewer-supplied hashes.

6.2 Critical missing coverage

No observed test establishes:

concurrent claims or chunk uploads;
per-request ownership fencing;
crash recovery across finalize steps;
install/no-op acknowledgement recovery;
positional wrong-repository rejection;
fail-closed behavior when origin is missing or unparsable;
semantic P0–P3 and implementation-prompt validation;
third and later filesystem revisions;
corrupt-entry health visibility;
external tunnel token non-retention;
a real ChatGPT Pro session using both GitHub connector reads and Bridge MCP writes.

Repository statements that hundreds of tests pass are useful project evidence, but this review did not execute those tests and does not treat the claimed count as independent attestation.

7. Persistence, migration, and rollback assessment
Persistence

The final result folder is the strongest persistence seam. Temporary-directory containment, exclusive file creation, provenance generation, fsync attempts, and rename provide a sound installation base.

Mailbox persistence is weaker because request state, upload state, result revision, index, and status are committed independently.

Migration

The implementation is additive and does not require a database migration. However, remediation that introduces locks, transaction journals, or a new mailbox schema must include an idempotent migration/reconciliation path for existing request directories.

Required migration properties:

never rewrite immutable result files;
preserve result manifest and files hashes;
derive or add transaction state without losing existing requests;
quarantine, rather than delete, corrupt state;
make startup reconciliation repeatable.
Rollback

Operational rollback is straightforward:

disable proBridge;
stop the tunnel/server;
preserve .vibe/pro-bridge evidence;
leave imported docs/plans packages immutable;
revert only the new code/config commit.

Rollback must not delete already imported review packages or move an existing release tag.

8. Public, shadow, and forbidden side effects
Public or external side effects
reading the authorized GitHub repository in ChatGPT;
exposing a temporary MCP endpoint through the configured tunnel;
copying/opening a Web handoff;
optional, explicitly selected Workspace Agent or Responses API calls.
Shadow/local side effects
.vibe/pro-bridge request, result, upload, cache, and outbox files;
temporary import directories;
provenance and imported-plan materialization under the configured result root.
Forbidden side effects not observed
no implicit Git push;
no GitHub source write;
no repository mirroring into the Bridge;
no browser DOM auto-submit or model-picker automation;
no automatic execution of the imported implementation prompt;
no new Stop-hook or sprint-completion coupling.

These preserved boundaries are central implementation strengths and must not be weakened while fixing lifecycle reliability.

9. Required remediation sequence
1. P1-004 current-repository fail-closed identity
2. P1-001 per-request serialization/fencing and unique temporary writes
3. P1-002 journaled/recoverable finalize
4. P1-003 no-op acknowledgement and import reconciliation
5. P2-003 semantic result-package validation
6. P2-002 explicit unbound-manual trust gate
7. P2-004 token transport hardening
8. P3-001 health/quarantine observability
9. P3-002 unbounded immutable revision folders
10. P2-001 verified Codex App Server provider or explicit scope reduction
11. real Web Pro/GitHub/MCP three-journey acceptance
12. fresh whole-workflow audit
13. sync/pristine/version/tag release closure
10. Final authorization boundary

This review authorizes remediation planning only. It does not authorize:

changing the Bridge destination or allowed output roots;
reading another request or tenant;
weakening request/result/file hash checks;
writing GitHub;
force-pushing or moving an existing tag;
exposing credentials;
starting implementation automatically;
representing synthetic or public-Web inspection as authenticated GitHub-connector proof.

The original goal should remain open until all P1 findings are closed and exact release evidence is bound to the final commit.