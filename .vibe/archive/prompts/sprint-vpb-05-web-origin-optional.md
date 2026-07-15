# Sprint vpb-05 — Web-origin design + 옵션 어댑터 (Phase 3~4)

(공용 규칙은 `.vibe/agent/_common-rules.md` 준수 — run-codex.sh가 자동 prepend한다.)

**이 Sprint 이후 사용자가 새로 할 수 있는 것**: 웹 ChatGPT Pro 세션에서 먼저 `create_design_request` 툴로 설계를 시작하고 결과까지 업로드하면, CLI에서 `npm run vibe:pro-sync -- --latest` 한 번으로 현재 repo에 매칭되는 web-origin 설계 패키지가 `docs/plans/`에 설치된다. 추가로 (전부 명시 opt-in) Workspace Agent trigger·Responses API(실행 전 비용 게이트)로 리뷰를 무인 구동하고, 설치된 구현 프롬프트를 `npm run vibe:pro-apply -- <folder>`로 codex cloud에 투입할 수 있으며, MCP 서버 기본 포트가 Windows WinNAT 제외 대역을 피해 18488로 이동하고 포트 점유 시 원인 힌트가 출력된다.

이 Sprint는 frontend/게임/시각 경험 제품을 건드리지 않는다 (CLI + transport 어댑터 표면). 경험형 evidence는 screenshot 대신 **실 커맨드 transcript**로 한정한다: Orchestrator가 샌드박스 밖에서 `vibe:pro-mcp`(tunnel none) 기동 → JSON-RPC `tools/call(create_design_request)` 왕복 → `list`에 web 요청 노출 → `vibe:pro-apply`(envId 미설정) 가이드 출력 확인이 identity/payoff evidence다. 실 ChatGPT 왕복·실 OpenAI API 과금 호출·실 codex cloud 투입은 Sprint pass 이후 사용자 확인 항목으로 분리한다.

## Sprint Contract

- **Target / output surface**:
  - `.vibe/harness/src/pro-bridge/mailbox/tools.ts` — 12번째 툴 `create_design_request`(web-origin request 생성) + `createMailboxTools` optional options 파라미터 (확장).
  - `.vibe/harness/src/pro-bridge/transports/workspace-agent.ts` — `WorkspaceAgentTransport`: mailbox 위임 + 외부 trigger 명령 실행(202-only), 멱등 trigger (신규).
  - `.vibe/harness/src/pro-bridge/transports/responses-api.ts` — `ResponsesApiTransport`: 같은 request/result 스키마, fetch 포트 주입, 비용 추정, background 폴링, vibe-bundle 추출, surface 강제 (신규).
  - `.vibe/harness/src/commands/pro-bridge.ts` — sync의 web-origin 매칭(fullName·unimported·kind·최신)·HEAD 불일치 게이트, `apply` 서브커맨드, adapter transport 분기, mcp listen 에러 힌트 (확장).
  - `.vibe/harness/src/pro-bridge/importer.ts` — `ImportContext.acknowledgedValidations` 최소 확장 (skippedValidations 합류).
  - `.vibe/harness/src/pro-bridge/scope-resolver.ts` — 기존 내부 함수 `parseGitHubFullName` export 승격만.
  - config `proBridge.{workspaceAgent,api,apply}` 섹션 + mcp 기본 포트 18488, npm script `vibe:pro-apply` 1키, setup 문서·스킬 runbook 갱신.
- **Allowed writes** (이 목록 밖은 쓰기 금지):
  - `.vibe/harness/src/pro-bridge/mailbox/tools.ts` (**확장만**: 툴 1종 추가 + `createMailboxTools(store, options?)` optional 2번째 파라미터. 기존 11툴 정의·헬퍼 무변경)
  - `.vibe/harness/src/pro-bridge/transports/workspace-agent.ts` (신규)
  - `.vibe/harness/src/pro-bridge/transports/responses-api.ts` (신규)
  - `.vibe/harness/src/pro-bridge/transports/types.ts` (**registry 추가만**: `SUPPORTED_TRANSPORTS`에 `'workspace-agent'`, `'responses-api'` — 포트 인터페이스·`resolveTransportName` 로직 무변경)
  - `.vibe/harness/src/pro-bridge/scope-resolver.ts` (**export 승격만**: `function parseGitHubFullName` → `export function`. 다른 변경 금지)
  - `.vibe/harness/src/pro-bridge/importer.ts` (**최소 확장**: `ImportContext`에 `acknowledgedValidations?: string[]` 추가 + 이 값을 skipped 집합에 병합해 outcome·provenance `skippedValidations`에 포함. 검증·설치 로직 무변경)
  - `.vibe/harness/src/commands/pro-bridge.ts` (**확장**: 아래 §2/§5/§6/§7 명시 범위만 — 기존 manual/mcp 동작 무변경)
  - `.vibe/harness/src/lib/config.ts` (**추가/변경 명시분만**: 3개 interface + defaults + `resolveProBridgeConfig` nested 머지 + `DEFAULT_PRO_BRIDGE_MCP_CONFIG.port` 8848→18488)
  - `.vibe/config.json` (`proBridge`에 `workspaceAgent`/`api`/`apply` 섹션 추가 + `mcp.port` 18488. `harnessVersion*` 등 다른 키 무변경)
  - `package.json` (`scripts`에 `vibe:pro-apply` 1키 **추가만**: `"node .vibe/harness/scripts/vibe-pro-bridge.mjs apply"`)
  - `docs/context/pro-bridge-setup.md` (port 예시 갱신 + 트러블슈팅/web-origin/옵션 어댑터 섹션 append)
  - `.claude/skills/vibe-pro-design/SKILL.md` (**명명된 수정 1건 + append**: "web-origin 설계는 Phase 3 예정" 문장을 현행화하는 1문장 교체 + "## Web-origin 경로 (Phase 3)" 섹션 append. 그 외 본문 무변경)
  - `docs/context/harness-gaps.md` (`gap-web-pro-bridge` 행 갱신만: covered_by에 vpb-05 산출물 추가, status `partial`→`covered`, migration-deadline `vpb-05`→`—`)
  - `.vibe/harness/test/pro-bridge-adapters.test.ts` (신규 — `.vibe/harness/test/` 바로 아래)
  - `.vibe/harness/test/pro-bridge-mailbox.test.ts` (**명명된 수정 1건 + append**: 'exposes eleven tools…' 케이스를 12툴 기준으로 갱신 + describe 1개 append)
  - `.vibe/harness/test/pro-bridge-mcp-server.test.ts` (**수정 1건만**: `assert.equal(tools.length, 11)` → `12`)
  - `.vibe/harness/test/pro-bridge-command.test.ts` (**append만**: 케이스 7건)
  - `.vibe/harness/test/pro-bridge-e2e.test.ts` (**append만**: 신규 describe 1개)
  - `.vibe/harness/test/pro-bridge-importer.test.ts` (**append만**: 케이스 1건)
