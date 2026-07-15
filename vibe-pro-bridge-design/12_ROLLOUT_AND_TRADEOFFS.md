# Rollout and Trade-offs

## 1. Phase 1 — Local/manual transport

Deliver first:

- both skills;
- Goal discovery;
- prompt generation;
- local outbox;
- result importer;
- schemas.

This validates the workflow without running remote infrastructure.

## 2. Phase 2 — MCP mailbox

Deliver:

- remote MCP server;
- ChatGPT Developer Mode app;
- Codex plugin app wiring;
- OAuth;
- request/result storage.

This removes manual file transfer.

## 3. Phase 3 — Web-origin design

Add:

- Web creates request/result for repository;
- CLI `sync --latest`;
- same output contract.

## 4. Phase 4 — Optional automation

Add only when useful:

- Workspace Agent trigger;
- Responses API adapter;
- notifications.

## 5. Trade-offs

### Benefits

- Pro review remains in Web;
- GitHub handles full source scope;
- no long prompt code paste;
- no ZIP download/manual move;
- result provenance preserved;
- reusable for audit and new design.

### Costs

- one remote MCP service;
- one-time ChatGPT Developer Mode/plugin setup;
- one manual Web invocation on personal Pro;
- output upload tool calls;
- need to push code or attach patch.

### Why not direct GitHub commit from Web

- requires write permission;
- risks unintended branch changes;
- conflicts with local dirty state;
- makes review artifact import inseparable from publication.

Mailbox + local importer is safer.

### Why not browser automation

- model picker and composer DOM are unstable;
- session/auth risks;
- no official contract;
- difficult to secure.

### Why not a large harness upgrade

The desired value is high-quality Web Pro review and artifact handoff,
not another automatic verification framework.

The skill remains explicitly invoked and adds no routine token/test overhead.

## 6. Expected routine overhead

When not invoked:

```text
token overhead: 0
test overhead: 0
hook latency: 0
```

When invoked:

- local discovery/prompt generation is deterministic and small;
- only one Web Pro review is performed;
- Bridge traffic is metadata/design files, not full source;
- no project test suite is automatically rerun.
