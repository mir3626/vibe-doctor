# Sprint vpb-03 — Manual Transport + Pro-Bridge 커맨드 + 스킬 4종 (Phase 1 완성)

(공용 규칙은 `.vibe/agent/_common-rules.md` 준수 — run-codex.sh가 자동 prepend한다.)

**이 Sprint 이후 사용자가 새로 할 수 있는 것**: `npm run vibe:pro-audit` 한 번으로 마지막 goal의 리뷰 요청 패킷(프롬프트 전문)이 `.vibe/pro-bridge/outbox/`에 생성되고 클립보드에 실리며 브라우저(chatgpt.com)가 열리는 것을 직접 보고, Pro 세션 응답(vibe-bundle)을 복사한 뒤 `npm run vibe:pro-sync`로 `docs/plans/<folder>/`에 설치된 리뷰 패키지와 다음 행동 안내를 받는다 — 수동 동작 2회(전송·복사)로 Phase 1 왕복이 완결되는 수직 슬라이스다.

이 Sprint는 frontend/게임/시각 경험 제품을 건드리지 않는다 (CLI 하네스 표면). 경험형 evidence는 screenshot 대신 **실 커맨드 transcript**로 한정한다: Orchestrator가 샌드박스 밖에서 mock 번들로 audit→sync 왕복 1회를 실행한 출력이 identity/payoff evidence이며, E2E 테스트가 기계 검증을 담당한다. 브라우저 핸드오프는 편의 기능이므로 evidence 대상에서 제외한다.

## Sprint Contract

- **Target / output surface**:
  - `.vibe/harness/src/pro-bridge/transports/types.ts` — `VibeProBridgeTransport` 포트 5메서드 + `RequestHandle`/`RequestStatus`/`ImportReceipt` + transport 이름 해석(우선순위) (신규).
  - `.vibe/harness/src/pro-bridge/transports/manual.ts` — ManualDirectoryTransport + 클립보드/브라우저 host 어댑터 (신규).
  - `.vibe/harness/src/commands/pro-bridge.ts` — audit/design/status/sync/cancel/list 서브커맨드 + default 상태 분기 + 실패 모드 4종 + 외부 발행 고지 (신규).
  - `.vibe/harness/scripts/vibe-pro-bridge.mjs` — **이번 Sprint 유일한 신규 스크립트** (커맨드 위임 wrapper) (신규).
  - 스킬 4종: `.claude/skills/{vibe-goal-audit,vibe-pro-design}/SKILL.md` + `.codex/skills/{vibe-goal-audit,vibe-pro-design}/SKILL.md` (신규).
  - config `proBridge` 섹션 + `src/lib/config.ts` 타입/머지 확장, npm scripts 4종, `.gitignore`, sync-manifest, harness-gaps 엔트리.
  - **Hotfix (회귀)**: `vibe-agent-session-start.mjs` stdin drain 가드 + `run-codex.sh` `agent_session_start()` `</dev/null` 이중 방어 + 회귀 테스트.
  - Carry-over 교정: scope-resolver `git diff` rename 표기로 인한 patch 누락 방지(`--no-renames`).
- **Allowed writes** (이 목록 밖은 쓰기 금지):
  - `.vibe/harness/src/pro-bridge/transports/types.ts` (신규)
  - `.vibe/harness/src/pro-bridge/transports/manual.ts` (신규)
  - `.vibe/harness/src/commands/pro-bridge.ts` (신규)
  - `.vibe/harness/scripts/vibe-pro-bridge.mjs` (신규)
  - `.vibe/harness/src/lib/config.ts` (**추가만**: `ProBridgeConfig` interface + `VibeConfig.proBridge?` + override/merge + resolve 헬퍼. 기존 필드·머지 동작 무변경)
  - `.vibe/harness/src/pro-bridge/scope-resolver.ts` (**최소 수정**: diff/numstat 호출에 `--no-renames` 추가만 — carry-over 2)
  - `.vibe/harness/scripts/vibe-agent-session-start.mjs` (**최소 수정**: 비-hook 컨텍스트 stdin 미읽기 가드만 — 아래 §8)
  - `.vibe/harness/scripts/run-codex.sh` (**1줄**: `agent_session_start()` 내 node 호출에 `</dev/null` 리다이렉트만)
  - `.vibe/config.json` (proBridge 섹션 **추가만**)
  - `.vibe/sync-manifest.json` (`.vibe/config.json` hybrid `projectKeys`에 `"proBridge"` **추가만**)
  - `package.json` (`scripts`에 `vibe:pro-audit`/`vibe:pro-design`/`vibe:pro-sync`/`vibe:pro-status` 4키 **추가만**)
  - `.gitignore` (`.vibe/pro-bridge/` 1라인 **추가만**)
  - `.claude/skills/vibe-goal-audit/SKILL.md`, `.claude/skills/vibe-pro-design/SKILL.md` (신규)
  - `.codex/skills/vibe-goal-audit/SKILL.md`, `.codex/skills/vibe-pro-design/SKILL.md` (신규)
  - `docs/context/harness-gaps.md` (`gap-web-pro-bridge` 행 1개 **append만** — 기존 6컬럼 표 형식 준수)
  - `.vibe/harness/test/pro-bridge-transport-manual.test.ts` (신규)
  - `.vibe/harness/test/pro-bridge-command.test.ts` (신규)
  - `.vibe/harness/test/pro-bridge-e2e.test.ts` (신규 — `.vibe/harness/test/` 바로 아래. `vibe:self-test` 글롭이 하위 디렉터리를 스캔하지 않음)
  - `.vibe/harness/test/pro-bridge-scope-resolver.test.ts` (**append만**: rename 회귀 1건)
  - `.vibe/harness/test/agent-session-start.test.ts` (**최소 수정**: 아래 §8의 fixture 현실화 2건 + 신규 가드 케이스 1건)
  - `.vibe/harness/test/run-codex-wrapper.test.ts` (**append만**: stdin 보존 회귀 1건)
- **Do NOT modify**:
  - `.vibe/harness/src/pro-bridge/`의 나머지 전부 — `contract.ts`, `vibe-bundle.ts`, `importer.ts`, `prompt-composer.ts`, `goal-source/**` (scope-resolver.ts의 명시된 최소 수정 제외). 전부 import 재사용만.
  - `.vibe/harness/src/lib/schemas/**` 일체 — 이번 Sprint는 zod 스키마를 추가·수정하지 않는다. `RequestHandle`/`RequestStatus`/`ImportReceipt`/`ProBridgeConfig`는 로컬 TS interface로만 정의 (gen-schemas 등록 금지, importer의 `ProvenanceReceipt` 선례).
  - `CLAUDE.md`, `README.md` — **Generator 수정 금지**. 필요한 정확한 추가 텍스트를 Final report에 제시하면 Orchestrator가 반영한다 (아래 Final report 요구사항).
  - `.claude/settings.json` — hook/statusline 등록 금지 (03 §4 lifecycle 무결합: Stop/PreCompact/sprint-complete/sprint-commit/vibe:qa 무변경).
  - `.vibe/harness/scripts/`의 나머지 스크립트 전부, `.vibe/harness/tsconfig*.json` (include가 이미 `src/pro-bridge/**`·`src/commands/**` 커버), 기존 스킬 디렉터리 전부.
  - 기존 테스트 중 위 로스터에 없는 파일 전부 (`pro-bridge-schemas/bundle/goal-source/composer/importer.test.ts`, `codex-skills.test.ts` 등 — codex-skills parity 테스트는 신규 스킬 디렉터리를 자동 열거하므로 wrapper 형식만 맞으면 무수정 통과해야 한다).
  - `.vibe/agent/*` state 파일, `docs/plans/**`, `vibe-pro-bridge-design/**` — 읽기 전용.
  - **범위 밖 (후속 Sprint — 생성 금지)**: `transports/mcp-mailbox.ts`·`workspace-agent.ts`·`responses-api.ts`(vpb-04+), MCP 서버·터널·`vibe:pro-mcp`, web-origin 매칭 로직(vpb-05, 단 `requestId: web-origin` 번들 수용은 importer가 이미 지원 — 그대로 노출), Developer Mode 문서(vpb-04), `docs/context/vibe-pro-bridge.md`.
