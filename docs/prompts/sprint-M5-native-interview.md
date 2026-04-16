# Sprint M5 — Native socratic interview (Ouroboros replacement)

> Generator prompt. Addressed to Codex. Execute scope items in order. Do not expand scope.
> Read `.vibe/agent/_common-rules.md` first. Windows + Unix parity required.
> This sprint does NOT introduce any new runtime dependencies. Pure Node 24+ built-ins only.

---

## Prior

M1 established `sprint-status.json` schema + `src/lib/sprint-status.ts` helpers.
M2 added platform wrappers + `--health` subcommand + sandbox invariants.
M3 shipped `vibe-sprint-commit.mjs` + `vibe-session-log-sync.mjs` + prompts archival + `project-decisions.jsonl`.
M4 shipped model-tier registry (`.vibe/model-registry.json`), `src/lib/model-registry.ts`, `scripts/vibe-resolve-model.mjs`, `vibe-model-registry-check.mjs` SessionStart hook, and preflight wrapper generalization. 82 pass + 1 skip.

**Flagged risks carried into M5**:
- **M4 risk A** — registry load at interview engine boot: call `loadRegistry()` exactly **once per `vibe-interview.mjs` process** and stash the result; do NOT reload per round or per dimension.
- **M4 risk B** — `.mjs` port drift. This sprint does not re-port registry logic (it consumes the M4 resolver CLI via child process, not an inline reimplementation), so no new drift fixtures are needed. Follow the M4 precedent comment style if any helper is duplicated.

---

## Goal (CRITICAL — read twice)

Replace Ouroboros (Python / MCP) with a native vibe-doctor interview engine that produces interviews **of equal or better domain-expert depth**. The benchmark: when the user gives a one-liner like *"부동산 재계약시 공인중개사가 아닌 행정사와 진행해야하는데 사용자와 행정사를 매칭해줄 수 있는 웹사이트"*, the engine must surface questions a **layperson could not author** — e.g., 변호사법 vs 행정사법 vs 공인중개사법 권한 경계, 전월세 갱신거절 통지 기한, 계약 특약 조항, 분쟁 발생 시 에스크로 처리 — by delegating question synthesis to the Orchestrator LLM (Claude Opus) under a carefully engineered expert-interviewer prompt contract.

Generic "what is your target user / tech stack?" output is **non-acceptance**. This is the single most important sprint of v1.2.0.

### Architectural thesis

Three decoupled layers:

1. **Rubric backbone** (static, domain-agnostic): 10 universal dimensions with weights + optional sub-fields. Portable across any project domain.
2. **Question synthesizer** (dynamic, LLM-driven): the hero artifact — a prompt template that instructs the Orchestrator LLM to act as a domain-expert PM/interviewer for the **inferred domain**, producing probing questions that require domain knowledge to author.
3. **Interview engine** (`scripts/vibe-interview.mjs`): state machine + coverage tracker + ambiguity formula. **Hosts no LLM itself** — orchestrates the Orchestrator as the LLM host via a structured stdin/stdout handoff protocol.

---

## Scope (produce exactly these files)

### 1. `.claude/skills/vibe-interview/dimensions.json` (NEW, harness tier)

Rubric backbone. Shape:

```json
{
  "$schema": "./dimensions.schema.json",
  "schemaVersion": 1,
  "dimensions": [
    {
      "id": "goal",
      "label": "프로젝트 목표 / 한 줄 정의",
      "weight": 1.0,
      "subFields": ["one_liner", "primary_value"],
      "required": true
    },
    {
      "id": "target_user",
      "label": "핵심 사용자 및 이해관계자",
      "weight": 0.9,
      "subFields": ["primary_persona", "secondary_stakeholders", "user_scale"],
      "required": true
    },
    {
      "id": "platform",
      "label": "플랫폼 / 배포 대상",
      "weight": 0.7,
      "subFields": ["platform_type", "runtime_constraints"],
      "required": true
    },
    {
      "id": "data_model",
      "label": "주요 도메인 엔티티 및 관계",
      "weight": 0.9,
      "subFields": ["entities", "key_relations", "invariants"],
      "required": true
    },
    {
      "id": "primary_interaction",
      "label": "핵심 사용자 시나리오",
      "weight": 0.9,
      "subFields": ["happy_path", "failure_paths"],
      "required": true
    },
    {
      "id": "success_metric",
      "label": "성공 기준 / 측정 지표",
      "weight": 0.8,
      "subFields": ["acceptance_criteria", "kpi"],
      "required": true
    },
    {
      "id": "non_goals",
      "label": "v1 의도적 제외 (non-goals)",
      "weight": 0.5,
      "subFields": [],
      "required": false
    },
    {
      "id": "constraints",
      "label": "법·규제·비용·보안 제약",
      "weight": 0.8,
      "subFields": ["legal_regulatory", "budget", "security_privacy"],
      "required": true
    },
    {
      "id": "tech_stack",
      "label": "기술 스택 선호·제약",
      "weight": 0.6,
      "subFields": ["language_runtime", "framework", "datastore", "hosting"],
      "required": false
    },
    {
      "id": "domain_specifics",
      "label": "도메인 특화 이슈 (전문가 probing)",
      "weight": 1.0,
      "subFields": [],
      "required": true
    }
  ]
}
```

Weights are intent signals; the engine normalizes them. `subFields: []` means "free-form — counted as covered if any non-empty content is attributed". `required: false` still contributes to ambiguity but with its listed weight; `required: true` dimensions additionally block termination if coverage is 0.

### 2. `.claude/skills/vibe-interview/dimensions.schema.json` (NEW, harness tier)

JSON Schema draft-07. Required: `schemaVersion` (const 1), `dimensions` (array, minItems 8). Each dimension: `id` (string, slug-ish), `label` (string), `weight` (number, 0..1), `subFields` (array of strings), `required` (boolean). `additionalProperties: false`.

### 3. `.claude/skills/vibe-interview/SKILL.md` (NEW, harness tier)

Step-by-step runbook for the Orchestrator. Must include:
- **When to invoke**: Phase 3 of `/vibe-init` (replaces Ouroboros MCP calls).
- **Invocation protocol** (verbatim):
  1. Ask the user for a one-liner prompt.
  2. `node scripts/vibe-interview.mjs --init --prompt "<one-liner>" [--lang ko|en] [--max-rounds 30] [--output .vibe/interview-log/<session-id>.json]`. Script returns JSON to stdout: `{ phase: "domain-inference", inferencePrompt: "<string>" }`.
  3. Orchestrator internally evaluates `inferencePrompt` against its own LLM context (no external call — Orchestrator IS Claude Opus), produces `inferred_domain` (1-2 sentence string).
  4. `node scripts/vibe-interview.mjs --set-domain --domain "<inferred_domain>"` → returns `{ phase: "round", roundNumber: 1, dimension: { id, label, ... }, synthesizerPrompt: "<string>", priorCoverage: { ... } }`.
  5. Orchestrator evaluates `synthesizerPrompt` internally → 1-3 probing questions in the interview language.
  6. Orchestrator asks user (or PO-proxy answers in autonomous mode). Collect answer(s).
  7. `node scripts/vibe-interview.mjs --continue --answer "<text>"` → engine returns `{ phase: "parse", answerParserPrompt: "<string>", pendingDimensionId: "<id>" }`.
  8. Orchestrator evaluates `answerParserPrompt` internally → structured JSON of sub-field attributions (shape defined in the parser prompt).
  9. `node scripts/vibe-interview.mjs --record --attribution '<json>'` → engine updates coverage, returns either another `{ phase: "round", ... }` or `{ phase: "done", summary: { ambiguity_final, dimensions, answers, rationale }, seedForProductMd: "<markdown>" }`.
  10. Loop until `phase === "done"`.
- **PO-proxy mode**: Orchestrator answers on the user's behalf per CLAUDE.md Phase 0-1 rules; answers flow through the same pipe; rationale is captured in the final summary.
- **"I don't know" / "미정" handling**: Orchestrator passes answer verbatim; parser prompt maps to `deferred` sub-fields; engine marks but does not short-circuit — it continues probing adjacent dimensions.
- **Termination**: ambiguity ≤ 0.2 OR roundNumber > maxRounds OR all required dimensions have coverage ≥ 0.5 AND ambiguity ≤ 0.3 (the "soft-terminate" guard — prevents infinite loops on stubborn free-form dimensions).
- **Output artifacts**:
  - `.vibe/interview-log/<session-id>.json` — full transcript (Q, A, attribution, rationale) + final coverage + ambiguity trace.
  - `seedForProductMd` text is appended as a `## Phase 3 답변 기록 (native interview)` section in `docs/context/product.md` by the Orchestrator after the interview completes.

