# Sprint O2 — Script-Wrapper Triage (3건)

- **Sprint ID**: `sprint-O2-script-wrapper-triage`
- **Slot**: iter-4 slot-2 (harness-stability-tune, P1 friction ×3)
- **Goal (한 줄)**: review-6 `#3` + `#4` + `#5` 를 script-wrapper / config 계약 수준에서 해결. prototype workflow 복원 + iter 경계 preflight 정합 + downstream bundle/browserSmoke path 커스터마이즈.
- **AC 요약**: (1) `vibe-audit-skip-set` 는 `.vibe/config.local.json` 미존재 시 minimal skeleton 생성 후 원 흐름 속행. (2) `vibe-preflight` `planner.presence` 는 `iteration-history.currentIteration` 섹션만 스캔해 다음 sprint 선택, legacy(iteration 헤더 없음) 는 graceful fallback. (3) `bundle.path` + `browserSmoke.dist` 필드를 선택적으로 지원 (기본 `"dist"`, legacy `bundle.dir` alias 호환). (4) 기존 235 테스트 + 신규 회귀 테스트 모두 pass + `tsc --noEmit` 0 error + `vibe-gen-schemas --check` 드리프트 없음.
- **예상 LOC**: add ~155 (engine + tests) / delete ~0. iter-4 growth budget slot-2 허용치 안. 초과 시 `#5` 를 최소 구현(설정 읽기 + 1 consumer + SKILL 1 줄)으로 축소하고 Final report "LOC Budget Audit" 에 기록.
- **신규 파일**: `test/audit-skip-set-bootstrap.test.ts` 1개 + `test/preflight-roadmap-iteration.test.ts` 1개 + `test/config-path-resolution.test.ts` 1개. **`scripts/` 아래 신규 파일 0**. (lib 내부 helper 는 `src/lib/preflight-roadmap.ts` 신규 1개 허용 — pure function 단위 테스트 격리용. script 아님.)
- **의존**: O1 (`sprint-O1-interview-coverage`) 완료 — 본 Sprint 는 O1 산출물(`scripts/vibe-interview.mjs`, `src/lib/interview.ts`, `test/interview-coverage.test.ts`) 을 건드리지 않는다.

---

## 공용 규칙

`.vibe/agent/_common-rules.md` 를 **항상** 준수한다. 특히:

- §1 샌드박스 우회 금지 — `next.config.ts` 등 영구 설정 파일에 workaround 추가 금지. Codex sandbox 제약은 Orchestrator 가 밖에서 풀어준다.
- §2 의존성 설치 금지 — `npm install` / 기타 패키지 매니저 네트워크 명령 실행 금지. 신규 deps 없음.
- §3 수정 금지 목록 존중 — 아래 "Do NOT modify" 참조.
- §4 TypeScript strict — `any` 금지. 경계는 `unknown` + 타입 가드.
- §5 범위 준수 — 아래 "편집 범위" 밖 리팩터 금지. O1 산출물은 read-only.
- §6 최종 검증 출력 — 아래 "Verification" 표 전부 exit 기록.
- §7 Sandbox × Orchestrator 계약 — `npm test` 전체 / `npm run build` / `vibe-gen-schemas --check` 실행은 Orchestrator 담당. Generator 는 sandbox 안에서 `tsc --noEmit` + 단일 test 파일 `node --test <path>` 만.
- §8 최소 테스트 — 순수 함수 신규/변경 시 회귀 테스트 포함. 본 Sprint 는 이미 강제.
- §9 Final report 형식 — 아래 요구 섹션 전부 포함.
- §13 Sandbox-bound Generator invariants — 위와 동일.
- §14 Wiring Integration Checklist — 본 프롬프트 말미 "Wiring Integration" 섹션으로 Final report 에 포함. 본 Sprint 는 config 필드 추가 + script 동작 변경이 있으므로 **W1 / W7 / W12 / W13** 이 특히 관련.