- **Explicit exceptions** (일반 규칙이 적용되지 않는 명명된 케이스):
  1. §15 unit test 금지 default는 "Tests to add" 섹션으로 해제된다.
  2. "기존 하네스 스크립트 수정 금지"의 명명된 예외 2건: `run-codex.sh`(§8의 1줄)와 `vibe-agent-session-start.mjs`(§8의 stdin 가드). 이 hotfix 범위 밖 로직 변경(리팩토링·에러 포맷·dedupe 로직 등) 금지.
  3. "기존 테스트 무변경" 원칙의 명명된 예외: `agent-session-start.test.ts`의 stdin 자동 감지 2개 케이스는 env fixture에 `CLAUDECODE: '1'`을 추가한다. 실제 Claude Code hook 자식 프로세스는 항상 `CLAUDE*` env를 보유하므로 이는 fixture 현실화이지 assert 약화가 아니다 — assert 자체(감지 동작·cwd fallback·dedupe)는 한 글자도 바꾸지 않는다.
  4. Generator의 설정 파일(`.vibe/config.json`, `package.json`, `.gitignore`, `.vibe/sync-manifest.json`) 수정은 Allowed writes에 명시된 "추가만" 범위에서 이번 Sprint에 한해 허용된다.
  5. vpb-02의 proof predicate "`src/pro-bridge/` 아래 `transports` 참조 부재"는 이번 Sprint부로 폐기된다 (transports가 정식 모듈로 승격).
  6. design.md §6.1 포트 인터페이스는 5메서드 시그니처 그대로 유지한다. `cancel`/`list`/`readRequest`는 포트에 추가하지 말고 ManualDirectoryTransport **클래스 전용 메서드**로 둔다 (커맨드가 concrete 클래스를 사용).
  7. `proBridge.githubRequired`/`copyInvocation` 키는 09 §3 스키마 완전성을 위해 config에 존재하지만, Phase 1 동작 분기는 최소로 한다: `githubRequired`는 값과 무관하게 scope-resolver gate가 정본이고, `copyInvocation=false`면 클립보드 복사만 skip. 이 단순화를 코드 주석 1줄과 Final report에 명시.
- **Reference-only values** (인용 가능, 신규 엔티티로 변환·구현 금지):
  - design.md §6.3~§6.5의 11-tool MCP 프로토콜·workspace-agent·responses-api — `transports/types.ts` 주석에서 이름만 인용 가능, 어댑터 stub 생성 금지 (§14.3 placeholder 금지).
  - 09 §7 "no mandatory package script; helper scripts live inside skill resources" — Pro 패키지 원안일 뿐. **design.md §10(v1 채택: npm scripts + src/commands + 단일 스크립트)이 정본**이다.
  - `@Vibe Pro Bridge review <id>` 한 줄 invocation — Phase 2 MCP 전용 UX. Phase 1 출력/스킬에는 "클립보드의 프롬프트를 붙여넣어 전송"만 안내.
  - 03 §3의 skill-local `scripts/discover-goal.mjs`·`scripts/import-result.mjs`·`resources/*` — 만들지 않는다.
  - 예시 requestId `AUD-20260715-abc123`, `chatgpt.com/?q=` — 포맷 예시/편의 기능일 뿐, `?q=` 정확성 의존 금지.
- **Proof predicates** (public contract보다 강하지 않게):
  1. `npm run vibe:typecheck` exit 0.
  2. `npm run vibe:self-test` exit 0 — 기존 전체 suite 무손상(codex-skills parity 포함) + 신규 3파일 + append 3건.
  3. `npm run vibe:build` exit 0.
  4. `npm run vibe:gen-schemas -- --check` exit 0 (lib/schemas 무변경이므로 drift 0이어야 정상).
  5. `npm run vibe:codex-wrapper-audit` exit 0 (신규 wrapper 2종 포함).
  6. `npm run vibe:sync-audit` exit 0.
  7. grep: 스킬 4파일 존재 + `.codex` wrapper 2종에 `BEGIN:VIBE-CODEX:SHARDS` 마커와 대응 `.claude/skills/<name>/SKILL.md` 경로.
  8. grep: `.gitignore`에 `.vibe/pro-bridge/` 라인.
  9. grep: `package.json`에 `vibe:pro-audit`/`vibe:pro-design`/`vibe:pro-sync`/`vibe:pro-status` 4키.
  10. grep: `run-codex.sh` `agent_session_start()`에 `</dev/null`.
  11. grep: 아래 명시된 테스트 케이스명이 해당 파일에 존재.
  12. `git status` 변경 로스터 ⊆ Allowed writes, 특히 `CLAUDE.md`·`README.md`·`.claude/settings.json` 무변경.
- **Current proof / non-proof**: Final report에서 이번 실행으로 직접 얻은 fresh evidence(정적 검사, 파일 로스터)와 non-proof(샌드박스 제약으로 실행 못 한 명령, 추론 기반 주장)를 반드시 분리 보고한다.

## 필수 참조 문서 (읽기 순서)