- **Do NOT modify**:
  - `.vibe/harness/src/pro-bridge/contract.ts`, `.vibe/harness/src/lib/schemas/**` 일체 — **이번 Sprint는 zod wire 스키마 무변경으로 완결된다.** `ReviewOriginSchema`에 `'web'`, `reviewerDeclaration.surface`에 3종 surface가 이미 존재한다. 스키마를 고치고 싶어지면 설계 오류이므로 중단하고 Final report에 보고.
  - `.vibe/harness/src/pro-bridge/mailbox/store.ts` — 무변경. web-origin request는 tools.ts가 `ReviewRequest` 전문을 구성해 기존 `store.createRequest`로 넣는다. `MailboxRequestStatus`에 origin/fullName 필드를 추가하지 않는다 (매칭은 커맨드가 `readRequest`로 수행).
  - `.vibe/harness/src/pro-bridge/mailbox/server.ts`, `mailbox/tunnel.ts`, `transports/manual.ts`, `transports/mcp-mailbox.ts`, `goal-source/**`, `prompt-composer.ts`, `vibe-bundle.ts` — import 재사용만.
  - `.vibe/harness/scripts/**` 전부 — wrapper는 argv 위임이므로 `apply` 라우팅은 커맨드 안에서 처리 (신규 스크립트 0 유지).
  - `.vibe/sync-manifest.json` — 무변경 (신규 src/test 파일은 기존 `src/**`·`test/**` 글롭 커버, setup 문서는 vpb-04에 등재 완료).
  - `CLAUDE.md`, `README.md` — 반영 제안 텍스트를 Final report에 제시.
  - `.claude/settings.json`(lifecycle 무결합 — hook 등록 금지), `.claude/skills/vibe-goal-audit/SKILL.md`(어댑터 안내는 setup 문서가 담당), `.codex/**`(샌드박스 쓰기 불가), `.gitignore`, `.vibe/harness/tsconfig*.json`, 기존 다른 테스트, `.vibe/agent/*` state, `docs/plans/**`, `vibe-pro-bridge-design/**` (읽기 전용).
  - **범위 밖 (생성 금지)**: 원격 호스팅·OAuth tenant·암호화 스토리지 (design.md §6.3/§13 인용 거부), Codex plugin 매니페스트, **model-registry/`vibe-resolve-model` 확장** (responses-api 모델은 config 직접 지정만 — setup 문서에 명시), 자동 merge/apply·`codex cloud` 결과의 자동 반영, 브라우저 자동화, Responses API streaming/tool-calling, goal-audit의 web-origin 변형.
- **Explicit exceptions** (일반 규칙이 적용되지 않는 명명된 케이스):
  1. §15 unit test 금지 default는 "Tests to add" 섹션으로 해제된다.
  2. "기존 파일 수정 금지" 원칙의 명명된 예외 5건: `tools.ts`(툴 1종+옵션 파라미터), `types.ts`(registry 2항목), `scope-resolver.ts`(export 1건), `importer.ts`(context 필드 1개), `commands/pro-bridge.ts`(명시 범위). 이 밖의 리팩토링·정리 금지.
  3. "기존 테스트 무변경" 원칙의 명명된 예외 2건: 12툴 로스터 갱신 (`pro-bridge-mailbox.test.ts` 케이스명+개수, `pro-bridge-mcp-server.test.ts` 개수 assert). 다른 기존 케이스 무변경.
  4. 스킬 "append만" 원칙의 명명된 예외 1건: `vibe-pro-design/SKILL.md`의 "web-origin … Phase 3 예정" 문장은 거짓이 되므로 1문장 교체 허용.
  5. 설정 파일(`.vibe/config.json`, `package.json`) 수정은 Allowed writes의 명시 범위에서 이번 Sprint에 한해 허용.
  6. 기본 포트 변경(8848→18488)은 breaking이 아니다 — 명시 설정된 사용자 값은 그대로 존중되고 default만 이동. 마이그레이션 파일을 만들지 않는다 (W11 n/a 근거로 보고).
  7. vpb-03/04 확정 규칙 유지: 커맨드는 transport **concrete 클래스**를 쓰고, 포트 5메서드에 메서드를 추가하지 않는다. 4개 transport의 공통 CLI 표면은 커맨드 파일 지역 구조 타입(`BridgeCliTransport` 확장)으로 취급.
- **Reference-only values** (인용 가능, 신규 엔티티로 변환·구현 금지):
  - `VPB-008`의 "Workspace Agents trigger API" — 실 API 표면 미확정이므로 **외부 명령 argv 실행으로 추상화**한다 (`triggerCommand` config). OpenAI Workspace/Agents SDK 클라이언트 구현 금지.
  - `02_END_TO_END_WORKFLOWS.md` §C의 `@Vibe Pro Bridge create design package` 문구 — 웹 UX 예시. 정확성 의존 로직 금지 (툴 이름·스키마가 계약).
  - `codex cloud exec/status/diff` CLI 표면 — spawn argv로만 사용, 출력 파싱에 정확성 의존 금지 (stdout은 그대로 전달).
  - OpenAI Responses API 필드 로스터 — 아래 §4의 최소 표면이 정본. 그 외 필드·엔드포인트 구현 금지.
  - WinNAT 실측 제외 대역 `8827–8926` — 안내 메시지·문서 인용용 수치. 코드 로직으로 대역 검사 구현 금지.
  - `requestId: web-origin` (vibe-bundle manual fallback 리터럴) — 기존 경로 동작 확인만, 변경 금지.
