# Sprint vpb-01 — 계약 스키마 + Goal Source Discovery

(공용 규칙은 `.vibe/agent/_common-rules.md` 준수 — run-codex.sh가 자동 prepend한다.)

**이 Sprint 이후 사용자가 새로 할 수 있는 것**: `npm run vibe:gen-schemas -- --check`와 `npm run vibe:self-test`를 실행해 web-pro-bridge 왕복 계약 3종(GoalSourceManifest / ReviewRequest / ReviewResultManifest)이 검증 가능한 JSON Schema 파일로 발행된 것을 확인하고, fixture 테스트를 통해 goal-source discovery 체인이 실제 하네스 state 파일 구조로부터 goal manifest를 재구성하는 것을 관찰할 수 있다.
이 roadmap slot은 수평 기술 레이어(계약 계층)다. 사용자 실행 가능한 수직 슬라이스(스킬 커맨드)는 sprint-vpb-03에서 완성되며, 이번 Sprint의 사용자 검증 표면은 "발행된 스키마 아티팩트 + 통과하는 discovery fixture 데모"로 한정한다는 tradeoff를 명시한다. 계약을 먼저 고정하지 않으면 vpb-02~05 전체가 이 타입 위에 쌓이므로 이 순서가 옳다.

이 Sprint는 frontend/게임/시각 경험 제품을 건드리지 않는다 (CLI 하네스 내부 계약 계층). 경험형 evidence(screenshot/playthrough)는 해당 없음 — evidence는 테스트 출력과 생성된 스키마 아티팩트로 범위를 한정한다.

## Sprint Contract

- **Target / output surface**:
  - `.vibe/harness/src/lib/schemas/pro-bridge.ts` — zod 스키마 3종 + 하위 스키마/enum (gen-schemas drift 대상).
  - `.vibe/harness/schemas/pro-bridge-*.schema.json` 3종 — 발행되는 JSON Schema 아티팩트 (Generator가 직접 쓰지 않음, 아래 예외 참조).
  - `.vibe/harness/src/pro-bridge/` — contract 상수/해시, vibe-bundle v1 파서, GoalSourceProvider 체인 4종 + resolver.
  - `.vibe/harness/test/pro-bridge-*.test.ts` 3개 — fixture 테스트.
- **Allowed writes** (이 목록 밖은 쓰기 금지):
  - `.vibe/harness/src/lib/schemas/pro-bridge.ts` (신규)
  - `.vibe/harness/src/lib/schemas/index.ts` (추가적 변경만: `GENERATED_ARTIFACT_SCHEMAS` 3키 등록 + re-export 추가. 기존 export/함수 변경 금지)
  - `.vibe/harness/src/pro-bridge/**` (신규 디렉터리)
  - `.vibe/harness/test/pro-bridge-schemas.test.ts`, `pro-bridge-bundle.test.ts`, `pro-bridge-goal-source.test.ts` (신규 — 반드시 `.vibe/harness/test/` 바로 아래. `vibe:self-test` 글롭이 하위 디렉터리를 스캔하지 않음)
  - `.vibe/harness/test/fixtures/pro-bridge/**` (신규 fixture JSON, 선택 — 인라인 fixture도 허용)
  - `.vibe/harness/scripts/vibe-gen-schemas-impl.ts` (`artifactOutputs` 맵에 3엔트리 추가만. 그 외 로직 변경 금지)
  - `.vibe/harness/tsconfig.harness.json` (`include` 배열에 `"src/pro-bridge/**/*.ts"` 1항목 추가만)
- **Do NOT modify**:
  - `.vibe/harness/scripts/**` 일체 (`vibe-gen-schemas-impl.ts`의 registry 맵 예외 제외). `vibe-gen-schemas.mjs` 런처 포함.
  - `.vibe/harness/src/lib/schemas/` 의 기존 스키마 파일들 (`datetime.ts`, `sidecar.ts`, `sprint-status.ts`, `iteration-history.ts` 등) — import 재사용만.
  - `package.json`, `CLAUDE.md`, `.claude/settings.json`, `.vibe/sync-manifest.json`, hook 관련 파일 전부.
  - `.vibe/agent/*` state 파일 (handoff.md / session-log.md / sprint-status.json / iteration-history.json) — **읽기 전용 구조 참조**.
  - `docs/plans/**`, `vibe-pro-bridge-design/**` — 참조 전용.
  - transport / scope-resolver / prompt-composer / importer / 스킬 / 커맨드 / config — **후속 Sprint 범위, 이번에 생성 금지** (`src/pro-bridge/transports/` 등 미리 만들지 말 것).