> **Sandbox verify skip header 안내**: `run-codex.sh` 가 EPERM 회피용 wrapper header 를 자동 prepend 한다. Generator 는 Orchestrator 담당 명령(`npm test --silent` / `vibe-gen-schemas --check` 등) 을 실행하려 하지 말고 Final report "Sandbox-only failures" 섹션에 기록만 한다.

---

## 배경

1. **dogfood8 iter-4 MVP run** (2026-04-18, Bucket 가계부 4 Sprint 자율 완주, 94분) 직후 `/vibe-review` 수행 결과 6 findings 중 P1 friction 3건 (`#3` / `#4` / `#5`) 이 모두 **script-wrapper 계약 수준 버그**로 묶여 본 slot 에 배당됨. 상세: `docs/reports/review-6-2026-04-18.md` §Friction.
2. **`#3` audit-skip-set hard-fail**: `scripts/vibe-audit-skip-set.mjs:80` 의 `loadConfigLocal()` 이 `.vibe/config.local.json` 미존재 시 `fail('config.local.json not found; run /vibe-init first')` 로 terminate. prototype 세션은 `config.local.json` 이 없는 상태가 default 라 audit-skip 경로 자체를 사용 불가. review-6 `#3` priority_score = P1, recommended_approach = `script-wrapper`.
3. **`#4` preflight planner.presence iteration 경계 오인**: `scripts/vibe-preflight.mjs:210-214` `parseRoadmapIds()` 가 roadmap 전체에서 `- **id**: \`...\`` 패턴을 flat scan → iter-3/iter-4 상태에서도 iter-1 의 `sprint-M1-schema-foundation` 을 "next pending" 으로 오인해 WARN 지속. dogfood8 94분 동안 내내 WARN. review-6 `#4` priority_score = P1, recommended_approach = `script-wrapper`.
4. **`#5` bundle/browserSmoke path hard-coded**: `src/commands/bundle-size.ts:84` 가 `bundle.dir ?? 'dist'` 단일 키만 읽음. `.vibe/config.json.browserSmoke` 에는 dist/path 개념이 아예 없음. downstream web/mobile 프로젝트가 `app/dist` 같은 경로로 bundle-size gate 를 opt-in 하려면 커스터마이즈 불가. review-6 `#5` priority_score = P1, recommended_approach = `config-default`.
5. **pending restoration**: iter-3 `.vibe/audit/iter-3/rules-deleted.md` 의 `two-tier-audit-convention` (tier B) 은 `gap-rule-only-in-md` 커버리지와 연결됨. 본 Sprint 는 `#3` 를 해결하는 과정에서 복원 조건이 충족되는지 **평가만** 하고 최종 복원 여부 판단은 **Sprint O3 로 deferr** 한다 (복원 하지 않음, 결론을 Final report `## Restoration Note` 에 1 단락 기록).

---

## 편집 범위 — 파일 지도

| 경로 | 역할 | 편집 종류 |
|---|---|---|
| `scripts/vibe-audit-skip-set.mjs` | `loadConfigLocal()` bootstrap + `writeConfigSkeleton()` helper | **수정** |
| `scripts/vibe-preflight.mjs` | `runPlannerPresenceCheck()` 에서 iteration 경계 aware 로직 위임 | **수정** (내부 helper 호출로 분기) |
| `src/lib/preflight-roadmap.ts` | roadmap iteration-scoped 파싱 순수 함수 모듈 | **신규** (1 파일, pure functions, script 아님) |
| `src/lib/config.ts` | `BundleConfig` 에 `path?: string` 추가. `BrowserSmokeConfig` 에 `dist?: string` 추가. `mergeOptionalObject` 흐름은 기존 유지 | **수정** |
| `src/commands/bundle-size.ts` | `resolveBundleConfig` 가 `path ?? dir ?? 'dist'` 순으로 해석 | **수정** |
| `scripts/vibe-browser-smoke.mjs` | `loadBrowserSmokeSettings()` 에 `dist` 필드 추가 (기본 `'dist'`) | **수정** |
| `.claude/skills/vibe-init/SKILL.md` | Step 3-4 opt-in 노트 1 줄 추가 ("custom dist 경로면 `bundle.path` / `browserSmoke.dist` 로 설정") | **수정** (1 줄) |
| `test/audit-skip-set-bootstrap.test.ts` | `#3` 회귀 | **신규** |
| `test/preflight-roadmap-iteration.test.ts` | `#4` 순수 함수 + CLI 회귀 | **신규** |
| `test/config-path-resolution.test.ts` | `#5` merge + default 회귀 | **신규** |