- **Proof predicates** (public contract보다 강하지 않게):
  1. `npm run vibe:typecheck` exit 0.
  2. `npm run vibe:self-test` exit 0 — 기존 전체 suite 무손상(12툴 갱신 2건 제외 기존 케이스 문자 그대로 유지) + 신규 1파일 + append/수정 로스터.
  3. `npm run vibe:build` exit 0.
  4. `npm run vibe:gen-schemas -- --check` exit 0 (lib/schemas 무변경 — drift 0).
  5. `npm run vibe:codex-wrapper-audit` / `npm run vibe:sync-audit` exit 0.
  6. grep: `mailbox/tools.ts`에 `create_design_request` + 12 tool name 전부, `transports/types.ts`에 `'workspace-agent'`·`'responses-api'`.
  7. grep: `package.json`에 `vibe:pro-apply` 1키, `.vibe/config.json`에 `18488`·`workspaceAgent`·`"api"`·`"apply"`.
  8. grep: `commands/pro-bridge.ts`에 `excludedportrange` 힌트 문자열과 `EADDRINUSE`, usage 라인에 `apply`.
  9. grep: `responses-api.ts`에 `'responses-api'` surface 강제 리터럴, `OPENAI_API_KEY`는 env 읽기 경로에만 존재하고 `.vibe/harness/src/**` 어디에도 API key를 파일·config에 쓰는 코드 없음.
  10. grep: `docs/context/pro-bridge-setup.md`에 `18488`·`excludedportrange`·web-origin·responses-api 섹션, `vibe-pro-design/SKILL.md`에 web-origin 섹션 + "Phase 3 예정" 문구 부재.
  11. grep: 테스트 케이스명 로스터 (아래 Tests to add의 리터럴 전부).
  12. `git status` 변경 로스터 ⊆ Allowed writes — 특히 `store.ts`·`server.ts`·`contract.ts`·`lib/schemas/**`·`sync-manifest.json`·`CLAUDE.md`·`README.md`·`.claude/settings.json`·`scripts/**`·`.codex/**` 무변경.
- **Current proof / non-proof**: Final report에서 이번 실행으로 직접 얻은 fresh evidence(정적 검사·파일 로스터·grep)와 non-proof(샌드박스 제약으로 실행 못 한 명령, 실 ChatGPT/OpenAI API/codex cloud 왕복 미수행, 실 trigger 명령 미실행)를 반드시 분리 보고한다.

## 필수 참조 문서 (읽기 순서)

1. `docs/plans/web-pro-bridge/design.md` — Hybrid v2 정본. §6.4(web-origin: 웹이 request+result 함께 생성, sync --latest 매칭 = repo fullName·unimported·kind·생성시간, head 불일치 시 경고 후 사용자 판단, 서버 사전 기동 안내 + vibe-bundle `requestId: web-origin` fallback 유지) / §6.5(workspace-agent trigger 202-only·bridge status 유일 completion / responses-api 같은 스키마·opt-in·비용 게이트·surface 기록·Web Pro 사칭 금지 / codex cloud apply 별도 opt-in·자동 merge 금지) / §12(provenance surface 구분). **다른 참조와 충돌 시 이 문서 우선.**
2. `vibe-pro-bridge-design/specs/VPB-007-web-origin-design.md`, `VPB-008-optional-automation.md`, `02_END_TO_END_WORKFLOWS.md` §C~E — DoD와 규칙(같은 스키마, Bridge status authoritative, unavailable/error ≠ result-ready, 사칭 금지, transport 교체 시 discovery/import 무변경).
3. 기존 코드 (실제 export 시그니처 확인 필수 — 재구현 금지):
   - `src/pro-bridge/mailbox/store.ts` — `createRequest`(zod parse + idempotency 내장), `listRequests` 최신순 정렬, `getRequest`, `MailboxStoreError`. **무변경 재사용.**
   - `src/pro-bridge/mailbox/tools.ts` — `definition()` 헬퍼·`INJECTION_DEFENSE`·`WRITE_SCOPE` 패턴을 신규 툴에 그대로 적용.
   - `src/pro-bridge/transports/mcp-mailbox.ts` — 위임 패턴 원본. WorkspaceAgent/ResponsesApi transport가 이 클래스를 **composition**으로 감싼다.
   - `src/pro-bridge/importer.ts` — `ImportContext`/`ImportOutcome`/`skippedValidations` 흐름과 provenance receipt의 `reviewerDeclaration` 기록 (§12 surface 구분은 이미 존재 — 이번엔 테스트로 증명 + acknowledgedValidations 합류만).
   - `src/commands/pro-bridge.ts` — `runMailboxSync`/`createAndPublish`/`runMcpServer`/`gitHead`/`createGit`/`ProBridgeDeps` 주입 구조. 확장은 이 구조 위에.
   - `src/lib/config.ts` — nested 머지 패턴 (`mcp` 선례 그대로).
   - `src/pro-bridge/contract.ts` — `computePayloadSha256`, `REQUIRED_RESULT_FILES`, `compareStringsByCodePoint`, re-export 스키마. 신규 모듈은 `../contract.js` 경유 import (vpb-01 확정 규칙).
4. `test/pro-bridge-e2e.test.ts`의 fixture·mkdtemp·captureIo 패턴, `test/pro-bridge-command.test.ts`의 fake deps 주입 패턴 — 신규 테스트가 재사용.

ESM 컨벤션: NodeNext, 상대 import `.js` 확장자, `strict`+`exactOptionalPropertyTypes`+`noUncheckedIndexedAccess`, UTF-8 (BOM 없음), 신규 의존성 설치 금지 (node 내장 + 기존 zod/zod-to-json-schema만), 정렬은 `compareStringsByCodePoint`. Node `>=24` — 전역 `fetch` 사용 가능 (단 주입 포트 기본값으로만).

## 기술 사양

### 파일 목록 / 의존 방향

```
src/pro-bridge/mailbox/tools.ts            # +create_design_request (확장)
src/pro-bridge/transports/workspace-agent.ts  # McpMailboxTransport 합성 + trigger (신규)
src/pro-bridge/transports/responses-api.ts    # McpMailboxTransport 합성 + fetch 포트 (신규)
src/pro-bridge/transports/types.ts         # SUPPORTED_TRANSPORTS 2항목 (registry만)
src/pro-bridge/scope-resolver.ts           # parseGitHubFullName export (승격만)
src/pro-bridge/importer.ts                 # acknowledgedValidations (최소)
src/commands/pro-bridge.ts                 # sync 매칭·게이트 + apply + 분기 + 포트 힌트 (확장)
src/lib/config.ts                          # workspaceAgent/api/apply + port 18488
```