- **Explicit exceptions** (일반 규칙이 적용되지 않는 명명된 케이스):
  1. `_common-rules.md` §14.3 "placeholder/stub 금지" 예외: `CodexAppServerGoalProvider`는 **의도된 unavailable stub**이다. App Server JSON-RPC 표면이 미검증(design.md §12 리스크 계획)이라 인터페이스 + 명시적 unavailable 반환 + TODO 마커로만 구현한다. resolver 체인에 실제로 wiring되므로 dead weight가 아니다.
  2. `.schema.json` 3종은 Generator가 손으로 작성하지 **않는다**. `zodToJsonSchema` 출력과 byte 단위 일치가 요구되므로 Orchestrator가 handoff 후 `npm run vibe:gen-schemas -- --write`로 생성한다. Final report의 "Sandbox-only failures"에 기록하고 Deviation으로 취급하지 않는다.
  3. §15 unit test 금지 default는 아래 "Tests to add" 섹션으로 해제된다.
- **Reference-only values** (인용 가능, 신규 엔티티로 변환·편집 금지):
  - `vibe-pro-bridge-design/schemas/review-request.example.json`의 `goalSource` 필드는 **비정합 스케치**다 (04 §1의 GoalSourceManifest 전체 구조와 불일치 — `goalText`가 `source` 밖에 있고 필수 필드 대부분 누락). design.md 우선 원칙에 따라 **04 §1의 strict 정의가 정본**이며, 이 예시에 맞추려고 스키마를 약화하지 말 것.
  - `.vibe/agent/*`, `docs/plans/sprint-roadmap.md`의 실제 내용(현재 iteration 텍스트, session-log 엔트리)은 파싱 로직의 구조 참조일 뿐 — 테스트는 임시 디렉터리의 합성 fixture로 수행하고 실 repo state를 mutate하지 않는다.
  - 예시 requestId `AUD-20260715-abc123`, 폴더명 `2026-07-15-example-goal-pro-review` 등은 포맷 예시일 뿐.
- **Proof predicates** (public contract보다 강하지 않게):
  1. `npm run vibe:typecheck` exit 0 (tsconfig.harness.json include 확장 포함).
  2. `npm run vibe:self-test` exit 0 — 기존 전체 suite + 신규 3파일.
  3. `npm run vibe:gen-schemas -- --write` 후 `npm run vibe:gen-schemas -- --check` exit 0, `.vibe/harness/schemas/pro-bridge-{goal-source,review-request,review-result}.schema.json` 3파일 존재.
  4. 아래 체크리스트에 명시된 테스트 케이스 이름이 해당 파일에 존재 (grep 검증).
  5. `git status` 변경 로스터가 Allowed writes 목록 안에만 있음.
- **Current proof / non-proof**: Final report에서 이번 실행으로 직접 얻은 fresh evidence(정적 검사 결과, 파일 로스터)와 non-proof(샌드박스 제약으로 실행 못 한 명령, 추론에 근거한 주장)를 반드시 분리 보고한다.

## 필수 참조 문서 (읽기 순서)

1. `docs/plans/web-pro-bridge/design.md` — Hybrid v2 설계 정본. 특히 §4(Goal Source Discovery), §5(계약 + vibe-bundle v1 파싱 규칙), §10(하네스 통합 레이아웃), §12(App Server 리스크). **아래 참조 패키지와 충돌 시 이 문서가 항상 우선.**
2. `vibe-pro-bridge-design/04_GOAL_SOURCE_DISCOVERY.md` — GoalSourceManifest 필드 전문 + provider 알고리즘.
3. `vibe-pro-bridge-design/05_BRIDGE_PROTOCOL.md` §1~3 — lifecycle + ReviewRequest/ReviewResultManifest 타입 전문.
4. `vibe-pro-bridge-design/schemas/review-request.example.json`, `review-result.example.json` — 예시 인스턴스 (request 예시의 goalSource 비정합 주의 — 위 Reference-only 참조).
5. 기존 코드 패턴: `.vibe/harness/src/lib/schemas/sidecar.ts`(zod 스타일 선례), `index.ts`(등록 방식), `.vibe/harness/scripts/vibe-gen-schemas-impl.ts`(artifact 등록 맵), `.vibe/harness/test/sidecar.test.ts`(temp-dir fixture 테스트 선례), `.vibe/harness/test/schemas.test.ts`(스키마 테스트 선례).

## 기술 사양

### 파일 목록 / 모듈 경계