1. `docs/plans/web-pro-bridge/design.md` — Hybrid v2 정본. 특히 §6.1(포트 시그니처)/§6.2(ManualDirectoryTransport)/§8(스킬 UX·브라우저 핸드오프 합의)/§9(전송=외부 발행 고지)/§10(하네스 통합 레이아웃·wiring 체크리스트·`.vibe/pro-bridge/` git-ignored). **다른 참조와 충돌 시 이 문서가 항상 우선.**
2. `vibe-pro-bridge-design/09_SKILL_AND_COMMAND_SPEC.md` — invocation 표면(§1~2)/default 분기(§1)/실패 모드 4종(§1)/config 스키마(§3)/transport 우선순위(§4)/browser handoff 경계(§5).
3. `vibe-pro-bridge-design/03_TARGET_ARCHITECTURE.md` §2(포트 시그니처 원문)/§4(lifecycle 무결합 금지 목록).
4. 기존 코드 (실제 export 시그니처 확인 필수):
   - `.vibe/harness/src/pro-bridge/contract.ts` — `ReviewRequest`/`ReviewResultManifest`/`RequestLifecycleState`/`REQUEST_LIFECYCLE_STATES`/`compareStringsByCodePoint`. re-export 표면이므로 신규 모듈은 전부 `../contract.js`(또는 transports에서 `../contract.js` 상대 경로) 경유 import — `lib/schemas/pro-bridge.js` 직접 참조 금지 (vpb-01 확정 규칙).
   - `prompt-composer.ts` — `ComposerInput`(now/random/ttlDays 주입)·`buildReviewRequest`·`ScopeBlockedError`.
   - `scope-resolver.ts` — `resolveGitHubScope(ctx, input, options)`·`ScopeResolution`·`PatchAttachment.excluded`.
   - `importer.ts` — `importReviewResult(input, context)`·`ImporterInput`(`{kind:'bundle'}`)·`ImportContext`·`ImportOutcome`.
   - `vibe-bundle.ts` — `parseVibeBundle`/`serializeVibeBundle`.
   - `goal-source/resolver.ts` — `resolveGoalSource(ctx, opts)` → `{selected, candidates, diagnostics}`; `goal-source/types.ts` — `GitPort`/`createDefaultGitPort`; manifest의 `baseSha`/`headSha`/`source.confidence`/`source.goalText`는 `GoalSourceManifest` 최상위/`source` 필드.
   - `src/lib/config.ts` — **zod가 아니라 plain interface + mergeConfig** 구조. `audit` 필드의 optional-section 머지 패턴을 그대로 따른다.
   - `src/lib/{args,cli,logger,paths}.ts` — `parseArgs`/`getStringFlag`/`getBooleanFlag`/`runMain(main, import.meta.url)`/`logger`/`paths` 커맨드 선례 (`write-report.ts` 참고).
5. 하네스 wiring 선례:
   - `.vibe/harness/scripts/vibe-gen-schemas.mjs` — **.mjs → .ts 위임의 유일 선례**: tsx loader 경로 resolve(`node_modules/tsx/dist/loader.mjs` 2후보) → `spawnSync(process.execPath, ['--import', tsxImport, <ts파일>, ...args])` → exit status 전파. `vibe-pro-bridge.mjs`는 이 패턴을 그대로 쓴다 (`npx tsx`를 스크립트 안에서 재호출하지 않는다).
   - `.claude/skills/vibe-goal-iterate/SKILL.md` + `.codex/skills/vibe-goal-iterate/SKILL.md` — 스킬 frontmatter/wrapper 형식.
   - `.vibe/harness/test/codex-skills.test.ts` — wrapper가 통과해야 하는 assert 로스터: shard 마커 블록, `provider-neutral skill runbooks` 문구, `repository-root path` 문구, `../../../.claude/skills` 금지.
   - `docs/context/harness-gaps.md` — 6컬럼 표(`id | symptom | covered_by | status | script-gate | migration-deadline`) + Update protocol.
6. Hotfix 대상 원문: `.vibe/harness/scripts/vibe-agent-session-start.mjs`(`readHookInput()`/`HOOK_MODE` 상단 40줄), `run-codex.sh`의 `agent_session_start()`(L300~314), 기존 테스트 `agent-session-start.test.ts`·`run-codex-wrapper.test.ts`(`shellEnv`가 `VIBE_SKIP_AGENT_SESSION_START` 기본 `'1'`을 넣는 구조 확인).

ESM 컨벤션: NodeNext, 상대 import `.js` 확장자 명시, `strict`+`exactOptionalPropertyTypes`+`noUncheckedIndexedAccess`, UTF-8 (BOM 없음), 신규 의존성 금지 — node 내장 + 기존 zod만. 정렬은 전부 `compareStringsByCodePoint` (localeCompare 금지 — 신규 코드 포함).

## 기술 사양

### 파일 목록 / 의존 방향

```
src/pro-bridge/transports/types.ts    # 포트 + 로컬 타입 + transport 해석 (신규)
src/pro-bridge/transports/manual.ts   # ManualDirectoryTransport + host 어댑터 (신규)
src/commands/pro-bridge.ts            # 서브커맨드 orchestration (신규)
scripts/vibe-pro-bridge.mjs           # tsx 위임 wrapper (신규)
src/lib/config.ts                     # ProBridgeConfig (추가만)
src/pro-bridge/scope-resolver.ts      # --no-renames (최소 수정)
scripts/vibe-agent-session-start.mjs  # stdin 가드 (최소 수정)
scripts/run-codex.sh                  # </dev/null (1줄)
```

의존 방향: `transports/types` → `contract`. `transports/manual` → `transports/types` + `contract`. `commands/pro-bridge` → `transports/*` + `goal-source/resolver` + `goal-source/types` + `scope-resolver` + `prompt-composer` + `importer` + `vibe-bundle` + `lib/{config,args,cli,logger}`. 역방향 의존(pro-bridge 코어 → commands/transports) 절대 금지.

### 1. `transports/types.ts` — 포트 + 레지스트리

```ts
import type {
  ReviewRequest,
  ReviewResultManifest,
  RequestLifecycleState,
} from '../contract.js';

export interface RequestHandle {
  requestId: string;
  transport: string;                 // 'manual'
  createdAt: string;                 // ISO
  requestDir: string;                // 절대경로 — outbox/<id>
  requestPath: string;               // request.json 절대경로
  promptPath: string;                // prompt.md 절대경로
}

export interface RequestStatus {
  requestId: string;
  state: RequestLifecycleState;      // contract의 lifecycle 상태 재사용
  kind: string;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
  detail: string | null;
}

export interface ImportReceipt {
  requestId: string;
  folder: string;
  installedPath: string;
  resultFilesSha256: string;
  importedAt: string;
}

export interface VibeProBridgeTransport {
  createRequest(request: ReviewRequest): Promise<RequestHandle>;
  getRequestStatus(requestId: string): Promise<RequestStatus>;
  getResultManifest(requestId: string): Promise<ReviewResultManifest | null>;
  getResultFile(requestId: string, path: string): Promise<Uint8Array>;
  acknowledgeImport(requestId: string, receipt: ImportReceipt): Promise<void>;
}

export const SUPPORTED_TRANSPORTS = ['manual'] as const;
export type SupportedTransportName = (typeof SUPPORTED_TRANSPORTS)[number];

// 09 §4 우선순위: explicit CLI option > project config > (installed MCP app: Phase 2) > manual fallback
export function resolveTransportName(input: {
  cliOption?: string | undefined;
  configTransport?: string | undefined;
}): SupportedTransportName;   // 미지원 이름 → SUPPORTED_TRANSPORTS 로스터를 담은 Error throw
```

포트는 design.md §6.1 시그니처 5메서드 그대로 — 메서드 추가/이름 변경 금지 (Contract 예외 6). 모든 타입은 로컬 interface (zod/gen-schemas 등록 금지).

### 2. `transports/manual.ts` — ManualDirectoryTransport + host 어댑터

**상태 저장**: `<repoRoot>/.vibe/pro-bridge/outbox/<requestId>/` 아래 `request.json`(ReviewRequest 전문, 2-space JSON + trailing newline), `prompt.md`(`request.reviewPrompt` 그대로), `status.json`(`{state, updatedAt, detail}`). git-ignored 런타임 디렉터리 — durable provenance는 결과 패키지 `.bridge/`가 담당 (design.md §10).

