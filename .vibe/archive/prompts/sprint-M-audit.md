# Sprint M-audit — audit gate + Zod schema validation + lightweight per-sprint audit

> Harness iteration-2 / v1.4.0 first slot (P0 Blocker).
> Resolves `dogfood7/docs/reports/review-10-2026-04-16.md` findings #1 (evaluator-audit-overdue), #2 (status-json-schema-drift), #8 (tmp-debug-scripts-residue).

---

## 0. Common rules (MUST READ FIRST)

- `.vibe/agent/_common-rules.md` **전체** 준수. 특히 **§14 Wiring Integration Checklist** — Final report 에 `## Wiring Integration` 섹션 **없으면 Sprint incomplete 로 간주**.
- `§13 Sandbox-bound Generator invariants` — Generator 는 `npm install` 금지. Zod / zod-to-json-schema 는 Orchestrator 가 샌드박스 밖에서 사전 설치한다고 가정 (`# NOTE TO GENERATOR` 참조).
- `§12 단일 커밋 원칙` — Sprint 완료 시 Generator 산출 + state 3종을 한 커밋에.
- `§4 strict TS / no any / ESM only` — `src/lib/schemas/*.ts` 전부 strict + `exactOptionalPropertyTypes` 통과해야 한다.

# NOTE TO GENERATOR

다음 deps 는 **Orchestrator 가 사전 설치한다** (Generator 는 `npm install` 실행 금지):

```
dependencies:
  zod: ^3.23.0
devDependencies:
  zod-to-json-schema: ^3.23.0
```

`package.json` 수정은 당신이 하되, 실제 `node_modules` 설치는 Orchestrator 가 책임.

---

## 1. Goal

