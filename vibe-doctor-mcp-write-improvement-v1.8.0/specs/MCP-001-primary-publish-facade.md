# MCP-001 — Primary Review Package Publication Facade

## Goal

Add `publish_review_package` as the single normal model action for completed audit/design packages.

## Work

- locate current result upload/finalization application services;
- extract shared package validation if duplicated;
- register facade tool;
- implement atomic normal path;
- implement request ownership and idempotency;
- return exact result-ready receipt;
- retain all current low-level tools.

## DoD

A normal Web review becomes:

```text
get_request
→ publish_review_package
```

and the CLI importer reads the resulting package unchanged.
