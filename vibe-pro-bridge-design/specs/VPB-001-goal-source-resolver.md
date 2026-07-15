# VPB-001 — Goal Source Resolver

## Objective

Resolve the most recent coherent implementation Goal and its original design/code scope.

## Deliverables

- `GoalSourceManifest` schema/resource
- App Server provider
- vibe-goal-iterate provider
- handoff/history provider
- Git reconstruction fallback
- scope classifier
- confidence and unresolved fields

## Rules

- do not expose private reasoning;
- no automatic push;
- dirty state is explicit;
- base/head must be immutable SHA;
- reconstructed sources are labeled.

## DoD

Fixtures for `/goal` and vibe-goal-iterate produce correct source manifests and changed scope.
