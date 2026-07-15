# Agent Handoff — Vibe Pro Bridge

## Target

`mir3626/vibe-doctor` at or after `f2f9512aeee62f0d13537e8b5fe99c8947a4bdd5`.

## User intent

Keep vibe-doctor lightweight and add explicit skills that bridge:

```text
Codex CLI
↔ ChatGPT Web Pro
↔ GitHub
↔ docs/plans result packages
```

## Core design decision

Use a shared MCP mailbox, not browser automation or direct GitHub writes.

## Required skills

```text
vibe-goal-audit
vibe-pro-design
```

## Implementation order

1. Goal discovery and local/manual transport
2. Review request composer and result importer
3. Remote MCP mailbox
4. ChatGPT developer-mode app and Codex plugin
5. Web-origin design
6. Optional automation adapters

## Hard constraints

- no new hook;
- no Stop QA change;
- no Sprint completion gate;
- no automatic Git push;
- no GitHub write permission;
- no source repository mirroring;
- no automatic implementation after import;
- no undocumented ChatGPT browser automation.

## Release posture

This can be a focused minor/feature release, but keep core harness changes small.
The remote bridge/plugin may be versioned separately.

## Final verification

Demonstrate:

```text
last Goal discovered
request created
Web Developer Mode app reads it
GitHub repo used
result submitted
CLI imports into docs/plans
prompt file exists
manual file transfer count = 0
```
