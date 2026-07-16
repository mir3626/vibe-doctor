# Metadata, Authentication, and Permission Specification

## 1. Explicit annotations

Every registered tool must declare:

```ts
annotations: {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
  idempotentHint?: boolean;
}
```

Do not rely on client defaults.

## 2. Model visibility

Every model-invoked tool:

```ts
_meta: {
  ui: {
    visibility: ['model', 'app']
  }
}
```

A tool with:

```text
visibility=['app']
or
openai/visibility='private'
```

must not be required by a model-only Web workflow.

## 3. Structured outputs

Every tool returning `structuredContent` must have an exact `outputSchema`.

Important follow-up fields:

```text
requestId
resultId
uploadSessionId
status
manifestSha256
requiredNextTools
```

The model must not parse these only from prose.

## 4. OAuth profiles

### Local no-auth development

Permitted only when:

- endpoint is private/local tunnel;
- mailbox is local single-user;
- no cross-tenant data exists.

Tool metadata may use:

```ts
securitySchemes: [{ type: 'noauth' }]
```

### Remote/authenticated mode

Recommended scopes:

```text
bridge.request.read
bridge.request.write
bridge.result.read
bridge.result.write
bridge.import.ack
```

Normal Web review needs:

```text
bridge.request.read
bridge.result.write
```

CLI importer needs:

```text
bridge.result.read
bridge.import.ack
```

## 5. Reauthorization

When a linked token lacks write scope, the handler must return an MCP OAuth challenge with:

```text
error=insufficient_scope
error_description=bridge.result.write is required
```

The following must all be present:

1. OAuth protected resource metadata
2. per-tool `securitySchemes`
3. runtime `_meta["mcp/www_authenticate"]`

A plain HTTP 403 or prose error is insufficient for ChatGPT linking UI.

## 6. Permission classification

Private mailbox publication:

```text
readOnlyHint: false
destructiveHint: false
openWorldHint: false
```

Rationale:

- creates private user-owned result state;
- does not overwrite/delete;
- does not publish outside the user's account.

`cancel_request`:

```text
readOnlyHint: false
destructiveHint: true
openWorldHint: false
```

## 7. Catalog audit

Add a deterministic test that loads raw registered tool descriptors and checks:

```text
every tool has annotations
every structured tool has outputSchema
write tools are not readOnly
cancel is destructive
normal writes are non-destructive
required Web tools are model-visible
write tools declare write auth where configured
descriptions begin with "Use this when"
low-level descriptions contain fallback restriction
```

Commit a canonical catalog snapshot for review, not as runtime authority.
