# `publish_review_package` Detailed Specification

## 1. Purpose

Publish a normal-size completed review/design package in one atomic model call.

This is a facade over the existing v1.8.0 result lifecycle.

```text
validate request
→ acquire/verify review ownership
→ validate package
→ store files
→ build immutable manifest
→ finalize request
→ return result-ready receipt
```

## 2. Input contract

```ts
type PublishReviewPackageInput = {
  requestId: string;

  proposedFolder: string;

  disposition:
    | 'approved'
    | 'approved-with-remediation'
    | 'remediation-required'
    | 'blocked';

  summary: {
    title: string;
    reviewedRepository: string;
    reviewedBaseSha: string;
    reviewedHeadSha: string;
    p0: number;
    p1: number;
    p2: number;
    p3: number;
    limitations: string[];
  };

  files: Array<{
    path: string;
    mediaType: 'text/markdown' | 'application/json';
    content: string;
  }>;

  clientPublicationId: string;
};
```

## 3. Required files

For audit:

```text
README.md
REVIEW.md
FINDINGS.json
source/GOAL_SOURCE_MANIFEST.json
prompt/CLI_MAIN_SESSION_PROMPT.md
```

For new design:

```text
README.md
DESIGN.md
FINDINGS.json
source/GOAL_SOURCE_MANIFEST.json or source/DESIGN_SOURCE_MANIFEST.json
prompt/CLI_MAIN_SESSION_PROMPT.md
```

Additional files are allowed under:

```text
design/**
specs/**
source/**
prompt/**
.bridge/**
```

## 4. Package bounds

Recommended default:

```text
files:              <= 32
total UTF-8 bytes:  <= 128 KiB
single file:        <= 48 KiB
JSON nesting:       bounded
```

Exact limits must be returned by `bridge_capabilities`.

When input exceeds server policy, return a structured non-final result:

```ts
type ChunkedUploadRequired = {
  status: 'chunked-upload-required';
  requestId: string;
  uploadSessionId: string;
  maxChunkBytes: number;
  requiredFiles: string[];
  requiredNextTools: [
    'put_result_file',
    'finalize_result'
  ];
};
```

The generated prompt must tell the model to follow this plan.

## 5. Output contract

Success:

```ts
type PublishReviewPackageResult = {
  status: 'result-ready';
  requestId: string;
  resultId: string;
  proposedFolder: string;
  resultManifestSha256: string;
  fileCount: number;
  totalBytes: number;
  revision: number;
  imported: false;
};
```

Conflict:

```ts
type PublicationConflict = {
  status: 'conflict';
  reason:
    | 'request-terminal'
    | 'claimed-by-another-reviewer'
    | 'different-result-already-finalized'
    | 'request-sha-mismatch';
  existingResultId?: string;
};
```

## 6. Atomicity

Normal package flow must not expose partial result state.

Preferred implementation:

```text
single mailbox transaction
or
staged private result + atomic finalize within one handler
```

Failure before finalization:

```text
request remains ready/claimed
no result-ready manifest visible
no partially readable file roster
retry with same clientPublicationId is safe
```

## 7. Idempotency

Identity:

```text
requestId
+ clientPublicationId
+ canonical package manifest SHA
```

Rules:

- exact repeat returns the existing result-ready receipt;
- same clientPublicationId with different content returns conflict;
- existing different finalized result requires revision path;
- facade cannot silently overwrite current manifest.

## 8. Claim behavior

For personal single-reviewer use:

- if request is `ready`, facade may atomically claim it for the authenticated principal;
- if already claimed by the same principal/session, continue;
- if claimed by another principal, return conflict;
- do not require a separate claim call for the normal happy path.

Existing `claim_request` remains available for explicit concurrency workflows.

## 9. Internal reuse

Do not duplicate validation logic.

The facade should call shared domain services currently used by:

```text
begin_result
put_result_file
finalize_result
```

Refactor shared behavior behind one application service if required.

## 10. Security

- Result writes remain within the authenticated mailbox tenant.
- Repository content cannot alter output root or authorization.
- Paths are normalized and allowlisted.
- No GitHub write.
- No local project filesystem write from Web.
- Server verifies request/repository/head binding.

## 11. Telemetry

Record:

```text
tool name
request kind
normal vs chunked path
file count/bytes
result status
confirmation shown if available
latency
error code
model/client metadata when privacy policy allows
```

Do not log file contents.
