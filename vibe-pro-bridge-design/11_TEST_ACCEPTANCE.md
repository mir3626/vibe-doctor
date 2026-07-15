# Test and Acceptance Plan

## 1. Goal discovery

Fixtures:

- active Codex `/goal`;
- completed persisted Codex Goal;
- vibe-goal-iterate completed queue;
- multiple recent iterations;
- missing App Server;
- handoff reconstruction;
- dirty/unpushed branch;
- unrelated recent commits.

Assertions:

- correct objective;
- correct base/head;
- correct design refs;
- code/test/migration scope classification;
- confidence level;
- no private reasoning extraction.

## 2. GitHub scope

- remote contains head;
- local-only commits;
- detached HEAD;
- no origin;
- private repository;
- secret file in dirty diff;
- oversized patch;
- binary file;
- safe untracked design file.

## 3. Prompt composer

- exact repo/refs;
- GitHub usage mandatory;
- original design present;
- full workflow review dimensions present;
- output paths present;
- Bridge submission instructions present;
- bounded prompt size.

## 4. MCP bridge

- OAuth tenant isolation;
- create idempotency;
- claim race;
- chunk ordering;
- duplicate chunk;
- missing chunk;
- file hash mismatch;
- result finalize;
- expiry/cancel;
- ack import;
- revision chain.

## 5. Result importer

- path traversal;
- absolute path;
- invalid UTF-8;
- unexpected media type;
- repository mismatch;
- reviewed SHA mismatch;
- existing folder conflict;
- same-result no-op;
- atomic failure before rename;
- required prompt missing;
- FINDINGS parse failure.

## 6. End-to-end mock

```text
CLI discover Goal
→ create request
→ mock Web client gets request
→ mock GitHub review
→ submit 5-file result
→ CLI sync
→ docs/plans/<folder> exists
→ prompt exists and hashes reconcile
```

## 7. Web developer-mode dogfood

Manual acceptance:

1. connect Vibe Pro Bridge app;
2. connect GitHub repository;
3. create goal audit request;
4. Web Pro fetches request;
5. reviewer cites GitHub code;
6. result is submitted;
7. CLI imports without download;
8. second import is no-op.

## 8. Web-origin design dogfood

1. start design in Web;
2. create result package;
3. CLI lists pending result;
4. sync to current repo;
5. implementation prompt is usable.

## 9. Optional adapters

### Workspace Agent

- duplicate trigger idempotency;
- Bridge status becomes ready;
- no dependence on API response retrieval.

### Responses API

- explicit opt-in;
- same result schema;
- tool failure does not produce result-ready.

## 10. Acceptance

```text
manual file download/move required = 0
automatic Git push = 0
repository source mirrored to bridge = 0
result path escape = 0
request/result hash mismatch accepted = 0
Web-origin and CLI-origin use same importer = true
```
