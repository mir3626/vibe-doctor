# Rollout and Compatibility

## 1. Release

Recommended upstream release:

```text
v1.8.1
```

Reason:

- additive tool;
- description/metadata improvements;
- existing request/result protocol retained;
- no expected mailbox data migration.

## 2. Rollout stages

### Stage A — Local/Inspector

- add facade;
- catalog audit;
- handler tests;
- Inspector direct calls.

### Stage B — Developer Mode dogfood

- deploy server;
- Refresh app;
- direct/indirect/negative prompts;
- test OAuth confirmation.

### Stage C — Skill prompt update

- add completion contract;
- add expected catalog version;
- add `doctor`;
- run real Goal audit.

### Stage D — Published plugin

If distributed as a plugin:

- scan updated metadata;
- submit/publish new plugin version;
- document compatibility.

## 3. Backward compatibility

Existing tools stay registered for at least one minor release.

Deprecation notice may be added later:

```text
begin_result is fallback-only as of tool catalog v2
```

Do not remove low-level tools until:

- large package facade exists or fallback is proven;
- downstream clients are upgraded;
- telemetry shows no unsupported usage.

## 4. Storage compatibility

Facade must produce the same result manifest schema expected by the current importer.

No backfill is required.

## 5. Failure rollback

Rollback:

- disable `publish_review_package` registration;
- restore catalog v1 metadata;
- low-level tools continue working;
- no result data deleted.

## 6. Documentation

Update:

- Vibe Pro Bridge setup
- ChatGPT Developer Mode setup
- tool list
- app Refresh procedure
- permissions
- doctor troubleshooting
- normal and large package examples
- release notes

## 7. Residual limitations

- MCP cannot prove which exact Web model picker was selected.
- Model tool selection remains probabilistic; golden prompt regression reduces risk.
- Very large result packages still need multiple tool calls.
- ChatGPT app metadata may remain stale until user Refresh or plugin republish.