### 4. `.claude/skills/vibe-interview/prompts/synthesizer.md` (NEW, harness tier — THE HERO FILE)

This is the single most valuable artifact of M5. It is a template consumed by the engine and emitted (with placeholders filled) as `synthesizerPrompt` to the Orchestrator each round.

Structure requirements (Generator: follow exactly — word the content thoughtfully, do not copy these instructions verbatim into the file):

- **Frontmatter**: purpose statement, "consumed by `scripts/vibe-interview.mjs`", "target reader: Claude Opus (Orchestrator) at interview time".
- **Role directive**: instruct the LLM to adopt the persona of a **senior product manager + domain SME** for the inferred domain. Explicitly warn against generic SaaS tropes.
- **Placeholders** (exact tokens the engine will replace via `String.prototype.replaceAll` — no templating library):
  - `{{ONE_LINER}}` — original user prompt
  - `{{INFERRED_DOMAIN}}` — domain string from Step 3
  - `{{LANG}}` — `ko` or `en` (interview language, default `ko`)
  - `{{DIMENSION_ID}}`, `{{DIMENSION_LABEL}}`, `{{DIMENSION_WEIGHT}}`
  - `{{DIMENSION_SUBFIELDS}}` — JSON array of sub-field slugs (empty array = free-form)
  - `{{PRIOR_ANSWERS_SUMMARY}}` — 10-line max digest of prior Q/A (engine compiles)
  - `{{COVERAGE_SNAPSHOT}}` — JSON of current per-dimension coverage ratios
  - `{{ROUND_NUMBER}}`, `{{MAX_ROUNDS}}`
  - `{{DOMAIN_PROBES}}` — optional inspiration bank contents (engine injects, may be empty)
- **Depth directive** (critical wording — the synthesizer must demand expert-level questions):
  - Explicitly state: "Generate 1-3 questions. Each question MUST reveal a decision that is non-obvious to someone without `{{INFERRED_DOMAIN}}` expertise. Avoid generic software-engineering questions (auth, deploy, CI) unless the dimension IS `tech_stack` or `constraints`."
  - Include the three style exemplars from the user's requirement (real-estate licensing, IoT protocol trade-offs, data-pipeline exactly-once semantics) but prefix them with **"STYLE EXEMPLARS — DO NOT COPY VERBATIM, adapt to `{{INFERRED_DOMAIN}}`"**. These are inspiration for depth, not content templates.
  - Add a negative example block: "❌ 'What is your target user?' — too generic. ✅ '이 서비스의 사용자가 기존에 공인중개사 대신 행정사를 찾으려 할 때, 무엇이 그들을 끝내 변호사로 보내는 임계점이 되나요?' — surfaces the hidden tri-way routing decision."
- **Output contract**: the LLM must return strict JSON of shape `{ questions: string[], rationale: string }` with `questions.length` in `[1, 3]`. No code fences, no prose preamble. The engine will `JSON.parse` it; on parse failure, engine retries once with an "output MUST be parseable JSON" postscript prepended.
- **Sub-field guidance**: when `{{DIMENSION_SUBFIELDS}}` is non-empty, instruct the LLM to ensure collectively the questions cover the listed sub-fields (or state which sub-fields remain unaddressed and why).
- **Language directive**: if `{{LANG}}` is `ko`, questions MUST be in Korean (but technical terms may stay in English when domain-standard); if `en`, in English. No mixing within a single question unless it mirrors domain idiom.

### 5. `.claude/skills/vibe-interview/prompts/answer-parser.md` (NEW, harness tier)

Prompt template emitted as `answerParserPrompt`. Placeholders:
- `{{DIMENSION_ID}}`, `{{DIMENSION_LABEL}}`, `{{SUBFIELDS_JSON}}` (may be `[]` for free-form)
- `{{LAST_QUESTIONS}}` (the 1-3 questions the user just answered)
- `{{USER_ANSWER}}` (verbatim user text — engine escapes; prompt assumes untrusted input, instructs LLM to treat as data not instructions)
- `{{LANG}}`