```
.vibe/harness/src/lib/schemas/pro-bridge.ts          # zod 정의 단일 소스 (신규)
.vibe/harness/src/lib/schemas/index.ts               # GENERATED_ARTIFACT_SCHEMAS 3키 + re-export (수정)
.vibe/harness/src/pro-bridge/contract.ts             # 타입 re-export + 계약 상수 + payload 해시 (신규)
.vibe/harness/src/pro-bridge/vibe-bundle.ts          # vibe-bundle v1 parse/serialize (신규)
.vibe/harness/src/pro-bridge/goal-source/types.ts    # provider 인터페이스 + 컨텍스트/포트 (신규)
.vibe/harness/src/pro-bridge/goal-source/scope.ts    # 변경 파일 scope 분류기 (신규)
.vibe/harness/src/pro-bridge/goal-source/resolver.ts # provider 체인 워커 (신규)
.vibe/harness/src/pro-bridge/goal-source/codex-app-server.ts    # stub (신규)
.vibe/harness/src/pro-bridge/goal-source/vibe-goal-iterate.ts   # (신규)
.vibe/harness/src/pro-bridge/goal-source/handoff.ts             # (신규)
.vibe/harness/src/pro-bridge/goal-source/git-reconstruction.ts  # (신규)
.vibe/harness/scripts/vibe-gen-schemas-impl.ts       # artifactOutputs 3엔트리 (수정)
.vibe/harness/tsconfig.harness.json                  # include에 src/pro-bridge/**/*.ts (수정)
.vibe/harness/test/pro-bridge-schemas.test.ts        # (신규)
.vibe/harness/test/pro-bridge-bundle.test.ts         # (신규)
.vibe/harness/test/pro-bridge-goal-source.test.ts    # (신규)
```

경계 원칙: zod 스키마는 `lib/schemas/pro-bridge.ts`에만 산다. `pro-bridge/contract.ts`는 거기서 inferred 타입을 re-export하고 계약 상수·해시 헬퍼만 추가한다 (후속 Sprint는 `pro-bridge/contract.ts`에서 import — `lib/schemas`를 직접 뚫지 않는다). 순환 import 금지: `lib/schemas` → `pro-bridge` 방향 의존은 절대 만들지 않는다.

