# End-to-End Workflows

## A. Last Goal Audit — CLI origin

### Step A1 — Discover

`$vibe-goal-audit`가 최근 Goal 후보를 수집한다.

Priority:

```text
1. current/last Codex App Server thread Goal
2. latest vibe-goal-iterate durable state
3. latest handoff + iteration + archived prompt set
4. Git commit/log reconstruction
```

### Step A2 — Freeze source manifest

```text
Goal objective
original design refs
implementation item refs
base/head SHA
commit roster
changed files
scope globs
uncommitted patch status
discovery confidence
```

### Step A3 — Validate GitHub visibility

Cases:

```text
HEAD pushed, clean:
  github-range

local commits not pushed:
  github-base + patch attachment
  또는 user-approved review branch push

dirty worktree:
  github-range + secret-safe patch attachment
```

No implicit push.

### Step A4 — Publish request

Bridge request includes:

```text
repo full name
base/head refs
source manifest
review prompt
output contract
optional patch hash
```

### Step A5 — Web review

User opens ChatGPT Web, selects Pro mode and Developer Mode tool:

```text
@Vibe Pro Bridge review <request-id>
```

The app returns request instructions.
Reviewer uses GitHub app to inspect the live repository and requested refs.

### Step A6 — Submit result

Web reviewer writes the package via MCP tools:

```text
begin_result
put_result_file × N
finalize_result
```

### Step A7 — Local sync

```text
$vibe-goal-audit sync --latest
```

Importer validates and installs files atomically.

---

## B. New Feature Design — CLI origin

```text
$vibe-pro-design "Goal text"
→ repository/context manifest
→ Bridge request(kind=feature_design)
→ Web Pro GitHub research/design
→ result package
→ CLI sync
```

Output includes implementation prompt but no code modification.

---

## C. New Feature Design — Web origin

In Web Pro:

```text
@Vibe Pro Bridge create design package
repository: owner/repo
branch/head: ...
goal: ...
```

The reviewer:

1. inspects GitHub;
2. creates a web-origin request;
3. submits the result package.

In CLI:

```text
$vibe-pro-design sync --latest
```

The CLI finds the newest unimported result matching the current repository identity.

---

## D. Optional Fully Automated Workspace Agent

```text
CLI create request
→ Workspace Agents trigger(request id)
→ agent uses GitHub + Bridge MCP
→ result submitted to Bridge
→ CLI polls/syncs
```

The trigger API response itself is not the completion source.
Bridge status is authoritative.

---

## E. Optional API Review

```text
CLI create request
→ Responses API adapter
→ GitHub/MCP tools
→ structured result
→ same importer
```

This uses the same request/result schemas.
