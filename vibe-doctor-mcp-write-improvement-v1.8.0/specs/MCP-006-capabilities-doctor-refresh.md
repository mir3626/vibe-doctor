# MCP-006 — Capability Handshake, Doctor, and Refresh

## Goal

Make stale app metadata and catalog mismatch immediately diagnosable.

## Work

- add `bridge_capabilities`;
- version tool catalog;
- add `$vibe-goal-audit doctor`;
- verify raw annotations/schema/auth;
- add generated handoff warning when catalog is stale;
- document Developer Mode Refresh and plugin republish.

## DoD

The CLI identifies a missing primary publish tool before the user starts a long review.