의존 방향: `transports/workspace-agent`·`transports/responses-api` → `transports/mcp-mailbox`(합성) + `transports/types` + `contract` (+responses-api는 `vibe-bundle` 파서 재사용). `mailbox/tools` → `mailbox/store` + `contract`. `commands/pro-bridge` → 위 전부. **역방향 의존 절대 금지.** 어댑터가 store를 직접 new 하지 않고 `McpMailboxTransport`를 감싼다 (단일 진입 유지).

### 1. `mailbox/tools.ts` — `create_design_request` (11→12 툴)

```ts
export interface MailboxToolOptions { now?: () => Date; requestTtlHours?: number }  // 기본 new Date / 72
export function createMailboxTools(store: MailboxStore, options?: MailboxToolOptions): McpToolDefinition[];  // 정확히 12개
```

- 입력 zod (strict): `{ repositoryFullName: /^[^/\s]+\/[^/\s]+$/, headSha: 40-hex, baseSha?: 40-hex(기본 headSha), branch?: string, goal: string(min 1, max 4000) }`. `remoteUrl`은 입력받지 않고 `https://github.com/<fullName>`으로 파생 (임의 URL 주입 표면 차단 — 주석 1줄).
- **requestId 결정성**: `web-` + `sha256("<fullName>\n<headSha>\n<goal>")` 앞 12 hex. 툴은 먼저 `store.getRequest(id)`를 확인해 존재하면 (타임스탬프 차이로 payload가 달라도) **재생성 없이** `{requestId, created: false, …}` 반환 — 같은 인자 재호출이 멱등이 되는 툴 계층 규칙 (store idempotency는 payload 완전일치 기준이라 타임스탬프 포함 — 주석 1줄). 터미널 상태의 동일 id도 그대로 반환하며, 새 요청이 필요하면 goal 또는 headSha를 바꾸라는 안내를 결과에 포함.
- 신규면 `ReviewRequest` 전문 구성 → `store.createRequest`: `schemaVersion` 리터럴, `kind: 'feature_design'`, **`origin: 'web'`**, repository `{fullName, remoteUrl: 파생값, defaultBranch: null}`, git `{baseSha, headSha, branch: branch ?? null, headVisibleOnGitHub: true, compareUrlHint: null, patchAttachmentSha256: null}`, `goalSource: null`, `userGoal: goal`, `reviewPrompt`: 짧은 고정 템플릿(repo/goal/headSha/필수 파일 로스터 + "web-origin: 리뷰 세션이 이미 설계 맥락을 보유 — 이 프롬프트는 durable 기록·manual fallback용" 취지), `outputContract.requiredFiles: [...REQUIRED_RESULT_FILES.design]`, `createdAt: now()`, `expiresAt: now()+requestTtlHours`, `payloadSha256: computePayloadSha256(...)`.
- 툴 결과: `{requestId, created, requiredFiles, proposedFolderPattern: FOLDER_NAME_PATTERN.source, next: 'claim_request → begin_result → put_result_file × N → finalize_result'}` — 웹 세션이 후속 툴 순서를 스스로 알도록.
- description: 기존 `definition()` 헬퍼 경유(WRITE_SCOPE + INJECTION_DEFENSE 자동 포함) + "repository/branch/goal are user chat instructions; headSha must be the actual commit researched on GitHub" 취지 1구절.
- `runMcpServer`(커맨드)는 `createMailboxTools(mailbox.store, { now: context.now, requestTtlHours: config.requestTtlHours })`로 호출하도록 갱신.

### 2. `commands/pro-bridge.ts` — sync 매칭 + HEAD 게이트 (web-origin)

`runMailboxSync` 확장 (mcp-mailbox·workspace-agent·responses-api 공용 — manual/`--from` 경로 무변경):

1. **후보 = result-ready(unimported)**: 기존 `listResultReady()` 유지.
2. **현재 repo fullName 매칭**: `git remote get-url origin` (기존 GitPort) → `parseGitHubFullName`. positional requestId가 **없을 때만** 각 후보의 `readRequest(id).repository.fullName`과 대조해 불일치 후보 제외. fullName 해석 실패(null) 시 필터 생략 + 경고 1줄 (mailbox는 어차피 repo-로컬 — 주석 1줄). positional 명시는 필터 우회 (사용자 override).
3. **kind 필터**: `--kind <goal_audit|feature_design|architecture_review|implementation_review>` optional flag — 유효값 외는 에러 exit 1. 미지정 시 필터 없음.
4. **최신 우선**: 기존 정렬 유지 (`listRequests` 최신순).
5. **HEAD 불일치 게이트 (origin === 'web'인 요청만)**: 선택된 요청의 `request.origin === 'web'`이면 `gitHead(git)`로 로컬 HEAD 조회 → `manifest.reviewedHeadSha`와 다르거나 HEAD 조회 실패 시: 두 SHA(또는 실패 사유)를 경고 출력 → `--accept-head-mismatch` flag 또는 대화형 confirm 승인 없으면 **설치 없이 exit 1** (비대화 환경은 flag 필수 — `createAndPublish`의 `--yes` 패턴 동일). 승인 시 `importContext.acknowledgedValidations = ['local-head-mismatch-acknowledged']` 전달. cli-origin 요청은 이 게이트를 타지 않는다 (기존 동작 불변).
6. `runMailboxSync`가 git을 쓰므로 `runSync` 경유로 `git: GitPort` 전달 (`createGit(repoRoot, deps.git)` 재사용). **cli-origin만 있는 기존 vpb-04 append 테스트가 fake git 없이도 계속 통과해야 한다** — fullName 해석 실패는 경고+무필터, `gitHead`는 web-origin 선택 시에만 호출.
7. `list`/`status`에도 `--kind` 필터 적용 (printStatuses 앞단 필터만 — 출력 포맷 무변경).

`importer.ts` 최소 확장: `ImportContext.acknowledgedValidations?: string[]` — 검증 통과 후 skipped 집합에 병합되어 `installed` outcome과 provenance receipt의 `skippedValidations`에 정렬 포함.

### 3. `transports/workspace-agent.ts` — 202-only trigger