ESM 컨벤션: NodeNext, 상대 import는 `.js` 확장자 명시 (기존 코드와 동일). `strict` + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` 전제. 모든 파일 UTF-8 (BOM 없음). zod(^3.23)와 zod-to-json-schema는 이미 설치되어 있음 — 신규 의존성 금지.

### 스키마 사양 — `lib/schemas/pro-bridge.ts`

공통 하위 스키마 (이 파일 지역 정의, `IsoDateTimeSchema`는 `./datetime.js`에서 재사용):

- `GitShaSchema` — `z.string().regex(/^[0-9a-f]{40}$/)` (base/head/commit SHA는 불변 full SHA — VPB-001 규칙).
- `Sha256HexSchema` — `z.string().regex(/^[0-9a-f]{64}$/)`.

**1. `GoalSourceManifestSchema`** (`vibe-goal-source-v1`) — `04_GOAL_SOURCE_DISCOVERY.md` §1의 필드 로스터 그대로. 필드 추가·삭제·이름변경 금지:

```ts
{
  schemaVersion: z.literal('vibe-goal-source-v1'),
  repository: { root: string, remoteUrl: string | null, fullName: string | null },
  source: {
    kind: 'codex-goal' | 'vibe-goal-iterate' | 'handoff-reconstruction' | 'git-reconstruction',
    confidence: 'exact' | 'high' | 'reconstructed',
    threadId: string | null, iterationId: string | null,
    goalText: string (min 1), goalStatus: string | null,
  },
  designRefs: string[], implementationRefs: string[],
  baseSha: GitSha, headSha: GitSha, commitShas: GitSha[],
  scope: { changedFiles, codeFiles, testFiles, migrationFiles, docsFiles, scopeGlobs: string[] },
  dirtyState: { staged: string[], unstaged: string[], untracked: string[], patchSha256: Sha256Hex | null },
  unresolved: string[],
  payloadSha256: Sha256Hex,
}
```

**2. `ReviewRequestSchema`** (`vibe-pro-review-request-v1`) — `05_BRIDGE_PROTOCOL.md` §2 그대로: `requestId`(min 1, 컨벤션 `<KIND3>-<YYYYMMDD>-<rand6>`은 문서화만 하고 스키마로 강제하지 않음), `kind` 4종(`goal_audit|feature_design|architecture_review|implementation_review`), `origin` 4종(`cli|web|workspace-agent|api`), `repository{fullName, remoteUrl, defaultBranch|null}`, `git{baseSha, headSha, branch|null, headVisibleOnGitHub: boolean, compareUrlHint|null, patchAttachmentSha256: Sha256Hex|null}`, `goalSource: GoalSourceManifestSchema.nullable()` (**strict 임베드 — 예시 JSON의 스케치에 맞춰 약화 금지**), `userGoal`, `reviewPrompt`, `outputContract`, `createdAt`/`expiresAt`(IsoDateTime), `payloadSha256`.

`ReviewOutputContractSchema`는 05에 미정의 — v1 최소형으로 고정: `{ requiredFiles: z.array(z.string().min(1)).min(1) }`.

**3. `ReviewResultManifestSchema`** (`vibe-pro-review-result-v1`) — 05 §3 그대로: `requestId`, `requestPayloadSha256`, `repositoryFullName`, `reviewedBaseSha`/`reviewedHeadSha`(GitSha), `resultKind: 'audit'|'design'`, `proposedFolder`(아래 FOLDER_NAME_PATTERN으로 강제), `disposition` 4종(`approved|approved-with-remediation|remediation-required|blocked`), `files[]{path(안전 상대경로 refine), mediaType: 'text/markdown'|'application/json', byteLength: int ≥ 0, sha256}`, `findingsSummary{p0..p3: int ≥ 0}`, `reviewerDeclaration{surface: 'chatgpt-web'|'workspace-agent'|'responses-api', requestedMode: 'pro'|'frontier'|'unspecified', githubConnectorUsed: boolean, limitations: string[]}`, `createdAt`, `payloadSha256`.

`index.ts` 등록: `GENERATED_ARTIFACT_SCHEMAS`에 `'pro-bridge-goal-source.json'` / `'pro-bridge-review-request.json'` / `'pro-bridge-review-result.json'` 3키 추가 + 스키마/타입 re-export. `vibe-gen-schemas-impl.ts`의 `artifactOutputs`에 대응 3엔트리 추가 — 출력 경로는 기존 sidecar 패턴대로 `.vibe/harness/schemas/pro-bridge-goal-source.schema.json` 등.

### `pro-bridge/contract.ts`

- `lib/schemas/pro-bridge.js`의 스키마 + `z.infer` 타입 전부 re-export.
- `REQUEST_LIFECYCLE_STATES` — 05 §1: `draft → ready → claimed → reviewing → result-uploading → result-ready → imported`, terminal failure `cancelled | expired | failed`. `REQUEST_LIFECYCLE_TRANSITIONS: Record<state, readonly state[]>` (선형 체인 + 비터미널 어느 상태에서든 3종 failure로 전이 가능, 터미널 상태는 outgoing 없음) + `canTransition(from, to): boolean`.
- `FOLDER_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{2,79}$/` (design.md §5.2).
- `REQUIRED_RESULT_FILES` — `audit: ['README.md','REVIEW.md','FINDINGS.json','prompt/CLI_MAIN_SESSION_PROMPT.md']`, `design: ['README.md','DESIGN.md','FINDINGS.json','prompt/CLI_MAIN_SESSION_PROMPT.md']` (design.md §5.2 필수 로스터).
- `isSafeRelativePath(path): boolean` — 상대 경로 + forward slash만, `..` 세그먼트 / 절대경로(`/` 시작, 드라이브 문자) / 백슬래시 / 빈 세그먼트 / 선행 `./` 거부. 스키마 refine과 vibe-bundle 파서가 공유.
- `computePayloadSha256(value: unknown): string` — canonical 해시 규약 (이후 모든 Sprint가 이 함수를 재사용하는 계약): 최상위 `payloadSha256` 프로퍼티 제외 → 재귀적으로 object key 정렬한 안정 직렬화(JSON, 배열 순서 보존) → UTF-8 SHA-256 lowercase hex. 결정적이어야 하며 key 삽입 순서에 무관해야 한다.

### `pro-bridge/vibe-bundle.ts` — manual transport wire format 파서

design.md §5.3 규칙 그대로. 형식:

```
VIBE-BUNDLE v1
requestId: AUD-20260715-abc123
folder: 2026-07-15-<slug>-pro-review
files: 4
==== VIBE:FILE README.md ====
...본문...
==== VIBE:FILE prompt/CLI_MAIN_SESSION_PROMPT.md ====
...본문...
==== VIBE:END ====
```

파싱 규칙 (전부 강제):

1. 라인 단위 파싱. `\r\n` 허용 — 각 라인의 trailing `\r`을 제거 후 매칭 (클립보드 경유 Windows 대비). 파일 본문은 라인들을 `\n`으로 재결합해 보존.
2. 헤더 라인은 정확히 `VIBE-BUNDLE v1`. **클립보드 관용**: 헤더 라인 이전의 선행 텍스트는 무시하고 첫 헤더 라인부터 파싱 시작. 헤더 라인이 2개 이상이면 ambiguous로 거부. `==== VIBE:END ====` 이후 잔여 텍스트는 무시.
3. 헤더 필드 `requestId:` / `folder:` / `files:` 3개 필수 (헤더 라인과 첫 separator 사이). `folder`는 `FOLDER_NAME_PATTERN` 검증. `requestId`는 비어있지 않으면 통과 — 리터럴 `web-origin` 허용 (로컬 pending request와의 바인딩은 후속 Sprint의 importer/transport 책임, 파서는 추출만).
4. separator는 라인 앵커 정규식 `^==== VIBE:FILE (.+) ====$`. 캡처된 경로는 `isSafeRelativePath` 검증, 중복 경로 거부.
5. `files:` 선언 수와 실제 파싱된 파일 수 교차검증 — 불일치 시 거부.
6. `^==== VIBE:END ====$` 센티널 부재 = 복사 잘림 → 거부.
7. 실패는 throw가 아니라 discriminated result로 반환 (기계 검증 가능한 에러 코드):

```ts
type VibeBundleParseResult =
  | { ok: true; bundle: { requestId: string; folder: string; files: Array<{ path: string; content: string }> } }
  | { ok: false; error: { code: 'missing-header' | 'duplicate-header' | 'missing-header-field'
      | 'invalid-folder' | 'invalid-files-count' | 'file-count-mismatch' | 'missing-end-sentinel'
      | 'unsafe-file-path' | 'duplicate-file-path' | 'empty-bundle'; message: string; line?: number } };