```ts
export interface ManualTransportOptions {
  repoRoot: string;
  bridgeRoot?: string;               // 기본 <repoRoot>/.vibe/pro-bridge
  now?: () => Date;                  // 결정성 주입
}

export class ManualTransportUnsupportedError extends Error {}

export class ManualDirectoryTransport implements VibeProBridgeTransport {
  constructor(options: ManualTransportOptions);
  // 포트 5메서드 +
  listRequests(): Promise<RequestStatus[]>;          // 최신순 (createdAt desc)
  cancelRequest(requestId: string): Promise<void>;   // state → 'cancelled'
  readRequest(requestId: string): Promise<ReviewRequest | null>;
}
```

동작 규칙:
- `createRequest`: `ReviewRequestSchema.parse`(contract 경유)로 자체 검증 → requestId가 `/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/` 불일치면 거부(경로 주입 방어 — requestId는 디렉터리명이 된다) → 디렉터리 생성 + 3파일 기록 + fsync best-effort(Windows 관용: 실패 무해) → state `'ready'` → RequestHandle 반환. 동일 requestId 재생성은 거부(Error).
- `getRequestStatus`: status.json + request.json 읽기. `imported.json` 존재 → `'imported'`. state가 종결 아니고 `now() > request.expiresAt` → `'expired'` 보고 (파일 갱신은 재량). 미존재 requestId → Error.
- `getResultManifest`: **항상 `null` 반환** — manual wire에는 원격 manifest가 없다 (Phase 1 결과 반입은 vibe-bundle → importer 직결). 주석으로 명시.
- `getResultFile`: `ManualTransportUnsupportedError` throw — "manual transport delivers results via clipboard/file bundle" 취지 메시지.
- `acknowledgeImport`: `imported.json`에 ImportReceipt 기록 + state `'imported'`. 미존재 requestId → Error (조용한 성공 금지).
- lifecycle 전이는 contract의 `canTransition` 재사용해 검증 (`ready→imported`는 직행 불가이므로 manual에선 `ready→claimed→…`를 강제하지 않고, acknowledge 시점에 `result-ready→imported` 경로로 기록하거나 state 전이 검증을 완화한 사유를 주석 1줄로 남긴다 — 재량이되 정직하게).

**Host 어댑터 (같은 파일에 export — 파일 로스터 고정)**: 전부 주입 가능, `shell: true` 절대 금지, `execFile`/`spawn` + `windowsHide: true`.

```ts
export interface HostExecPorts {
  execFile?: typeof import('node:child_process').execFile;  // 또는 동등 주입 표면 — 테스트 fake용
  platform?: NodeJS.Platform;
}
export async function copyFileToClipboard(filePath: string, ports?: HostExecPorts):
  Promise<{ ok: boolean; method: string | null; error: string | null }>;
export async function readClipboardText(ports?: HostExecPorts):
  Promise<{ ok: boolean; text: string | null; error: string | null }>;
export async function openInBrowser(url: string, ports?: HostExecPorts):
  Promise<{ ok: boolean; error: string | null }>;
```

- 클립보드 쓰기: Windows 우선 `powershell -NoProfile` + `Set-Clipboard` (내용은 인자 이스케이프 대신 **파일 경유**: `Get-Content -Raw -Encoding utf8 '<promptPath>'` 조합 권장 — 한글 프롬프트 UTF-8 안전이 계약, 정확한 PS 구문은 재량). POSIX fallback 순서: `pbcopy` → `xclip -selection clipboard` → `wl-copy` (파일 내용을 child stdin으로 write). 전부 실패 → `ok:false` + 커맨드가 파일 경로 안내로 대체 (전송 실패 아님).
- 클립보드 읽기: `powershell Get-Clipboard -Raw` / `pbpaste` / `xclip -selection clipboard -o` / `wl-paste`.
- 브라우저: `cmd /c start "" <url>`(win) / `open`(darwin) / `xdg-open`(기타). spawn detached + child `error` 핸들러 부착(gap-wsl-browser-open-eacces 선례 — 비동기 EACCES가 프로세스를 죽이지 않게) — 실패는 warning-only.
- 딥링크: `https://chatgpt.com/?q=<encodeURIComponent(짧은 부트스트랩 문구)>`. 부트스트랩은 "클립보드의 리뷰 요청 프롬프트를 붙여넣어 진행하라" 취지의 고정 상수 1~2문장. **URL 전체 2048바이트 초과 시 bare `https://chatgpt.com/`** — 본문은 항상 클립보드가 정본, `?q=`는 실패 무해 편의 (design.md §8.3).

### 3. `src/commands/pro-bridge.ts` — 서브커맨드

**테스트 가능 구조 (필수)**: 모듈 API 직호출로 전 경로를 검증할 수 있어야 한다.

```ts
export interface ProBridgeIo {
  out(line: string): void;
  err(line: string): void;
  confirm(question: string): Promise<boolean>;   // 기본 구현: TTY면 stdin 질의, 비TTY면 false
}
export interface ProBridgeDeps {
  repoRoot?: string;                              // 기본 process.cwd()
  git?: GitPort;                                  // 기본 createDefaultGitPort(repoRoot)
  config?: ProBridgeConfig;                       // 기본 loadConfig() → resolveProBridgeConfig
  io?: ProBridgeIo;
  clipboard?: { copyFile: typeof copyFileToClipboard; readText: typeof readClipboardText };
  browser?: { open: typeof openInBrowser };
  goalResolver?: typeof resolveGoalSource;        // 테스트 주입
  now?: () => Date;
}
export async function runProBridge(argv: string[], deps?: ProBridgeDeps): Promise<number>; // exit code
runMain(async () => { process.exitCode = await runProBridge(process.argv.slice(2)); }, import.meta.url);
```

**공통 게이트**: `config.enabled !== true`이면 `status`/`list`를 제외한 모든 서브커맨드는 `.vibe/config.json`(또는 config.local.json)의 `proBridge.enabled: true` 설정 안내 1줄 출력 후 exit 1 (명시 opt-in — 미사용 시 오버헤드 0 원칙). transport는 `resolveTransportName({cliOption: --transport, configTransport})`.

**서브커맨드**:

- **(default, 인자 없음)** — 09 §1 상태 분기: outbox에 미종결(ready/claimed 계열) 요청 존재 → `status` 출력 + "결과가 준비되면 `npm run vibe:pro-sync`" 제안 (manual transport는 result-ready를 자동 감지할 수 없음을 한 줄로 정직하게 안내). 없음 → `audit` 플로우로 진행.
- **`audit [--yes] [--allow-reconstructed] [--base <sha>]`** — kind=goal_audit 파이프라인:
  1. `resolveGoalSource({repoRoot, git, now})`. `selected === null` → **실패 모드 1**: diagnostics/candidates 요약 출력 + "발행 보류" + exit 1. `source.confidence === 'reconstructed'` → 경고 출력 후 `--allow-reconstructed` 또는 interactive confirm 필요 (미승인 시 발행 보류).
  2. `resolveGitHubScope({repoRoot, git}, {baseSha: manifest.baseSha, headSha: manifest.headSha}, {maxPatchBytes: config.maxPatchBytes})`.
  3. `buildReviewRequest({kind:'goal_audit', userGoal: manifest.source.goalText, goalSource: manifest, scope, now, ttlDays: config.requestTtlHours / 24})`. `ScopeBlockedError` catch → 사유별 안내: `repository-fullname-unresolved` → **실패 모드 2** (origin 없음: GitHub remote 필요 + manual/API 경로 안내); `patch-oversized` + head 비가시 → **실패 모드 3** (patch 상한 초과 안내 + "review-branch push는 사용자가 직접 실행 후 재시도" — **자동 push 절대 금지, push 명령을 실행하지 않는다**); `base-not-on-remote` → base push 안내. 전부 exit 1.
  4. **전송 직전 외부 발행 1회 고지 (design.md §9)**: 요청 메타데이터·리뷰 프롬프트·(있다면) patch가 OpenAI(ChatGPT 웹)로 나간다는 사실 + patch 파일 roster + excluded 요약을 출력하고 confirm. `--yes`면 생략. 비TTY + `--yes` 없음 → "non-interactive는 --yes 필요" 안내 + exit 1.
  5. `transport.createRequest(request)` → outbox 기록.
  6. `config.copyInvocation`이면 `clipboard.copyFile(promptPath)`. 실패 → **경고 + prompt.md 경로 안내로 대체** (실패 모드 4의 정신: bridge 불능이어도 outbox 패키지는 이미 있다).
  7. `config.openBrowser`이면 `browser.open(딥링크)` — 실패 warning-only.
  8. 마무리 안내 출력: requestId, prompt.md 경로, "Pro 모델은 사용자가 직접 선택", "응답의 vibe-bundle 1블록을 복사한 뒤 `npm run vibe:pro-sync`". **compareUrlHint는 `scope.git.headVisibleOnGitHub === true`인 케이스에서만 출력** (carry-over 1: head 미푸시 시 404 URL 노출 금지).
- **`design "<goal>" [--yes]`** — kind=feature_design. `userGoal` = 필수 positional (없으면 usage + exit 1). goalSource는 `null` (goal discovery 생략 — 설계 목표는 인자가 정본). base/head: `git rev-parse HEAD` 결과를 양쪽에 사용 (delta 리뷰가 아니라 현 아키텍처 기준 설계; dirty worktree면 scope-resolver가 range+patch로 처리). 이후 4~8단계 동일.
- **`status`** — `listRequests()` 표 출력: requestId / kind / state / createdAt / expiresAt. 비어있으면 안내.
- **`sync [--latest] [--from <file>] [--yes]`** — 결과 반입:
  1. 입력 텍스트: `--from <file>` → 파일 읽기(UTF-8); 기본 → `clipboard.readText()` (실패/비어있음 → 안내 + exit 1).
  2. `parseVibeBundle(text)`. 파싱 에러(특히 `VIBE:END` 부재 = 복사 잘림) → 에러 로스터 출력 + exit 1.
  3. requestId 바인딩: 번들 requestId와 일치하는 outbox 요청의 request.json 로드 → `ImportContext.request`. `web-origin`이면 request 없이 진행(importer가 skippedValidations 기록). `--latest`는 requestId가 `web-origin`일 때 최신 미종결 요청에 바인딩을 시도하는 편의 — 불일치 강제 바인딩 금지.
  4. `importReviewResult({kind:'bundle', bundle}, { repoRoot, request, expectedRepositoryFullName: request?.repository.fullName ?? null, transport: 'manual', now })` — **installRoot는 기본값(docs/plans) 사용** (carry-over 3); `config.resultRoot`가 `docs/plans`가 아니면 `installRoot: path.join(repoRoot, config.resultRoot)` 전달.
  5. outcome 분기: `installed` → `acknowledgeImport` (바인딩된 요청이 있을 때만) + `nextAction`·skippedValidations 출력, **구현 자동 시작 금지**; `no-op`/`refused`/`invalid` → 각각 정직하게 출력 + invalid/refused는 exit 1. revision 승인은 `--yes`가 아니라 별도 `--approve-revision` 플래그로만 (덮어쓰기성 결정을 --yes에 합치지 않는다).
- **`cancel <id>`** — `cancelRequest` + 확인 출력. 미존재 → exit 1.
- **`list`** — status와 동일 데이터, 종결 포함 전체.

**사용자 출력 규칙**: patch excluded 로스터 표시 시 raw `reason` 라벨(`'secret'`/`'binary'`)을 그대로 노출하지 않고 "보안 필터 제외"/"비텍스트 제외"로 그룹 표기 (carry-over 4: untracked unsafe-path의 `'binary'` 라벨이 부정확할 수 있음 — 사용자 문구는 라벨 의미론에 의존하지 않는다). 에러/안내는 `logger` 또는 io 경유 — `console.log` 직접 호출 금지.

### 4. `scripts/vibe-pro-bridge.mjs` + npm scripts

`vibe-gen-schemas.mjs` 패턴 그대로: tsx loader 2후보 resolve → `spawnSync(process.execPath, ['--import', tsxImport, <src/commands/pro-bridge.ts 절대경로>, ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true })` → `process.exit(result.status ?? 1)`. 로직 없음 — 순수 위임.

package.json scripts (4키 추가만):

```json
"vibe:pro-audit":  "node .vibe/harness/scripts/vibe-pro-bridge.mjs audit",
"vibe:pro-design": "node .vibe/harness/scripts/vibe-pro-bridge.mjs design",
"vibe:pro-sync":   "node .vibe/harness/scripts/vibe-pro-bridge.mjs sync",
"vibe:pro-status": "node .vibe/harness/scripts/vibe-pro-bridge.mjs status"
```

스킬 runbook의 커맨드 표기는 이 4키와 정확히 일치시켜라 (`npm run vibe:pro-audit -- --yes` 형태의 추가 인자 전달 포함).

### 5. config — `proBridge` 섹션

`src/lib/config.ts` (추가만):

```ts
export interface ProBridgeConfig {
  enabled: boolean;
  transport: string;          // Phase 1 유효값 'manual' — 검증은 resolveTransportName
  resultRoot: string;
  requestTtlHours: number;
  maxPatchBytes: number;
  openBrowser: boolean;
  copyInvocation: boolean;
  githubRequired: boolean;
}
export const DEFAULT_PRO_BRIDGE_CONFIG: ProBridgeConfig = {
  enabled: false, transport: 'manual', resultRoot: 'docs/plans',
  requestTtlHours: 72, maxPatchBytes: 1048576, openBrowser: true,
  copyInvocation: true, githubRequired: true,
};
export function resolveProBridgeConfig(base?: Partial<ProBridgeConfig>, override?: Partial<ProBridgeConfig>): ProBridgeConfig;
```

