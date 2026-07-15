# Target Architecture

## 1. Layers

```text
┌──────────────────────────────────────────────┐
│ Skills                                       │
│ vibe-goal-audit / vibe-pro-design            │
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│ Local Review Orchestrator                    │
│ GoalSourceResolver                           │
│ GitScopeResolver                             │
│ PromptComposer                               │
│ ResultImporter                               │
└──────────────────────┬───────────────────────┘
                       │ BridgePort
┌──────────────────────▼───────────────────────┐
│ Transport adapters                           │
│ MCP Mailbox | Manual | Workspace | API       │
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│ Remote Vibe Pro Bridge MCP                   │
│ request/result state + encrypted artifacts   │
└──────────────┬───────────────────┬───────────┘
               │                   │
        ChatGPT Web Pro        Codex CLI/plugin
               │
        ChatGPT GitHub app
```

## 2. Port interfaces

### Goal source

```ts
interface GoalSourceProvider {
  discover(input: GoalDiscoveryInput): Promise<GoalSourceCandidate[]>;
}
```

Providers:

```text
CodexAppServerGoalProvider
VibeGoalIterateProvider
HandoffHistoryProvider
GitReconstructionProvider
```

### Repository scope

```ts
interface RepositoryScopeProvider {
  resolve(input: RepositoryScopeInput): Promise<RepositoryScopeManifest>;
}
```

### Bridge transport

```ts
interface VibeProBridgeTransport {
  createRequest(request: ReviewRequest): Promise<RequestHandle>;
  getRequestStatus(requestId: string): Promise<RequestStatus>;
  getResultManifest(requestId: string): Promise<ReviewResultManifest | null>;
  getResultFile(requestId: string, path: string): Promise<Uint8Array>;
  acknowledgeImport(requestId: string, receipt: ImportReceipt): Promise<void>;
}
```

Adapters:

```text
McpMailboxTransport
ManualDirectoryTransport
WorkspaceAgentTransport
ResponsesApiTransport
```

### Result importer

```ts
interface ReviewResultImporter {
  validate(result: DownloadedResult): Promise<ValidatedResult>;
  install(result: ValidatedResult, projectRoot: string): Promise<ImportReceipt>;
}
```

## 3. Project footprint

Core vibe-doctor changes should remain small.

Suggested:

```text
.claude/skills/vibe-goal-audit/
  SKILL.md
  resources/*
  scripts/discover-goal.mjs
  scripts/import-result.mjs

.codex/skills/vibe-goal-audit/
  SKILL.md

.claude/skills/vibe-pro-design/
  SKILL.md
  resources/*

.codex/skills/vibe-pro-design/
  SKILL.md

docs/context/vibe-pro-bridge.md
```

The remote MCP/plugin can live in a separate repository/package:

```text
vibe-pro-bridge/
  mcp-server/
  plugin/
  schemas/
```

This keeps downstream harness sync light.

## 4. No lifecycle coupling

Do not wire the bridge into:

```text
Stop hook
PreCompact hook
Sprint complete
Sprint commit
vibe:qa
vibe:review automatic cadence
```

The user explicitly invokes the skill.
