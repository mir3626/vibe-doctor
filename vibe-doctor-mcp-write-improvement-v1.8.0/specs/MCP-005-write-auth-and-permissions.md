# MCP-005 — Write Authentication and Permissions

## Goal

Ensure read-linked clients can reauthorize for result writes.

## Work

- define separate read/write scopes in remote mode;
- declare per-tool security schemes;
- update protected-resource metadata;
- emit `mcp/www_authenticate` on missing write scope;
- preserve local noauth development profile;
- document app permission settings.

## DoD

A read-only token gets a proper reauthorization flow; a write token publishes successfully.