- `VibeConfig`에 `proBridge?: ProBridgeConfig`, `VibeConfigOverride`에 `proBridge?: Partial<ProBridgeConfig>` 추가, `mergeConfig`에 `audit` 필드와 동일한 optional-section 머지 추가. 기존 필드·동작 무변경.
- `.vibe/config.json`에 `proBridge` 섹션을 `DEFAULT_PRO_BRIDGE_CONFIG` 값 그대로 추가 (`enabled: false` — 사용 시 사용자/Orchestrator가 config.local.json 또는 config.json에서 켠다).
- `.vibe/sync-manifest.json`: hybrid `.vibe/config.json`의 **`projectKeys`에 `"proBridge"` 추가** — 사용자의 transport/enabled 선택은 프로젝트 소유이므로 sync가 덮어쓰지 않는다 (harnessKeys가 아닌 이유를 Final report W7에 명기).
- `.gitignore`: `# pro-bridge runtime mailbox (durable provenance lives in installed packages)` 주석 + `.vibe/pro-bridge/` 라인 추가.

### 6. 스킬 4종

**`.claude/skills/vibe-goal-audit/SKILL.md`** — frontmatter(`name: vibe-goal-audit`, description: 마지막 goal의 구현을 웹 ChatGPT Pro 세션 리뷰로 보내고 결과 패키지를 설치할 때 사용) + 본문 runbook:

1. **사전조건 체크리스트**: `.vibe/config.json` `proBridge.enabled: true`; ChatGPT GitHub 커넥터 앱 설치 + 대상 repo 승인(private repo는 설정에서 명시 승인); 신규/private repo는 인덱싱 ~5분 지연 — 안 보이면 `repo:owner/name <키워드>` 검색으로 인덱싱 트리거; **Pro 모델은 자동 선택 불가 — 웹에서 사용자가 직접 선택**.
2. **커맨드 절차**: 기본 `npm run vibe:pro-audit` (상태 분기 자동) / 비대화 `-- --yes` / `npm run vibe:pro-status` / 결과 반입 `npm run vibe:pro-sync` (클립보드 기본, `-- --from <file>` 대안) / `node .vibe/harness/scripts/vibe-pro-bridge.mjs cancel <id>`·`list`.
3. **실패 모드 4종 대응** (09 §1): goal 불명확 → 후보 리스트 확인 후 goal을 명시해 재시도(발행 보류가 기본) / origin 없음 → GitHub remote 필요 / head 비가시 → patch 자동 첨부 또는 상한 초과 시 **사용자가 직접** branch push 후 재시도 (스킬·커맨드는 push하지 않는다) / bridge 불능(클립보드/브라우저 실패) → `.vibe/pro-bridge/outbox/<id>/prompt.md`를 수동으로 복사.
4. **전송 = 외부 발행 고지**: 요청 패킷·patch가 OpenAI로 전송됨 — 커맨드가 전송 직전 1회 고지하며 스킬 사용자는 이를 승인하는 것.
5. **브라우저 핸드오프 경계** (design.md §8.3): 지원 = chatgpt.com 오픈 + 클립보드 + 짧은 `?q=` 프리필(실패 무해). 비지원 = DOM 자동화·자동 제출·모델 피커 자동화.
6. **결과 반입**: Pro 응답의 vibe-bundle 1블록 전체 Copy → sync. 잘린 복사는 `VIBE:END` 부재로 거부됨. 설치 후 구현 자동 시작 금지 — `docs/plans/<folder>/prompt/CLI_MAIN_SESSION_PROMPT.md`를 다음 goal로 투입할지는 사용자가 결정.
7. **커넥터 가용성 실측 기록 지시**: dogfood 왕복 시 Pro 모드 챗의 GitHub 커넥터 동작 여부·제약 관찰을 session-log에 `[decision]` 없이 짧은 실측 노트로, 그리고 결과 패키지의 reviewerDeclaration으로 확인하라는 지시 (design.md §12 리스크 추기용).

**`.claude/skills/vibe-pro-design/SKILL.md`** — 동일 골격, kind=feature_design: `npm run vibe:pro-design -- "<goal>"` 필수 인자, goal discovery 없이 인자가 정본, web-origin 설계(웹에서 먼저 시작)는 Phase 3 예정이며 현재는 manual sync(`--from`/클립보드)만 지원한다고 명시.

**`.codex/skills/{vibe-goal-audit,vibe-pro-design}/SKILL.md`** — `vibe-goal-iterate` wrapper 형식 그대로: frontmatter(name + Codex-compatible wrapper description) + `provider-neutral skill runbooks` 문구 + `<!-- BEGIN:VIBE-CODEX:SHARDS -->` 블록에 대응 `.claude/skills/<name>/SKILL.md` 경로 + `repository-root path` 문구. 상대 `../../..` 경로 금지. (`codex-skills.test.ts`와 `vibe:codex-wrapper-audit`가 자동 검증한다.)

### 7. wiring — harness-gaps + 제안 텍스트

- `docs/context/harness-gaps.md` Entries 표 끝에 6컬럼 행 1개 append (Update protocol 준수):
  - id `gap-web-pro-bridge` / symptom: goal 리뷰·신규 설계를 웹 ChatGPT Pro 세션으로 보내고 결과 패키지를 받는 왕복이 구조화된 계약 없이 수동 복붙에 의존했음 / covered_by: `docs/plans/web-pro-bridge/design.md` Hybrid v2 + `src/pro-bridge/**`(vpb-01~03: contracts·goal-source·scope·composer·importer·manual transport) + `vibe-pro-bridge.mjs` + `vibe:pro-*` scripts + `$vibe-goal-audit`/`$vibe-pro-design` 스킬 + E2E mock 테스트 / status `partial` (Phase 2~4: mcp-mailbox·web-origin·자동화 어댑터 미구현) / script-gate `partial` / migration-deadline `vpb-05`.
- **CLAUDE.md·README.md는 수정 금지.** 대신 Final report에 아래 2건의 **그대로 붙여넣을 수 있는 정확한 텍스트**를 제시하라: (a) CLAUDE.md "관련 스킬" 목록에 넣을 `/vibe-goal-audit`·`/vibe-pro-design` 항목(각 한 줄 설명 포함), (b) CLAUDE.md 훅/스크립트 표에 넣을 `vibe-pro-bridge.mjs` 행(시점: 사용자 명시 호출 | 역할: Phase 1 manual transport 왕복 커맨드 — lifecycle 무결합·opt-in). README용 사용자 가시 섹션 텍스트도 동일하게 제안만.

### 8. Hotfix — session-start stdin drain 회귀

**증상**: `cat docs/prompts/x.md | ./.vibe/harness/scripts/run-codex.sh -` 실행 시 `agent_session_start()`가 띄우는 `node vibe-agent-session-start.mjs`가 wrapper의 stdin(파이프)을 상속하고, `readHookInput()`의 `readFileSync(0)`이 **프롬프트 전문을 drain**하여 Codex에 빈 프롬프트가 전달된다.

**수정 (a) — `run-codex.sh` 1줄 (결정적 방어)**: `agent_session_start()`의 `node "$script_path" >&2 || true` → `node "$script_path" </dev/null >&2 || true`. 이 함수 밖 어떤 변경도 금지.

**수정 (b) — `vibe-agent-session-start.mjs` stdin 가드 (비-Claude 호스트 방어)**: `readHookInput()` 진입 전에 hook 컨텍스트 가능성을 판정하고, 아니면 stdin을 **아예 읽지 않는다**:

```js
const CLAUDE_HOOK_CONTEXT = process.argv.includes('--hook')
  || Object.keys(process.env).some((key) => key.startsWith('CLAUDE'));
// readHookInput(): if (!CLAUDE_HOOK_CONTEXT) return null;  ← isTTY 체크보다 먼저
```

근거: 실제 Claude Code hook 자식 프로세스는 항상 `CLAUDE*` env(`CLAUDE_PROJECT_DIR`, `CLAUDECODE` 등)를 보유하므로 v1.7.27의 legacy stdin 자동 감지(`--hook` 플래그 없는 오래된 hook command)는 보존된다. 한편 Claude 세션 **안에서** 실행되는 run-codex.sh 파이프라인은 CLAUDE* env가 있어 이 가드를 통과하므로, (a)의 `</dev/null`이 결정적 방어다 — 두 수정은 중복이 아니라 각각 다른 경로를 막는다. 이 관계를 코드 주석 1줄과 Final report에 명시. `HOOK_MODE` 파생·dedupe·root 해석 등 나머지 로직 무변경.

**테스트**:
- `agent-session-start.test.ts`: (i) 기존 `'auto-detects SessionStart from stdin and uses the input cwd'`·`'deduplicates repeated delivery of the same hook lifecycle but preserves source transitions'` 두 케이스의 env fixture에 `CLAUDECODE: '1'` 추가 — assert 무변경 (Contract 예외 3). (ii) 신규 케이스 `'ignores piped stdin when invoked outside a hook context'`: 모든 `CLAUDE*` env 키를 제거하고 `--hook` 없이, stdin에 `hook_event_name: 'SessionStart'` + `cwd: <다른 루트>` JSON을 주입 → exit 0, 이벤트가 JSON의 cwd가 아니라 spawn cwd(또는 VIBE_ROOT) 아래에 `invocation: 'provider-wrapper'`로 기록되고 JSON cwd 루트에는 daily 파일이 생기지 않음을 assert (stdin이 무시되었다는 관측 가능한 증거).
- `run-codex-wrapper.test.ts` append: `'preserves piped prompt when session start is enabled'` — 기존 stdin 스텁 패턴으로 `[bashScriptPath, '-']` + `input: 'hello from stdin'` + `shellEnv(binDir, { VIBE_SKIP_AGENT_SESSION_START: '0', CLAUDECODE: '1' })` → stdout에 `hello from stdin` 포함 assert (CLAUDE env가 있어도 `</dev/null` 방어로 프롬프트가 보존됨을 증명. 기존 suite가 skip되는 bash 부재 환경 처리는 파일의 기존 `{ skip }` 패턴 그대로).

### 9. Carry-over 교정 — scope-resolver rename patch 누락

`git diff --numstat`이 rename을 `{a => b}` 표기로 출력하면 patch 로스터/pathspec이 깨질 수 있다 (vpb-02 Evaluator carry-over 2). 교정: scope-resolver의 numstat 호출과 patch 본문 생성용 `git diff` 호출에 **`--no-renames`를 추가**한다 — rename이 delete+add 쌍으로 풀려 로스터 경로가 항상 plain path가 된다. 다른 로직 변경 금지. 회귀 테스트 1건 append (아래).

## Tests to add (§15 해제 — 아래 파일·케이스는 명시 요구사항)

러너: node:test(`describe`/`it`, `node:assert/strict`), 파일은 `.vibe/harness/test/` 바로 아래. fake `GitPort`/주입 어댑터 + `mkdtemp` 임시 디렉터리 — **실 repo의 `.vibe/pro-bridge/`·`docs/plans/`·클립보드·브라우저·네트워크 접근 금지**. 케이스명은 아래 문자열 그대로 (grep 검증 대상).

**1. `pro-bridge-transport-manual.test.ts`** — describe `'manual directory transport'`:
- `'creates an outbox request with request json and prompt markdown'` — 3파일 + state ready + RequestHandle 경로.
- `'rejects request ids that are not filesystem safe'` — `../x`, 절대경로성 id 거부.
- `'rejects duplicate request creation'`
- `'reports request status and expiry from the outbox'` — now 주입으로 expiresAt 경과 → expired.
- `'returns null result manifest for the manual wire'`
- `'rejects result file fetch as unsupported'` — `ManualTransportUnsupportedError`.
- `'acknowledges import with a receipt marker'` — imported.json + state imported.
- `'cancels a pending request and lists newest first'`
- `'copies prompt file through the injected clipboard adapter'` — fake exec가 받은 커맨드/입력 검증 + 전부 실패 시 `ok:false`.
- `'opens the browser as convenience only and never throws'` — fake 실패 → `ok:false`, throw 없음; 2KB 초과 부트스트랩 → bare URL.

**2. `pro-bridge-command.test.ts`** — describe `'pro bridge command'` (전부 deps 주입, mkdtemp repoRoot):
- `'refuses subcommands while the bridge is disabled'` — enabled:false → exit 1 + 안내 (status/list는 통과).
- `'defaults to status guidance when a request is pending'`
- `'holds publication when no coherent goal is found'` — goalResolver 주입 selected null → 후보/diagnostics 출력 + exit 1.
- `'requires explicit approval for reconstructed goal confidence'`
- `'requires confirmation before external publication and honors the yes flag'` — confirm false → 미발행; `--yes` → confirm 미호출.
- `'never pushes and asks the user when head is invisible with oversized patch'` — ScopeBlockedError(patch-oversized) → push 안내 문구 + fake GitPort에 mutating 명령 0회.
- `'omits compare url hint when head is not visible on github'` — carry-over 1.
- `'does not expose raw exclusion reason labels in user output'` — excluded에 `'binary'` 라벨 → 출력에 리터럴 `binary`/`secret` 라벨 부재.
- `'sync installs a clipboard bundle through the shared importer'` — fake clipboard가 vibe-bundle 반환 → docs/plans(<mkdtemp>) 설치 + nextAction 출력 + acknowledgeImport 호출됨.
- `'sync from file rejects a truncated bundle'` — `VIBE:END` 부재 → exit 1.
- `'sync refuses revision overwrite without the approve revision flag'`
- `'cancel and list manage the outbox lifecycle'`

**3. `pro-bridge-e2e.test.ts`** — describe `'pro bridge manual round trip'` (이번 Sprint closure evidence):
- `'round trips an audit request from goal scope to an installed result package'` — fake GitPort(remote 가시 + 40-hex SHA 응답) → `resolveGitHubScope` → `buildReviewRequest` → `ManualDirectoryTransport.createRequest`(mkdtemp bridgeRoot) → outbox 검증 → outputContract.requiredFiles를 충족하는 mock 결과 파일 세트 → `serializeVibeBundle` → 커맨드 sync 경로(모듈 API + fake clipboard) → `docs/plans/<folder>/` 필수 4파일 + `.bridge/provenance.json` 존재 + requestId 바인딩 검증.
- `'acknowledges import and closes the outbox request'` — sync 후 status가 imported.
- `'installs a web origin bundle with skipped validations recorded'` — `requestId: web-origin` 번들 → 설치 + provenance의 skippedValidations 비어있지 않음.