```ts
export interface WorkspaceAgentTriggerPort {
  run(argv: string[]): Promise<{ ok: boolean; code: number | null; stdout: string; stderr: string }>;
}
export interface WorkspaceAgentTransportOptions {
  repoRoot: string; bridgeRoot?: string; now?: () => Date;
  triggerCommand: string[];                 // config에서 — 비어 있으면 생성자에서 throw
  trigger?: WorkspaceAgentTriggerPort;      // 기본: node:child_process spawn(shell:false, windowsHide:true)
}
export class WorkspaceAgentTransport implements VibeProBridgeTransport {
  constructor(options: WorkspaceAgentTransportOptions);   // 내부에 McpMailboxTransport 합성
  // 포트 5메서드 + listRequests/cancelRequest/readRequest/listResultReady — 전부 mailbox 위임
  trigger(requestId: string): Promise<{ triggered: boolean; reason: string }>;
}
```

- `trigger(requestId)`: **멱등 — 요청 상태 기반.** `getRequestStatus`가 `ready`일 때만 argv 실행 (`triggerCommand`에서 `'{requestId}'` 토큰이 있으면 치환, 없으면 마지막 인자로 append). `ready`가 아니면 실행 없이 `{triggered: false, reason: 'request already <state>'}`. 
- **202-only 계약**: trigger 실행 결과는 "접수 성공/실패"로만 취급 — stdout/stderr에서 리뷰 결과·manifest·상태를 **절대 파싱하지 않는다** (주석 1줄 + 테스트). exit 0 = accepted, 그 외 = 접수 실패 throw. completion 판정은 오직 mailbox status 폴링(`vibe:pro-status`/`vibe:pro-sync`).
- `createRequest`는 mailbox 위임만 — trigger는 커맨드가 발행 완료 후 별도 호출 (아래 §6).

### 4. `transports/responses-api.ts` — 비용 게이트 + surface 강제

```ts
export interface ResponsesApiFetchPort { fetch: typeof fetch }
export interface ResponsesApiTransportOptions {
  repoRoot: string; bridgeRoot?: string; now?: () => Date;
  apiKey: string;                            // 커맨드가 env에서 읽어 주입 — transport는 env 접근 금지
  api: ProBridgeApiConfig;                   // config §5
  baseUrl?: string;                          // 기본 'https://api.openai.com' (테스트 오버라이드)
  ports?: { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> };
}
export const ESTIMATED_OUTPUT_TOKENS = 30_000;
export function estimateReviewCost(request: ReviewRequest, api: ProBridgeApiConfig): {
  inputTokens: number; outputTokens: number; usd: number; exceedsLimit: boolean;
};
export class ResponsesApiTransport implements VibeProBridgeTransport {
  constructor(options: ResponsesApiTransportOptions);   // McpMailboxTransport 합성
  // 포트 5메서드 + listRequests/cancelRequest/readRequest/listResultReady — mailbox 위임
  execute(requestId: string): Promise<{ resultReady: boolean; attempts: number }>;
}
```

- **비용 추정 (결정적 순수 함수)**: 제출 프롬프트(아래 조립분) UTF-8 길이 기준 `inputTokens = ceil(bytes / 4)`, `outputTokens = ESTIMATED_OUTPUT_TOKENS`, `usd = (in×priceInputPerMTok + out×priceOutputPerMTok) / 1_000_000`, `exceedsLimit = inputTokens > maxInputTokens`. **네트워크 호출 없이 계산** (테스트가 fetch 미호출 검증).
- **execute 절차**: 상태 `ready` 검증 → mailbox `claimRequest` → `beginResult` → 제출 프롬프트 조립: `request.reviewPrompt` + 래퍼 지시("출력은 정확히 하나의 VIBE-BUNDLE v1 블록, `requestId: <id>` echo, outputContract.requiredFiles 전부 포함") → **최소 API 표면**: `POST {baseUrl}/v1/responses` body `{model, background: true, reasoning: {effort}, input: <프롬프트 문자열>}` + `Authorization: Bearer <apiKey>` → 응답 `{id, status}` → `status ∈ {queued, in_progress}` 동안 `GET {baseUrl}/v1/responses/{id}`를 `pollIntervalMs` 간격(주입 sleep) 폴링 → `completed`면 출력 텍스트 추출(`output_text` 우선, 없으면 `output[].content[]`의 `output_text` 타입 text concat).
- **결과 반입**: `parseVibeBundle`(기존 파서)로 번들 추출 → 실패 시 오류 (아래 실패 규칙). 성공 시 transport가 `ReviewResultManifest`를 **로컬에서 구성**: files(각 sha256/byteLength 계산), `requestId`/`requestPayloadSha256`/`repositoryFullName`/`reviewedBaseSha`/`reviewedHeadSha`는 request에서, `resultKind`는 kind 매핑(goal_audit→audit, 그 외→design), `proposedFolder`는 bundle.folder, `disposition`은 FINDINGS.json의 `disposition`이 유효 enum이면 그 값·아니면 `'approved-with-remediation'`(주석 1줄), `findingsSummary`는 FINDINGS.json 최상위 `findings[]`의 `priority` P0~P3 집계(불가하면 전부 0), **`reviewerDeclaration` 강제 주입**: `{surface: 'responses-api', requestedMode: 'frontier', githubConnectorUsed: false, limitations: ['no live GitHub grounding; prompt and attached patch only']}` — 모델 출력이 무엇을 주장하든 **무조건 이 값** (Web Pro 사칭 금지, VPB-008), `payloadSha256` 계산 → 파일들을 `putResultFile`(단일 chunk, sha 계산) → `finalizeResult(manifest)` — 기존 importer 검증·설치 경로가 그대로 작동.
- **재시도 상한 1**: 네트워크 오류·HTTP ≥500·terminal `failed`는 전체 제출을 정확히 1회 재시도. HTTP 401/403/4xx·번들 파싱 실패·finalize 검증 실패는 재시도 없이 즉시 실패. **실패는 result-ready가 아니다** — 상태를 조작하지 않고(claim/uploading 상태 그대로) 오류를 throw. 호출측이 사유 출력 + `cancel` 안내.

### 5. `lib/config.ts` — 신규 섹션 + 포트

