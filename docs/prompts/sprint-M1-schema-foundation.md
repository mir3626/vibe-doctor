# Sprint M1 — Schema foundation (state files)

> 공용 규칙은 `.vibe/agent/_common-rules.md` 준수. Sprint 고유 규칙만 아래에 기술.
>
> **상위 컨텍스트**: `docs/plans/sprint-roadmap.md` → §Sprint M1 slot.
> **이전 Sprint 결과 요약**: `v1.1.0-process-refactor` 통과 — `vibe:sync` 메커니즘 정착, `sprint-status.json` + `handoff.md` + `session-log.md` 3종 state가 Sprint 경계 전달 용도로 안착. 그러나 (a) `stateUpdatedAt` 의미 이원화(`handoff.updatedAt` vs 파일 mtime) 때문에 `preflight.handoff.stale` 가 잡음 생성, (b) risk/scope/audit-counter 같은 cumulative 메타가 수동으로만 유지되는 한계 → 본 Sprint 에서 schema 를 공식 확장.
> **단일 커밋 원칙 (v1.1.1+)**: Generator 산출 파일 + 3종 state 파일을 한 커밋에 묶는다 (별도 `docs(sprint): close ...` 커밋 생성 금지).

---

## Goal

`.vibe/agent/sprint-status.json` 스키마에 cumulative 메타 필드를 공식 추가하고, 이후 Sprint (M3 automation, M8 audit, M9 statusline) 가 참조할 machine-readable state 파일 2종(`project-map.json`, `sprint-api-contracts.json`) + 그 스키마 + CRUD helper 모듈 2개(`src/lib/sprint-status.ts`, `src/lib/project-map.ts`) 를 도입한다. `vibe-sprint-complete.mjs` 는 새 필드를 자동 유지하고, `vibe-preflight.mjs` 의 stale 판정은 새 `stateUpdatedAt` 기반으로 재작성한다. Legacy sprint-status.json 은 `migrations/1.1.0.mjs` 가 idempotent 로 이행한다.

### Non-goals (defer)

이번 Sprint 에서 **하지 않는** 작업 — 후속 Sprint slot 확보:

- AST 기반 project-map 자동 스캔 → **M3 또는 M10** 으로 연기. M1 은 container + 수동 등록 helper 만.
- `vibe-sprint-commit.mjs` wrapper → **M3**.
- session-log 자동 정렬 스크립트 → **M3**.
- `sprint-roadmap.md` Current pointer 자동 갱신 → **M3**.
- Prompts archive 이동 → **M3**.
- sync.ts glob 디렉토리 지원 → **M6**.
- audit-required 실제 Evaluator 실행 로직 → **M8** (M1 은 pendingRisk 생성까지만).

이 목록 바깥의 "개선"/"리팩터" 수행 금지 (§공용 규칙 5).

---

## Scope — files

### 생성 (ADD)

1. `.vibe/agent/project-map.json` — 빈 skeleton (schemaVersion/updatedAt/modules={}/activePlatformRules=[]).
2. `.vibe/agent/project-map.schema.json` — JSON Schema draft 2020-12.
3. `.vibe/agent/sprint-api-contracts.json` — 빈 skeleton (schemaVersion/updatedAt/contracts={}).
4. `.vibe/agent/sprint-api-contracts.schema.json` — JSON Schema draft 2020-12.
5. `src/lib/sprint-status.ts` — CRUD helper (§ "Module API" 참조).
6. `src/lib/project-map.ts` — CRUD helper (§ "Module API" 참조).
7. `migrations/1.1.0.mjs` — legacy sprint-status.json migration (CLI + exported function).
8. `test/sprint-status.test.ts` — 단위 테스트.
9. `test/project-map.test.ts` — 단위 테스트.
10. `test/preflight-stale.test.ts` — 새 stale 판정 단위 테스트.

### 수정 (MODIFY)

