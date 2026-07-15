# Bridge Protocol

## 1. Request lifecycle

```text
draft
→ ready
→ claimed
→ reviewing
→ result-uploading
→ result-ready
→ imported
```

Terminal failures:

```text
cancelled
expired
failed
```

## 2. ReviewRequest

```ts
type ReviewRequest = {
  schemaVersion: 'vibe-pro-review-request-v1';
  requestId: string;
  kind:
    | 'goal_audit'
    | 'feature_design'
    | 'architecture_review'
    | 'implementation_review';
  origin: 'cli' | 'web' | 'workspace-agent' | 'api';

  repository: {
    fullName: string;
    remoteUrl: string;
    defaultBranch: string | null;
  };
  git: {
    baseSha: string;
    headSha: string;
    branch: string | null;
    headVisibleOnGitHub: boolean;
    compareUrlHint: string | null;
    patchAttachmentSha256: string | null;
  };

  goalSource: GoalSourceManifest | null;
  userGoal: string;
  reviewPrompt: string;
  outputContract: ReviewOutputContract;

  createdAt: string;
  expiresAt: string;
  payloadSha256: string;
};
```

## 3. Result manifest

```ts
type ReviewResultManifest = {
  schemaVersion: 'vibe-pro-review-result-v1';
  requestId: string;
  requestPayloadSha256: string;
  repositoryFullName: string;
  reviewedBaseSha: string;
  reviewedHeadSha: string;
  resultKind: 'audit' | 'design';

  proposedFolder: string;
  disposition:
    | 'approved'
    | 'approved-with-remediation'
    | 'remediation-required'
    | 'blocked';

  files: Array<{
    path: string;
    mediaType: 'text/markdown' | 'application/json';
    byteLength: number;
    sha256: string;
  }>;

  findingsSummary: {
    p0: number;
    p1: number;
    p2: number;
    p3: number;
  };

  reviewerDeclaration: {
    surface: 'chatgpt-web' | 'workspace-agent' | 'responses-api';
    requestedMode: 'pro' | 'frontier' | 'unspecified';
    githubConnectorUsed: boolean;
    limitations: string[];
  };

  createdAt: string;
  payloadSha256: string;
};
```

The bridge cannot cryptographically prove the exact Web model picker selection.
It records the reviewer's declaration and requires the user to choose Pro mode.

## 4. MCP tools

Minimum tool set:

```text
create_request
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

### Chunking

`put_result_file` supports:

```text
filePath
chunkIndex
chunkCount
contentBase64 or UTF-8 text
chunkSha256
```

`finalize_result` verifies:

- complete file roster;
- per-file hash;
- manifest hash;
- required files;
- safe relative paths.

## 5. Idempotency

```text
create_request:
  Idempotency key = repository + request payload SHA

finalize_result:
  one immutable result version per result manifest SHA

acknowledge_import:
  exact import receipt SHA
```

A revised Pro review creates a new result revision linked to its predecessor.

## 6. Storage

Recommended:

```text
metadata: relational/KV store
file chunks: object storage
retention: 7–30 days
encryption: at rest
```

Repository source is not mirrored.
Only optional bounded patch attachments are stored.

## 7. Local mirror

Ignored path:

```text
.vibe/pro-bridge/
├── requests/<id>.json
├── results/<id>.json
└── cache/<id>/*
```

No access token in repository files.