```ts
export interface ProBridgeWorkspaceAgentConfig { enabled: boolean; triggerCommand: string[] }
export interface ProBridgeApiConfig {
  enabled: boolean; model: string; effort: string;
  maxInputTokens: number; priceInputPerMTok: number; priceOutputPerMTok: number; pollIntervalMs: number;
}
export interface ProBridgeApplyConfig { envId: string | null }
// defaults: {false, []} / {false, '', 'high', 200_000, 0, 0, 5_000} / {envId: null}
// DEFAULT_PRO_BRIDGE_MCP_CONFIG.port: 8848 → 18488
// ProBridgeConfig에 workspaceAgent/api/apply 추가, ProBridgeConfigInput nested Partial, resolveProBridgeConfig 필드별 머지 (mcp 선례)
```

`.vibe/config.json`의 `proBridge`: `mcp.port` 18488로 갱신 + `"workspaceAgent": {"enabled": false, "triggerCommand": []}`, `"api": {"enabled": false, "model": "", "effort": "high", "maxInputTokens": 200000, "priceInputPerMTok": 0, "priceOutputPerMTok": 0, "pollIntervalMs": 5000}`, `"apply": {"envId": null}` 추가. `transport`는 `"manual"` 유지.

### 6. `commands/pro-bridge.ts` — transport 분기·apply·포트 힌트

1. **transport 분기**: `transportName: SupportedTransportName`으로 광역화. `'workspace-agent'` → `config.workspaceAgent.enabled !== true` 또는 `triggerCommand` 빈 배열이면 설정 가이드 출력 + exit 1; 아니면 `WorkspaceAgentTransport` (trigger 포트는 `deps.agentTrigger?` 주입, 기본 spawn). `'responses-api'` → `config.api.enabled !== true`면 가이드 + exit 1; `deps.env?.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY` 부재 시 "OPENAI_API_KEY 환경변수 전용 — config에 넣지 마세요" 가이드 + exit 1; `config.api.model` 빈 문자열이면 "model은 config 직접 지정 (model-registry 범위 밖)" 가이드 + exit 1; 아니면 `ResponsesApiTransport` (fetch/sleep은 `deps.fetchPort?`/`deps.sleep?` 주입). `ProBridgeDeps` 확장: `agentTrigger?`, `fetchPort?`, `sleep?`, `env?: Record<string, string | undefined>`, `codexExec?` (아래).
2. **발행 마무리 분기** (`createAndPublish`): adapter 2종은 클립보드·브라우저·invocation 출력을 생략. `workspace-agent`: createRequest 후 `transport.trigger(requestId)` → `triggered` 여부 + "trigger 응답은 접수 확인일 뿐 — completion은 vibe:pro-status 폴링과 vibe:pro-sync로만" 출력. `responses-api`: publicationSummary(문구를 "OpenAI API로 전송"으로 조정) + **비용 게이트**: `estimateReviewCost` 결과(model/inputTokens/outputTokens/usd 4자리) 출력 → `exceedsLimit`이면 발행 중단 exit 1 → confirm 또는 `--yes` 없으면 중단 exit 1 → createRequest → `execute()` → 성공 시 "결과 업로드 완료 — npm run vibe:pro-sync 로 설치" / 실패 시 사유 + attempts 출력 exit 1.
3. **`apply` 서브커맨드**: usage `vibe-pro-bridge apply <folder>`. enabled 게이트 적용(기존 공통 — status/list 예외 유지). 절차: `<resultRoot>/<folder>/prompt/CLI_MAIN_SESSION_PROMPT.md` 존재 확인 — 부재 시 오류 + exit 1. `config.apply.envId`가 null/빈값이면 **설정 가이드 출력 + exit 0** (codex cloud 환경 id 확인법 + `.vibe/config.local.json`에 `proBridge.apply.envId` 설정 안내). 설정돼 있으면 `deps.codexExec?`(기본: `codex` spawn) 포트로 `['cloud', 'exec', '--env', envId]` 실행 + 프롬프트 전문 stdin 전달 → stdout/stderr 그대로 출력 → "다음: codex cloud status / codex cloud diff 로 확인 — 자동 merge/apply는 하지 않습니다" 안내. exit code는 spawn 결과 따름. `deps.codexExec` 시그니처: `{ run(args: string[], stdinText: string): Promise<{ code: number | null; stdout: string; stderr: string }> }`.
4. **mcp listen 오류 힌트 (carry-over 1)**: `runMcpServer`의 서버 기동을 try/catch — `error.code`가 `EACCES` 또는 `EADDRINUSE`면 출력: 사용 포트, "Windows WinNAT excluded port range 충돌 가능 (실측 예: 8827–8926) — `netsh interface ipv4 show excludedportrange protocol=tcp` 로 확인", "`--port <n>` 또는 `.vibe/config.local.json`의 `proBridge.mcp.port` 오버라이드" 안내 후 exit 1. 그 외 오류는 기존 메시지 경로.
5. usage 라인 갱신: `[audit|design|status|sync|cancel|list|mcp|apply]`.

### 7. 문서·스킬

**`docs/context/pro-bridge-setup.md`**: §1 예시 port 18488로 갱신. append: (a) "## 포트 트러블슈팅" — EACCES/EADDRINUSE 시 WinNAT excluded range 확인법(netsh 명령), `--port`/config 오버라이드, 기본 18488 사유(실측 8827–8926 제외 대역 회피). (b) "## Web-origin 설계 (Phase 3)" — 웹-origin 세션 시작 **전** `vibe:pro-mcp` 기동 필수, 웹에서 `create_design_request`(repository/branch/goal/headSha) → claim → begin/put/finalize 순서, CLI `npm run vibe:pro-sync -- --latest`가 현재 repo fullName·unimported·kind·최신 기준 매칭, HEAD 불일치 시 경고+명시 승인, 서버 불가 시 vibe-bundle `requestId: web-origin` → `--from` fallback. (c) "## 옵션 어댑터 (Phase 4, 명시 opt-in)" — workspace-agent(trigger는 접수 확인일 뿐·completion은 bridge status만·중복 trigger 멱등), responses-api(OPENAI_API_KEY env 전용, model은 config 직접 지정 — **model-registry 확장 안 함**, 실행 전 비용 게이트, 재시도 1회, 결과 provenance surface는 `responses-api`로 기록되어 Web Pro 리뷰와 구분), `vibe:pro-apply`(envId 설정, status/diff 래핑까지 — 자동 merge 금지).