11. `.vibe/agent/sprint-status.schema.json` — 새 필드 추가, 기존 필드 보존.
12. `.vibe/agent/sprint-status.json` — 새 필드 defaults 초기값 주입(migration 1.1.0 self-run 과 동치인 결과).
13. `scripts/vibe-sprint-complete.mjs` — stateUpdatedAt 갱신 + `--scope` 플래그 수용 + audit counter 증가 + threshold 시 `pendingRisks` 주입.
14. `scripts/vibe-preflight.mjs` — `handoff.stale` 판정 재작성 (새 tolerance 규칙).
15. `src/lib/paths.ts` — 새 path entries 추가 (projectMap, sprintApiContracts 및 schemas).
16. `.vibe/sync-manifest.json` — 신규 harness/project 파일 등록 + migrations map 에 `1.1.0` 추가.
17. `test/sync.test.ts` — manifest 업데이트 반영 검증 케이스 1개 추가 (신규 harness 파일이 manifest 에 포함되어 있는지).

### Do NOT modify

- `CLAUDE.md` (M1 은 schema/script 만 건드림)
- `.vibe/agent/_common-rules.md`
- `.vibe/agent/handoff.md` 본문 (script 가 자동 관리)
- `.vibe/agent/session-log.md` (script 가 자동 관리)
- `src/lib/sync.ts` (glob 지원은 M6)
- 기존 mjs 스크립트 중 본 Scope 에 없는 것

---

## Technical spec

### 1. `sprint-status.schema.json` 확장

**추가 필드 (모두 optional — backward-compat)**:

```jsonc
{
  "properties": {
    // ... 기존 schemaVersion/project/sprints/verificationCommands/handoff/sandboxNotes 유지
    "pendingRisks": {
      "type": "array",
      "description": "Open risks raised by any Sprint that require action in a future Sprint. Consumed by vibe-sprint-complete (threshold-triggered inserts) and /vibe-review (M8).",
      "items": { "$ref": "#/$defs/pendingRisk" }
    },
    "lastSprintScope": {
      "type": "array",
      "description": "Absolute-to-repo-root file paths touched by the most recently completed Sprint. Populated by vibe-sprint-complete --scope. M3 will derive this from git-staged files; M1 only stores what is passed.",
      "items": { "type": "string" }
    },
    "lastSprintScopeGlob": {
      "type": "array",
      "description": "Glob summarisation of lastSprintScope (e.g. 'src/lib/**', 'scripts/*.mjs'). Stored verbatim from --scope CLI; derivation algorithm deferred to M3.",
      "items": { "type": "string" }
    },
    "sprintsSinceLastAudit": {
      "type": "integer",
      "minimum": 0,
      "default": 0,
      "description": "Counter incremented on every vibe-sprint-complete passed run. Reset to 0 when an audit-required pendingRisk is resolved (M8). Threshold: .vibe/config.json.audit.everyN (default 5)."
    },
    "stateUpdatedAt": {
      "type": "string",
      "format": "date-time",
      "description": "ISO8601 timestamp set by the last tool that wrote this file (vibe-sprint-complete, migrations, sprint-status.ts helpers). Preflight freshness check uses this as the authoritative signal, replacing handoff.updatedAt vs mtime heuristic."
    },
    "verifiedAt": {
      "type": "string",
      "format": "date-time",
      "description": "ISO8601 timestamp set by the Orchestrator after self-QA or Evaluator verdict. Distinct from stateUpdatedAt (which tracks writes) — this tracks verification events."
    }
  },
  "$defs": {
    "pendingRisk": {
      "type": "object",
      "required": ["id", "raisedBy", "targetSprint", "text", "status", "createdAt"],
      "properties": {
        "id": { "type": "string", "description": "Stable short id, e.g. 'audit-2026Q2' or 'risk-schema-drift-01'" },
        "raisedBy": { "type": "string", "description": "Sprint id or tool name that raised this risk" },
        "targetSprint": { "type": "string", "description": "Sprint id that should address this, or '*' for any future sprint" },
        "text": { "type": "string" },
        "status": { "type": "string", "enum": ["open", "acknowledged", "resolved"] },
        "createdAt": { "type": "string", "format": "date-time" },
        "resolvedAt": { "type": "string", "format": "date-time" }
      }
    }
  }
}
```

