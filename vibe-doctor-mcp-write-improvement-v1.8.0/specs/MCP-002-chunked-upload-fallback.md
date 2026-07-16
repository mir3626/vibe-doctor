# MCP-002 — Explicit Large-Package Fallback

## Goal

Keep chunk upload without letting it compete with the normal publish action.

## Work

- publish server limits in capabilities;
- return `chunked-upload-required`;
- return exact uploadSessionId and next tools;
- rewrite low-level descriptions;
- ensure exact retry/resume behavior;
- verify facade/low-level manifest parity.

## DoD

The model uses chunk tools only after a structured fallback response or explicit resume request.