**`.claude/skills/vibe-pro-design/SKILL.md`**: "Phase 3 예정" 문장을 현행 안내로 교체 + "## Web-origin 경로 (Phase 3)" append — 서버 사전 기동, 웹 툴 호출 순서, `npm run vibe:pro-sync -- --latest` 매칭 규칙과 `--accept-head-mismatch`, manual fallback. 상세는 setup 문서 참조로 위임.

## Tests to add (§15 해제 — 아래 파일·케이스는 명시 요구사항)

러너: node:test(`describe`/`it`, `node:assert/strict`), mkdtemp 임시 디렉터리 + 주입 fake. **실 네트워크·실 OpenAI API·실 codex/cloudflared/외부 trigger spawn·실 repo의 `.vibe/pro-bridge/`·`docs/plans/`·클립보드·브라우저 접근 금지.** fetch/sleep/trigger/codexExec/git 전부 fake 주입. 케이스명은 아래 문자열 그대로 (grep 검증 대상).

**1. `pro-bridge-mailbox.test.ts`** — 기존 `'exposes eleven tools with injection defense descriptions and read only hints'`를 `'exposes twelve tools with injection defense descriptions and read only hints'`로 갱신(12 이름 + `create_design_request` + read-only 4종 유지). append describe `'web origin design requests'`:
- `'creates a web origin design request with origin web and a deterministic id'` — 같은 인자 → 같은 `web-…` id, origin/kind/expiresAt(now+TTL 주입) 검증.
- `'returns the existing request when the same web design request is repeated'` — now가 달라도 두 번째 호출 `created: false`, store에 요청 1건.
- `'rejects web origin input with an invalid head sha'` — 40-hex 위반 zod 거부.

**2. `pro-bridge-mcp-server.test.ts`** — `'lists the mailbox tools over tools list'` 내 `assert.equal(tools.length, 11)` → `12` (이 한 줄만).

**3. `pro-bridge-adapters.test.ts`** (신규) — describe `'workspace agent transport'`:
- `'triggers the external agent command once for a ready request'` — `{requestId}` 토큰 치환 argv 검증.
- `'skips duplicate triggers after the request leaves the ready state'` — claim 후 재trigger → 실행 0회 + `triggered: false`.
- `'never reads results from the trigger response'` — trigger stdout에 그럴듯한 manifest JSON을 넣어도 상태는 mailbox 기준 그대로(202-only).

describe `'responses api transport'`:
- `'estimates the review cost deterministically before any network call'` — 공식(길이/4·30k·단가) 일치 + fake fetch 호출 0회.
- `'refuses a request whose estimated input exceeds the configured limit'` — `exceedsLimit` true.
- `'round trips a background response into a mailbox result with a forced surface'` — fake fetch: POST→`{id,status:'queued'}`, GET→`in_progress`→`completed`(+vibe-bundle 텍스트); finalize까지 도달, `getResultManifest().reviewerDeclaration.surface === 'responses-api'`, 상태 `result-ready`.
- `'retries a failed submission at most once'` — 1차 5xx → 2차 성공 = attempts 2; 연속 실패 = 정확히 2회 시도 후 오류.
- `'does not mark the request result ready when the api fails'` — 실패 후 상태 ≠ `result-ready`, result manifest null.

**4. `pro-bridge-command.test.ts` append 7건** (기존 케이스 무변경):
- `'resolves adapter config defaults when the sections are absent'` — workspaceAgent/api/apply 기본값 + `mcp.port === 18488`.
- `'sync latest matches only result ready requests for the current repository and kind'` — fake git remote로 현재 fullName 고정, 타 repo·타 kind 후보 제외 검증.
- `'sync gates a web origin head mismatch behind explicit approval'` — 거부: 설치 0 + exit 1; `--accept-head-mismatch`: 설치 + provenance/outcome `skippedValidations`에 `local-head-mismatch-acknowledged`.
- `'apply refuses to run without an installed prompt file'` — exit 1.
- `'apply prints environment setup guidance and exits zero when envId is missing'` — exit 0 + codexExec 호출 0회.
- `'apply submits the installed prompt through the codex cloud exec port'` — fake codexExec argv에 `cloud exec --env`, stdin=프롬프트 전문, merge류 명령 부재.
- `'mcp subcommand explains windows excluded port ranges on listen errors'` — fake mcpServer.start가 `EACCES` code로 reject → `excludedportrange`·`--port` 힌트 출력 + exit 1.

**5. `pro-bridge-e2e.test.ts` append** — describe `'pro bridge web origin round trip'`:
- `'installs a web created design package through sync latest'` — `create_design_request` 툴 invoke(웹 시뮬레이션)로 요청 생성 → 툴 경유 claim/begin/put/finalize(reviewerDeclaration surface `chatgpt-web`) → fake git(HEAD = 요청 headSha, remote = 요청 fullName)으로 커맨드 `sync --latest` → `docs/plans/<folder>/` 필수 파일 설치 + `.bridge/provenance.json`의 `reviewerDeclaration.surface === 'chatgpt-web'` + 상태 `imported` (carry-over 2 폐루프 + §12 surface 구분 증명).

**6. `pro-bridge-importer.test.ts` append 1건**:
- `'records acknowledged validations in the provenance receipt'` — `acknowledgedValidations` 전달 시 outcome·provenance `skippedValidations`에 정렬 포함.

## Codex 실행 환경 제약

- Windows sandbox — **tsc/test/빌드/npm/git push/네트워크 실행 불가**. self-check는 static inspection으로만, 실행 검증은 Orchestrator가 샌드박스 밖에서 수행. 실행 못 한 명령을 Final report "Sandbox-only failures"에 전부 나열: `npm run vibe:typecheck`, `npm run vibe:self-test`, `npm run vibe:build`, `npm run vibe:gen-schemas -- --check`, `npm run vibe:codex-wrapper-audit`, `npm run vibe:sync-audit`.
- 실 OpenAI API·실 codex cloud·실 trigger 명령·터널 실행 시도 금지. 의존성 설치 금지. 샌드박스 우회용 영구 설정 변경 금지 (`_common-rules.md` §1~2).
- 실 repo의 `.vibe/pro-bridge/` 생성 코드 실행 금지 — 런타임 디렉터리는 테스트 mkdtemp 안에서만.
- `.codex/**` 쓰기 불가 — 필요 변경은 Final report에 텍스트 제시.