**규칙**:
- 기존 `$defs/verificationCommand` / `properties/handoff` 등 유지 (append-only 확장).
- `handoff.updatedAt` 는 제거하지 않되 **의미를 "handoff 블록이 마지막으로 쓰여진 시각"** 으로 좁힌다. 파일 전체의 freshness 는 top-level `stateUpdatedAt` 로 이동. schema description 에 이 구분을 명시.
- 새 필드는 **required 에 넣지 않는다**. legacy file 도 parse 가 통과해야 함.

### 2. `project-map.schema.json`

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://vibe-doctor/.vibe/agent/project-map.schema.json",
  "title": "Project Map",
  "description": "Module-level inventory: exports/imports per source file, plus active platform-level rules (e.g. 'all routes must go through middleware X'). M1 provides schema + manual registration API; AST auto-scan deferred to a later sprint.",
  "type": "object",
  "required": ["schemaVersion", "updatedAt", "modules", "activePlatformRules"],
  "properties": {
    "schemaVersion": { "type": "string", "const": "0.1" },
    "updatedAt": { "type": "string", "format": "date-time" },
    "lastSprintId": { "type": "string" },
    "modules": {
      "type": "object",
      "description": "Keyed by repo-relative file path (POSIX separator).",
      "additionalProperties": {
        "type": "object",
        "required": ["exports", "imports"],
        "properties": {
          "exports": { "type": "array", "items": { "type": "string" } },
          "imports": { "type": "array", "items": { "type": "string" } },
          "sprintAdded": { "type": "string" }
        }
      }
    },
    "activePlatformRules": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["rule", "location", "sprintAdded"],
        "properties": {
          "rule": { "type": "string" },
          "location": { "type": "string", "description": "repo-relative path or abstract locator, e.g. 'src/middleware/auth.ts' or 'global'" },
          "sprintAdded": { "type": "string" }
        }
      }
    }
  }
}
```

### 3. `sprint-api-contracts.schema.json`

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://vibe-doctor/.vibe/agent/sprint-api-contracts.schema.json",
  "title": "Sprint API Contracts",
  "description": "Per-sprint record of public exports and types introduced, so later sprints can reference without grepping.",
  "type": "object",
  "required": ["schemaVersion", "updatedAt", "contracts"],
  "properties": {
    "schemaVersion": { "type": "string", "const": "0.1" },
    "updatedAt": { "type": "string", "format": "date-time" },
    "contracts": {
      "type": "object",
      "description": "Keyed by sprint id.",
      "additionalProperties": {
        "type": "object",
        "required": ["publicExports", "types"],
        "properties": {
          "publicExports": {
            "type": "object",
            "additionalProperties": { "type": "array", "items": { "type": "string" } }
          },
          "types": {
            "type": "object",
            "additionalProperties": { "type": "array", "items": { "type": "string" } }
          }
        }
      }
    }
  }
}
```

### 4. `src/lib/sprint-status.ts` — Module API

