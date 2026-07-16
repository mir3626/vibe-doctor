# Completion Contract and Prompt Specification

## 1. Problem

A review can be analytically complete but operationally incomplete.

```text
GitHub review complete
Markdown generated in chat
Bridge result not finalized
CLI cannot sync
```

The protocol must define publication as part of task completion.

## 2. `get_request` structured output

Add:

```ts
type ReviewCompletionContract = {
  publicationRequired: true;
  primaryFinalTool: 'publish_review_package';
  requiredFinalStatus: 'result-ready';
  normalPackageMaxBytes: number;
  requiredFiles: string[];
  fallback: {
    triggerStatus: 'chunked-upload-required';
    tools: ['put_result_file', 'finalize_result'];
  };
  chatOnlyOutputCompletesRequest: false;
};
```

`get_request` returns:

```ts
{
  request: ...,
  reviewPrompt: ...,
  completionContract: ReviewCompletionContract
}
```

## 3. Generated Web prompt

Mandatory final section:

```text
## Mandatory publication contract

This task is incomplete until the result package is published through
Vibe Pro Bridge.

After completing the GitHub-backed review:

1. Generate every required result file.
2. Call `publish_review_package`.
3. Do not finish by only printing Markdown in chat.
4. Do not send the final user response until the tool returns:
   status = "result-ready"
5. If the tool returns `chunked-upload-required`, upload every requested
   file/chunk and call `finalize_result`.
6. The final response must include requestId, resultId, proposedFolder,
   and resultManifestSha256.

If the publication tool is unavailable, report that the Bridge app tool
surface is incomplete. Do not claim the request is complete.
```

## 4. Final response contract

Success response from Web reviewer:

```text
Review package published.

requestId: ...
resultId: ...
folder: ...
manifest: ...
status: result-ready
```

The model may summarize findings after these fields, but not instead of them.

## 5. Negative behavior

The prompt must prohibit:

- writing only Markdown in chat;
- claiming success after `begin_result`;
- omitting required files;
- using `acknowledge_import` before CLI import;
- cancelling and recreating a request to avoid a conflict;
- silently switching repository/head;
- pushing to GitHub.

## 6. New feature design

`create_design_request` and Web-origin design use the same completion contract.

The only difference is required core document:

```text
DESIGN.md instead of REVIEW.md
```

## 7. Prompt size

Do not embed all code or full repository diffs.

Include:

- repository
- exact refs
- Goal/design manifest
- scope hints
- review requirements
- completion contract

GitHub remains the source reader.