### Do NOT modify (O1 산출물 + 경계 밖)

- `scripts/vibe-interview.mjs` — O1 완료 산출물. 본 Sprint 는 **전혀 건드리지 않음**.
- `src/lib/interview.ts` — 동일.
- `test/interview-coverage.test.ts` — 동일.
- `.vibe/audit/iter-*/` 디렉토리 일체 — iter-scoped audit 기록 불변.
- `.vibe/audit/iter-3/rules-deleted.md` — pending restoration 정보원. read-only.
- `.vibe/config.json` / `.vibe/config.local.json` — 본 Sprint 는 **schema 확장만**, 실제 upstream config 값은 건드리지 않음 (downstream 에서 덮어씀).
- `scripts/vibe-gen-schemas.mjs` / `scripts/vibe-gen-schemas-impl.ts` — 본 Sprint 는 **state schema (STATE_FILE_SCHEMAS) 변경 없음**. `config.ts` 는 Zod 가 아닌 TS interface 기반이므로 `vibe-gen-schemas --check` 는 drift 없이 그대로 통과해야 함. 만약 drift 가 발생하면 `src/lib/config.ts` 변경이 `STATE_FILE_SCHEMAS` 까지 번져 들어갔다는 뜻 — 즉시 롤백.

> `.vibe/config.schema.json` 은 본 저장소에 **존재하지 않는다** (Zod source 가 config 를 커버하지 않음). `CLAUDE.md` §훅 테이블의 `vibe-gen-schemas.mjs` 항목은 STATE file 만 대상으로 한다. 따라서 본 Sprint 에서 **`config.schema.json` 생성/업데이트 금지** (스켈레톤 추가도 금지 — dead weight).

---

## 구현 세부

### Part A — `#3` `scripts/vibe-audit-skip-set.mjs` bootstrap

현재 `loadConfigLocal()` (line 78-88) 은 파일 미존재 시 `fail(...)` 으로 exit. 아래와 같이 재작성:

```
function writeConfigSkeleton() {
  // minimal viable shape. $schema reference 는 실제 schema 파일 존재 시에만 포함.
  const schemaPath = resolve('.vibe/config.local.schema.json');
  const skeleton = existsSync(schemaPath)
    ? { $schema: './config.local.schema.json', userDirectives: {} }
    : { userDirectives: {} };
  writeFileSync(configLocalPath, `${JSON.stringify(skeleton, null, 2)}\n`, 'utf8');
  process.stdout.write('created .vibe/config.local.json with default skeleton\n');
  return skeleton;
}

function loadConfigLocal() {
  if (!existsSync(configLocalPath)) {
    return writeConfigSkeleton();
  }
  const config = readJson(configLocalPath);
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    fail('config.local.json must contain a JSON object');
  }
  return config;
}
```

의도:
- 파일 미존재 = **graceful bootstrap**, 파일 존재+무효 = **여전히 hard-fail** (오염된 상태를 조용히 덮어쓰지 않음).
- `$schema` 참조는 실제 schema 파일이 나중에 도입될 경우를 위한 forward-compat. 현재 repo 에 `config.local.schema.json` 은 없으므로 기본 skeleton 은 `{ "userDirectives": {} }` 1 키.
- skeleton 생성 시 정확히 1 줄 stdout: `created .vibe/config.local.json with default skeleton`.
- 기존 `setAuditSkippedMode` / `clearAuditSkippedMode` 흐름은 **변경 없이** 그대로 이어 실행.