```

8. `serializeVibeBundle(bundle): string` — 역방향 직렬화. 본문 라인 중 separator/END 정규식에 매칭되는 라인이 있으면 충돌 가드로 거부(에러 반환) — v1은 escaping을 정의하지 않으므로 침묵 오염 대신 명시 거부. `parse(serialize(b))` 왕복 시 deep-equal 보장.
9. `checkRequiredFiles(paths: string[], resultKind: 'audit' | 'design'): { ok: boolean; missing: string[] }` — `REQUIRED_RESULT_FILES` 대조 헬퍼 (구조 파싱과 로스터 정책 검증을 분리 — 전체 allowlist 정책은 vpb-02 importer 범위).

### `pro-bridge/goal-source/` — provider 체인

**types.ts**:

```ts
type GoalSourceKind = 'codex-goal' | 'vibe-goal-iterate' | 'handoff-reconstruction' | 'git-reconstruction';

interface GitPort {  // 테스트에서 fake 주입 가능하도록 격리
  run(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }>;
}

interface GoalSourceContext { repoRoot: string; git: GitPort; now?: () => Date; }

type ProviderOutcome =
  | { status: 'candidate'; manifest: GoalSourceManifest }
  | { status: 'no-goal'; reason: string }
  | { status: 'unavailable'; reason: string };

