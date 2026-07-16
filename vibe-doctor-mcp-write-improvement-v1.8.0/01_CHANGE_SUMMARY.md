# Change Summary

## 1. Additive changes

| Area | Current | Change |
|---|---|---|
| Model-facing publication | `begin_result → put_result_file → finalize_result` | Add `publish_review_package` facade |
| Normal package flow | Multiple write calls | One atomic call |
| Large package flow | Always low-level | Low-level tools only after explicit fallback |
| Tool descriptions | Functional prose | `Use this when...` and negative guidance |
| Tool annotations | Must be manually inspected | Explicit, audited annotations on every tool |
| Model visibility | Implicit/default or unknown | Explicit `["model","app"]` for model tools |
| Request output | Review prompt | Add structured completion contract |
| Final completion | Chat prose may finish task | Require `status=result-ready` receipt |
| Auth | Per-server/default may be sufficient | Explicit per-tool read/write scopes |
| Diagnostics | Inspector/manual | Add `bridge_capabilities` and skill `doctor` |
| Regression testing | Handler/protocol tests | Add catalog snapshot + golden tool-selection prompts |
| Deployment | Server deploy | Deploy + ChatGPT Refresh/plugin version update |

## 2. Preserved behavior

No change to:

```text
request/result immutable identity
file path policy
hash validation
revision chain
local mailbox namespace
CLI atomic importer
GitHub read-only code review
manual user control over Web Pro session
existing low-level tools
```

## 3. Tool count after change

Recommended Web-visible catalog:

```text
create_request
create_design_request
list_pending_requests
get_request
claim_request
publish_review_package        NEW PRIMARY
begin_result                  FALLBACK
put_result_file               FALLBACK
finalize_result               FALLBACK
get_result_manifest
get_result_file
acknowledge_import
cancel_request
bridge_capabilities           NEW READ/DIAGNOSTIC
```

## 4. Compatibility

- Existing v1.8.0 clients may continue using low-level upload tools.
- Existing result manifests remain readable.
- No persisted mailbox migration is required if facade delegates to existing domain services.
- Tool metadata snapshot changes require Developer Mode Refresh or plugin republish.
