# Tool Catalog AS-IS / TO-BE

## 1. User action mapping

| User intent | AS-IS selection | TO-BE selection |
|---|---|---|
| Review latest Goal | `list/get/claim`, review, then 3+ upload tools | `get_request`, review, `publish_review_package` |
| Save completed review | No single direct tool | Exactly one primary tool |
| Save very large package | Chunk tools | Primary tool returns explicit fallback plan |
| Check whether writing is enabled | Infer from catalog | `bridge_capabilities` |
| Diagnose missing write invocation | Inspector/manual | `$vibe-goal-audit doctor` plus Inspector |
| Finish task | Model may answer with Markdown | Must receive `result-ready` |

## 2. Required metadata by tool

| Tool | readOnly | destructive | openWorld | idempotent | Model-visible |
|---|---:|---:|---:|---:|---:|
| `list_pending_requests` | true | false | false | true | yes |
| `get_request` | true | false | false | true | yes |
| `get_result_manifest` | true | false | false | true | yes |
| `get_result_file` | true | false | false | true | yes |
| `bridge_capabilities` | true | false | false | true | yes |
| `create_request` | false | false | false | true | yes |
| `create_design_request` | false | false | false | true | yes |
| `claim_request` | false | false | false | conditional | yes |
| `publish_review_package` | false | false | false | true | yes |
| `begin_result` | false | false | false | true with client upload ID | fallback |
| `put_result_file` | false | false | false | true by chunk hash | fallback |
| `finalize_result` | false | false | false | true by manifest hash | fallback |
| `acknowledge_import` | false | false | false | true | CLI-oriented |
| `cancel_request` | false | true | false | true | explicit only |

`idempotentHint=true`는 server가 실제로 동일 argument의 추가 effect가 없음을 보장할 때만 사용한다.

## 3. Description rewrite

### `publish_review_package`

```text
Use this when a Vibe goal audit, implementation review, or feature design is
complete and the user asked to save the package for CLI import. This is the
required final publication step. Do not merely print the files in chat.
```

### `begin_result`

```text
Use this only when publish_review_package returned
chunked-upload-required, or when an existing upload session must be resumed.
Do not use it as the default publication path.
```

### `put_result_file`

```text
Use this only for an active upload session returned by
publish_review_package or begin_result. Upload exactly the requested file or
chunk and preserve the returned upload session identity.
```

### `finalize_result`

```text
Use this only after every file required by the active chunked upload has been
stored. This is the final fallback step and must return status=result-ready.
```

### `acknowledge_import`

```text
Use this after the local CLI importer has successfully installed and verified
the exact result package. Do not use it merely because a Web review finished.
```

### `cancel_request`

```text
Use this only when the user explicitly asks to cancel a non-terminal request.
Do not use it to restart, revise, or replace a review.
```

## 4. Tool profile guidance

Normal Web review should expose the full catalog but strongly prefer:

```text
get_request
publish_review_package
```

Low-level tools stay model-visible only because they are required for large-package fallback.
Their descriptions must not compete with the primary direct prompt.