interface GoalSourceProvider { readonly kind: GoalSourceKind; discover(ctx: GoalSourceContext): Promise<ProviderOutcome>; }
```

default `GitPort` 어댑터: `execFile`로 `git` 호출 (`shell: true` 금지 — Windows 콘솔/인젝션 안전). 파일 읽기는 `ctx.repoRoot` 기준 절대경로 조합 — repoRoot 밖 읽기 금지.

**resolver.ts** — 체인 워커:

```ts
resolveGoalSource(ctx, opts?: { providers?: GoalSourceProvider[]; collectAll?: boolean }): Promise<{
  selected: GoalSourceManifest | null;
  candidates: GoalSourceManifest[];
  diagnostics: Array<{ provider: GoalSourceKind; status: 'candidate'|'no-goal'|'unavailable'|'error'; reason?: string }>;
}>
```

기본 순서: codex-app-server → vibe-goal-iterate → handoff → git-reconstruction (design.md §4 우선순위). provider가 throw해도 resolver는 죽지 않고 diagnostics에 `error`로 기록 후 다음 provider 진행. 기본 모드는 첫 candidate 채택, `collectAll`은 전 provider 수집 (후속 스킬의 "후보 리스트 제시" 실패 모드 대비). 각 candidate manifest는 반환 전 `GoalSourceManifestSchema.parse`로 자체 검증하고 `payloadSha256`은 `computePayloadSha256`으로 채운다.

**공통 provider 계약**: base/head는 실제 40-hex full SHA로 해석될 때만 candidate 반환 — 해석 불가면 `no-goal`/`unavailable`. 확정 못 한 항목은 `unresolved[]`에 명시. `dirtyState`는 `git status --porcelain` 결과로 staged/unstaged/untracked 분류, `patchSha256`은 이번 Sprint에선 항상 `null` (patch 생성은 vpb-02 범위). 커밋 아무것도 상관 못 지으면 baseSha=headSha=HEAD + `unresolved: ['no-commits-correlated']` 허용.

**codex-app-server.ts** — **명시적 unavailable stub** (완전 동작 금지):
- `kind: 'codex-goal'`. `discover()`는 어떤 파일/git/네트워크 I/O도 수행하지 않고 즉시 `{ status: 'unavailable', reason: 'codex-app-server-api-unverified' }` 반환.
- 파일 내 `TODO(vpb-app-server)` 마커 주석 필수 + 04 §2 알고리즘(thread/list → repo cwd/gitInfo 필터 → thread/goal/get → 선택 후보만 thread/read) 을 의도 주석으로 문서화.
- **private reasoning 파싱 금지 원칙을 주석에 명문화**: "private model reasoning은 절대 파싱하지 않는다. 사용자 메시지·goal 메타데이터·tool 결과·커밋된 산출물만 사용한다." — 이 원칙은 향후 실구현의 계약이다.

**vibe-goal-iterate.ts** — `kind: 'vibe-goal-iterate'`, confidence `'high'`. 읽는 실존 state 파일과 실제 구조 (전부 존재하지 않을 수 있음 — 개별 누락은 관용, 핵심 조합 부재 시 `no-goal`):
- `.vibe/agent/sprint-status.json` — 기존 `SprintStatusSchema`(`lib/schemas`에서 import)로 파싱. sprints 로스터/상태, `handoff.currentSprintId`, `handoff.lastActionSummary` 사용.
- `.vibe/agent/iteration-history.json` — 기존 `IterationHistorySchema`로 파싱 (`{ currentIteration, iterations[] }`). iterationId 소스.
- `docs/plans/sprint-roadmap.md` — 구조: `<!-- BEGIN:VIBE:CURRENT-SPRINT -->` ~ `<!-- END:VIBE:CURRENT-SPRINT -->` 마커 블록(`> **Current**: <id|idle>` 라인들), iteration 헤딩 `^## Iteration \d+ — .+$`, Sprint 항목 `- **id**: \`<sprintId>\`` + 하위 `- **목표**: ...` 불릿. iteration 섹션 텍스트에서 goalText·sprint 로스터·backtick된 `docs/**` 경로(→ designRefs) 추출. `docs/plans/archive/roadmaps/*.md`는 존재 시 보조 소스.
- `.vibe/agent/session-log.md` — `## Entries` 섹션의 `- <ISO8601> [tag][tag2] 텍스트` 라인들. `[decision]` 태그 엔트리에서 goal 선언·타임스탬프 앵커 추출.
- `.vibe/archive/prompts/*.md`, `docs/prompts/*.md` — 파일명 `sprint-<id>-*.md`를 sprint 로스터와 매칭 → implementationRefs (경로 목록).
- git 상관: 위 타임스탬프·sprint id를 커밋 메시지/시각과 상관시켜 base(iteration 첫 관련 커밋의 부모)/head(마지막 관련 커밋 또는 HEAD)/commitShas 도출. 휴리스틱 세부는 재량이되 결정적(같은 입력 → 같은 출력)이어야 한다.
- 여러 iteration이 있으면 **가장 최근** coherent iteration 선택.

**handoff.ts** — `kind: 'handoff-reconstruction'`, confidence `'reconstructed'`. roadmap/iteration state가 없거나 stale할 때의 fallback: `.vibe/agent/handoff.md`(`## 2. Status` / `## 3. Next Action` 섹션 — 헤딩 번호 유무에 관용적으로) + session-log 최근 `[checkpoint]`/`[decision]` 엔트리에서 goal 서사 재구성. git HEAD 기준 base/head 추정. 모호점은 전부 `unresolved[]`에 — 리뷰 프롬프트가 모호성을 명시할 수 있도록 (design.md §4).

**git-reconstruction.ts** — `kind: 'git-reconstruction'`, confidence `'reconstructed'`. 최종 fallback, git만 사용: 최근 커밋(bounded, 예: 50개)의 subject/body/시각/변경 파일 클러스터링으로 최근 연속 구현 커밋 묶음을 goal로 추정. 커밋이 참조하는 `docs/plans/**`·`docs/**` 경로 → designRefs. 무관한 최근 커밋(클러스터 시간 간격/주제 이탈)은 제외하거나 `unresolved`에 플래그. `unresolved`에 `'reconstructed-from-git-history'` 항목 필수.