vibe-doctor 하네스 의 **state validation 단일 소스** 를 Zod 로 통합하고, **audit cadence** 를 MD 권고에서 **script gate** 로 승격한다. 동시에 **lightweight per-sprint audit** 인프라를 도입하여 heavyweight Evaluator 소환 없이도 매 sprint 의 기초 건강성 검증을 자동화한다. 이 Sprint 는 dogfood7 review 의 3개 finding (#1, #2, #8) 을 해결하고, iteration-2 나머지 Sprint (M-process-discipline / M-harness-gates) 의 기반을 제공한다.

---

## 2. Scope

### 2.1 Files to CREATE

#### Schema 레이어 (Zod single source)
- `src/lib/schemas/sprint-status.ts` — `SprintStatusSchema` (Zod) + `z.infer` 파생 TS types. 현 수동 validator 의 모든 필드 + dogfood7 에서 drift 드러난 필드 (`verificationCommands[]` top-level, `handoff.orchestratorContextBudget`, `handoff.preferencesActive`) 반드시 포함. `verifiedAt: z.string().datetime().nullable().optional()` 로 **null 허용** (dogfood7 #2 해결).
- `src/lib/schemas/project-map.ts` — `ProjectMapSchema` (기존 `project-map.schema.json` 과 구조 동등).
- `src/lib/schemas/sprint-api-contracts.ts` — `SprintApiContractsSchema`.
- `src/lib/schemas/iteration-history.ts` — `IterationHistorySchema` (기존 `iteration-history.schema.json` 과 동등; `additionalProperties: true` → Zod `.passthrough()`).
- `src/lib/schemas/model-registry.ts` — `ModelRegistrySchema` (기존 `.vibe/model-registry.schema.json` 과 동등).
- `src/lib/schemas/index.ts` — 배럴 export + `parseStateFile(name, content)` util + `STATE_FILE_SCHEMAS` map + `generateFixSuggestion(zodError)` helper.

#### 스크립트 (audit gates + schema generation)
- `scripts/vibe-gen-schemas.mjs` — Zod → JSON schema 변환기. `zod-to-json-schema` 사용. CLI:
  - `--check` : 현재 파일과 regenerated 결과 비교. diff 있으면 exit 1.
  - `--write` : 5개 `.schema.json` 파일 덮어쓰기.
  - 기본 (arg 없음) : `--check` 와 동일.
- `scripts/vibe-audit-lightweight.mjs` — per-sprint 자동 감사. CLI: `node scripts/vibe-audit-lightweight.mjs <sprintId> [--prev-commit=<sha>]`.
  - 체크 1: `git diff --stat <prev-commit>..HEAD` 파싱 → 변경 파일 수 / LOC delta / extension 분포.
  - 체크 2: commit message 본문에서 spec keyword (`rate-limit`, `limit`, `spec`, `max`, `min`, 숫자 + 단위 토큰) 추출 → 실제 touched 파일에서 해당 keyword/상수값 grep. Mismatch 시 flag.
  - 체크 3: 신규 `src/` 파일 당 대응 `test/` 파일 존재 여부 (naming convention: `src/lib/foo.ts` → `test/foo.test.ts`).
  - 체크 4: LOC outlier (프로젝트 이력 평균 ± 3σ 기준 — `sprint-status.json.sprints[].actualLoc` 로부터 계산). 샘플 < 3 이면 skip.
  - 체크 5: `scripts/tmp-*.{ts,mjs}` 잔존 여부.
  - 출력: flag 내역 JSON to stdout + `sprint-status.json.pendingRisks` 에 `lightweight-audit-<sprintId>` entry 주입 (severity=info, status=open, targetSprint=`*`, text=flag 요약). Flag 없으면 주입 생략.
  - Exit code: **항상 0** (non-blocking INFO). Script 자체 에러만 exit 1.

#### Migration
- `migrations/1.4.0.mjs` — idempotent. 다음을 수행:
  - `sprint-status.json` 을 읽어 `SprintStatusSchema.safeParse()` 통과 여부 확인. 실패 필드만 기본값으로 patch (예: `verifiedAt: null`, `handoff.orchestratorContextBudget: 'medium'`, `handoff.preferencesActive: []`).
  - 기존 1.1.0 migration 과 호환 (이미 1.1.0 적용된 파일은 idempotent pass).
  - `.vibe/config.json.harnessVersionInstalled` 를 `1.4.0` 으로 갱신 (compareVersions 기반).
  - 2회 연속 실행 시 두 번째는 완전 no-op (stdout 에 `idempotent` 출력).

#### 테스트
- `test/schemas.test.ts` — 각 5개 Zod schema 에 대해 3 케이스:
  1. Real production payload (`.vibe/agent/*.json` 현 파일 내용) `.parse()` 성공.
  2. `SchemaName.parse({})` 가 default 로 populate 되어 성공 (해당 schema 에 bootstrap default 가 있는 경우만 — sprint-status 는 yes, 나머지는 required field 있어 Zod error throw 기대).
  3. Invalid payload (e.g. `{ schemaVersion: 123 }`) 에서 `ZodError` throw.
- `test/preflight-audit-gate.test.ts` — 임시 디렉토리에 가짜 `.vibe/agent/sprint-status.json` 쓰고 `spawnSync('node', ['scripts/vibe-preflight.mjs'])` 로:
  - `sprintsSinceLastAudit=10` → exit 1.
  - `pendingRisks` 에 `audit-required` entry 존재 → exit 1.
  - `--ack-audit-overdue=sprint-test:manual-review` → exit 0 + session-log 에 `[decision][audit-ack]` entry append 확인.
  - `--bootstrap` → audit gate skip, exit 0 (other check 통과 가정).
- `test/audit-lightweight.test.ts` — `execFileSync('node', ['scripts/vibe-audit-lightweight.mjs', 'sprint-test'])` 를 여러 fixture 로:
  - 정상 diff → flag 0, pendingRisks 주입 없음.
  - tmp-*.ts 파일 있는 fixture → flag 발생, pendingRisks 주입.
  - 테스트 누락 fixture (src/lib/foo.ts 만 추가) → flag 발생.
  - Script 항상 exit 0.

### 2.2 Files to MODIFY

#### Core lib (Zod 기반 재작성 — 기존 시그니처 유지, backward compat)
- `src/lib/sprint-status.ts`:
  - 수동 `isSprintStatus` / `isSprintEntry` / `isHandoffBlock` / `isPendingRisk` / `withDefaults` → `SprintStatusSchema.safeParse()` / `.parse()` 기반으로 재작성.
  - 기존 export (`loadSprintStatus`, `saveSprintStatus`, `appendPendingRisk`, `resolvePendingRisk`, `resolvePendingRisksByPrefix`, `incrementAuditCounter`, `resetAuditCounter`, `touchStateUpdated`, `markVerified`, `extendLastSprintScope`, `isSprintStatus`, `isPendingRisk`, `withDefaults`, interface types) **시그니처 전부 유지** — 내부 구현만 교체.
  - `isSprintStatus(v)` → `SprintStatusSchema.safeParse(v).success` wrapper 로 유지 (backward compat).
  - `SprintStatus` / `PendingRisk` / `VerificationCommand` / 등 interface 는 `z.infer<typeof ...Schema>` 로 재정의.
- `src/lib/project-map.ts` — 동일 패턴. `ProjectMapSchema` 기반. 기존 export 시그니처 유지.

#### Preflight (audit gate + state validation)
- `scripts/vibe-preflight.mjs`:
  - **최상단 (check 1 git.worktree 이전)** 에 `state.schema` check 단계 추가:
    - `.vibe/agent/sprint-status.json`, `project-map.json`, `sprint-api-contracts.json`, `iteration-history.json`, `.vibe/model-registry.json` 5개 파일 순회.
    - 각 파일을 `schemas/index.ts.parseStateFile(name, content)` 로 validation.
    - 파일 없으면 skip (첫 sprint OK). 파일 있고 invalid 면 `record('state.schema.<name>', false, ...)` + `generateFixSuggestion()` 결과를 detail 에 포함. **silent auto-fix 금지**.
    - Bootstrap 모드에서는 skip.
  - **audit overdue gate** 추가 (체크 6 `phase0.product` 근처, 단 `--bootstrap` 제외):
    - 조건: `sprintStatus.sprintsSinceLastAudit >= auditEveryN` OR `sprintStatus.pendingRisks.filter(r => r.status === 'open' && r.id.startsWith('audit-')).length > 0`.
    - `auditEveryN` 은 `.vibe/config.json.audit.everyN` (default 5).
    - 조건 충족 시 `record('audit.overdue', false, 'audit required — run vibe-audit-clear or acknowledge with --ack-audit-overdue=<sprintId>:<reason>', 'fail')`.
    - Bypass: CLI arg `--ack-audit-overdue=<sprintId>:<reason>` (= 기호 이후 전체). Parse 성공 시:
      - `.vibe/agent/session-log.md` 의 `## Entries` 섹션에 `- <ISO> [decision][audit-ack] sprint=<sprintId> reason=<reason>` 한 줄 append.
      - `record('audit.overdue', true, 'acknowledged: sprint=<sprintId> reason=<reason>', 'warn')`.
    - `--ack-audit-overdue` 파싱은 `sprintId:reason` 형식. `:` 없으면 오류 메시지 후 exit 1.
  - Import from `src/lib/schemas/index.ts`: Node ESM `.mjs` 에서 `.ts` import 불가 → **scripts/vibe-preflight.mjs 는 `.mjs` 유지하되 schema validation 로직은 inline JS 포팅** (schemas 를 `.mjs` 에서 `import { SprintStatusSchema } from '../src/lib/schemas/...'` 시도 X. 대신 **compiled output** 또는 **런타임에 `npx tsx` 로 wrapping** 은 preflight 가 이미 node 바이너리 전용이라 부적합 → **단순 구현**: preflight 가 내부적으로 `execFileSync('npx', ['tsx', 'scripts/vibe-validate-state.ts'])` 로 TS helper 위임. 또는 schemas 배럴에서 zod 정의를 `.mjs` 변형으로 복제).
  - 권장 접근: `scripts/vibe-validate-state.mjs` 신규 (`.mjs` ESM) 를 추가 생성 — zod 를 직접 import 하여 5 schema 검증 + fix suggestion stdout JSON 출력. preflight 가 `execFileSync('node', ['scripts/vibe-validate-state.mjs'])` 호출. Schema 정의는 **중복 방지를 위해 `src/lib/schemas/*.ts` 와 `scripts/vibe-validate-state.mjs` 가 같은 파일을 import 하도록** — Node 24 는 `.ts` import 를 direct 지원하지 않으므로 **TS 를 tsx 로 로드 or schemas 를 pure JS 로 이동**.
  - **최종 설계 (Generator 가 반드시 이 형태로 구현)**: `src/lib/schemas/*.ts` 가 single source. `scripts/vibe-validate-state.mjs` 는 `npx tsx --eval` 또는 `child_process.execFileSync('npx', ['tsx', '--eval', '...'])` 대신, **TS 파일을 직접 로드하기 위해 `node --import tsx/esm` 을 사용**. 즉 preflight 가 내부에서 `spawnSync(process.execPath, ['--import', 'tsx', 'scripts/vibe-validate-state.ts'], ...)` 로 위임. `scripts/vibe-validate-state.ts` 신규 (TypeScript) — 5 파일 validate + JSON stdout. 이 방식으로 schema 정의는 TS single source 유지.
  - 신규 파일로 `scripts/vibe-validate-state.ts` 추가 (위 설계). `test/*.test.ts` 이미 `node --import tsx --test` 로 돌아가므로 같은 패턴 차용 가능.

#### Sprint complete hook
- `scripts/vibe-sprint-complete.mjs`:
  - Write 직전 (최종 `saveSprintStatus` 호출 전) 에 `spawnSync(process.execPath, ['--import', 'tsx', 'scripts/vibe-validate-state.ts'])` 호출. exit ≠ 0 이면 abort (write 안 함) + stderr 에 reason.
  - 완료 후 lightweight audit 호출: `spawnSync('node', ['scripts/vibe-audit-lightweight.mjs', sprintId])` — 실패해도 continue (non-blocking). 결과는 stderr 로 로깅.

#### Sync manifest
- `.vibe/sync-manifest.json`:
  - `files.harness[]` 에 다음 파일 추가:
    - `src/lib/schemas/sprint-status.ts`
    - `src/lib/schemas/project-map.ts`
    - `src/lib/schemas/sprint-api-contracts.ts`
    - `src/lib/schemas/iteration-history.ts`
    - `src/lib/schemas/model-registry.ts`
    - `src/lib/schemas/index.ts`
    - `scripts/vibe-gen-schemas.mjs`
    - `scripts/vibe-audit-lightweight.mjs`
    - `scripts/vibe-validate-state.ts`
    - `migrations/1.4.0.mjs`
    - `test/schemas.test.ts`
    - `test/preflight-audit-gate.test.ts`
    - `test/audit-lightweight.test.ts`
    - `docs/release/v1.4.0.md`
  - `migrations` 맵에 `"1.4.0": "migrations/1.4.0.mjs"` 추가.

#### Generated schema files (auto-generated, do NOT hand-edit)
- `.vibe/agent/sprint-status.schema.json` — `vibe-gen-schemas.mjs --write` 결과로 덮어쓰기. 기존 x-purpose 같은 Zod 표현 불가한 메타는 **상단 주석 블록**으로 보존하거나 손실 허용 (dogfood7 에서 사용자가 JSON schema 를 직접 읽지 않는다는 확인).
- `.vibe/agent/project-map.schema.json` — 동일.
- `.vibe/agent/sprint-api-contracts.schema.json` — 동일.
- `.vibe/agent/iteration-history.schema.json` — 동일.
- `.vibe/model-registry.schema.json` — 동일.
- 모두 Zod 파생. 기존 형식/metadata 일부 손실은 Deviations 에 명시.

#### Config files
- `.gitignore` — 다음 패턴 추가 (중복 없이):
  ```
  scripts/tmp-*.ts
  scripts/tmp-*.mjs
  ```
- `package.json`:
  - `dependencies.zod`: `^3.23.0` 추가.
  - `devDependencies["zod-to-json-schema"]`: `^3.23.0` 추가.
  - `scripts["vibe:gen-schemas"]`: `"node scripts/vibe-gen-schemas.mjs"`.
  - `scripts["vibe:audit-lightweight"]`: `"node scripts/vibe-audit-lightweight.mjs"`.
  - **주의**: `dependencies` 에 zod 를 넣는 이유는 런타임 validation (preflight / sprint-complete) 에서 사용되기 때문.

#### Documentation
- `CLAUDE.md`:
  - §훅 강제 메커니즘 테이블에 두 행 추가:
    | Sprint 완료 시 | `node scripts/vibe-audit-lightweight.mjs` | diff stats / spec keyword / test coverage / tmp 잔존 — pendingRisks INFO 주입 |
    | 사전 준비 / CI | `node scripts/vibe-gen-schemas.mjs --check` | Zod source ↔ `.schema.json` drift 감지 |
  - 2단 감사 convention 명문화 블록 신규 추가 (§ 트리거 매트릭스 근처):
    - Lightweight per-sprint: 자동 스크립트, non-blocking INFO.
    - Heavyweight per-N: Evaluator 실제 소환, audit gate block. `--ack-audit-overdue` 우회 절차 명시.
  - "audit-skipped-mode" directive (사용자가 자율 모드로 audit skip 을 명시 인가한 경우) 를 공식 라벨로 인정하되 session-log 영구 기록 강제 (미래 M-harness-gates 에서 scripting — 본 Sprint 는 policy 문서화만).
- `docs/context/harness-gaps.md`:
  - 기존 `gap-rule-only-in-md` 행의 `covered_by` / `status` 갱신: "audit cadence 가 preflight script gate 로 강제됨 (M-audit). 나머지 MD 룰은 M-harness-gates 이후 점진 승격" — status 는 `partial` 유지 (Planner skip 룰은 M-process-discipline 에서 처리).
  - 필요 시 새 entry `gap-zod-single-source` 추가: covered_by = `src/lib/schemas/*.ts` + `vibe-gen-schemas.mjs`, status = `covered`.
- `docs/release/v1.4.0.md` — **신규 파일**. iteration-2 의 릴리스 노트 seed. 본 Sprint 변경점을 "## M-audit" 섹션에 기록. 이후 M-process-discipline / M-harness-gates 가 누적 append.
- `README.md` — 사용자 가시 섹션에 두 줄 추가:
  - `npm run vibe:gen-schemas` — Zod source 로부터 `.schema.json` regenerate.
  - `npm run vibe:audit-lightweight <sprintId>` — per-sprint 자동 감사 (non-blocking).

### 2.3 Files to DELETE

없음. 기존 수동 `.schema.json` 은 `--write` 로 **덮어쓰기만**, 삭제하지 않는다.

### 2.4 Do NOT modify

- `.vibe/agent/sprint-status.json` (내용 — migration 외 편집 금지. 필드 추가는 migrations/1.4.0.mjs 가 처리)
- `.vibe/agent/handoff.md`, `session-log.md` (Orchestrator 가 완료 후 vibe-sprint-complete 통해 갱신)
- 기존 `migrations/1.0.0.mjs` ~ `1.3.0.mjs` (과거 migration 수정 금지)
- `.claude/agents/planner.md` (M-process-discipline 에서 교체 — 본 Sprint 범위 밖)
- `scripts/vibe-audit-clear.mjs` (현 동작 유지. 본 Sprint 는 heavyweight audit 경로 변경 X)

---

## 3. Technical specifications

### 3.1 Zod schema 구조 예시 (sprint-status)

```ts
// src/lib/schemas/sprint-status.ts
import { z } from 'zod';

export const PendingRiskSchema = z.object({
  id: z.string(),
  raisedBy: z.string(),
  targetSprint: z.string(),
  text: z.string(),
  status: z.enum(['open', 'acknowledged', 'resolved']),
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
});

export const VerificationCommandSchema = z.object({
  id: z.string(),
  command: z.string(),
  expectExitCode: z.number().int().default(0),
  expectStdoutContains: z.string().optional(),
  introducedInSprint: z.string().optional(),
  runOutsideSandbox: z.boolean().optional(),
});

export const ActualLocSchema = z.object({
  added: z.number().int(),
  deleted: z.number().int(),
  net: z.number().int(),
  filesChanged: z.number().int(),
});

export const SprintEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['planned', 'in_progress', 'passed', 'failed', 'skipped']),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  planPromptPath: z.string().optional(),
  generatorReportPath: z.string().optional(),
  evaluatorVerdict: z.enum(['pass', 'fail', 'skipped']).optional(),
  addedVerificationCommands: z.array(VerificationCommandSchema).optional(),
  deviations: z.array(z.string()).optional(),
  actualLoc: ActualLocSchema.optional(),
});

export const HandoffBlockSchema = z.object({
  currentSprintId: z.string(),
  lastActionSummary: z.string(),
  openIssues: z.array(z.string()).optional(),
  orchestratorContextBudget: z.enum(['low', 'medium', 'high']),
  preferencesActive: z.array(z.string()),
  handoffDocPath: z.string().optional(),
  updatedAt: z.string().datetime().optional(),
});

export const SandboxNoteSchema = z.object({
  command: z.string(),
  reason: z.string(),
  runOutsideSandbox: z.boolean().optional(),
});

export const SprintStatusSchema = z.object({
  $schema: z.string().optional(),
  schemaVersion: z.literal('0.1'),
  project: z.object({
    name: z.string(),
    createdAt: z.string().datetime(),
    runtime: z.string().optional(),
    framework: z.string().optional(),
  }),
  sprints: z.array(SprintEntrySchema),
  verificationCommands: z.array(VerificationCommandSchema),
  handoff: HandoffBlockSchema.optional(),
  sandboxNotes: z.array(SandboxNoteSchema).optional(),
  pendingRisks: z.array(PendingRiskSchema).default([]),
  lastSprintScope: z.array(z.string()).default([]),
  lastSprintScopeGlob: z.array(z.string()).default([]),
  sprintsSinceLastAudit: z.number().int().min(0).default(0),
  stateUpdatedAt: z.string().datetime().optional(),
  verifiedAt: z.string().datetime().nullable().optional(),
});

export type SprintStatus = z.infer<typeof SprintStatusSchema>;
export type PendingRisk = z.infer<typeof PendingRiskSchema>;
export type VerificationCommand = z.infer<typeof VerificationCommandSchema>;
export type ActualLoc = z.infer<typeof ActualLocSchema>;
export type SprintEntry = z.infer<typeof SprintEntrySchema>;
export type HandoffBlock = z.infer<typeof HandoffBlockSchema>;
export type SandboxNote = z.infer<typeof SandboxNoteSchema>;
```

> **중요**: 현 `src/lib/sprint-status.ts` 의 `HandoffBlock` 에 있는 `orchestratorContextBudget`, `preferencesActive` 는 schema 에도 required 로 포함. Dogfood7 bootstrap 이 이 두 필드를 누락해 throw 한 원인이 여기서 해결됨.

### 3.2 parseStateFile 인터페이스

```ts
// src/lib/schemas/index.ts
import { z, ZodError } from 'zod';
import { SprintStatusSchema } from './sprint-status.js';
import { ProjectMapSchema } from './project-map.js';
import { SprintApiContractsSchema } from './sprint-api-contracts.js';
import { IterationHistorySchema } from './iteration-history.js';
import { ModelRegistrySchema } from './model-registry.js';

export const STATE_FILE_SCHEMAS = {
  'sprint-status.json': SprintStatusSchema,
  'project-map.json': ProjectMapSchema,
  'sprint-api-contracts.json': SprintApiContractsSchema,
  'iteration-history.json': IterationHistorySchema,
  'model-registry.json': ModelRegistrySchema,
} as const;

export type StateFileName = keyof typeof STATE_FILE_SCHEMAS;

export interface ParseStateResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  fixSuggestion?: string;
}

export function parseStateFile(name: string, content: string): ParseStateResult {
  const schema = (STATE_FILE_SCHEMAS as Record<string, z.ZodTypeAny>)[name];
  if (!schema) return { ok: false, error: `Unknown state file: ${name}` };

  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (e) {
    return { ok: false, error: `JSON parse error: ${(e as Error).message}` };
  }

  const parsed = schema.safeParse(json);
  if (parsed.success) return { ok: true, data: parsed.data };

  return {
    ok: false,
    error: parsed.error.message,
    fixSuggestion: generateFixSuggestion(parsed.error),
  };
}

export function generateFixSuggestion(err: ZodError): string {
  const issues = err.issues.slice(0, 5).map((issue) => {
    const path = issue.path.join('.');
    return `- ${path}: ${issue.message} (code=${issue.code})`;
  });
  return `Missing/invalid fields:\n${issues.join('\n')}\n\nSuggested: run 'node migrations/1.4.0.mjs' to patch bootstrap defaults.`;
}

export { SprintStatusSchema, ProjectMapSchema, SprintApiContractsSchema, IterationHistorySchema, ModelRegistrySchema };
```

### 3.3 preflight audit gate — 의사코드

```js
// scripts/vibe-preflight.mjs 내부

// 최상단 (기존 check 1 git.worktree 이전)
if (!BOOTSTRAP_MODE) {
  const stateValidation = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/vibe-validate-state.ts'], {
    encoding: 'utf8',
  });
  if (stateValidation.status !== 0) {
    // stderr 에 fix suggestion 포함된 JSON 기대
    const parsed = JSON.parse(stateValidation.stderr || stateValidation.stdout || '{"errors":[]}');
    for (const err of parsed.errors) {
      record(`state.schema.${err.file}`, false, `${err.message}\n  suggest: ${err.fixSuggestion}`, 'fail');
    }
  } else {
    record('state.schema', true, 'all 5 state files valid');
  }
}

// audit overdue gate (기존 check 6 phase0.product 근처)
const ackArg = process.argv.find((a) => a.startsWith('--ack-audit-overdue='));
let ackSprintId = null;
let ackReason = null;
if (ackArg) {
  const raw = ackArg.slice('--ack-audit-overdue='.length);
  const colonIdx = raw.indexOf(':');
  if (colonIdx === -1) {
    process.stderr.write(`invalid --ack-audit-overdue format (expect <sprintId>:<reason>)\n`);
    process.exit(1);
  }
  ackSprintId = raw.slice(0, colonIdx);
  ackReason = raw.slice(colonIdx + 1);
}

if (!BOOTSTRAP_MODE && sprintStatus) {
  const auditEveryN = cfg?.audit?.everyN ?? 5;
  const openAuditRisks = (sprintStatus.pendingRisks ?? []).filter(
    (r) => r.status === 'open' && String(r.id).startsWith('audit-'),
  );
  const overdueByCount = (sprintStatus.sprintsSinceLastAudit ?? 0) >= auditEveryN;
  const overdueByRisks = openAuditRisks.length > 0;

  if (overdueByCount || overdueByRisks) {
    if (ackSprintId) {
      // session-log 에 [decision][audit-ack] append
      const nowIso = new Date().toISOString();
      const entry = `- ${nowIso} [decision][audit-ack] sprint=${ackSprintId} reason=${ackReason}`;
      const current = readFileSync(sessionLogPath, 'utf8');
      const updated = current.replace(/^## Entries\s*$/m, (m) => `${m}\n\n${entry}`);
      writeFileSync(sessionLogPath, updated, 'utf8');
      record('audit.overdue', true, `acknowledged: sprint=${ackSprintId} reason=${ackReason}`, 'warn');
    } else {
      const reason = overdueByCount
        ? `sprintsSinceLastAudit=${sprintStatus.sprintsSinceLastAudit} >= ${auditEveryN}`
        : `${openAuditRisks.length} open audit-* pendingRisks`;
      record(
        'audit.overdue',
        false,
        `${reason}. Bypass: --ack-audit-overdue=<sprintId>:<reason> or run vibe-audit-clear`,
        'fail',
      );
    }
  } else {
    record('audit.overdue', true, `ok (counter=${sprintStatus.sprintsSinceLastAudit}/${auditEveryN})`);
  }
}
```

### 3.4 vibe-validate-state.ts (신규)

```ts
#!/usr/bin/env node
// Validates all 5 state files against Zod schemas. Emits JSON errors on stderr.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseStateFile, type StateFileName } from '../src/lib/schemas/index.js';

const files: Array<{ name: StateFileName; path: string }> = [
  { name: 'sprint-status.json', path: '.vibe/agent/sprint-status.json' },
  { name: 'project-map.json', path: '.vibe/agent/project-map.json' },
  { name: 'sprint-api-contracts.json', path: '.vibe/agent/sprint-api-contracts.json' },
  { name: 'iteration-history.json', path: '.vibe/agent/iteration-history.json' },
  { name: 'model-registry.json', path: '.vibe/model-registry.json' },
];

const errors: Array<{ file: string; message: string; fixSuggestion?: string }> = [];

for (const f of files) {
  const abs = resolve(f.path);
  if (!existsSync(abs)) continue; // skip missing (first sprint OK)
  const result = parseStateFile(f.name, readFileSync(abs, 'utf8'));
  if (!result.ok) {
    errors.push({ file: f.name, message: result.error ?? 'unknown', fixSuggestion: result.fixSuggestion });
  }
}

if (errors.length > 0) {
  process.stderr.write(JSON.stringify({ errors }) + '\n');
  process.exit(1);
}
process.exit(0);
```

### 3.5 vibe-audit-lightweight.mjs 알고리즘

```
1. Parse CLI: sprintId (required), --prev-commit=<sha> (optional).
2. Determine diff range:
   - If --prev-commit given, use <prev-commit>..HEAD.
   - Else try HEAD~1..HEAD. If fails (initial commit), skip diff checks.
3. Run 5 checks → collect flags[].
4. If flags.length > 0:
   - Load sprint-status.json.
   - Append pendingRisks entry:
     { id: `lightweight-audit-${sprintId}`, raisedBy: 'vibe-audit-lightweight',
       targetSprint: '*', text: <flag summary>, status: 'open',
       createdAt: <now ISO> }.
   - Skip if same id already exists (idempotent).
   - Save.
5. Output JSON to stdout: { sprintId, flags: [...], risksInjected: boolean }.
6. Exit 0 (always, unless script itself errors).
```

Spec keyword extraction (check 2): 커밋 메시지에서 정규식 `/\b(rate-limit|limit|max|min|cap|ttl|quota)\b\s*[:=]?\s*(\d+\s*(?:\/[a-z]+|m|s|ms|h|d)?)/gi` 로 pair 추출 → touched 파일에서 해당 숫자 grep.

### 3.6 vibe-gen-schemas.mjs — 설계

```js
#!/usr/bin/env node
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
// NOTE: .mjs cannot import .ts directly → this script delegates TS loading via tsx.
// Simpler approach: ship a companion scripts/vibe-gen-schemas-impl.ts that does the work,
// and vibe-gen-schemas.mjs spawns it with --import tsx.

const mode = process.argv.includes('--write') ? 'write' : 'check';
const result = spawnSync(process.execPath, [
  '--import', 'tsx',
  'scripts/vibe-gen-schemas-impl.ts',
  `--mode=${mode}`,
], { encoding: 'utf8', stdio: 'inherit' });
process.exit(result.status ?? 1);
```

`scripts/vibe-gen-schemas-impl.ts` 신규 (위 위임 대상). STATE_FILE_SCHEMAS 순회 → `zodToJsonSchema(schema, { name, target: 'jsonSchema7' })` → 파일 경로 매핑:
- `sprint-status.json` → `.vibe/agent/sprint-status.schema.json`
- `project-map.json` → `.vibe/agent/project-map.schema.json`
- `sprint-api-contracts.json` → `.vibe/agent/sprint-api-contracts.schema.json`
- `iteration-history.json` → `.vibe/agent/iteration-history.schema.json`
- `model-registry.json` → `.vibe/model-registry.schema.json`

`--check` 모드: regenerated JSON 과 현 파일 `JSON.stringify(..., null, 2)` 비교. diff 있으면 stderr 에 파일명 + `git diff` 스타일 diff 출력 후 exit 1.
`--write` 모드: 덮어쓰기 + exit 0.

> `scripts/vibe-gen-schemas-impl.ts` 도 `files.harness[]` 에 추가. 본 scope §2.1 "신규 파일" 목록에 추가 예정 — **아래 Wiring 체크리스트 W6 에 포함 확인**.

### 3.7 migrations/1.4.0.mjs — 설계

```js
#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
// ... (1.3.0.mjs 패턴 참조)

function patchSprintStatus(root) {
  const p = path.join(root, '.vibe', 'agent', 'sprint-status.json');
  if (!existsSync(p)) return 'missing';

  const raw = JSON.parse(readFileSync(p, 'utf8'));
  let mutated = false;

  // verifiedAt: null 허용 전환 — 기존 값이 string 이 아니면 null 로
  if (raw.verifiedAt === undefined) {
    raw.verifiedAt = null;
    mutated = true;
  }

  // handoff.orchestratorContextBudget 기본값
  if (raw.handoff && raw.handoff.orchestratorContextBudget === undefined) {
    raw.handoff.orchestratorContextBudget = 'medium';
    mutated = true;
  }

  // handoff.preferencesActive 기본값
  if (raw.handoff && raw.handoff.preferencesActive === undefined) {
    raw.handoff.preferencesActive = [];
    mutated = true;
  }

  // verificationCommands top-level 누락 시
  if (raw.verificationCommands === undefined) {
    raw.verificationCommands = [];
    mutated = true;
  }

  if (!mutated) return 'idempotent';
  writeJson(p, raw);
  return 'patched';
}

function updateConfig(root) {
  // harnessVersionInstalled → 1.4.0
  // ... (1.3.0.mjs 와 동일 패턴)
}

// main: patchSprintStatus + updateConfig + stdout log
```

---

## 4. Test strategy

- `test/schemas.test.ts` (3 × 5 = 15 case):
  - `SprintStatusSchema.parse(readFileSync('.vibe/agent/sprint-status.json'))` 성공.
  - `SprintStatusSchema.safeParse({ schemaVersion: '0.1' })` → invalid (missing required project).
  - `SprintStatusSchema.parse({ schemaVersion: '0.1', project: {...}, sprints: [], verificationCommands: [] })` → success + `pendingRisks` 등 default 적용 확인.
  - 나머지 4 schema 도 동일 패턴.
- `test/preflight-audit-gate.test.ts`:
  - 임시 tmpdir 에 fixture 작성 → `spawnSync('node', ['scripts/vibe-preflight.mjs'], { cwd: tmpdir })`.
  - sprintsSinceLastAudit=10 → status=1, stdout 에 `[FAIL] audit.overdue` 포함.
  - `--ack-audit-overdue=sprint-M-audit:manual-review` → status=0, session-log 에 `[decision][audit-ack]` line 존재.
  - pendingRisks `audit-after-S05` (open) → status=1.
  - `--bootstrap` → audit gate skip.
- `test/audit-lightweight.test.ts`:
  - Fixture 1: normal diff → flags=0, pendingRisks 변화 없음.
  - Fixture 2: `scripts/tmp-debug.ts` 존재 → flag 발생, pendingRisks 주입.
  - Fixture 3: `src/lib/newfoo.ts` 추가, `test/newfoo.test.ts` 없음 → flag 발생.
  - 모든 케이스 script exit 0.
- **기존 테스트 업데이트**:
  - `test/sprint-status.test.ts` — Zod 기반 재작성. `isSprintStatus` / `withDefaults` 호출 테스트는 유지 (시그니처 불변).
  - `test/project-map.test.ts` — Zod 기반 재작성.
- `package.json scripts.test` 실행 시 전부 pass. 기존 pass 숫자 유지 + 신규 15+4+3 = 22 case 추가.

---

## 5. §14 Wiring Integration Checklist — 반드시 Final report 에 이 표 포함

| # | 체크포인트 | 본 Sprint 의 touched 대상 | Expected status |
|---|---|---|---|
| W1 | CLAUDE.md 훅 테이블 | `vibe-audit-lightweight.mjs` + `vibe-gen-schemas.mjs` 2행 추가 | touched |
| W2 | CLAUDE.md 관련 스킬 | — (신규 슬래시 커맨드 없음) | n/a |
| W3 | CLAUDE.md Sprint flow 번호 | — (flow 변경 없음) | n/a |
| W4 | `.claude/settings.json` hook | — (SessionStart/Stop 등 추가 없음) | n/a |
| W5 | `.claude/settings.json` statusLine | — | n/a |
| W6 | `.vibe/sync-manifest.json` `files.harness[]` | 14 파일 + `scripts/vibe-gen-schemas-impl.ts` 합쳐 **15 entry** 추가, `migrations` 맵에 `1.4.0` 추가 | touched |
| W7 | `sync-manifest.json` hybrid harnessKeys | — (`dependencies` 는 이미 projectKeys, Zod 추가는 projectKeys 영역이므로 수정 불요) | n/a |
| W8 | README.md | `vibe:gen-schemas` / `vibe:audit-lightweight` 두 줄 추가 | touched |
| W9 | package.json `scripts.vibe:*` | `vibe:gen-schemas` + `vibe:audit-lightweight` 2개 추가 | touched |
| W10 | docs/release/v1.4.0.md | 신규 작성 — "## M-audit" 섹션으로 시작 | touched |
| W11 | `migrations/1.4.0.mjs` + `sync-manifest.migrations` map | 추가 | touched |
| W12 | test/*.test.ts 회귀 | 3 신규 + 2 업데이트 | touched |
| W13 | `docs/context/harness-gaps.md` | `gap-rule-only-in-md` covered_by 갱신 (여전히 partial 유지), 신규 `gap-zod-single-source` = covered append | touched |
| W14 | `.gitignore` | `scripts/tmp-*.{ts,mjs}` 2 pattern 추가 | touched |

### verified-callers (Final report 필수)

각 신규 파일 당 grep 확인된 실 호출처 명시:

- `src/lib/schemas/sprint-status.ts` → `src/lib/sprint-status.ts` (import), `src/lib/schemas/index.ts` (re-export), `scripts/vibe-validate-state.ts` (via barrel)
- `src/lib/schemas/project-map.ts` → `src/lib/project-map.ts`, `src/lib/schemas/index.ts`
- `src/lib/schemas/sprint-api-contracts.ts` → `src/lib/schemas/index.ts`
- `src/lib/schemas/iteration-history.ts` → `src/lib/schemas/index.ts`
- `src/lib/schemas/model-registry.ts` → `src/lib/schemas/index.ts`, 기존 `src/lib/model-registry.ts` 에서 import (호환)
- `src/lib/schemas/index.ts` → `scripts/vibe-validate-state.ts`, `scripts/vibe-gen-schemas-impl.ts`, `test/schemas.test.ts`
- `scripts/vibe-validate-state.ts` → `scripts/vibe-preflight.mjs` (spawnSync), `scripts/vibe-sprint-complete.mjs` (pre-write guard)
- `scripts/vibe-audit-lightweight.mjs` → CLAUDE.md hook table, `scripts/vibe-sprint-complete.mjs` post-step, `package.json scripts.vibe:audit-lightweight`
- `scripts/vibe-gen-schemas.mjs` + `scripts/vibe-gen-schemas-impl.ts` → `package.json scripts.vibe:gen-schemas`, CLAUDE.md hook table
- `migrations/1.4.0.mjs` → `sync-manifest.migrations["1.4.0"]`, 수동 호출 (README / release notes)
- `test/*.test.ts` → `npm test` (node --import tsx --test glob)

---

## 6. 완료 기준 (기계적 검증)

| 조건 | 검증 명령 | 기대 결과 |
|---|---|---|
| TypeScript 타입 체크 | `npx tsc --noEmit` | exit 0, 0 errors |
| 전체 테스트 | `npm test` | 전체 pass (기존 + 신규 22+) |
| Zod 런타임 로드 | `node -e "import('zod').then(m=>console.log(m.z?'ok':'fail'))"` | `ok` |
| Schema auto-gen drift 없음 | `node scripts/vibe-gen-schemas.mjs --check` | exit 0 |
| Preflight audit gate block | fixture 로 `sprintsSinceLastAudit=10` 세팅 후 `node scripts/vibe-preflight.mjs` | exit 1, stdout `[FAIL] audit.overdue` |
| Preflight audit ack 우회 | `node scripts/vibe-preflight.mjs --ack-audit-overdue=sprint-M-audit:manual` | exit 0, session-log 에 `[decision][audit-ack]` entry |
| Preflight state validation | fixture 로 sprint-status.json 필드 하나 누락 후 `node scripts/vibe-preflight.mjs` | exit 1, stdout fix suggestion 포함 |
| Migration idempotent | `node migrations/1.4.0.mjs $(pwd)` 2회 연속 실행 | 2번째 실행 stdout 에 `idempotent` |
| Lightweight audit 실행 | `node scripts/vibe-audit-lightweight.mjs sprint-M-audit` | exit 0, stdout JSON 포함 |
| `## Wiring Integration` section | Final report grep | 섹션 + 표 존재 |

---

## 7. 범위 밖 (defer to later sprints)

- **Evaluator agent 실제 소환** 하여 dogfood7 의 6 audit-required risk 처리 — **dogfood7 이터레이션 몫**. 본 Sprint 는 backstop 인프라만 담당.
- **Planner agent (planner.md → sprint-planner.md) 교체** — M-process-discipline.
- **harnessVersion delta auto-tag** — M-harness-gates.
- **`/vibe-audit-skipped-mode` user directive** — M-harness-gates.
- 기존 테스트 대폭 리팩토링 — Zod 적용은 **최소 침습** 원칙, 시그니처 유지.
- `scripts/vibe-rule-audit.mjs` (CLAUDE.md MD 룰 → script gate 미커버 detection) — M-harness-gates.

---

## 8. Sandbox × Orchestrator 계약

- Generator (본 위임 대상) 가 **MUST NOT** 실행:
  - `npm install` — Zod / zod-to-json-schema 는 Orchestrator 사전 설치.
  - `npm test` 전체 — self-contained smoke 는 OK, full test suite 는 Orchestrator 가 밖에서.
- Generator MAY 실행:
  - `npx tsc --noEmit` — 타입 체크.
  - `node scripts/vibe-gen-schemas.mjs --check` — drift 확인.
  - `node scripts/vibe-validate-state.ts` 를 tsx 로 — 5 schema 검증 self-smoke.
  - 단일 test 파일 smoke: `node --import tsx --test test/schemas.test.ts`.
- Sandbox-only failure 발견 시 Final report 의 `## Sandbox-only failures` 에 명시.

---

## 9. Final report format (§_common-rules §9 + §14.4 준수)

```markdown
## Files added
- path — 한 줄 설명

## Files modified
- path — 한 줄 설명

## Verification
| command | exit |
|---|---|
| npx tsc --noEmit | 0 |
| node --import tsx --test test/schemas.test.ts | 0 |
| node scripts/vibe-gen-schemas.mjs --check | 0 |
| ... | ... |

## Sandbox-only failures
- (sandbox 제약으로 실행 못 한 검증만)

## Wiring Integration
| Checkpoint | Status | Evidence |
|---|---|---|
| W1 CLAUDE.md hook 테이블 | touched | CLAUDE.md:<line> |
| W6 sync-manifest harness[] | touched | sync-manifest.json:<line> (15 entries) |
| ... | ... | ... |

verified-callers:
- src/lib/schemas/sprint-status.ts → src/lib/sprint-status.ts:<line> import
- scripts/vibe-audit-lightweight.mjs → CLAUDE.md:<line> hook table / scripts/vibe-sprint-complete.mjs:<line> post-step
- ... (위 §5 verified-callers 전체 보고)

## Deviations
- (없으면 "none"; 있으면 이유와 함께 나열. 예: JSON schema metadata (x-purpose) Zod 표현 불가로 손실)
```

---

## 10. Risks / hints

- **ESM/TS import 경로**: `src/lib/schemas/sprint-status.ts` 가 `src/lib/sprint-status.ts` 에 import 될 때 반드시 `.js` extension (ESM/NodeNext 규약). barrel `./index.js` 동일.
- **`.mjs` 에서 `.ts` import 불가**: preflight 가 TS schemas 를 쓰려면 `node --import tsx` wrapping 필요. 본 프롬프트는 `scripts/vibe-validate-state.ts` 를 별도 TS 엔트리로 두고 preflight 가 spawnSync 로 위임하는 패턴을 강제.
- **Zod v4 beta 금지**. `^3.23.0` 유지.
- **기존 `src/lib/model-registry.ts`** 가 ad-hoc 타입을 쓰고 있을 수 있음. 만약 있다면 Zod schema import 로 re-align — 단 시그니처 breaking 금지 (M-audit 범위는 non-breaking).
- **dogfood7 bootstrap 에서 드러난 실제 누락 필드 3건** (`verificationCommands` top-level, `handoff.orchestratorContextBudget`, `handoff.preferencesActive`) 반드시 schema + migration 양쪽에서 커버.
- **JSON schema auto-gen 의 formatting**: Node 에서 `JSON.stringify(obj, null, 2) + '\n'` 형식으로 일관. `--check` 모드가 false positive diff 만들지 않도록 동일 serializer 사용.

---

## 11. Completion sequence (Generator 기준)

1. `src/lib/schemas/` 신규 파일 6개 작성 (각 schema + index).
2. `src/lib/sprint-status.ts` / `src/lib/project-map.ts` Zod 기반 재작성 (시그니처 유지).
3. `scripts/vibe-validate-state.ts` / `vibe-audit-lightweight.mjs` / `vibe-gen-schemas.mjs` / `vibe-gen-schemas-impl.ts` 작성.
4. `scripts/vibe-preflight.mjs` 확장 (state validation + audit gate).
5. `scripts/vibe-sprint-complete.mjs` 확장 (pre-write validate + post lightweight audit).
6. `migrations/1.4.0.mjs` 작성.
7. `.vibe/agent/*.schema.json` 5개 regenerate via `node scripts/vibe-gen-schemas.mjs --write`.
8. `.gitignore` / `package.json` / `CLAUDE.md` / `README.md` / `sync-manifest.json` / `docs/release/v1.4.0.md` / `harness-gaps.md` 업데이트.
9. 테스트 3 신규 + 2 업데이트.
10. Verification commands 순차 실행, Final report 작성 (`## Wiring Integration` + `verified-callers` 포함 필수).