### Part B — `#4` `src/lib/preflight-roadmap.ts` (신규) + `scripts/vibe-preflight.mjs` 위임

새 모듈 `src/lib/preflight-roadmap.ts` 는 **순수 함수 3종** 을 export:

```ts
export interface RoadmapSprintCandidate {
  id: string;           // 예: "sprint-O2-script-wrapper-triage"
}

export interface ResolveArgs {
  roadmapMd: string;
  currentIterationId: string | null;  // 예: "iter-3" / "iter-4" / null
  completedSprintIds: ReadonlySet<string>;
}

export interface ResolveResult {
  pendingId: string | null;
  scanScope: 'iteration-scoped' | 'legacy-flat';
  iterationHeader: string | null;  // 매칭된 헤더 원문
}

export function parseIterationSections(md: string): Array<{
  iterationId: string;           // 예: "iter-3" (숫자만 있는 경우 "iter-<n>" 으로 정규화)
  header: string;                // 원본 헤더 라인
  startLine: number;             // 0-based
  endLine: number;               // exclusive
  body: string;
}>;

export function extractSprintIdsFromSection(body: string): string[];

export function resolveNextSprintFromRoadmap(args: ResolveArgs): ResolveResult;
```

핵심 규칙:

1. **Iteration header 매칭**: 정규식 `^(#|##)\s+Iteration\s+(?:iter-)?(\d+)\b[^\n]*$` — multiline. 포획된 숫자 n 으로 정규화된 id `iter-${n}` 을 생성.
2. **Current iteration 해석**:
   - `currentIterationId` 가 `iter-4` 형태면 그대로 비교.
   - `currentIterationId` 가 `null` 이거나 iteration 섹션이 하나도 없으면 `scanScope = 'legacy-flat'` → **전체 roadmap** 에서 sprint id 스캔 (기존 동작 완전 호환).
   - `currentIterationId` 가 제공됐으나 roadmap 에서 매칭 안 되면 `scanScope = 'iteration-scoped'` + `iterationHeader = null` + `pendingId = null` (preflight 측 에서 WARN 대신 INFO 로 graceful 처리).
3. **Section body**: 매칭된 iteration header 다음 라인부터 **다음 iteration header (level 무관) 또는 EOF** 까지.
4. **Sprint id 추출**: body 내부에서 `^- \*\*id\*\*: \`([^\`]+)\`` 패턴만 (기존 `parseRoadmapIds` 와 동일 시그니처). `## Sprint <id>` 같은 prose heading 은 source of truth 아님 (roadmap 의 canonical 표기는 id 필드).
5. **Pending 선택**: iteration-scoped 섹션 안에서 `completedSprintIds` 에 속하지 않는 **최초 id** 를 반환.

`scripts/vibe-preflight.mjs` 측 변경:

- 기존 `parseRoadmapIds()` 는 **legacy-flat fallback** 용으로 유지 (함수 시그니처 불변).
- `runPlannerPresenceCheck()` 내부에서 `iteration-history.json` 이 있으면 `currentIteration` 필드 읽어 `currentIterationId` 로 전달. 파일 없으면 `null`.
- `resolveNextSprintFromRoadmap(...)` 호출 결과의 `pendingId` 로 기존 로직 (프롬프트 파일 찾기 + mtime 비교) 을 돌림.
- `scanScope === 'legacy-flat'` 일 때는 기존 flat 스캔 동작 보존 (downstream 가 roadmap 에 iteration 헤더 없이 단일 플랫 목록을 쓰는 경우).