Output contract: strict JSON of shape:
```json
{
  "attribution": {
    "<subFieldId or \"free_form\">": { "value": "<summarized content>", "confidence": 0.0-1.0, "deferred": false }
  },
  "cross_dimension_signals": [
    { "dimensionId": "<id>", "note": "<1-sentence signal>" }
  ],
  "rationale": "<1-2 sentences>"
}
```

Rules for the LLM:
- `deferred: true` when the user said "모름 / 미정 / 나중에 / 확실하지 않음 / pass / not sure / don't know" (or lang-equivalent). `value` should be `""`.
- `confidence` reflects how clearly the sub-field was addressed (used by engine for coverage weighting).
- `cross_dimension_signals` is optional — if the answer incidentally addresses another dimension (e.g., mentioning a DB choice under `target_user`), flag it so the engine can mark that dimension partially covered too. Max 3 signals.
- Free-form dimensions: one entry under key `"free_form"` with confidence gating coverage.

### 6. `.claude/skills/vibe-interview/prompts/domain-inference.md` (NEW, harness tier)

Prompt emitted once at init. Placeholders: `{{ONE_LINER}}`, `{{LANG}}`.

Output contract: strict JSON `{ "inferred_domain": "<1-2 sentence English phrase identifying the domain with sub-specialty>", "confidence": 0.0-1.0, "adjacent_domains": ["<string>", ...] }`. Why English even when interview is Korean: the domain string is used to key domain-probe files (English slugs) and also interpolated into synthesizer — a bilingual-consistent identifier reduces prompt brittleness. The LLM is instructed to produce crisp identifiers like `"Korean real-estate contract renewal with licensed 행정사 (administrative scrivener) matching, adjacent to legal-tech and prop-tech"` rather than vague `"web app"`.

### 7. `.claude/skills/vibe-interview/domain-probes/` (NEW directory, 7 files)

Each file: 30–50 lines of markdown, header `# Expert-level probes — INSPIRATION ONLY, do not copy verbatim`, followed by bulleted example probing questions that demonstrate domain depth. Tone: match the hero synthesizer exemplars.

Files to create:
- `real-estate.md` — 공인중개사 vs 행정사 vs 변호사 권한 경계, 전월세 갱신청구권, 특약 조항, 에스크로, 등기 변경 통지 기한.
- `iot.md` — MQTT vs CoAP, device provisioning, OTA rollback, battery target, edge vs cloud attribution, 인증서 rotation.
- `data-pipeline.md` — exactly-once vs at-least-once, watermark strategy, late-arriving data, schema evolution, backfill idempotency.
- `web-saas.md` — multi-tenant isolation, org vs user billing boundary, SSO IdP scope, rate-limit dimension, audit log retention.
- `game.md` — deterministic simulation, frame-rate independence, input buffering, save-state versioning, match-making weight function, anti-cheat attack surface.
- `research.md` (academic / scientific computing) — reproducibility pinning, data provenance, artifact versioning, citation chain, IRB scope.
- `cli-tool.md` — POSIX vs Windows quoting, stdin vs argv trade-off, exit-code contract, config precedence order, man-page vs `--help` parity.

Engine injects contents at synthesis time ONLY if the inferred domain string matches (case-insensitive substring or explicit mapping — see engine §8). When no match, `{{DOMAIN_PROBES}}` is the empty string and the synthesizer relies purely on the LLM's own domain knowledge.

### 8. `scripts/vibe-interview.mjs` (NEW, harness tier — ~500 LOC engine)

Pure `.mjs` (Node 24+). No runtime deps. Imports from `node:*` + consumes `scripts/vibe-resolve-model.mjs` via `import` (named export `resolveRoleFromCli`) when `--json` metadata is needed — DO NOT spawn a child process for this, use the exported function.

