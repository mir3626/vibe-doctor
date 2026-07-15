# Result Package and Import Specification

## 1. Folder naming

`proposedFolder`:

```text
^[a-z0-9][a-z0-9-]{2,79}$
```

Recommended:

```text
YYYY-MM-DD-<goal-slug>-pro-review
YYYY-MM-DD-<feature-slug>-design
```

## 2. Allowed paths

Only:

```text
README.md
REVIEW.md
DESIGN.md
FINDINGS.json
source/**
design/**
specs/**
prompt/**
.bridge/**
```

Reject:

- absolute paths;
- `..`;
- symlink payloads;
- executable/binary files;
- paths outside the proposed folder.

## 3. Required implementation prompt

```text
prompt/CLI_MAIN_SESSION_PROMPT.md
```

It must include:

- repository and reviewed SHA;
- mandatory reading;
- implementation order;
- immutable boundaries;
- prohibited operations;
- exact verification;
- stop condition;
- final report requirements.

## 4. Validation

Before install:

```text
request/result hash binding
repository full name matches current origin
reviewed head matches request
file roster complete
per-file SHA valid
UTF-8 valid
size/count within limits
required files present
FINDINGS.json parses
prompt non-empty
```

## 5. Atomic installation

```text
download to .vibe/pro-bridge/cache/<id>/
validate
write docs/plans/.tmp-<id>/
fsync where supported
rename to final folder
write import receipt
acknowledge Bridge
```

## 6. Existing folder

Rules:

```text
same result hash:
  no-op

different result hash:
  refuse overwrite
  install as <folder>-rev2 only with explicit user approval
```

## 7. Provenance

`.bridge/provenance.json`:

```text
request ID
request hash
result hash
reviewed base/head
imported at
transport
review surface declaration
GitHub connector declaration
limitations
```

## 8. Next action

After import, the skill prints:

```text
Read:
  docs/plans/<folder>/README.md

Start implementation with:
  docs/plans/<folder>/prompt/CLI_MAIN_SESSION_PROMPT.md
```

It does not automatically start implementation.