## 완료 체크리스트

기계 검증 (Orchestrator가 샌드박스 밖에서 실행):

- [ ] `npm run vibe:typecheck` / `npm run vibe:self-test` / `npm run vibe:build` exit 0 (기존 suite 무손상 — 12툴 갱신 2건 외 기존 케이스 문자 그대로)
- [ ] `npm run vibe:gen-schemas -- --check` exit 0 (lib/schemas 무변경 — drift 0)
- [ ] `npm run vibe:codex-wrapper-audit` / `npm run vibe:sync-audit` exit 0
- [ ] grep: `create_design_request` + 12 tool name / `SUPPORTED_TRANSPORTS`에 4종 / `vibe:pro-apply` / config `18488`·`workspaceAgent`·`api`·`apply`
- [ ] grep: `excludedportrange` 힌트(커맨드+setup 문서), `'responses-api'` surface 강제, `local-head-mismatch-acknowledged`
- [ ] grep: 테스트 케이스명 로스터 (mailbox 3+갱신 1 / server 갱신 1 / adapters 8 / command 7 / e2e 1 / importer 1)
- [ ] grep: `.vibe/harness/src/**`에 API key를 파일·config·로그에 기록하는 경로 없음 (`OPENAI_API_KEY`는 env 읽기만)
- [ ] `git status` 변경 로스터 ⊆ Allowed writes (특히 store/server/contract/schemas/sync-manifest/CLAUDE.md/README/settings/scripts/.codex 무변경)

Inspection 항목 (**Evaluator 소환 Must** — 신규+수정 파일 >5):

- [ ] **같은 스키마·같은 importer 불변식 (VPB-008 DoD)**: 어댑터 2종이 request/result 스키마·importer·mailbox lifecycle을 재정의하지 않고 합성만 함 — transport 교체가 discovery/import에 무영향
- [ ] **202-only + Bridge status authoritative**: trigger 응답에서 결과를 회수하는 코드 경로 부재, 실패가 result-ready로 위장되지 않음
- [ ] **비용 게이트·재시도 1·사칭 금지**: 실행 전 추정 출력 + 승인 게이트, 재시도 정확히 1, surface가 모델 출력과 무관하게 `responses-api`로 강제
- [ ] **web-origin 매칭·게이트가 design.md §6.4와 일치**: fullName·unimported·kind·최신 / HEAD 불일치 시 사용자 판단 / manual fallback 보존
- [ ] **apply 안전 경계**: 자동 merge/적용 없음, envId 미설정은 오류가 아닌 가이드+exit 0
- [ ] lifecycle 무결합 유지: hook/settings/sprint gate 연결 없음, 어댑터는 명시 opt-in 없이는 코드 경로 진입 불가
- [ ] **Orchestrator dogfood transcript**: 샌드박스 밖에서 `vibe:pro-mcp`(port 18488, tunnel none) 기동 → `tools/list`(12툴) + `tools/call(create_design_request)` 왕복 → `list`에 web 요청 노출 → `vibe:pro-apply`(envId 미설정) 가이드 확인 (Orchestrator 수행 — Generator는 해당 없음 표기)
- [ ] **실 왕복 3종은 사용자 확인 항목으로 분리**: 실 ChatGPT web-origin 왕복 / 실 Responses API 소액 리뷰 / 실 codex cloud apply — 실측 결과를 design.md §12에 추기하도록 Final report가 안내

## Final report 요구사항

`_common-rules.md` §9 형식 + §14.4 `## Wiring Integration` 표 필수. **"CLAUDE.md/README 반영 제안 텍스트"** 섹션에 붙여넣기용 텍스트 제시: (a) README의 `vibe:pro-apply`·web-origin·어댑터 항목, (b) CLAUDE.md에 12툴·기본 포트 18488 언급이 필요하면 그 행. 이번 Sprint W/D 사전 판정 (Generator는 실제 상태로 갱신·보고):

| Checkpoint | 예상 상태 | 근거 |
|---|---|---|
| W1 CLAUDE.md hook 표 | n/a | 신규 스크립트 0 — apply는 기존 wrapper 서브커맨드 |
| W2 CLAUDE.md 관련 스킬 | n/a | 신규 스킬 없음 (기존 1종 갱신) |
| W3 Sprint flow | n/a | 절차 무변경 |
| W4/W5 settings hook/statusline | n/a | lifecycle 무결합 — 등록 금지 |
| W6 sync-manifest harness[] | n/a | 신규 src/test는 기존 글롭 커버, setup 문서 vpb-04 등재 완료 |
| W7 sync-manifest hybrid keys | n/a | 전부 기존 projectKeys `proBridge` 하위 |
| W8 README | skipped+reason | 제안 텍스트 제출 |
| W9 npm scripts | touched | `vibe:pro-apply` 1키 |
| W10 release 기록 | skipped+reason | iteration 종료 시 Orchestrator 일괄 기록 |
| W11 migration | n/a | 신규 config 섹션 optional + 기본 포트 변경은 default만 이동 (Contract 예외 6) |
| W12 회귀 테스트 | touched | 신규 1파일 + append/갱신 로스터 |
| W13 harness-gaps | touched | `gap-web-pro-bridge` partial→covered, deadline 해소 |
| W14 .gitignore | n/a | 신규 런타임 artifact 없음 |
| D1~D6 | n/a | 삭제·개명 없음 |

`verified-callers` 필수 명시: `create_design_request → mailbox 로스터 테스트 + e2e web-origin + runMcpServer(options 전달)`, `workspace-agent.ts → commands/pro-bridge.ts + adapters 테스트`, `responses-api.ts → commands/pro-bridge.ts + adapters 테스트`, `parseGitHubFullName export → commands/pro-bridge.ts(sync 매칭)`, `acknowledgedValidations → runMailboxSync(head 게이트) + importer 테스트`, `vibe:pro-apply → package.json + setup 문서`. Sprint Contract 절에서 Current proof(정적 검사·grep·파일 로스터)와 Non-proof(미실행 명령·실 API/cloud/web 왕복 미수행)를 분리 보고. Contract 예외 4(스킬 1문장 교체)·6(포트 default 이동)의 채택 사실을 Deviations가 아닌 본문으로 설명.
