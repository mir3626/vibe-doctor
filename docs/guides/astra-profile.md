# Astra harness profile

GPT-6 Astra uses a short execution contract in `.vibe/agent/astra-rules.md`.
Lower and unknown models retain the existing prompts and workflow obligations.
Runtime correctness and test infrastructure improvements are shared by all models.
This is workflow selection, not a security boundary or proof of model quality.

## Selection

Native agents use their runtime-confirmed active identity when selecting the
document workflow. For mechanical commands in that session, use a scoped environment:

```powershell
$env:VIBE_ACTIVE_MODEL = 'gpt-6-astra'
node .vibe/harness/scripts/vibe-preflight.mjs --json
node --import tsx .vibe/harness/src/commands/verify.ts --changed
```

Do not persist this variable globally. Clear/reselect it on model switches and
delegation. `VIBE_ACTIVE_PROVIDER` defaults to `codex`; other providers stay legacy.
The Codex wrapper instead selects its CHILD model from `-m`/`--model`, a model
configuration override, or `CODEX_MODEL`. It never inherits `VIBE_ACTIVE_MODEL`.
An ambiguous provider/profile override selects legacy. Default CLI model identity
is unknown until explicitly pinned; a registry role alias alone is not execution evidence.

`VIBE_HARNESS_PROFILE=legacy` forces the old prompt/workflow route even for Astra, for rollback
and paired comparisons. `VIBE_HARNESS_PROFILE=astra` cannot promote a lower or
unknown model. Verified successors are added explicitly as exact API IDs with
`harnessProfile: "astra"` in the existing model registry. Do not infer eligibility
from a version number or marketing label. Require a same-condition comparison
before marking a successor. Known lower tiers cannot be promoted by that flag.

Requested model/effort are recorded separately from effective values. `null`
means the provider has not confirmed the effective value. It is not billing telemetry.
The optional sidecar uses the active eligible model by default in Astra sessions;
explicit `--model` is still authoritative, and legacy sessions keep their old default.

## Changed workflow

### Delegation and assigned roles

The init delegation prompt is a receiving-session selector. It does not select
Astra from the sender's environment. The receiving agent confirms its own model;
eligible Astra reads the short contract, while lower/unknown/explicit legacy
sessions load `.claude/templates/agent-delegation-legacy.md`.

Planner, Generator and Evaluator are optional task assignments in Astra. A wrapper
invocation alone is not a Generator assignment. The coder profile lets Astra
resolve routine implementation choices; consequential scope/authority decisions
still require their owner. Planner output distinguishes confirmed requirements
from suggested implementation details and selects its handoff for the independently
pinned Generator model. Unknown children retain legacy obligations.

`vibe:run-agent --role planner` (also `generator` / `evaluator`) selects the role's
provider when `--provider` is absent. A registry-backed role, for example
`{"provider":"codex","tier":"flagship"}`, supplies the resolved model to the
canonical wrapper's `CODEX_MODEL` default; the wrapper pins that model in the actual
child arguments. Explicit provider arguments/config/env retain precedence over a
role default. String provider references do not establish a model identity.

`--model <api-id>` requests an explicit model; conflicting or ambiguous Codex
provider configuration is rejected before execution. Custom model-selected runners
must declare `{model}` in their args/env rather than relying on an assumed CLI
syntax. `--cwd` binds configuration, registry, relative prompt paths and run records
to the target checkout. Records include `roleModel` separately from the actual
invocation's requested/unknown-effective provenance.

### Counter-only audit reminders

Astra still records completed Sprint counts but does not create a blocking
Evaluator reminder from the count. Historical counter-only reminders are preserved
unchanged and treated as advisory by preflight and commit. Recognition requires
the exact automatic producer, wildcard target, reminder text and original field
set; real findings, extra evidence and ambiguous records remain blocking.
Switching to legacy restores its counter/reminder gate. No risk is auto-accepted,
resolved or deleted merely by selecting Astra.

### Common execution

Astra reads relevant context on demand, works from one durable queue, skips settled
interviews, and selects meaningful checks. Planner/Generator/Evaluator roles,
creative bets, per-file tests, cleanup commits, LOC quotas, numeric review scores,
and approval re-requests are not default obligations. Pro, sidecars and browser
reports remain optional tools. User-requested versions of these workflows still apply.

Keep initialization, scope/ownership, design decisions, handoff/session log,
checkpoint, actual result verification, UTF-8, and durable Pro execution binding.
An ambient ACTIVE.json must not attach a standalone task to a Pro flow.

Every Codex wrapper invokes Codex once. It does not replay a failed task whose side
effects may already exist. Use the native session's retry/resume mechanisms and
inspect state before a new execution. `CODEX_RETRY` and `CODEX_RETRY_DELAY` no longer
replay tasks, including in legacy mode. Astra stdin and positional prompts use UTF-8
stdin with the same short contract. Native resume/review are used directly.

## Shared infrastructure

- Bash preserves legacy Markdown injection; Windows keeps its existing prompt body
  while using shell-free child execution and preserving Unicode/metacharacters.
  Both retain child failures and respect explicit model/sandbox flags without duplicates.
- Requested versus unconfirmed effective model/effort metadata applies to all sidecars.
  Model defaults and model-specific workflow selection remain unchanged.
- Verification has one dependency manifest and discovers nested integration tests for
  every model. Missing inputs, changed scripts/documents, damaged receipts and changes
  during execution invalidate results. It never borrows a base from ambient ACTIVE.json;
  use an explicit base argument or `VIBE_VERIFY_BASE` for a bound Pro review.
- Template hygiene checks the Git shipping set, including staged files, so local user
  drafts do not fail pristine-template checks. Historical milestone/ledger assertions
  and source-function-placement assertions were removed for all models; behavior,
  ownership, migration and UI checks remain. Pure protocol hash fixtures need no Git repo.

Static preflight audits reuse a passing content-addressed result for every model; current state
and environment checks remain live. `--force-audits` reruns all static audits.
An unavailable/read-only cache falls back to executing audits; it cannot skip a failing audit.
Verification receipts are profile-separated; release verification uses `--all --force`.
Prompt wording/role-contract reductions and heuristic workflow retirement remain Astra-only.
Shared model resolution and interview kernels are behavior-preserving refactors
used by both profiles, so there is no second model registry or duplicate algorithm.

## Paired evaluation

Use the same Astra model, effort, CLI/runtime, task fixtures, tools and initial
files for legacy/reduced pairs. Start separate ephemeral sessions; do not reuse
answers from the other arm. The matrix is in `astra-eval-cases.json`. Record
outcome, scope violations, redundant approval requests, verification repetition,
elapsed time, injected bytes, and known usage separately. Use actual output/files
for scoring; keyword counts and mock process tests are insufficient.

Local contract tests cover profile eligibility/downgrade, real wrapper transport,
non-replay, cache invalidation, selection/hash dependencies, and legacy compatibility.
They do not establish live model task-success equivalence. Provider unavailability
is a live-evaluation blocker, not a failed local implementation test.