```typescript
// All writes go through src/lib/fs.ts (writeJson). No direct fs calls.
// Runtime validation via inline type guards — NO new runtime deps (no ajv).

export interface PendingRisk {
  id: string;
  raisedBy: string;
  targetSprint: string;
  text: string;
  status: 'open' | 'acknowledged' | 'resolved';
  createdAt: string;
  resolvedAt?: string;
}

export interface SprintStatus {
  schemaVersion: string;               // '0.1'
  project: { name: string; createdAt: string; runtime?: string; framework?: string };
  sprints: SprintEntry[];
  verificationCommands: VerificationCommand[];
  handoff?: HandoffBlock;
  sandboxNotes?: SandboxNote[];

  // Added in schema v0.1 (M1 extension)
  pendingRisks: PendingRisk[];
  lastSprintScope: string[];
  lastSprintScopeGlob: string[];
  sprintsSinceLastAudit: number;
  stateUpdatedAt: string;
  verifiedAt?: string;
}

// Re-export sub-types (SprintEntry, VerificationCommand, HandoffBlock, SandboxNote)
// — infer from schema description fields verbatim.

export async function loadSprintStatus(root?: string): Promise<SprintStatus>;
export async function saveSprintStatus(status: SprintStatus, root?: string): Promise<void>;

export async function appendPendingRisk(risk: Omit<PendingRisk, 'createdAt' | 'status'> & {
  status?: PendingRisk['status'];
}, root?: string): Promise<PendingRisk>;

export async function resolvePendingRisk(id: string, root?: string): Promise<PendingRisk | null>;

export async function incrementAuditCounter(root?: string): Promise<number>;
export async function resetAuditCounter(root?: string): Promise<void>;

export async function touchStateUpdated(root?: string): Promise<string>; // returns new ISO
export async function markVerified(root?: string): Promise<string>;      // returns new ISO

// Validation helpers (exported for tests)
export function isSprintStatus(value: unknown): value is SprintStatus;
export function isPendingRisk(value: unknown): value is PendingRisk;

// Defaults injection (idempotent) — used by migrations and first-load recovery.
export function withDefaults(partial: Partial<SprintStatus> & { schemaVersion: string; project: SprintStatus['project']; sprints: SprintEntry[]; verificationCommands: VerificationCommand[] }): SprintStatus;
```

