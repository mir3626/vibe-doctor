# GitHub Scope and Prompt Specification

## 1. Why GitHub is mandatory

The request prompt does not embed the entire repository.

It embeds:

```text
repository identity
base/head SHA
commit roster
changed file roster
original design refs
scope expansion hints
review questions
```

The Web reviewer uses ChatGPT's GitHub connection to inspect source directly.

## 2. GitHub availability gate

Before publishing request:

```text
repository full name resolved
base commit available remotely
head commit available remotely OR patch attached
authorized repository reminder present
```

If the repository is private, the user must authorize it in ChatGPT GitHub settings.

## 3. Patch attachment

Used for:

- unpushed commits;
- staged/unstaged changes;
- safe untracked files in scope.

Rules:

```text
unified diff
max total size configurable
binary content omitted
secret paths omitted
unsafe control characters rejected
file roster and SHA included
```

Review prompt instructs:

```text
Use GitHub for base repository and call graph.
Apply the attached patch conceptually for local-only changes.
```

## 4. Review prompt template

Sections:

```text
A. Role and review objective
B. Repository and exact refs
C. Original Goal/design manifest
D. Implementation item/commit scope
E. Required workflow reconstruction
F. Review dimensions
G. Required output package
H. Bridge submission instructions
I. Safety and limitations
```

## 5. Mandatory review dimensions

For goal audit:

- implementation versus original design;
- end-to-end workflow and missing seams;
- persistence/materialization;
- authority and temporal ordering;
- cache/warm/cold parity;
- concurrency/retry/restart;
- provenance and identity;
- operational scheduling;
- migration/rollback;
- observability;
- tests that exist versus tests that are missing;
- public/shadow/forbidden side effects.

For new feature design:

- current architecture fit;
- reuse versus new abstraction;
- data contracts;
- workflow and failure modes;
- implementation sequence;
- tests and acceptance;
- migration/rollback;
- downstream compatibility.

## 6. Required output contract

At minimum:

```text
README.md
REVIEW.md or DESIGN.md
FINDINGS.json
source/GOAL_SOURCE_MANIFEST.json
specs/*.md
prompt/CLI_MAIN_SESSION_PROMPT.md
```

Large designs should add `design/*.md`.

## 7. Evidence

Review files should reference:

```text
repository path
symbol/module
commit SHA
reasoning connection
```

Line references are desirable but not required when connector output cannot preserve stable line numbers.