**scope.ts** — `classifyScope(changedFiles: string[]): GoalSourceManifest['scope']` 순수 함수. 분류 규칙: test(경로에 `test/`·`tests/`·`__tests__/`·`e2e/` 세그먼트 또는 `*.test.*`/`*.spec.*`) / migration(`migrations/` 세그먼트 또는 `*.sql`) / docs(`*.md`/`*.mdx` 또는 `docs/` 최상위) / 나머지 = code. `scopeGlobs`는 결정적·정렬된 bounded 프리픽스 글롭 (예: 상위 1~2 세그먼트 `**` 글롭). 전 provider가 공유.

### 후속 Sprint를 위한 비-구현 경계 (반복 강조)

transport 인터페이스·ManualDirectoryTransport·scope-resolver(GitHub visibility)·prompt-composer·importer·MCP·스킬·커맨드·`.vibe/pro-bridge/` state 디렉터리 — 전부 vpb-02~05. 이번 Sprint 산출물에서 이들을 참조하는 코드를 만들지 않는다.

## Tests to add (§15 해제 — 아래 파일·케이스는 명시 요구사항)

테스트 러너: node:test (`describe`/`it` from `node:test`, `assert` from `node:assert/strict`), 파일은 `.vibe/harness/test/` 바로 아래. fixture는 `mkdtemp` 임시 디렉터리 + 합성 state 파일 + fake `GitPort` 주입 (실 git repo 생성 불요 — 결정적·빠름·Windows 안전, `sidecar.test.ts` 선례). 실 repo의 `.vibe/agent/*`를 읽거나 쓰는 테스트 금지.

**1. `pro-bridge-schemas.test.ts`** — describe `'pro-bridge schemas'`:
- 정합 fixture 3종(GoalSourceManifest / ReviewRequest / ReviewResultManifest) parse 성공. ReviewRequest fixture의 `goalSource`는 **완전 정합 manifest** (예시 JSON의 스케치를 교정해 사용 — 교정 사실을 테스트 주석에 남길 것). `review-result.example.json`과 동형의 인스턴스는 그대로 정합해야 함.
- 거부 케이스: 잘못된 `schemaVersion`, 40-hex 아닌 SHA, 64-hex 아닌 payloadSha256, 허용 외 `disposition`/`kind`, 음수 findings 카운트, `FOLDER_NAME_PATTERN` 위반 `proposedFolder`, `files[].path`의 `../` 경로.
- `computePayloadSha256`: key 순서 무관 결정성 + `payloadSha256` 필드 자체 제외 확인.
- lifecycle: `canTransition` 선형 체인 성공 + 역방향/터미널-발 전이 거부.

**2. `pro-bridge-bundle.test.ts`** — describe `'vibe-bundle v1 parser'`:
- 정상 4파일 번들 파싱 (LF + CRLF 두 변형), 선행 클립보드 잡음 무시, `requestId: web-origin` 허용.
- 거부: END 센티널 부재(`missing-end-sentinel`), `files:` 수 불일치(`file-count-mismatch`), `../escape` / 절대경로 / 백슬래시 경로(`unsafe-file-path`), 중복 경로(`duplicate-file-path`), folder 패턴 위반(`invalid-folder`), 헤더 부재(`missing-header`) — 에러 코드 단위 assert.
- `serialize → parse` 왕복 deep-equal + separator 충돌 본문 serialize 거부.
- `checkRequiredFiles`: audit/design 각각 필수 로스터 누락 검출.

**3. `pro-bridge-goal-source.test.ts`** — describe `'goal source discovery'` (design.md §11의 discovery fixture 로스터를 이번 Sprint 범위로 사상):
- `'resolves a vibe-goal-iterate goal from coherent state'` — roadmap+status+log 정합 fixture → kind/confidence('high')/goalText/base/head/designRefs/scope 분류 assert.
- `'picks the most recent of multiple iterations'`.
- `'records app-server unavailable and continues the chain'` — diagnostics에 codex-goal unavailable 기록 + 다음 provider 진행.
- `'reconstructs from handoff when roadmap state is missing'` — kind `handoff-reconstruction` + confidence `'reconstructed'`.
- `'captures dirty and unpushed state explicitly'` — fake GitPort의 porcelain 출력 → dirtyState 3분류 + patchSha256 null.
- `'flags unrelated recent commits'` — 무관 커밋이 commitShas에서 제외되거나 unresolved에 플래그.
- `'falls back to git reconstruction with reconstructed label'` — agent state 전무 fixture.
- `'returns null selected with diagnostics when no goal exists'`.
- `'app-server stub performs no I/O and never touches thread content'` — spy GitPort/fs로 zero-call assert (private reasoning 비파싱 계약의 현 단계 검증).
- `classifyScope` 단위 케이스 (code/test/migration/docs 각 1개 이상).

