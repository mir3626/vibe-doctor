# Skill and Command Specification

## 1. `$vibe-goal-audit`

### Invocation

```text
$vibe-goal-audit
$vibe-goal-audit send
$vibe-goal-audit status
$vibe-goal-audit sync [--latest|<request-id>]
$vibe-goal-audit cancel <request-id>
```

### Default behavior

```text
pending request for current repo exists?
  result ready → sync suggestion
  still pending → status
  none → discover and send
```

### Skill phases

1. verify initialized repository;
2. resolve Goal source;
3. resolve GitHub scope;
4. generate source manifest;
5. generate review prompt;
6. publish through selected transport;
7. persist local request mirror;
8. print Web Pro invocation.

### Failure modes

```text
no coherent Goal:
  produce candidate list and reconstructed request only if confidence threshold met

no GitHub remote:
  block Web Pro GitHub mode; allow manual/API adapter only

head not visible:
  attach safe patch or request explicit branch push

bridge unavailable:
  generate manual package in .vibe/pro-bridge/outbox/
```

## 2. `$vibe-pro-design`

### Invocation

```text
$vibe-pro-design "<goal>"
$vibe-pro-design status
$vibe-pro-design sync --latest
$vibe-pro-design list
```

It uses the same bridge protocol with `kind=feature_design`.

### Web-origin sync

`sync --latest` searches remote results by:

```text
repository full name
unimported status
result kind
created time
```

## 3. Shared configuration

Project-local non-secret config:

```json
{
  "proBridge": {
    "transport": "mcp-mailbox",
    "resultRoot": "docs/plans",
    "requestTtlHours": 72,
    "maxPatchBytes": 1048576,
    "openBrowser": true,
    "copyInvocation": true,
    "githubRequired": true
  }
}
```

Secret/auth config remains outside repository or in ignored local config.

## 4. Transport selection

Priority:

```text
explicit CLI option
project local config
installed MCP app
manual-directory fallback
```

## 5. Browser handoff

Supported convenience:

- open `https://chatgpt.com/`;
- copy invocation to clipboard.

Not supported as a correctness dependency:

- DOM automation;
- auto-submit;
- model-picker automation;
- undocumented prompt query parameters.

## 6. App Server integration

Goal discovery may call a local helper that speaks App Server JSON-RPC.

If unavailable, the skill continues with durable file providers.
The bridge itself does not require App Server.

## 7. Wiring

Because the user prefers a skill-only direction:

- no new root slash command required;
- no mandatory package script;
- helper scripts live inside skill resources;
- Codex and Claude wrappers point to one shared skill source;
- optional plugin installation handles MCP tools.
