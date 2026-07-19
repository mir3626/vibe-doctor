# Web Pro Bridge Bootstrap

Use this file when a Web ChatGPT Pro session starts a repository review or
design without a CLI-generated prompt.

## Fixed policy

- Exchange branch: `vibe-pro-bridge`
- Default timezone: `Asia/Seoul`
- Protocol root: `protocol/v1`
- Archive root: `flows/YYYYMMDD/NNN-slug`

## Mandatory transport

MUST use only the GitHub app's exact repository/ref fetch, compare, list, and
create-file actions for repository work. MUST NOT use Web Search, browser search,
generic search results, URL browsing, or the GitHub search index to locate files
or infer branch state. MUST NOT fall back to a default branch when another ref
is required.

Do not create a branch, PR, issue, tag, or release. Do not update, delete, rename,
or overwrite a completed bridge path. Keep every GitHub write confirmation
visible.

## Start or continue

1. Resolve the repository from the user's `@GitHub` target.
2. Fetch this file again from the exact bound code ref.
3. Fetch `protocol/v1/PROTOCOL.json` from `vibe-pro-bridge`.
4. Fetch every protocol file declared by that manifest, including
   `WEB-RUNBOOK.md`, `COMMON-HARNESS.md`, and JSON schemas.
5. Resolve the single immutable commit that added the protocol files. Stop with
   `PROTOCOL_BOOTSTRAP_REQUIRED` when any file or exact commit is unavailable.
6. Follow `WEB-RUNBOOK.md` without weakening its rules.

If the user names an existing `flows/...` path, continue that flow. Otherwise a
request such as “review this project”, “review work since commit X”, or “find
changes/improvements” starts a new Pro-origin review-to-design flow:

- Use the explicitly named code branch, or fetch the repository's actual default
  branch when the user omitted one.
- Resolve every named commit to a full SHA.
- For “since commit X”, bind the review range from X to the current branch HEAD.
- Create `FLOW.json`, the Pro goal event, and the detailed design event according
  to the pinned Web runbook.
- Derive a concise 3–60 character ASCII slug from the review goal.
- Re-read the daily directory immediately before allocating its sequence.
- Create payload files first and each `COMPLETE.json` last.

Finish by reporting the flow path, code base/head, protocol commit, created
event IDs, GitHub commit/blob receipts, unavailable paths, and the exact next
actor. Do not return a design that exists only in chat.