참고: App Server 실연동 fixture 2종(active `/goal`, persisted goal)은 API 실측 후 Sprint에서 추가한다 — 이번 범위 아님.

## Codex 실행 환경 제약

- Windows sandbox — **tsc/test/빌드/npm 실행 불가**. self-check는 static inspection으로만 수행하고, 모든 실행 검증은 Orchestrator가 샌드박스 밖에서 수행한다. 실행 못 한 명령은 Final report "Sandbox-only failures"에 전부 나열할 것: `npm run vibe:typecheck`, `npm run vibe:self-test`, `npm run vibe:gen-schemas -- --write`, `npm run vibe:gen-schemas -- --check`.
- `.schema.json` 손작성 금지 (Sprint Contract 예외 2).
- 네트워크·의존성 설치 금지. 샌드박스 우회용 영구 설정 변경 금지 (`_common-rules.md` §1~2).

## 완료 체크리스트

기계 검증 (Orchestrator가 샌드박스 밖에서 실행):

- [ ] `npm run vibe:typecheck` exit 0
- [ ] `npm run vibe:self-test` exit 0 (기존 suite 무손상 + 신규 3파일 포함 실행 확인)
- [ ] `npm run vibe:gen-schemas -- --write` 후 `npm run vibe:gen-schemas -- --check` exit 0
- [ ] `.vibe/harness/schemas/pro-bridge-goal-source.schema.json` / `pro-bridge-review-request.schema.json` / `pro-bridge-review-result.schema.json` 3파일 존재
- [ ] `npm run vibe:build` exit 0
- [ ] grep: `.vibe/harness/test/pro-bridge-goal-source.test.ts`에 위 명시 케이스명 존재 (`'picks the most recent of multiple iterations'` 등 9건)
- [ ] grep: `codex-app-server.ts`에 `TODO(vpb-app-server)` 마커 + private reasoning 금지 문구 존재
- [ ] grep: `src/pro-bridge/` 아래에 `transports`/`importer`/`composer` 참조 부재 (범위 이탈 감지)
- [ ] `git status` 변경 로스터 ⊆ Allowed writes

Inspection 항목 (Evaluator — 신규 파일 >5개이므로 Evaluator 소환은 Must):

- [ ] 스키마 3종의 필드 로스터가 04 §1 / 05 §2~3과 1:1 대응 (자의적 필드 추가·완화 없음, 특히 goalSource strict 임베드 유지)
- [ ] provider들의 confidence 라벨이 과대평가되지 않음 (fallback 산출물은 전부 `reconstructed` + unresolved 명시)
- [ ] vibe-bundle 파서가 design.md §5.3 규칙의 임의 완화 없이 구현됨 (관용은 명세된 2건 — CRLF·선행 잡음 — 만)

## Final report 요구사항

`_common-rules.md` §9 형식 + §14.4 `## Wiring Integration` 표 필수. 이번 Sprint의 W/D 사전 판정 (Generator는 실제 상태로 갱신·보고):

| Checkpoint | 예상 상태 | 근거 |
|---|---|---|
| W1/W2/W3/W4/W5 | n/a | 신규 스크립트·스킬·hook·Sprint 절차 변경 없음 |
| W6 sync-manifest | n/a (커버됨) | `.vibe/harness/src/**`·`schemas/**`·`test/**` 글롭이 기존 등록 (sync-manifest.json:6,9,10) |
| W7/W8/W9 | n/a | hybrid key·README·npm script 변경 없음 (사용자 대면은 vpb-03) |
| W10 release 기록 | skipped+reason | iteration 종료 시 Orchestrator가 일괄 기록 |
| W11 migration | n/a | 기존 state 파일 구조 무변경 (신규 artifact 스키마만) |
| W12 회귀 테스트 | touched | 신규 테스트 3파일 |
| W13 harness-gaps | skipped+reason | `gap-web-pro-bridge` 등록은 vpb-03 wiring Sprint 범위 (design.md §10) |
| W14 .gitignore | n/a | 런타임 artifact 생성 없음 (`.vibe/pro-bridge/`는 vpb-03) |
| D1~D6 | n/a | 삭제·개명 없음 |

`verified-callers`에 신규 모듈별 실제 import 지점 명시 (예: `goal-source/*.ts → resolver.ts`, `resolver.ts → pro-bridge-goal-source.test.ts`, `pro-bridge.ts → index.ts + vibe-gen-schemas-impl.ts`). Sprint Contract 절(§9 형식)에서 Current proof(정적 검사·파일 로스터)와 Non-proof(미실행 명령·추론)를 분리 보고.
