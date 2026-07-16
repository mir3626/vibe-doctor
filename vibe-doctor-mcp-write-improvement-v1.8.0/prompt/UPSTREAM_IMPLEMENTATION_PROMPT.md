# Upstream Implementation Prompt — Vibe Pro Bridge Write-Path Improvement

You are the primary implementation agent for `mir3626/vibe-doctor`.

## Starting point

The reviewed release is:

```text
version: v1.8.0
commit:  60511059e787301216b4ece7706c4c7b1328e6a7
subject: Release v1.8.0 web pro bridge
```

If `main` has advanced, inspect the entire delta first and preserve stricter or newer behavior.

## Objective

Improve the Vibe Pro Bridge MCP app so that ChatGPT Web reliably publishes completed review/design packages.

Do not replace the existing v1.8.0 hybrid bridge.

Preserve:

```text
request creation
Web-origin design creation
private/local mailbox semantics
immutable request/result manifests
hash-bound chunk upload
result revision
CLI importer
GitHub read-only review
existing low-level upload tools
```

Add a high-level model-facing publication action and make its invocation, auth, completion, diagnostics, and regression behavior explicit.

## Mandatory reading

Read this design package completely:

```text
README.md
00_CURRENT_MAIN_AND_DIAGNOSIS.md
01_CHANGE_SUMMARY.md
02_TOOL_CATALOG_ASIS_TOBE.md
03_PUBLISH_REVIEW_PACKAGE_SPEC.md
04_METADATA_AUTH_PERMISSION_SPEC.md
05_COMPLETION_CONTRACT_AND_PROMPT_SPEC.md
06_DIAGNOSTICS_AND_APP_REFRESH.md
07_TEST_AND_ACCEPTANCE_PLAN.md
08_ROLLOUT_COMPATIBILITY.md
09_TRACEABILITY_MATRIX.md
SOURCE_NOTES.md
FINDINGS.json
specs/MCP-001-primary-publish-facade.md
specs/MCP-002-chunked-upload-fallback.md
specs/MCP-003-completion-contract.md
specs/MCP-004-tool-metadata-and-visibility.md
specs/MCP-005-write-auth-and-permissions.md
specs/MCP-006-capabilities-doctor-refresh.md
specs/MCP-007-golden-prompt-and-e2e.md
```

Then inspect current `main` implementation rather than assuming file paths.

Search the repository for these registered tool names:

```text
create_request
create_design_request
list_pending_requests
get_request
claim_request
begin_result
put_result_file
finalize_result
get_result_manifest
get_result_file
acknowledge_import
cancel_request
```

Also locate:

```text
MCP server registration
tool schema definitions
mailbox domain/application services
result validation/finalization
request prompt composer
vibe-goal-audit skill
vibe-pro-design skill
CLI result importer
app/plugin metadata
auth metadata
bridge tests
release notes and sync manifest
```

## Core diagnosis

The write operations already exist.

The failure is primarily model-facing orchestration:

```text
user job:
  publish completed review package

current tools:
  begin_result
  put_result_file × N
  finalize_result
```

Do not add a generic tool named `write`.

Add one domain action:

```text
publish_review_package
```

It must be the primary normal-package path.

## MCP-001 — High-level publication facade

Register `publish_review_package`.

Requirements:

- one normal call publishes a complete package;
- use current shared validators and mailbox services;
- do not duplicate path/hash/manifest rules;
- atomically claim when safe or validate existing ownership;
- no partial result-ready state;
- exact idempotency by request, client publication ID, and manifest hash;
- return:
  - `status=result-ready`
  - requestId
  - resultId
  - proposedFolder
  - resultManifestSha256
  - fileCount
  - totalBytes
  - revision.

Keep existing low-level tools.

## MCP-002 — Large-package fallback

Normal limits should be discoverable and configurable.

Recommended defaults:

```text
max files: 32
max total UTF-8 bytes: 128 KiB
max single file: 48 KiB
```

If normal package policy is exceeded, return:

```text
status=chunked-upload-required
uploadSessionId
maxChunkBytes
requiredFiles
requiredNextTools=[put_result_file, finalize_result]
```

Rewrite low-level descriptions so they are selected only after this fallback or an explicit resume request.

