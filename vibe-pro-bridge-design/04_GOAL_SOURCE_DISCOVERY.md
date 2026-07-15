# Goal Source Discovery

## 1. GoalSourceManifest

```ts
type GoalSourceManifest = {
  schemaVersion: 'vibe-goal-source-v1';
  repository: {
    root: string;
    remoteUrl: string | null;
    fullName: string | null;
  };
  source: {
    kind:
      | 'codex-goal'
      | 'vibe-goal-iterate'
      | 'handoff-reconstruction'
      | 'git-reconstruction';
    confidence: 'exact' | 'high' | 'reconstructed';
    threadId: string | null;
    iterationId: string | null;
    goalText: string;
    goalStatus: string | null;
  };
  designRefs: string[];
  implementationRefs: string[];
  baseSha: string;
  headSha: string;
  commitShas: string[];
  scope: {
    changedFiles: string[];
    codeFiles: string[];
    testFiles: string[];
    migrationFiles: string[];
    docsFiles: string[];
    scopeGlobs: string[];
  };
  dirtyState: {
    staged: string[];
    unstaged: string[];
    untracked: string[];
    patchSha256: string | null;
  };
  unresolved: string[];
  payloadSha256: string;
};
```

## 2. Codex App Server provider

Algorithm:

1. start/connect to App Server in read-only integration mode;
2. list stored threads;
3. filter by repository cwd and persisted gitInfo;
4. rank by updated turn/goal time;
5. call `thread/goal/get`;
6. call `thread/read(includeTurns=true)` only for the selected candidate;
7. extract goal text, user-approved plan/design references and completion summary.

Do not parse private model reasoning.
Use user messages, goal metadata, tool results and committed artifacts.

## 3. vibe-goal-iterate provider

Inspect:

```text
.vibe/agent/handoff.md
.vibe/agent/session-log.md
.vibe/agent/iteration-history.json
.vibe/agent/sprint-status.json
docs/plans/sprint-roadmap.md
docs/plans/archive/roadmaps/*
.vibe/archive/prompts/*
docs/prompts/*
```

Identify the most recent coherent goal/iteration with:

- planned item roster;
- completed/deferred/blocked status;
- prompt paths;
- commit timestamps;
- base and terminal commit.

## 4. Git reconstruction provider

Fallback only.

Heuristics:

- latest checkpoint before contiguous implementation commits;
- commit subjects and body;
- design docs referenced by commits;
- changed file clustering;
- session-log timestamps;
- last user-goal marker.

The result must be marked `reconstructed`.
The Pro review prompt must explicitly mention ambiguities.

## 5. Scope correctness

`code scope` is not only `git diff --name-only`.

Include:

```text
direct changed files
callers/importers of changed public contracts
composition/wiring files
schema/migrations
runtime scripts/jobs
tests and fixtures
design/acceptance docs
```

Generate two scopes:

```text
diffScope
reviewExpansionHints
```

Web Pro remains authorized to inspect additional related code through GitHub.

## 6. Dirty and unpushed state

The skill must never assume Web GitHub can see local-only code.

It records:

```text
remote contains HEAD?
tracking branch?
unpushed commits?
dirty files?
```

Default policies:

- no automatic push;
- secret-like files never uploaded;
- untracked content excluded unless the skill explicitly determines it belongs to scope and is safe;
- optional patch attachment has file roster, size limits and SHA-256.
