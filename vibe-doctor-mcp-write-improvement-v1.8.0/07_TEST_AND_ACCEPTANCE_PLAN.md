# Test and Acceptance Plan

## 1. Handler tests

### Normal package

- five required files;
- valid paths;
- exact request/head binding;
- one result-ready manifest;
- same call is idempotent;
- no partial result state.

### Invalid package

- missing required file;
- path traversal;
- absolute path;
- unsupported media type;
- invalid UTF-8;
- repository/head mismatch;
- same publication ID with different content;
- already finalized different result.

### Limits

- exactly at byte/file limit;
- over total size returns chunked plan;
- over single-file size returns chunked plan;
- requiredNextTools are exact.

## 2. Low-level compatibility tests

Existing v1.8.0 flow remains valid:

```text
begin_result
→ put_result_file
→ finalize_result
```

Test:

- current clients continue working;
- facade and low-level path create equivalent manifests;
- revisions remain valid;
- CLI importer reads both.

## 3. Tool catalog tests

For every tool:

- annotations exist;
- read/write classification correct;
- destructive classification correct;
- model visibility correct;
- exact output schema;
- auth schemes correct;
- descriptions start with `Use this when`;
- fallback tools state the prerequisite.

## 4. OAuth tests

- read token can get request;
- read token cannot publish;
- insufficient scope returns MCP auth challenge;
- reauthorized write token publishes;
- wrong audience/tenant rejected;
- local noauth profile stays local-only.

## 5. Completion contract tests

`get_request` contains:

```text
publicationRequired=true
primaryFinalTool=publish_review_package
requiredFinalStatus=result-ready
chatOnlyOutputCompletesRequest=false
```

Generated prompt includes the same invariant.

## 6. Golden prompt matrix

### Direct — must publish

```text
Review request AUD-123 and save the completed package for CLI import.
```

Expected:

```text
get_request
publish_review_package
```

### Indirect — must publish

```text
Finish this Vibe review and make the result available to my CLI.
```

Expected: primary publish tool selected.

### Explicit low-level — fallback only

```text
Resume upload session UPL-123 using the returned chunk plan.
```

Expected: low-level upload tools.

### Negative — must not publish

```text
Explain what request AUD-123 is asking for.
```

Expected: read only.

### Cancel — destructive confirmation

```text
Cancel request AUD-123.
```

Expected: `cancel_request`, not publish.

## 7. Developer Mode acceptance

Run at least:

```text
10 direct prompts
10 indirect prompts
10 negative prompts
```

Targets:

```text
direct publication recall:    100%
negative false publication:   0%
normal publish completion:    100%
normal median write calls:    1
partial result visibility:    0
```

## 8. End-to-end dogfood

```text
CLI creates Goal audit request
→ Web attaches GitHub + Vibe Pro Bridge
→ get_request
→ review exact GitHub range
→ publish_review_package
→ result-ready receipt
→ CLI sync
→ docs/plans/<folder>
→ acknowledge_import
```

Assert:

- required files exist;
- hashes reconcile;
- imported prompt exists;
- no manual download/copy;
- no GitHub write;
- no duplicate result.

## 9. Metadata refresh test

- deploy catalog v2;
- before Refresh, old tool list observed;
- Refresh app;
- new tool list observed;
- new conversation selects publish tool.

## 10. CI

Add focused commands such as:

```text
vibe:pro-bridge-tool-audit
vibe:pro-bridge-self-test
```

Do not add routine project test overhead to downstream Stop hooks.
Upstream CI should run the focused tests.