**Import 처리**: `scripts/vibe-preflight.mjs` 는 ESM `.mjs` 이고 `src/lib/preflight-roadmap.ts` 는 tsx 로 로드되어야 함. 기존 `runStateValidation()` 이 `spawnSync` 로 tsx 하위 프로세스를 호출하는 패턴을 참고해 **동일 패턴** 으로 추가 — 즉 `scripts/vibe-preflight-roadmap.ts` 같은 shim 이 아니라 **inline spawnSync + tsx loader** 로 해석 결과(JSON) 를 받아서 mjs 측에서 소비. OR: `tsx` import 없이 preflight.mjs 에서 직접 TypeScript 로직을 복제하는 대신, `src/lib/preflight-roadmap.ts` 를 tsx subprocess 로 호출해서 `{ pendingId, scanScope, iterationHeader }` JSON 을 받는 wrapper 함수를 preflight.mjs 에 둔다. 이 방식이 테스트 격리 + 재사용에 유리.

> 대안이 간결하다면, pure logic 을 `src/lib/preflight-roadmap.ts` 에 두되 **preflight.mjs 는 동일한 파싱 regex 를 자체 복사** 하는 경로도 허용. 단, **테스트는 항상 `src/lib/preflight-roadmap.ts` 의 exported 함수 대상으로 작성** (tsx 테스트 경로 확립). 두 코드 경로가 같은 regex/로직을 갖도록 Final report 에 diff 블록 1개로 증명.

Generator 가 둘 중 **간단·견고한 쪽** 선택. 선택 사유를 Final report "Deviations" 에 1 줄.

### Part C — `#5` bundle.path + browserSmoke.dist

`src/lib/config.ts`:

```ts
export interface BundleConfig {
  enabled: boolean;
  dir: string;       // legacy alias (유지). 기본 'dist'
  path?: string;     // 신규. 우선 사용. 없으면 dir fallback
  limitGzipKB: number;
  excludeExt: string[];
}

export interface BrowserSmokeConfig {
  enabled: boolean;
  configPath: string;
  dist?: string;     // 신규. 기본 'dist'
}
```

`src/commands/bundle-size.ts` (`resolveBundleConfig` 부근):

```ts
function resolveBundleConfig(bundle: BundleConfig | undefined): Required<Omit<BundleConfig,'path'>> & { path: string } {
  const path = bundle?.path ?? bundle?.dir ?? 'dist';
  return {
    enabled: bundle?.enabled ?? false,
    dir: bundle?.dir ?? 'dist',
    path,
    limitGzipKB: bundle?.limitGzipKB ?? 80,
    excludeExt: bundle?.excludeExt ?? ['.map'],
  };
}
```

그리고 기존 `path.resolve(bundle.dir)` → `path.resolve(resolved.path)` 로 변경.

`scripts/vibe-browser-smoke.mjs` `loadBrowserSmokeSettings()`:

```js
return {
  enabled: local.browserSmoke?.enabled ?? shared.browserSmoke?.enabled ?? false,
  configPath: local.browserSmoke?.configPath ?? shared.browserSmoke?.configPath ?? '.vibe/smoke.config.js',
  dist: local.browserSmoke?.dist ?? shared.browserSmoke?.dist ?? 'dist',
};
```

기존 browser-smoke 실행 로직이 `dist` 를 실제로 소비하지 않을 수 있음 (현재 script 는 DOM/console 계약만 검증). **필드를 노출만 하고, 소비처가 없다면 `checkContract` 같은 export 에서 문자열로 받아 정규화만** 수행. 단, 이 경우 dead field 우려가 있으므로:
- 만약 `vibe-browser-smoke.mjs` 가 dist 경로를 실제로 안 쓴다면 → 필드는 `config.ts` 타입 + test 에서만 읽히고 script 는 수정 **안 함**. 즉 Part C 의 `scripts/vibe-browser-smoke.mjs` 항목을 **생략**.
- Generator 가 script 본문을 읽고 판단. 결론을 Final report "Deviations" 에 1 줄.

`.vibe/config.json` 자체는 **변경하지 않음** (upstream default 유지, downstream 가 덮어씀).

`.claude/skills/vibe-init/SKILL.md` Step 3-4 (bundle/browserSmoke opt-in) 섹션에 **1 줄 추가**:

> `app/dist` 같은 커스텀 번들 경로가 있으면 `.vibe/config.json` 에 `bundle.path` / `browserSmoke.dist` 로 설정한다 (기본값 `dist`).

실제 인터뷰 분기 로직 구현은 **iter-4+ defer** — 본 Sprint 는 SKILL.md 텍스트만 업데이트 (Mode flag 와 동일 패턴).

### LOC Budget Audit (축소 규칙)

추정:
- Part A: ~40 LOC (script + test)
- Part B: ~65 LOC (lib + preflight wiring + test)
- Part C: ~50 LOC (types + consumer + test + SKILL 1 줄)
- 총합 ~155 LOC.

**초과 시**: Part C 를 아래 순서로 축소 —
1. `BrowserSmokeConfig.dist` 필드 + `test/config-path-resolution.test.ts` 유지.
2. `scripts/vibe-browser-smoke.mjs` 수정 **제거** (field 선언만).
3. `SKILL.md` 1 줄 유지.
여전히 초과하면 Part C 전체를 O3 backlog 로 이관하고 Final report "Deviations" 에 근거 명시.

---

## Verification (Orchestrator 가 샌드박스 밖에서 실행)

| # | 명령 | 기대 |
|---|---|---|
| V1 | `npx tsc --noEmit` | 0 error |
| V2 | `node --test test/audit-skip-set-bootstrap.test.ts` | 모두 pass |
| V3 | `node --test test/preflight-roadmap-iteration.test.ts` | 모두 pass |
| V4 | `node --test test/config-path-resolution.test.ts` | 모두 pass |
| V5 | `node --test` (전체 — Orchestrator 담당) | 기존 235 + 신규 3개 파일 모두 pass, regression 없음 |
| V6 | `node scripts/vibe-gen-schemas.mjs --check` | drift 없음 (STATE_FILE_SCHEMAS 미변경 확인용) |
| V7 | `node scripts/vibe-preflight.mjs` | `planner.presence` WARN 소거 or iter-4 내 sprint 로 매칭. `audit.overdue` 는 기존 상태 유지 |
| V8 | `node scripts/vibe-audit-skip-set.mjs --clear` (임시 백업 후 config.local.json 삭제해 확인, 복원은 Orchestrator 수작업) | `created .vibe/config.local.json with default skeleton` stdout 후 `cleared audit-skipped-mode` or `already cleared` |

Generator 는 V1, V2~V4 (단일 test 파일 단위) 만 sandbox 안에서 실행. V5~V8 은 Orchestrator 가 밖에서 실행하고 결과를 Final report "Verification" 표에 붙여 넣는다.

---

## Regression test 상세 요구사항

### `test/audit-skip-set-bootstrap.test.ts`

- 임시 디렉토리에 `.vibe/agent/session-log.md` + `## Entries` 헤딩 작성. `.vibe/config.local.json` 은 **생성하지 않음**.
- `node scripts/vibe-audit-skip-set.mjs "proto reason" 7` 실행 (cwd=tempDir).
- 기대:
  - exit code 0.
  - `.vibe/config.local.json` 파일 생성됨.
  - 해당 JSON 의 `userDirectives.auditSkippedMode.enabled === true` + `reason === 'proto reason'`.
  - `session-log.md` 에 `[decision][audit-skipped-mode] reason=proto reason ... durationDays=7` 라인 추가됨.
  - stdout 첫 줄 (또는 어느 줄이든) 에 `created .vibe/config.local.json with default skeleton` 포함.
- 추가 케이스: `config.local.json` 이 **이미 존재** (빈 객체 `{}`) → skeleton 메시지 출력 **안 함** + 기존 흐름 그대로.

### `test/preflight-roadmap-iteration.test.ts`

