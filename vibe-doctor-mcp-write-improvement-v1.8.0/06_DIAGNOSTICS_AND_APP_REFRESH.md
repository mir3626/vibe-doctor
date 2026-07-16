# Diagnostics and App Refresh Specification

## 1. `bridge_capabilities` read tool

Output:

```ts
type BridgeCapabilities = {
  protocolVersion: string;
  serverBuildSha: string;
  toolCatalogVersion: string;

  resultWriteEnabled: boolean;
  primaryResultWriteTool: 'publish_review_package' | null;
  normalPackageLimits: {
    maxFiles: number;
    maxTotalBytes: number;
    maxSingleFileBytes: number;
  };
  chunkedUploadEnabled: boolean;

  authMode: 'noauth-local' | 'oauth';
  requiredScopes: {
    reviewRead: string[];
    resultWrite: string[];
    importAck: string[];
  };

  supportedRequestKinds: string[];
};
```

## 2. `$vibe-goal-audit doctor`

Explicit skill subcommand; no hook or routine overhead.

Checks:

```text
MCP endpoint reachable
protocol initialize succeeds
tools/list available
required tools exist
publish_review_package exists
write annotations correct
model visibility correct
output schema present
OAuth metadata reachable
write scope advertised
server build/catalog version
local skill expected version
```

Output example:

```text
[PASS] get_request
[FAIL] publish_review_package missing
[WARN] server catalog v1, skill expects v2
[ACTION] redeploy and Refresh the ChatGPT developer-mode app
```

## 3. Tool-catalog versioning

Recommended:

```text
protocolVersion: vibe-pro-bridge-v1
toolCatalogVersion: 2
```

Do not change persisted result schema solely for catalog improvements.

## 4. ChatGPT metadata refresh

After any tool name, description, annotation, schema, or auth change:

1. deploy/restart MCP server;
2. Settings → Plugins;
3. open Vibe Pro Bridge developer-mode app;
4. choose Refresh;
5. verify the tool list;
6. open a new conversation;
7. attach the app;
8. replay golden prompts.

Published plugins require a new scanned/published metadata snapshot.

## 5. App permission

Document recommended personal setting:

```text
Ask before making changes
```

or, after trusted dogfood:

```text
Ask only before important changes
```

Normal package publication may require one confirmation.
The high-level facade avoids per-file confirmations.

## 6. Inspector workflow

Required release evidence:

```text
MCP Inspector List Tools raw JSON
MCP Inspector direct publish call
Developer Mode direct prompt
Developer Mode indirect prompt
Developer Mode negative prompt
```

## 7. Stale client detection

If Web app metadata is stale, `bridge_capabilities` may be unavailable or catalog version mismatched.

The generated CLI handoff should print:

```text
Expected tool catalog: 2
If publish_review_package is absent:
  Refresh the app before starting the review.
```