**4. append 3건** (기존 파일):
- `pro-bridge-scope-resolver.test.ts`: `'disables rename detection so renamed files stay in the patch roster'` — fake GitPort가 받은 diff/numstat args에 `--no-renames` 포함 assert.
- `agent-session-start.test.ts`: `'ignores piped stdin when invoked outside a hook context'` (§8).
- `run-codex-wrapper.test.ts`: `'preserves piped prompt when session start is enabled'` (§8).

## Codex 실행 환경 제약

- Windows sandbox — **tsc/test/빌드/npm/git push/클립보드/브라우저 실행 불가**. self-check는 static inspection으로만 수행하고, 실행 검증은 Orchestrator가 샌드박스 밖에서 수행한다. 실행 못 한 명령을 Final report "Sandbox-only failures"에 전부 나열: `npm run vibe:typecheck`, `npm run vibe:self-test`, `npm run vibe:build`, `npm run vibe:gen-schemas -- --check`, `npm run vibe:codex-wrapper-audit`, `npm run vibe:sync-audit`.
- 네트워크·의존성 설치 금지. 샌드박스 우회용 영구 설정 변경 금지 (`_common-rules.md` §1~2).
- 실 repo의 `.vibe/pro-bridge/`를 생성하는 코드 실행 금지 — 런타임 디렉터리는 테스트 mkdtemp 안에서만 생성·정리.

## 완료 체크리스트

기계 검증 (Orchestrator가 샌드박스 밖에서 실행):

- [ ] `npm run vibe:typecheck` exit 0
- [ ] `npm run vibe:self-test` exit 0 (기존 suite 무손상 — 특히 codex-skills parity·run-codex-wrapper·agent-session-start + 신규 3파일 + append 3건)
- [ ] `npm run vibe:build` exit 0
- [ ] `npm run vibe:gen-schemas -- --check` exit 0
- [ ] `npm run vibe:codex-wrapper-audit` exit 0
- [ ] `npm run vibe:sync-audit` exit 0
- [ ] grep: 스킬 4파일 존재, wrapper 2종에 `BEGIN:VIBE-CODEX:SHARDS` + 대응 `.claude/skills/...` 경로
- [ ] grep: `.gitignore`에 `.vibe/pro-bridge/`
- [ ] grep: package.json `vibe:pro-audit|vibe:pro-design|vibe:pro-sync|vibe:pro-status` 4키
- [ ] grep: `run-codex.sh`의 `agent_session_start()`에 `</dev/null`
- [ ] grep: `vibe-agent-session-start.mjs`에 CLAUDE 컨텍스트 stdin 가드
- [ ] grep: 신규/append 테스트 케이스명 로스터 (transport 10 / command 12 / e2e 3 / append 3)
- [ ] grep: `docs/context/harness-gaps.md`에 `gap-web-pro-bridge` 6컬럼 행
- [ ] `git status` 변경 로스터 ⊆ Allowed writes + `CLAUDE.md`/`README.md`/`.claude/settings.json` 무변경

Inspection 항목 (**Evaluator 소환 Must** — 신규+수정 파일 >5):

- [ ] 커맨드 실패 모드 4종이 09 §1과 1:1 대응하고, 어떤 경로에서도 mutating git(특히 push)을 실행하지 않음 — no implicit push 불변식 육안 확인
- [ ] 외부 발행 고지가 전송 직전 정확히 1회, patch roster/excluded 요약 포함 (design.md §9)
- [ ] compareUrlHint 표기가 head 가시 케이스로 한정 + excluded raw 라벨 미노출 (carry-over 1·4)
- [ ] hotfix가 최소 diff — run-codex.sh는 1줄, session-start는 가드만, 기존 hook 감지·dedupe assert 무변경
- [ ] 스킬 runbook이 사전조건(GitHub 앱·repo 승인·인덱싱 트리거·Pro 수동 선택·enabled 설정)과 브라우저 핸드오프 경계를 빠짐없이 담음
- [ ] lifecycle 무결합 유지: hook/settings/sprint-complete/vibe:qa 어디에도 pro-bridge 연결 없음 (03 §4)
- [ ] **사용자/Orchestrator dogfood transcript**: 샌드박스 밖에서 `vibe:pro-audit`(--yes, enabled 임시 true) → mock 번들 → `vibe:pro-sync` 왕복 1회 실행 출력을 identity/payoff evidence로 확보 (Orchestrator 수행 — Generator는 해당 없음 표기)

## Final report 요구사항

`_common-rules.md` §9 형식 + §14.4 `## Wiring Integration` 표 필수. 추가로 **"CLAUDE.md/README 반영 제안 텍스트"** 섹션에 §7에서 요구한 붙여넣기용 텍스트 2+1건을 포함하라. 이번 Sprint W/D 사전 판정 (Generator는 실제 상태로 갱신·보고):

| Checkpoint | 예상 상태 | 근거 |
|---|---|---|
| W1 CLAUDE.md hook 표 | skipped+reason | Generator 수정 금지 — 제안 텍스트 제출, Orchestrator 반영 |
| W2 CLAUDE.md 관련 스킬 | skipped+reason | 동일 |
| W3 Sprint flow | n/a | Sprint 절차 무변경 |
| W4/W5 settings hook/statusline | n/a | lifecycle 무결합 원칙 — 등록 자체가 금지 |
| W6 sync-manifest harness[] | n/a (커버됨) | `src/**`·`scripts/**`·`.claude/skills/**`·`.codex/skills/**`·`test/**` 기존 글롭 |
| W7 sync-manifest hybrid keys | touched | config.json `projectKeys`에 `proBridge` (사용자 소유 선택 보존 — harnessKeys 미채택 사유 보고) |
| W8 README | skipped+reason | 제안 텍스트 제출 |
| W9 npm scripts | touched | `vibe:pro-*` 4종 |
| W10 release 기록 | skipped+reason | iteration 종료 시 Orchestrator 일괄 기록 |
| W11 migration | n/a | `proBridge`는 optional 키 — 부재 시 기본값 resolve, state 구조 무변경 |
| W12 회귀 테스트 | touched | 신규 3파일 + append 3건 |
| W13 harness-gaps | touched | `gap-web-pro-bridge` append |
| W14 .gitignore | touched | `.vibe/pro-bridge/` |
| D1~D6 | n/a | 삭제·개명 없음 |

`verified-callers` 필수 명시: `transports/manual.ts → commands/pro-bridge.ts + 테스트 2파일`, `transports/types.ts → manual.ts + commands/pro-bridge.ts`, `commands/pro-bridge.ts → scripts/vibe-pro-bridge.mjs`, `vibe-pro-bridge.mjs → package.json vibe:pro-* 4 scripts + 스킬 runbook 4파일`, `ProBridgeConfig → commands/pro-bridge.ts`, 스킬 → CLAUDE.md 등재는 제안 텍스트로 pending임을 명시. Sprint Contract 절에서 Current proof(정적 검사·파일 로스터·grep)와 Non-proof(미실행 명령·추론)를 분리 보고. hotfix의 이중 방어 관계(§8 — 가드는 비-Claude 호스트용, `</dev/null`이 Claude 세션 파이프라인의 결정적 방어)를 Deviations가 아닌 본문으로 설명.
