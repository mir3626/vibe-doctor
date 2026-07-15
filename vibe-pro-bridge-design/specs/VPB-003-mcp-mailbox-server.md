# VPB-003 — MCP Mailbox Server

## Objective

Provide a secure bidirectional request/result mailbox usable by ChatGPT Web and Codex.

## Deliverables

- OAuth tenant model
- MCP tools
- request lifecycle
- chunked result upload
- immutable manifests/hashes
- expiry/cancel/import acknowledgement
- encrypted artifact storage

## DoD

Concurrent claim/upload, cross-tenant, path traversal, hash mismatch and expiry tests pass.
