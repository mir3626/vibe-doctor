# MCP-003 — Request and Prompt Completion Contract

## Goal

Make mailbox publication part of task completion.

## Work

- add `completionContract` to `get_request`;
- update audit/design prompt templates;
- require result-ready receipt in final response;
- forbid chat-only completion;
- add missing-tool failure wording;
- cover CLI-origin and Web-origin designs.

## DoD

Generated prompts cannot validly claim completion without requestId/resultId/manifest receipt.