## MCP-003 — Completion contract

Extend `get_request` structured output with:

```text
publicationRequired=true
primaryFinalTool=publish_review_package
requiredFinalStatus=result-ready
requiredFiles
chatOnlyOutputCompletesRequest=false
fallback contract
```

Update every Web review/design prompt template.

The generated prompt must state:

```text
The task is incomplete until the Bridge returns status=result-ready.
Do not finish by only printing Markdown in chat.
```

Final Web response must include the result receipt identifiers.

If the publish tool is unavailable, the model must report an incomplete Bridge tool surface rather than claim success.

## MCP-004 — Tool metadata

For every tool, explicitly declare:

```text
readOnlyHint
destructiveHint
openWorldHint
idempotentHint where true
outputSchema
_meta.ui.visibility
```

Normal private mailbox writes:

```text
readOnly=false
destructive=false
openWorld=false
```

`cancel_request`:

```text
destructive=true
```

Model-invoked tools:

```text
visibility=["model","app"]
```

Descriptions must begin with `Use this when...` and include disallowed cases.

Add a deterministic tool-catalog audit that fails on:

- missing annotations;
- write tool marked read-only;
- incorrect destructive classification;
- missing output schema;
- missing model visibility;
- missing fallback restriction;
- missing required auth scope.

## MCP-005 — Auth and permissions

Support both:

```text
local private noauth profile
remote OAuth profile
```

For OAuth mode, define per-tool scopes:

```text
bridge.request.read
bridge.request.write
bridge.result.read
bridge.result.write
bridge.import.ack
```

A missing write scope must produce `_meta["mcp/www_authenticate"]` with `insufficient_scope`.
A plain 403 is insufficient.

Document personal ChatGPT app permission settings and reauthorization.

## MCP-006 — Diagnostics

Add read-only:

```text
bridge_capabilities
```

Return:

```text
protocol version
server build SHA
tool catalog version
write enabled
primary write tool
normal package limits
chunked fallback support
auth mode
required scopes
```

Add:

```text
$vibe-goal-audit doctor
```

It must inspect raw `tools/list` and diagnose:

- missing publish tool;
- catalog mismatch;
- wrong annotations;
- wrong visibility;
- missing output schema;
- missing auth metadata;
- server unreachable.

No hook or routine QA integration.

## MCP-007 — Golden prompt regression

Create direct, indirect, negative, fallback, and cancel prompt datasets.

Targets for the release golden set:

```text
direct publication recall = 100%
negative false publication = 0%
normal publication success = 100%
normal median write calls = 1
partial result-ready state = 0
```

Run:

- unit/handler tests;
- catalog audit;
- MCP Inspector List Tools and Call Tool;
- ChatGPT Developer Mode golden prompts;
- one real Goal audit from request through CLI import.

## ChatGPT metadata refresh

Because the tool list and descriptions change, document and execute:

```text
deploy/restart MCP server
→ Settings > Plugins
→ open developer-mode app
→ Refresh
→ verify new tool list
→ open a new chat
→ attach Vibe Pro Bridge
→ replay golden prompts
```

If using a published plugin, scan/submit/publish a new metadata snapshot.

## Compatibility and release

Prefer:

```text
v1.8.1
```

provided current mailbox/result schemas remain unchanged.

Do not remove existing low-level tools.

Do not mutate existing requests or results.

Do not change:

```text
Stop hooks
Sprint completion
vibe:qa defaults
automatic audit cadence
GitHub write policy
CLI importer output root
```

## Tests and verification

Run all current focused bridge tests plus repository-required:

```text
typecheck
lint
unit/self tests
build
sync/wrapper audits as applicable
```

Add focused commands or equivalent tests for:

```text
tool catalog
publish facade
completion contract
OAuth scope
doctor
end-to-end import
```

## Final report

Report:

- actual starting and ending SHA;
- files changed by MCP item;
- exact tool catalog before/after;
- annotation/auth matrix;
- handler and catalog test results;
- Inspector evidence;
- Developer Mode golden prompt results;
- app Refresh/plugin update steps;
- E2E request/result/import receipts;
- release/version disposition;
- residual limitations.

Do not push, tag, publish a plugin, or deploy a public MCP endpoint unless explicitly authorized by the active user.