**Behavioral contracts**:
- `loadSprintStatus` — if file parses but missing new fields, it **must still succeed** by populating defaults via `withDefaults`. Does NOT write back (that is migration's job). Defaults: `pendingRisks=[]`, `lastSprintScope=[]`, `lastSprintScopeGlob=[]`, `sprintsSinceLastAudit=0`, `stateUpdatedAt=` existing `handoff.updatedAt` if present else `project.createdAt` else `new Date().toISOString()`. `verifiedAt` stays undefined (optional).
- `saveSprintStatus` — must call `touchStateUpdated` internally BEFORE `writeJson`, so every write keeps `stateUpdatedAt` ≥ previous write. Trailing newline to match existing `writeJson` helper.
- `appendPendingRisk` — assigns `createdAt=now`, defaults `status='open'`. Duplicate id → throw `Error('pendingRisk id already exists: <id>')`.
- `resolvePendingRisk` — returns `null` if id not found; on success sets `status='resolved'` and `resolvedAt=now`.
- `incrementAuditCounter` — increments and persists. Returns new counter value.
- `resetAuditCounter` — sets to 0.
- `touchStateUpdated` / `markVerified` — set respective ISO timestamp and persist. `markVerified` does NOT touch `stateUpdatedAt` (separate concerns).
- All functions default `root` to `paths.root` (= `process.cwd()`).
- `isSprintStatus` must accept legacy objects missing the new fields, provided core required fields (`schemaVersion`, `project`, `sprints`, `verificationCommands`) are valid. This is the "soft validator" used at load time. A stricter `isStrictSprintStatus` is NOT required this Sprint.

### 5. `src/lib/project-map.ts` — Module API

```typescript
export interface ProjectMapModule {
  exports: string[];
  imports: string[];
  sprintAdded?: string;
}

export interface ActivePlatformRule {
  rule: string;
  location: string;
  sprintAdded: string;
}

export interface ProjectMap {
  schemaVersion: string;  // '0.1'
  updatedAt: string;
  lastSprintId?: string;
  modules: Record<string, ProjectMapModule>;
  activePlatformRules: ActivePlatformRule[];
}

export async function loadProjectMap(root?: string): Promise<ProjectMap>;
export async function saveProjectMap(map: ProjectMap, root?: string): Promise<void>;

export async function registerModule(args: {
  path: string;               // repo-relative, POSIX
  exports: string[];
  imports: string[];
  sprintId: string;
  root?: string;
}): Promise<ProjectMap>;

export async function registerPlatformRule(args: {
  rule: string;
  location: string;
  sprintId: string;
  root?: string;
}): Promise<ProjectMap>;

export function mergeProjectMaps(base: ProjectMap, incoming: Partial<ProjectMap>): ProjectMap;

export function isProjectMap(value: unknown): value is ProjectMap;
```

**Behavioral contracts**:
- `loadProjectMap` — if file absent, returns a fresh empty map (does NOT write).
- `saveProjectMap` — updates `updatedAt=now` then writes via `writeJson`.
- `registerModule` — idempotent: calling twice with same path overwrites exports/imports but preserves `sprintAdded` from first registration (first-wins). Normalises path separators to POSIX before keying.
- `registerPlatformRule` — idempotent on exact `(rule, location)` tuple: duplicate insert is a no-op (keeps earliest `sprintAdded`).
- `mergeProjectMaps` — module-level overwrite (incoming wins per-key), platform rules concat+dedup.
- No AST scan. No file globbing. Consumer is responsible for calling `registerModule` with the right data.

### 6. `migrations/1.1.0.mjs`

- CLI entry: `node migrations/1.1.0.mjs [<root>]` (default `process.cwd()`). Mirrors `migrations/1.0.0.mjs` structure (top-level try/catch, exit 0 on benign skip, exit 1 on hard failure).
- Export a pure function `export async function migrate(root)` so tests can import it directly.
- Steps (all idempotent — re-running must be a no-op):
  1. If `.vibe/agent/sprint-status.json` absent → exit 0 (nothing to migrate).
  2. Parse it. If `pendingRisks` already defined → assume already migrated, still touch schemas below.
  3. Inject defaults via `withDefaults` (imported from `src/lib/sprint-status.ts` — use `tsx` via import? see note below).
  4. `stateUpdatedAt` default: prefer existing `handoff.updatedAt`, else `project.createdAt`, else `new Date().toISOString()`.
  5. Write back through `writeFileSync` (mjs script — do NOT import the TS helper; replicate the JSON write there to avoid tsx dependency in migrations. See "tsx-in-migrations" note.).
  6. Ensure `.vibe/agent/project-map.json` exists with empty skeleton; create if missing.
  7. Ensure `.vibe/agent/sprint-api-contracts.json` exists with empty skeleton; create if missing.
  8. Update `.vibe/config.json` — add `"audit": { "everyN": 5 }` if `audit` key absent (idempotent).
- "**tsx-in-migrations**" note: migrations are plain `.mjs` and must NOT require `tsx`. Replicate the small amount of JSON shape logic inline. The TS helper `withDefaults` is for runtime code; migration 1.1.0 duplicates the defaults so it can run with `node` alone.

### 7. `scripts/vibe-sprint-complete.mjs` — extensions

Preserve all existing behavior (existing sprint entries/handoff table rewrite/session-log append). Add:

1. **Flag parser**: accept `--scope <comma-separated globs or paths>`. Store split array in `sprint-status.json` as `lastSprintScope` (verbatim path list) AND `lastSprintScopeGlob` (verbatim — dedup = deferred, just store whatever caller passed). Absent flag → leave existing values intact (do not clear on `passed`, do not inject `[]`).
2. **stateUpdatedAt**: after computing the final `sprintStatus` object in-memory, set `sprintStatus.stateUpdatedAt = nowIso` before `writeFileSync`. Keep existing `handoff.updatedAt` line for back-compat.
3. **Audit counter**: only when `status === 'passed'`, increment `sprintStatus.sprintsSinceLastAudit` by 1 (default to 0 if absent). Read threshold from `.vibe/config.json.audit.everyN` (fallback 5). When counter ≥ threshold, append a pendingRisk:
   ```jsonc
   {
     "id": `audit-${sprintId}`,   // stable per-sprint id to avoid dupes on re-run
     "raisedBy": "vibe-sprint-complete",
     "targetSprint": "*",
     "text": `Evaluator audit due (sprintsSinceLastAudit=${counter}, everyN=${everyN}).`,
     "status": "open",
     "createdAt": nowIso
   }
   ```
   Skip insert if a risk with same id already exists (idempotent re-runs). Do NOT reset counter here — reset is M8's job.
4. **Backward compat**: for legacy sprint-status.json without new fields, this script must still work. If any of `pendingRisks` / counter keys are `undefined`, initialise them in-memory before writing.
5. CLI usage string updated: `node scripts/vibe-sprint-complete.mjs <sprintId> <passed|failed> [--summary "..."] [--scope <path1,path2,...>]`.

### 8. `scripts/vibe-preflight.mjs` — new `handoff.stale` logic

Replace the existing block (step "6. handoff freshness", currently comparing `handoff.updatedAt` vs `git log -1 --format=%cI` vs mtime) with:

```
Let s = sprintStatus.stateUpdatedAt (top-level, NOT handoff.updatedAt).
Let age = now - parseIso(s).

- s missing/unparseable AND sprint-status.json exists  → INFO: "stateUpdatedAt absent (pre-1.1.0 state — run migrations/1.1.0.mjs)". ok=true.
- age <= 5 minutes                                     → OK, detail "fresh: stateUpdatedAt=<iso>". No "warning" prefix.
- 5 minutes < age <= 24 hours                          → INFO, detail "stateUpdatedAt=<iso> (age=<Nm> minutes)". ok=true, no "warning".
- age > 24 hours                                       → WARN, detail "stateUpdatedAt=<iso> stale (age=<Nh> hours). Run vibe-sprint-complete or refresh state." ok=true.
- Never FAIL on staleness alone.
```

- BOOTSTRAP_MODE path: keep skip (existing behavior).
- Output format: existing `[OK ]` / `[FAIL]` prefix retained. Add a third literal prefix `[INFO]` used when the recorded status is neither a hard OK (green) nor a fail. Adjust the final output loop to print `[INFO]` when `r.level === 'info'`. Schema of `record()` gains an optional third field `level?: 'ok' | 'info' | 'warn'`; default `'ok'`. Old call sites continue to work.
- JSON_MODE includes the `level` field.

**Only the handoff.stale check uses `info`/`warn` levels this Sprint.** Do not touch other checks' level semantics (keep them binary ok/fail).

### 9. `src/lib/paths.ts` — new entries

```typescript
export const paths = {
  // ... existing
  projectMap: path.join(cwd, '.vibe', 'agent', 'project-map.json'),
  projectMapSchema: path.join(cwd, '.vibe', 'agent', 'project-map.schema.json'),
  sprintApiContracts: path.join(cwd, '.vibe', 'agent', 'sprint-api-contracts.json'),
  sprintApiContractsSchema: path.join(cwd, '.vibe', 'agent', 'sprint-api-contracts.schema.json'),
  sprintStatus: path.join(cwd, '.vibe', 'agent', 'sprint-status.json'),
  sprintStatusSchema: path.join(cwd, '.vibe', 'agent', 'sprint-status.schema.json'),
};
```

(Keep existing keys untouched.)

### 10. `.vibe/sync-manifest.json`

**Append to `files.harness`** (preserving order — append at end of section):

```
".vibe/agent/project-map.schema.json",
".vibe/agent/sprint-api-contracts.schema.json",
"src/lib/sprint-status.ts",
"src/lib/project-map.ts",
"test/sprint-status.test.ts",
"test/project-map.test.ts",
"test/preflight-stale.test.ts",
"migrations/1.1.0.mjs"
```

**Append to `files.project`** (live instance data — NOT harness, because downstream projects will each have their own content):

```
".vibe/agent/project-map.json",
".vibe/agent/sprint-api-contracts.json"
```

Rationale for tier assignment: schemas + helper TS modules + tests + migrations are harness (identical across projects; upstream owns). The two `.json` instance files are populated differently per project, same tier as `sprint-status.json` which is already `project`.

**Update `migrations` map**: add `"1.1.0": "migrations/1.1.0.mjs"` to the existing object.

**Do NOT** change `hybrid` entries. `sprint-status.schema.json` is already listed as `harness`; upgraded schema will flow through `vibe:sync` replace action naturally.

### 11. `.vibe/agent/sprint-status.json` — initial M1 defaults

Orchestrator's own sprint-status.json also needs the new fields populated (so Sprint M2 preflight sees `stateUpdatedAt`). Generator: run the migration **in-process** at the end of the codegen by writing the JSON directly OR include a one-line note at the top of the Final report "User must run `node migrations/1.1.0.mjs` before M2". Either path is acceptable; prefer the migration-run path to eliminate the manual step.

---

## Test strategy

### `test/sprint-status.test.ts`

Use the same tmp-dir pattern as `test/sync.test.ts`. Set `cwd` via temporarily chdir-ing or pass explicit `root` arg to helpers (preferred — helpers accept `root`).

Cases (minimum 6):

1. `loadSprintStatus` on a legacy file (no new fields) injects defaults (`pendingRisks=[]`, `sprintsSinceLastAudit=0`, `stateUpdatedAt` falls back to `handoff.updatedAt`).
2. `saveSprintStatus` roundtrip: load → mutate → save → load → equal.
3. `appendPendingRisk` sets `status='open'`, `createdAt` is ISO, returns the created risk.
4. `appendPendingRisk` duplicate id throws.
5. `resolvePendingRisk` unknown id returns null; known id sets `status='resolved'` + `resolvedAt`.
6. `incrementAuditCounter` increments and persists; `resetAuditCounter` zeroes it; stateUpdatedAt advances after each call.
7. `isSprintStatus` accepts legacy shape; rejects obvious garbage (missing `schemaVersion`).

### `test/project-map.test.ts`

Cases (minimum 4):

1. `loadProjectMap` on absent file returns empty skeleton (modules={}, activePlatformRules=[]).
2. `registerModule` twice on same path: second call overwrites exports, preserves original `sprintAdded`.
3. `registerPlatformRule` duplicate `(rule, location)` is no-op (length stays 1).
4. `mergeProjectMaps` — module key collision: incoming wins; platform rules concat+dedup.

### `test/preflight-stale.test.ts`

Since `vibe-preflight.mjs` is an mjs script, test by spawning it with `execFile` into a tmp dir that contains a crafted `.vibe/agent/sprint-status.json` + `.vibe/agent/handoff.md` (touch empty) + `docs/context/product.md` (stub). Cases (minimum 3):

1. `stateUpdatedAt` within 5 min → prints `[OK ]` line for `handoff.stale` with substring `fresh`.
2. `stateUpdatedAt` 30 min ago → prints `[INFO]` line, substring `age=`.
3. `stateUpdatedAt` 2 days ago → prints `[OK ]` line (because staleness never FAILs) but detail substring `stale`. Acceptable if WARN is printed as `[OK ]` with stale-text; OR introduce a `[WARN]` prefix literally. Generator's choice as long as JSON_MODE `level` distinguishes them.

Test invocation: run `node scripts/vibe-preflight.mjs --json` in a child process and parse stdout.

**Skip condition**: if a test cannot run preflight in sandbox because of missing provider commands, filter results down to just `handoff.stale` in the assertions (other results may fail — ignore). Or set `VIBE_TEST_SKIP_PROVIDER=1` env and have preflight honour it (simplest: just filter assertions to only check `handoff.stale` record).

### `test/sync.test.ts` addition

Add 1 case: read `.vibe/sync-manifest.json` from repo root, assert:
- `manifest.files.harness` includes `src/lib/sprint-status.ts`, `src/lib/project-map.ts`, `migrations/1.1.0.mjs`.
- `manifest.files.project` includes `.vibe/agent/project-map.json`, `.vibe/agent/sprint-api-contracts.json`.
- `manifest.migrations['1.1.0']` equals `'migrations/1.1.0.mjs'`.

### Run command

`npm test` (uses `node --import tsx --test test/*.test.ts`). All existing 34 tests must still pass.

---

## Verification

Run each of the following from the repo root (outside sandbox if sandbox blocks). Record exit codes in Final report:

| id | command | expect |
|---|---|---|
| tsc | `npx tsc --noEmit` | exit 0 |
| test | `npm test` | exit 0, all tests pass |
| migrate | `node migrations/1.1.0.mjs` | exit 0 (idempotent) |
| migrate-rerun | `node migrations/1.1.0.mjs` (2nd time) | exit 0, no file diff |
| preflight | `node scripts/vibe-preflight.mjs` | exit 0 |
| preflight-json | `node scripts/vibe-preflight.mjs --json` | valid JSON with at least one record having `"level":"ok"` for `handoff.stale` |
| bootstrap | `node scripts/vibe-preflight.mjs --bootstrap` | exit 0 |

---

## Checklist

- [ ] `sprint-status.schema.json` adds `pendingRisks` / `lastSprintScope` / `lastSprintScopeGlob` / `sprintsSinceLastAudit` / `stateUpdatedAt` / `verifiedAt` + `$defs.pendingRisk`. Existing fields untouched. Valid against `https://json-schema.org/draft/2020-12/schema` (parser loads without error).
- [ ] `project-map.schema.json` and `sprint-api-contracts.schema.json` created with draft 2020-12 `$schema`.
- [ ] `project-map.json` and `sprint-api-contracts.json` present with empty skeletons matching their schemas.
- [ ] `src/lib/sprint-status.ts` exports: `loadSprintStatus`, `saveSprintStatus`, `appendPendingRisk`, `resolvePendingRisk`, `incrementAuditCounter`, `resetAuditCounter`, `touchStateUpdated`, `markVerified`, `withDefaults`, `isSprintStatus`, `isPendingRisk`, and the types listed above. `npx tsc --noEmit` passes under `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`.
- [ ] `src/lib/project-map.ts` exports the surface in §5 and passes tsc.
- [ ] All writes go through `writeJson` from `src/lib/fs.ts`. Grep for `fs.writeFile\|writeFileSync` in the two new TS modules returns no hits.
- [ ] `migrations/1.1.0.mjs` is idempotent: running twice produces identical files (diff empty).
- [ ] `vibe-sprint-complete.mjs` accepts `--scope`, updates `stateUpdatedAt`, increments `sprintsSinceLastAudit` only on `passed`, and injects audit-required `pendingRisk` at threshold (with stable id).
- [ ] `vibe-preflight.mjs` `handoff.stale` uses `stateUpdatedAt` only; 5-min tolerance, INFO band up to 24h, never FAIL. Other checks' behaviour unchanged.
- [ ] `paths.ts` gains the 6 new entries without breaking callers.
- [ ] `sync-manifest.json` updated: harness additions + project additions + migrations map entry for `1.1.0`.
- [ ] `test/sprint-status.test.ts`, `test/project-map.test.ts`, `test/preflight-stale.test.ts` added. `test/sync.test.ts` gains manifest assertion case.
- [ ] `npm test` passes (34 existing + new cases).
- [ ] Final report includes a Verification table with every row in §Verification.

---

## Out of scope (recap — do NOT do)

- AST scan / file globbing in `project-map.ts`.
- Wrapper `vibe-sprint-commit.mjs`, session-log sorting, prompts archive, current-pointer maintenance.
- Glob harness dir support in `sync.ts`.
- Changing `sprint-status.schema.json` existing fields' meaning beyond tightening `handoff.updatedAt` description.
- Any change to `CLAUDE.md`, `_common-rules.md`, `re-incarnation.md`, `orchestration.md`.

---

## Final report format

See §9 of `_common-rules.md`. In addition, include:

- **Schema extension strategy** (1 sentence): "append-only optional fields; legacy files parse via `withDefaults`; migration 1.1.0 persists defaults on disk."
- **`stateUpdatedAt` transition note** (1 sentence): tools that authoritatively write it (`saveSprintStatus`, `touchStateUpdated`, `vibe-sprint-complete.mjs`, `migrations/1.1.0.mjs`) and what consumes it (`vibe-preflight.mjs handoff.stale`).
- **Audit-counter trigger note** (1 sentence): threshold source, id stability, idempotent re-insert.
- **Flagged risk for M3**: since M3 will add `vibe-sprint-commit.mjs` + dynamic scope detection from git-staged files, the M1-stored `lastSprintScope` format (verbatim path list) must stay compatible — M3 should read-and-extend, not rewrite.
