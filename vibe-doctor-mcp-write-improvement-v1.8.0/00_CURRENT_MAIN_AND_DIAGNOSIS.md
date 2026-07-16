# Current Main Assessment and Diagnosis

## 1. Reviewed state

GitHub Actions의 현재 최신 main/tag release는 다음이다.

```text
release: v1.8.0
commit:  60511059e787301216b4ece7706c4c7b1328e6a7
subject: Release v1.8.0 web pro bridge
```

본 설계는 이 release가 제공하는 hybrid 구조를 폐기하지 않는다.

보존 대상:

- CLI-origin review request
- Web-origin design request
- local/private bridge mailbox
- immutable request/result manifests
- hash-bound file chunks
- result revision
- CLI result importer
- GitHub-backed Web review
- existing low-level upload protocol

## 2. Observed tool catalog

### Read tools

```text
list_pending_requests
get_request
get_result_manifest
get_result_file
```

### Non-destructive state-changing tools

```text
create_request
create_design_request
claim_request
begin_result
put_result_file
finalize_result
acknowledge_import
```

### Destructive state-changing tool

```text
cancel_request
```

따라서 raw capability 관점에서 write handler가 전혀 없는 것은 아니다.

## 3. Root cause assessment

### Primary: model-facing action granularity mismatch

User intent:

```text
Publish the completed review package.
```

Current tool sequence:

```text
begin
→ upload every file/chunk
→ finalize
```

각 tool은 transport 관점에서는 single-purpose지만,
direct user prompt에 대응하는 **하나의 명확한 model action**이 없다.

OpenAI Apps SDK의 discovery 지침은 direct prompt마다 해당 요청을 명확하게 처리하는 tool이
정확히 하나 있는지 검토하라고 요구한다.

### Secondary: metadata selection weakness

현재 description은 주로 다음 형태다.

```text
Create...
Open...
Upload...
Validate and finalize...
```

기능 설명은 정확하지만, model discovery에 최적화된:

```text
Use this when...
Do not use when...
This is the required final step...
```

계약이 약하다.

### Secondary: annotations/visibility uncertainty

UI에 표시된 name/description만으로는 다음 raw descriptor를 알 수 없다.

```text
annotations.readOnlyHint
annotations.destructiveHint
annotations.openWorldHint
annotations.idempotentHint
_meta.ui.visibility
securitySchemes
outputSchema
```

이 값이 누락 또는 잘못 설정되면:

- write confirmation flow가 부정확해지거나
- model이 tool을 read-only로 오인하거나
- tool이 app UI에는 보이지만 model에는 보이지 않거나
- write OAuth reauthorization이 시작되지 않을 수 있다.

### Secondary: completion semantics not protocol-visible

Review prompt가 mailbox write를 언급하더라도,
`get_request` output과 final tool output에 completion contract가 구조화되어 있지 않으면
모델은 Markdown chat response를 task completion으로 판단할 수 있다.

## 4. Why a generic `write` tool is not required

MCP/Apps SDK에서 tool 이름이 반드시 `write`일 필요는 없다.

Write semantics는 다음으로 표현한다.

```text
action-specific tool name
+ readOnlyHint=false
+ destructiveHint
+ openWorldHint
+ security scope
+ permission confirmation
```

따라서 해결책은 generic `write` tool이 아니라
domain action에 맞는 `publish_review_package`다.

## 5. Immediate workaround before code changes

현재 tool set으로도 generated prompt를 다음처럼 강제하면 성공률을 높일 수 있다.

```text
1. get_request
2. GitHub review
3. begin_result
4. put_result_file for every required file
5. finalize_result
6. Do not answer finally until status=result-ready
```

그러나 이는 prompt-dependent workaround이며,
장기 해결책은 high-level facade와 metadata 개선이다.