**CLI surface**:
```
node scripts/vibe-interview.mjs --init --prompt "<one-liner>" [--lang ko|en] [--max-rounds 30] [--output <path>]
node scripts/vibe-interview.mjs --set-domain --domain "<string>"
node scripts/vibe-interview.mjs --continue --answer "<text>"
node scripts/vibe-interview.mjs --record --attribution '<json>'
node scripts/vibe-interview.mjs --status                  # prints current state snapshot
node scripts/vibe-interview.mjs --abort                   # discards session state
```

**State file**: `.vibe/interview-log/<session-id>.json` — single source of truth; all CLI subcommands after `--init` read/write it. Session id = ISO8601 slug + 6-char random suffix. Path override via `--output` at init; subsequent commands auto-locate via `.vibe/interview-log/.active` pointer file (one-line sessionId). `--abort` removes `.active`.

**State schema** (engine's own, not exposed as JSON Schema — comment at top of file enumerating shape):
```ts
{
  sessionId: string,
  createdAt: string,
  lang: "ko" | "en",
  maxRounds: number,
  oneLiner: string,
  inferredDomain: string | null,
  domainConfidence: number | null,
  adjacentDomains: string[],
  dimensions: Dimension[],                 // loaded from dimensions.json
  coverage: Record<dimensionId, { ratio: number, subFields: Record<subFieldId, { value: string, confidence: number, deferred: boolean }> }>,
  rounds: Array<{
    roundNumber: number,
    dimensionId: string,
    questions: string[],
    answer: string,
    attribution: unknown,                  // raw LLM JSON
    crossDimensionSignals: Array<{ dimensionId: string, note: string }>,
    timestamp: string
  }>,
  ambiguityTrace: number[],                // one entry per round after coverage update
  terminatedAt: string | null,
  terminationReason: "ambiguity" | "max-rounds" | "soft-terminate" | null
}
```

**Dimension-selection policy** (per round): pick the required dimension with lowest coverage ratio; tiebreak by highest weight. If all required ≥ 0.5, pick any remaining dimension with ratio < 0.5 by weight desc. Never revisit a dimension within 3 rounds unless all other dimensions have higher coverage (avoid thrashing).

**Ambiguity formula**:
```
ambiguity = 1 - (Σ weight_d × coverage_d) / (Σ weight_d)   // over all dimensions
coverage_d (with subFields) = average of per-subField coverage where
  coverage_subField = confidence if !deferred, else 0
coverage_d (free-form) = 1 if free_form.value is non-empty and !deferred, else 0
```
Export this as a named function `computeAmbiguity(dimensions, coverage): number` so the test suite can exercise it independently.

**Domain-probe injection**: maintain a static map `DOMAIN_PROBE_MAP` inside the script keyed by lowercase substring → filename under `.claude/skills/vibe-interview/domain-probes/`. e.g., `"real-estate" | "행정사" | "부동산"` → `real-estate.md`. When inferredDomain matches any key, read the file and inject as `{{DOMAIN_PROBES}}`; else empty string. First match wins.

**Prompt emission**: read the three prompt templates once at startup and cache. Replace placeholders via `String.prototype.replaceAll` (no template engine). Escape `{{USER_ANSWER}}` and `{{ONE_LINER}}` minimally (no JSON-encoding — they're going into markdown bodies; engine trims and replaces null bytes only).

**Registry integration**: call `resolveRoleFromCli('planner')` from `scripts/vibe-resolve-model.mjs` **once** at `--init` to record the Orchestrator's model identity into the session state under `meta.orchestratorModel`. This is purely observational (for the interview log header); engine must continue working if resolution fails (catch + log `meta.orchestratorModel = null`).

**Termination branch**: when `phase === "done"`, emit a `seedForProductMd` string — a markdown snippet comprising:
- Dimension-by-dimension summary (label + key answers)
- Final ambiguity
- Deferred sub-fields (listed explicitly for future re-interview)
- Q/A transcript (compact: `Round N (dimension): Q → A`)

Engine writes the full state to `--output` path (default `.vibe/interview-log/<sessionId>.json`) on termination and unlinks `.active`.

**CLI errors**: unknown subcommand → exit 2 + usage line to stderr. Missing `.active` pointer on `--continue/--record/--status` → exit 2 + `no active interview session (run --init first)`. Dimension.json missing/invalid schema → exit 3 + explicit message pointing at `.claude/skills/vibe-interview/dimensions.json`.

### 9. `.claude/skills/vibe-init/SKILL.md` Phase 3 rewrite

Replace the **entire** current Phase 3 body (starts at the header `## Phase 3 — 프로젝트 맞춤 설정 (ouroboros 소크라테스식 인터뷰)`) with a new Phase 3 body that:
- Reframes Phase 3 as "native socratic interview (vibe-interview)" — no mention of ouroboros-ai in the primary flow.
- References `.claude/skills/vibe-interview/SKILL.md` as the authoritative runbook.
- Keeps Step 3-0 (one-liner prompt collection) and Step 3-2 (seed → context shards mapping table) intact in spirit but trims redundant prose.
- Preserves the seed-field → shard mapping table (it's still the recipe for product.md / architecture.md / conventions.md) — the new seed fields map as:
  - `dimensions.goal` → product.md one-liner / success criteria
  - `dimensions.target_user` → product.md target users
  - `dimensions.platform` → product.md platform
  - `dimensions.data_model` → architecture.md data model
  - `dimensions.primary_interaction` → product.md user flow
  - `dimensions.success_metric` → product.md acceptance criteria
  - `dimensions.non_goals` → product.md non-goals
  - `dimensions.constraints` → product.md core assumptions + conventions.md security rules
  - `dimensions.tech_stack` → architecture.md tech stack
  - `dimensions.domain_specifics` → product.md domain notes + conventions.md extra rules
- Preserves the "Phase 3는 스킵 불가" rule and PO-proxy rationale recording (once at end, session-log `[decision][phase3-po-proxy]`).
- Adds a single-line legacy clause at the end: *"이전 세션이 남긴 `.ouroboros/` 디렉토리는 유지(참조용). 삭제하지 않음."*
- Removes entirely: Phase 1 Step 3 about ouroboros-ai pip install, stale PID troubleshooting, `.mcp.json` checks, `ouroboros setup` guidance. If these sections cross-reference other Phase 1 steps, preserve numbering and cross-refs (renumber if necessary; prefer keeping numbers to minimize diff).

Do this edit in-place — preserve all other Phase 1/2/4 content verbatim.

### 10. `CLAUDE.md` Phase 0 Step 0-1 update

Current text inside `<!-- BEGIN:HARNESS:sprint-flow -->` mentions `/vibe-init` Phase 3 `ouroboros_pm_interview / ouroboros_interview`. Replace those tool names with `vibe-interview (scripts/vibe-interview.mjs)` and the path `.claude/skills/vibe-init/SKILL.md §Phase 3` remains correct. Keep the scope strict: do NOT touch any other section.

### 11. `docs/context/tokens.md` new section

Append a new `## Native interview cost` section with these points (do not rewrite existing content):
- Per-interview baseline: ~15K tokens across Orchestrator internal evaluations (~6 synthesizer calls × 1.5K prompt + answer-parser ×6 × 1K + domain-inference 1K). Depends on `max-rounds` and answer verbosity.
- Note: these are Orchestrator-internal LLM evaluations counted in main-window usage, NOT separate API calls. No external token cost vs Ouroboros (which ran out-of-process).
- Session state is stored locally under `.vibe/interview-log/<sessionId>.json`; not counted against tokens.
- Budget guard: if `rounds.length > maxRounds × 0.8` and ambiguity still > 0.4, engine emits a stderr warning so Orchestrator can consider PO-proxy finalization.

### 12. `src/lib/interview.ts` (NEW)

Pure TypeScript helpers used only by tests (and potentially by a future typed consumer). No side effects, no I/O. Exports:

```ts
export interface SubFieldCoverage {
  value: string;
  confidence: number;
  deferred: boolean;
}
export interface DimensionCoverage {
  ratio: number;                      // derived, NOT source of truth
  subFields: Record<string, SubFieldCoverage>;
}
export interface DimensionSpec {
  id: string;
  label: string;
  weight: number;
  subFields: string[];
  required: boolean;
}

export function subFieldCoverageValue(sf: SubFieldCoverage): number;         // deferred → 0 else confidence
export function dimensionCoverageRatio(spec: DimensionSpec, cov: DimensionCoverage): number;
export function computeAmbiguity(
  specs: DimensionSpec[],
  coverage: Record<string, DimensionCoverage>,
): number;
export function selectNextDimension(
  specs: DimensionSpec[],
  coverage: Record<string, DimensionCoverage>,
  recentDimensionIds: string[],       // last K dimensionIds for thrash avoidance
  options?: { thrashWindow?: number },
): string;
export function shouldTerminate(
  ambiguity: number,
  round: number,
  maxRounds: number,
  specs: DimensionSpec[],
  coverage: Record<string, DimensionCoverage>,
): { terminate: boolean; reason: "ambiguity" | "max-rounds" | "soft-terminate" | null };
```

`scripts/vibe-interview.mjs` does NOT import this file (keeps .mjs free of .ts). Instead, the engine inlines the same logic — add the M4-style CROSS-REF comment at each inlined function pointing at `src/lib/interview.ts`. Drift-detection: `test/interview-engine.test.ts` must compare a fixture computed both ways (spawn the .mjs via subprocess, call .ts helper via import, assert equal ambiguity for identical coverage input).

### 13. Tests

- `test/interview-dimensions.test.ts` — load `dimensions.json`, validate against `dimensions.schema.json` using the same validator pattern as `test/sprint-status.test.ts`. Assert 10 dimensions, all required dimensions present, weights in [0,1], no duplicate ids.
- `test/interview-engine.test.ts`:
  - `computeAmbiguity` with (a) all dimensions fully covered → 0, (b) none covered → 1, (c) one heavy-weight free-form fully covered, rest zero → matches manual calc within 1e-9.
  - `selectNextDimension` thrash-avoidance: given `recentDimensionIds = ["goal","goal","goal"]`, engine must skip `goal` even if it has lowest coverage (as long as another dimension has ratio < 0.5).
  - `shouldTerminate`: max-rounds boundary, soft-terminate branch (all required ≥ 0.5 AND ambiguity ≤ 0.3 but > 0.2), ambiguity-hit branch.
  - Drift fixture: spawn `node scripts/vibe-interview.mjs` in a subprocess with a stub mode (add `--stub-compute-ambiguity <coverageJson>` hidden flag that prints numeric result and exits — this is test scaffolding only). Compare against `computeAmbiguity` from `src/lib/interview.ts`. If the fixture diverges, the test fails with a message naming both values.
- `test/interview-cli.test.ts`:
  - `--init` creates `.vibe/interview-log/<sessionId>.json` + `.active` pointer.
  - `--init` twice in a row — second call aborts gracefully with stderr `existing active session; run --abort first` and exit code 2.
  - `--set-domain` without prior init → exit 2 + expected stderr.
  - `--continue` → `--record` → state mutation: coverage updated per attribution JSON; `rounds` appended.
  - `--record` on the last required dimension with confidence 1.0 across the board triggers `phase === "done"` with `seedForProductMd` non-empty.
  - All subprocess tests use tmp dirs (reuse `withTempProject` helper from `test/sprint-commit.test.ts` or equivalent — if none exists, create a minimal helper in `test/helpers/tmp-project.ts`, same style as existing test helpers).

### 14. Manifest + package.json

- Add to `.vibe/sync-manifest.json` `files.harness[]`: `scripts/vibe-interview.mjs`, `.claude/skills/vibe-interview/SKILL.md`, `.claude/skills/vibe-interview/dimensions.json`, `.claude/skills/vibe-interview/dimensions.schema.json`, `.claude/skills/vibe-interview/prompts/synthesizer.md`, `.claude/skills/vibe-interview/prompts/answer-parser.md`, `.claude/skills/vibe-interview/prompts/domain-inference.md`, `.claude/skills/vibe-interview/domain-probes/real-estate.md`, `.claude/skills/vibe-interview/domain-probes/iot.md`, `.claude/skills/vibe-interview/domain-probes/data-pipeline.md`, `.claude/skills/vibe-interview/domain-probes/web-saas.md`, `.claude/skills/vibe-interview/domain-probes/game.md`, `.claude/skills/vibe-interview/domain-probes/research.md`, `.claude/skills/vibe-interview/domain-probes/cli-tool.md`, `src/lib/interview.ts`, `test/interview-dimensions.test.ts`, `test/interview-engine.test.ts`, `test/interview-cli.test.ts`.
- Do NOT remove any ouroboros-related manifest entries (there are none — ouroboros was pip-installed, not manifested).
- Add `.vibe/interview-log/` as a project-tier glob if applicable, or leave unmanaged (it's session state, should not sync upstream). Verify via preflight that an empty `.vibe/interview-log/` directory does not trigger false positives.
- `package.json`: add one script `"vibe:interview": "node scripts/vibe-interview.mjs"` under the harness-managed `scripts.vibe:*` namespace so downstream projects can invoke via `npm run vibe:interview -- --init ...`.

---

## Non-scope / Out of scope

- Do not implement an MCP server replacement or any networked service.
- Do not modify `docs/context/product.md` / `architecture.md` / `conventions.md` templates beyond what the Phase 3 rewrite requires — the seed-mapping recipe lives in SKILL.md, not in the engine.
- Do not delete any existing Ouroboros references outside the two files called out (`vibe-init/SKILL.md` §Phase 3 + `CLAUDE.md` Phase 0 Step 0-1). Phase 1 §environment-check Ouroboros guidance is scheduled for removal in a later sweep; leaving it stale is fine — SKILL.md Phase 3 rewrite takes precedence.
- Do not add linting for the prompt markdown files beyond normal eslint/tsc.
- Do not hot-reload `dimensions.json` at runtime — read once at `--init` and snapshot into session state.
- Do not attempt to parse LLM output with regex; rely on strict JSON + one retry with postscript.

---

## Contract reminders

- No new runtime deps (Node 24+ built-ins only). No new devDeps either unless a test genuinely requires one (if tempted, write a justification note in the PR description instead and use node:test patterns already in the repo).
- Pure `.mjs` for the engine. No tsx. No import of `.ts` files from the engine.
- Windows/POSIX parity — all file paths via `node:path`, newline handling via `os.EOL` where appropriate, avoid POSIX-only shell assumptions in scripts.
- Registry load at engine boot: **once per process**. Verify by instrumenting a counter in a test fixture if needed.
- All LLM-facing prompts must instruct strict JSON output with a one-retry fallback protocol documented in SKILL.md.
- Respect `_common-rules.md` §sandbox invariants — no integration test runner / no package-manager calls from the engine itself.

---

## Self-verification checklist (Codex: run before reporting complete)

1. `npx tsc --noEmit` → 0 errors.
2. `npx eslint . --quiet` → 0 errors.
3. `npm test` → all prior tests pass + new tests pass.
4. `node scripts/vibe-interview.mjs --init --prompt "smoke"` exits 0 and creates `.vibe/interview-log/<id>.json` + `.active`. Follow with `--abort` and confirm `.active` removed.
5. `node scripts/vibe-preflight.mjs` exits 0.
6. `node scripts/vibe-resolve-model.mjs planner --json` still works unchanged (regression guard on M4 resolver).
7. `cat .claude/skills/vibe-interview/dimensions.json | python -c 'import json,sys; json.load(sys.stdin)'` — OR a `node -e "JSON.parse(require('node:fs').readFileSync('.claude/skills/vibe-interview/dimensions.json','utf8'))"` round-trip — to confirm JSON validity.
8. Grep `ouroboros_interview\|ouroboros_pm_interview` across the repo: only the two locations rewritten (CLAUDE.md Phase 0 and vibe-init Phase 3) should show **no** matches; Phase 1 install guidance may still contain "ouroboros" strings — acceptable.
9. Manifest entries for all new files present; `npm run vibe:sync -- --dry-run` (or `node scripts/vibe-sync-bootstrap.mjs --dry-run` equivalent) reports new files as `new-file` action.
10. Verify `dimensions.schema.json` validates `dimensions.json` via the test suite — do not skip.

---

## Final report format (write to `docs/reports/sprint-M5-native-interview.md`)

- Files created / modified with LOC per file.
- Test summary (`X pass / Y skip / Z fail`).
- Exact commands run for verification (each with exit code).
- Any deviation from this spec with one-line rationale per deviation.
- One paragraph: how the synthesizer prompt achieves domain-expert depth (specific wording choices from §4).
- Flagged risks to carry into M6 (shards). At minimum: how `vibe-interview` consumes tech_stack answers to eventually drive M6 shard selection.
