# Astra execution contract

Applies only to the active `gpt-6-astra` (Codex) or `claude-opus-5-5` (Claude, any
context-window variant such as `[1m]`) model, or a successor explicitly marked
`harnessProfile: astra` in the model registry. Lower/unknown models use the
existing common rules. A parent's profile never grants eligibility to a child.
Native sessions may set `VIBE_ACTIVE_MODEL` (and `VIBE_ACTIVE_PROVIDER=anthropic`
for Claude) to their known active model for harness commands; clear/reselect it
when changing models. `VIBE_HARNESS_PROFILE=legacy`
is the rollback and comparison path. It cannot enable Astra for another model.

- Follow the user's current goal and higher-priority runtime instructions. Proceed
  autonomously with authorized work. Do not impose Planner/Generator/Evaluator
  roles, a `/goal` per item, creative bets, cleanup commits, LOC quotas, or fresh
  context rituals. Delegate only when the active runtime/user allows it and an
  independent subtask justifies it. Existing explicit Sprint file limits still apply.
- Ask only for a consequential missing decision or action outside authorization.
  Existing authorization persists. Settled requirements need no interview;
  retain useful init questions and honest deferred/proxy answers. A request for
  review does not authorize implementation; a request for fixes does.
- Read the relevant project/design files and current handoff on demand. State
  contract: restart state is the top current-state section of `.vibe/agent/handoff.md`
  (overwritten, one screen, refreshed at meaningful boundaries) plus the project's
  own queue documents; older handoff sections are history. `session-log.md` gets
  one-line pointers (commit hash or document path) per decision or commit.
  `sprint-status.json`, `iteration-history.json` and pendingRisks are legacy-profile
  state: do not update them, and do not read them as current. Do not synthesize
  unobserved completion. No arbitrary per-item Sprint is needed.
- Before large work unrelated to the current context, or in another repository,
  with the context about half full or more: refresh that handoff section and suggest
  a new session in one line. The user decides.
- When the user corrects a deliverable, record the rule in that repository's rule
  document (for example `RULEBOOK.md`) as well as fixing it.
- This contract overrides CLAUDE.md mechanical overrides 1-2 (separate STEP 0 cleanup
  commits, beyond-request improvements); override 3 (verify before reporting) stays.
- Select meaningful verification for the changed behavior and actual environment.
  For harness patches use `npm run vibe:verify` (or `npm test` for tests only);
  Pro Git/worktree tests run only for mapped Pro dependencies or a reported
  conservative fallback. Do not add a Pro roundtrip run to an unrelated patch.
  Add tests when a regression merits one; no per-file quota or blanket prohibition.
  Reuse a passing verification receipt only when all inputs, profile, command,
  and relevant environment match. Release validation remains full and forced.
  Windows alone does not prohibit builds, tests, installs, schemas, or subprocesses.
  Respect the real sandbox/network/permissions and preserve UTF-8.
- Keep scope tied to the goal. Refactor or remove dead code only when useful to it;
  do not force creative changes, extra commits, or expansion for file size alone.
- Resolve durable `executionBinding` before ambient Pro state. Standalone remains
  standalone; a Pro binding selects exactly its flow. Missing legacy/corrupt
  binding needs an explicit resolution, never silent attachment to ACTIVE.json.
  Keep ownership, append-only evidence, immutable hashes, approval and close
  authority, resume semantics, and project/harness sync boundaries intact.
- Optional Pro, sealed review sidecars, browser reports, and dashboards are loaded
  when requested or causally needed. Do not create/publish/open them by ceremony.
  Static keyword counts, historical regression scores, audit counters and LOC
  thresholds are advisory; absence of matches is unknown, never proof of safety
  or a reason to delete code. Audit actual risk and report concrete evidence.
- Continue until the authorized outcome is verified or a concrete blocker exists.
  Preserve user edits. State actual checks and limitations without inventing
  effective model/effort, metered usage, test success, or user approval.