- `src/lib/preflight-roadmap.ts` 의 `resolveNextSprintFromRoadmap` 을 직접 import (tsx 경유).
- Case 1 (iter-4, O1 completed): roadmap 전체 문자열 + `currentIterationId='iter-4'` + completed={`sprint-O1-interview-coverage`, ...iter-3 sprints, ...iter-2 sprints, ...iter-1 sprints} → `pendingId === 'sprint-O2-script-wrapper-triage'` + `scanScope === 'iteration-scoped'`.
- Case 2 (iter-3 시점 회귀): completed = iter-2/iter-1 전부 → `pendingId` 가 **iter-3 sprint 중 하나** (N1/N2/N3). iter-1 의 M1 이 매칭되지 **않음**.
- Case 3 (legacy flat): iteration 헤더 0개 인 minimal roadmap + `currentIterationId=null` → `scanScope === 'legacy-flat'` + `pendingId` 는 flat 첫 미완료.
- Case 4 (currentIterationId 매칭 실패): iteration 헤더 있는 roadmap + `currentIterationId='iter-99'` → `pendingId === null` + `iterationHeader === null` (preflight 측은 INFO 처리).
- 추가: integration smoke — 기존 `test/preflight-planner-presence.test.ts` 와 동일 패턴으로 `scripts/vibe-preflight.mjs` 를 실제 spawn 해서 iter-4 scaffold 에서 WARN 이 사라지는지 1 케이스.

### `test/config-path-resolution.test.ts`

- `src/lib/config.ts` `mergeConfig` 를 직접 import 해서:
  - Case A: base `{ bundle: { dir: 'dist', enabled: true, ... } }` + override `{ bundle: { path: 'app/dist' } }` → merged `bundle.path === 'app/dist'` + `bundle.dir === 'dist'`.
  - Case B: browserSmoke merge 동일 케이스.
- `src/commands/bundle-size.ts` `resolveBundleConfig` 직접 import:
  - `{ path: 'app/dist', dir: 'old', ... }` → resolved.path = `'app/dist'`.
  - `{ dir: 'legacy' }` (path 없음) → resolved.path = `'legacy'`.
  - `{}` (둘 다 없음) → resolved.path = `'dist'`.

---

## Wiring Integration Checklist — Final report 필수 포함

`## Wiring Integration` 섹션을 Final report 에 반드시 포함 (`.vibe/agent/_common-rules.md §14.4`). 아래 항목 전부 `touched / n/a / skipped+reason` 상태 명시.

| Checkpoint | 본 Sprint 예상 상태 | 사유 / 증거 |
|---|---|---|
| W1 `CLAUDE.md` §훅 테이블 | n/a | 신규 script 추가 없음 (기존 3 script 수정만) |
| W2 `CLAUDE.md` §관련 스킬 | n/a | 신규 슬래시 커맨드 없음 |
| W3 `CLAUDE.md` §Sprint flow 번호 | n/a | 절차 변경 없음 |
| W4 `.claude/settings.json` hooks | n/a | 신규 hook 없음 |
| W5 `.claude/settings.json` statusLine | n/a | 변경 없음 |
| W6 `sync-manifest.json` `files.harness[]` | **touched** | 신규 `src/lib/preflight-roadmap.ts` 추가 → manifest harness[] 등록 필요 |
| W7 `sync-manifest.json` `files.hybrid{}.harnessKeys` | **touched** | `.vibe/config.json` 이 hybrid 대상이면 `bundle.path` + `browserSmoke.dist` 키 확장. hybrid 아니면 n/a 로 기록 (sync-manifest.json 확인 필수). |
| W8 `README.md` | skipped (사용자 가시 변화 최소) | config opt-in 문구는 `vibe-init` SKILL 에서만 커버. README 수정 시 scope 확대 → 다음 iteration |
| W9 `package.json` `scripts.vibe:*` | n/a | 신규 npm script 없음 |
| W10 `docs/release/vX.Y.Z.md` | **touched** | v1.4.2 릴리스 노트에 본 3 fix 기록 (경로 미존재 시 신규 생성) |
| W11 `migrations/X.Y.Z.mjs` | n/a | state schema 변경 없음. `BundleConfig.path` 는 optional 필드 추가라 기존 config 호환. |
| W12 `test/*.test.ts` | **touched** | 신규 3 파일 추가 (위 "Regression test 상세" 참조) |
| W13 `docs/context/harness-gaps.md` | **touched** | 관련 gap 업데이트. 특히 `gap-rule-only-in-md` 의 `two-tier-audit-convention` 연결은 "평가만, 복원 defer" 로 status 변경 (open → under-review). |
| W14 `.gitignore` | n/a | 런타임 artifact 생성 없음 |
| D1~D6 | n/a | 파일 삭제/이름 변경 없음 |

`verified-callers` 블록:
- `src/lib/preflight-roadmap.ts` → `scripts/vibe-preflight.mjs` (spawnSync 또는 복제 regex) / `test/preflight-roadmap-iteration.test.ts` / (optional) direct tsx import.
- `scripts/vibe-audit-skip-set.mjs` → `test/audit-skip-set-bootstrap.test.ts` + `CLAUDE.md` §훅 테이블(기존 행, 추가 없음).
- `src/lib/config.ts:BundleConfig.path` → `src/commands/bundle-size.ts:resolveBundleConfig` / `test/config-path-resolution.test.ts`.
- `src/lib/config.ts:BrowserSmokeConfig.dist` → `scripts/vibe-browser-smoke.mjs:loadBrowserSmokeSettings` (수정 한 경우만) / `test/config-path-resolution.test.ts`.

---

## Final report 필수 섹션

아래 섹션을 Final report 에 모두 포함. 누락 시 Orchestrator 가 Sprint incomplete 로 간주하고 재위임.

```markdown
## Summary
<3-5줄>

## Files added
- <path> — <역할>

## Files modified
- <path> — <한줄 요약>

## Verification
| # | 명령 | 결과 |
|---|---|---|
| V1 | npx tsc --noEmit | 0 error |
| V2 | node --test test/audit-skip-set-bootstrap.test.ts | N passed |
| V3 | node --test test/preflight-roadmap-iteration.test.ts | N passed |
| V4 | node --test test/config-path-resolution.test.ts | N passed |
| V5 | node --test (Orchestrator) | 기존 + 신규 pass |
| V6 | vibe-gen-schemas --check (Orchestrator) | drift 없음 |
| V7 | vibe-preflight (Orchestrator) | planner.presence WARN 소거 |
| V8 | audit-skip-set bootstrap smoke (Orchestrator) | skeleton 생성 stdout |

## Sandbox-only failures
<Orchestrator 담당으로 위임된 명령 + 이유>

## Deviations
- Part B 구현 선택: <spawnSync via tsx / regex 복제> — 근거
- Part C 축소 여부: <전체 구현 / 축소 / defer>

## LOC Budget Audit
- 추정 ~155, 실측 <add>/<delete>, 차이 근거

## Restoration Note
- `two-tier-audit-convention` (iter-3 tier B): <평가 결과 1 단락>. 최종 복원 여부는 Sprint O3 에서 판정.

## Wiring Integration
<§14.4 표 포함, verified-callers 블록 포함>
```

---

## Codex 사용 가이드 (간단)

- 산출물 생성 순서 권장: Part C (타입 + 기본값 — 가장 표면적) → Part A (script 단일 함수 교체) → Part B (신규 모듈 + preflight 통합).
- 각 Part 끝마다 `npx tsc --noEmit` 로컬 1회 + 해당 Part 의 test 파일 1회 실행.
- O1 산출물 회귀 우려 시 **즉시 중단** 하고 Final report "Deviations" 에 근거 기록 후 Orchestrator 에 되돌린다 (override 금지).
- UTF-8 no-BOM 고정, Windows bash(MINGW)+macOS 둘 다 cross-platform 고려 (`path.join` / `path.sep` / `os.EOL` 중립).

끝.
