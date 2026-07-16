# Sprint vpb-10 — publish_review_package 파사드 + chunked fallback + 완료 계약 (MCP-001·002·003)

**이 Sprint 이후 사용자가 새로 할 수 있는 것**: 실 ChatGPT 웹 Pro 리뷰 세션이 저수준 3단 업로드(begin_result → put_result_file×N → finalize_result)를 오케스트레이션하지 못해 리뷰 패키지 발행이 유실되던 Journey B 실패에서 벗어난다 — 웹 모델은 `get_request → publish_review_package` **단 두 콜**로 패키지를 발행하고, Bridge가 `status=result-ready` receipt를 반환하기 전까지는 과업 완료를 주장할 수 없으며, 사용자는 그 receipt(requestId/resultId/manifest SHA)를 최종 응답에서 직접 확인한다. 이 Sprint는 시각적 표면이 없는 CLI/프로토콜 제품이므로 경험 증거는 tools/list JSON 스냅샷 + get_request 응답 transcript로 한정하고, 실 ChatGPT Developer Mode 재실행은 roadmap 종료 조건 1에 따라 사용자 참여 항목으로 분리한다.

이 Sprint는 웹 Pro 세션이 설계한 정본 패키지 `vibe-doctor-mcp-write-improvement-v1.8.0/`의 **MCP-001(발행 파사드)·MCP-002(대용량 fallback)·MCP-003(완료 계약)** 을 구현한다. 정본의 대상 기준은 v1.8.0(6051105)이지만 main은 iter-2 remediation(16923cc, 3a79cf9, e63d9d3 — one-time connect code, FINDINGS v1 시맨틱 계약, revN, journal/fencing/lease)으로 전진했다. 정본 프롬프트 조항("If main has advanced, inspect the entire delta first and **preserve stricter or newer behavior**")대로 **현행 main 구현 위에 additive로** 적용한다 — iter-2 불변식은 어떤 경우에도 약화하지 않는다. MCP-004~007(카탈로그 audit·bridge_capabilities·doctor·OAuth·golden)은 vpb-11/12 범위다.

---

## Sprint Contract

### Target and output surface

- **MCP-001**: 13번째 MCP 툴 `publish_review_package` — 단일 정상 호출로 {files 배열 + manifest 필드} 수신 → 기존 store 내부 경로(claim→begin→put→finalize)를 **한 lease/큐 트랜잭션 안에서 내부 재사용**하여 발행. 검증/해시/경로/manifest 규칙 이중 구현 0 (기존 finalize의 importer 단일 경로 그대로 통과). 부분 result-ready 상태 0 — 전체 성공 또는 요청 상태 원복. 멱등 3중 identity(requestId + clientPublicationId + canonical manifest SHA). 성공 반환: `status=result-ready, requestId, resultId, proposedFolder, resultManifestSha256, fileCount, totalBytes, revision, imported=false`.
- **MCP-002**: 패키지 한도 config `proBridge.mcp.publishLimits`(기본 maxFiles 32 / maxTotalBytes 131,072 / maxFileBytes 49,152). 한도 초과 시 `status=chunked-upload-required` + uploadSessionId + maxChunkBytes + requiredFiles + `requiredNextTools=['put_result_file','finalize_result']` — **facade가 claim+begin까지 수행해 업로드 세션을 열어 둔 상태로 반환한다** (정본 03 §4의 requiredNextTools가 begin_result를 생략하므로 세션 개방이 스펙 준수 해석이다). 저수준 3툴(begin/put/finalize) description을 "fallback 이후 또는 명시 재개 시에만" 문구로 재작성. 한도는 get_request 완료 계약과 fallback 응답에 노출 (bridge_capabilities는 vpb-11).
- **MCP-003**: `get_request` 반환에 `completionContract` 필드 additive 추가(기존 top-level request 필드 전부 보존). 웹 프롬프트 템플릿 양 wire 갱신 — composer(CLI-origin, manual prompt.md와 mailbox get_request 양쪽으로 전달)와 tools.ts create_design_request(web-origin) 모두: "The task is incomplete until the Bridge returns status=result-ready." + "Do not finish by only printing Markdown in chat." + 최종 응답에 receipt 식별자 포함 + publish 툴 부재 시 도구 표면 불완전 보고. **manual(vibe-bundle) wire의 기존 계약은 유지** — mailbox 툴이 대화에 붙어 있지 않으면 vibe-bundle 출력이 완료 경로임을 모순 없이 명시.

### Allowed writes (Files Generator may touch — 이 목록 밖 쓰기 금지)

| 파일 | 허용 범위 |
|---|---|
| `.vibe/harness/src/pro-bridge/mailbox/store.ts` | additive — `publishReviewPackage` 공개 메서드 + 내부 rollback/publication-record 헬퍼 + 타입 export. 기존 메서드·lifecycle·journal·lease·health 로직 비변경·비약화 |
| `.vibe/harness/src/pro-bridge/mailbox/tools.ts` | additive — `publish_review_package` 등록(claim_request 뒤·begin_result 앞 위치 고정), `get_request` 반환에 completionContract 추가, 저수준 3툴 summary 재작성, create_design_request의 reviewPrompt/`next` 문구 갱신, `MailboxToolOptions.publishLimits` 추가. 기존 12툴 이름·inputSchema 형태·기존 반환 필드 불변 |
| `.vibe/harness/src/pro-bridge/mailbox/server.ts` | 필요 시 최소. **기본 무변경이 정답** — tools/call은 이미 구조화 반환·MailboxStoreError isError 매핑을 지원한다 |
| `.vibe/harness/src/pro-bridge/prompt-composer.ts` | 완료 계약 섹션 추가(H 확장 또는 신규 섹션, re-lettering 허용). 기존 섹션 내용·G섹션 FINDINGS 스켈레톤·inline patch 로직 전부 보존 |
| `.vibe/harness/src/lib/schemas/pro-bridge.ts` | additive — `PublishLimits` 타입 + `DEFAULT_PUBLISH_LIMITS` 상수 export (config·store·tools의 단일 소스). 기존 스키마 형태 변경 금지 |
| `.vibe/harness/src/lib/config.ts` | additive — `ProBridgeMcpConfig.publishLimits` + 기본값 + `resolveProBridgeConfig` per-field 병합(partial 입력 허용). 기존 필드 불변 |
| `.vibe/harness/src/commands/pro-bridge.ts` | `runMcpServer`의 `createMailboxTools` 옵션에 `publishLimits: context.config.mcp.publishLimits` 전달 1곳 + 필요 최소. sync/identity/token 경로 비약화 |
| `docs/context/pro-bridge-setup.md` | §4 리뷰 왕복(publish 우선, 저수준은 fallback으로 격하) + §Web-origin(claim→begin→put→finalize 나열을 publish 우선으로) 갱신 |
| `.vibe/harness/test/pro-bridge-publish.test.ts` | **신규 파일** — T1~T18 |
| `.vibe/harness/test/pro-bridge-mailbox.test.ts`, `pro-bridge-composer.test.ts`, `pro-bridge-mcp-server.test.ts` | 신규 케이스(T19~T26) + **의도된 행동 전환**(12→13툴, 저수준 description, completionContract, 프롬프트 문구)으로 깨지는 기존 기대값 갱신만. 무관 assertion 약화 금지 |

### Do NOT modify

- `.vibe/harness/src/pro-bridge/importer.ts` — **읽기 전용**. facade는 finalize 경로를 경유해 importer를 재사용한다 — importer를 고치고 싶어지면 설계가 틀린 것이다.
- `.vibe/harness/src/pro-bridge/contract.ts`, `vibe-bundle.ts`, `scope-resolver.ts`, `mailbox/tunnel.ts`, `transports/**`, `goal-source/**` — 전부 읽기만.
- **iter-2 불변식 전부 비약화**: vpb-07 identity(repository/reviewed-head 바인딩, fail-closed), vpb-08 lifecycle(per-request 큐+lease/fencing, finalize journal 6-phase, 멱등 ack, health **5상태 union 확장 금지**, `onAfterDurableOp` seam), vpb-09(FINDINGS v1 시맨틱 계약, revN, one-time connect code). `pro-bridge-identity/lifecycle/health/importer/schemas/e2e.test.ts` 기대값 약화 금지.
- 기존 12툴 제거·개명·inputSchema 형태 변경 금지. `finalize_result` description의 해시 생략 문장("requestPayloadSha256 and payloadSha256 fields may be omitted; the server fills and verifies both hashes") **보존** — 기존 테스트가 regex로 대조한다 (`pro-bridge-mailbox.test.ts:464`).
- 기존 request/result 데이터 불변 — 저장된 request.json/manifest/provenance를 절대 재작성하지 않는다. `ReviewRequestSchema`/`ReviewResultManifestSchema` 형태 불변.
- lifecycle 전이표(contract.ts) 불변. `MAX_CHUNK_BYTES` 등 기존 staging 상수 불변.
- hook/sprint/QA 스크립트, `package.json`(신규 의존성/스크립트 0), `.vibe/config.json`, `.vibe/config.local.json`, git tag(`v1.8.0` 불이동).
- 검증 약화 절대 금지: path traversal/containment, UTF-8, size, chunk/file/request/result SHA, repository/reviewed-head 바인딩, FINDINGS 계약. facade는 이 검증들을 **한 번 더 통과**시키는 경로이지 우회로가 아니다.

### Explicit exceptions

- **12→13 툴 카탈로그 기대값 갱신**(`exposes twelve tools…` 케이스, `pro-bridge-mcp-server.test.ts:316`의 `tools.length === 12`)은 의도된 행동 전환이며 검증 약화가 아니다 — Final report에 케이스별 사유 기록.
- **rollback의 raw `writeStatus`**: 실패한 복합 연산의 상태 원복(예: result-uploading → ready)은 lifecycle 전이표 위반이 아니라 동일 lease/큐 내부의 미완 트랜잭션 abort다. 전이표 자체는 손대지 않는다.
- **facade가 putResultFileUnsafe에 넘길 chunkSha256을 직접 계산**하는 것은 검증 이중 구현이 아니라 기존 인터페이스 충족이다 — 서버가 재검증한다.
- `get_request` 반환 확장은 `{ ...request, completionContract }` **additive sibling** — 기존 소비자가 읽는 top-level 필드는 전부 보존된다.
- `create_design_request`의 `next`/guidance 문구 변경은 안내 텍스트이지 계약 필드가 아니다.
- `claimed-by-another-reviewer` conflict reason은 **reserved** — 로컬 단일 principal store에는 principal identity가 없으므로 이번 구현에서 실제로 반환될 수 없다. union에 선언만 하고 미도달임을 주석으로 명시한다 (OAuth principal은 vpb-12).
- 03 §11 telemetry는 이번 범위 밖 — residual limitation으로 보고.
- STEP 0 죽은 코드 정리는 직접 수정하는 함수 내부로 한정. 커밋은 Orchestrator가 수행 — Generator는 커밋하지 않는다.

### Reference-only values (인용만, 새 엔티티 생성·편집 금지)

- 정본 패키지 `vibe-doctor-mcp-write-improvement-v1.8.0/**` 전체 — 읽기 전용. FINDINGS.json 등 어떤 파일도 수정 금지.
- v1.8.0 commit `6051105`, iter-2 커밋 `16923cc`/`3a79cf9`/`e63d9d3` — 문서 인용용.
- MCP-004~007 산출물(bridge_capabilities, `$vibe-goal-audit doctor`, annotation 전면 정비, OAuth scope 5종, golden dataset) — 언급 가능, **구현 금지** (vpb-11/12 소관).
- `docs/plans/2026-07-15-*` 설치 패키지 — 읽기 전용.
- 03 §3의 required files 로스터(`source/GOAL_SOURCE_MANIFEST.json` 포함 5종)는 정본 문서의 권고다 — 현행 main의 정본은 `REQUIRED_RESULT_FILES`(contract.ts: 4종)와 `request.outputContract.requiredFiles`이며, **더 새로운 현행 계약을 따른다** (preserve-newer 조항). requiredFiles 노출은 항상 `request.outputContract.requiredFiles`를 사용한다.

### Proof predicates (공개 계약보다 강하지 않게, 아래가 전부)

Orchestrator가 샌드박스 밖에서 실행 (Generator는 static 확인만):

1. `npm run vibe:typecheck` → exit 0.
2. `npm run vibe:self-test` → exit 0 (identity·lifecycle·health·importer·schemas·e2e 기존 로스터 무손상).
3. targeted: `node --import tsx --test .vibe/harness/test/pro-bridge-publish.test.ts .vibe/harness/test/pro-bridge-mailbox.test.ts .vibe/harness/test/pro-bridge-composer.test.ts .vibe/harness/test/pro-bridge-mcp-server.test.ts` → exit 0, Tests to add의 **리터럴 케이스명 26종 전부** 출력에 존재.
4. `rg "publish_review_package" .vibe/harness/src/pro-bridge/mailbox/tools.ts` ≥1. `rg "chunked-upload-required" .vibe/harness/src/pro-bridge` ≥1. `rg "publishLimits" .vibe/harness/src/lib/config.ts .vibe/harness/src/lib/schemas/pro-bridge.ts .vibe/harness/src/commands/pro-bridge.ts` — 3파일 모두 ≥1.
5. 프롬프트 리터럴: `rg "incomplete until the Bridge returns status=result-ready" .vibe/harness/src/pro-bridge` ≥2 (composer + tools.ts web-origin). `rg "Do not finish by only printing Markdown in chat" .vibe/harness/src/pro-bridge` ≥2.
6. 불변 파일 회귀 가드: `git diff -- .vibe/harness/src/pro-bridge/importer.ts .vibe/harness/src/pro-bridge/contract.ts .vibe/harness/src/pro-bridge/vibe-bundle.ts .vibe/harness/src/pro-bridge/scope-resolver.ts .vibe/harness/src/pro-bridge/mailbox/tunnel.ts .vibe/harness/src/pro-bridge/transports .vibe/harness/src/pro-bridge/goal-source package.json .vibe/config.json` → 빈 출력.
7. 기존 12툴 이름 전부 잔존: `rg "'(create_request|create_design_request|list_pending_requests|get_request|claim_request|begin_result|put_result_file|finalize_result|get_result_manifest|get_result_file|acknowledge_import|cancel_request)'" .vibe/harness/src/pro-bridge/mailbox/tools.ts` → 12종 전부 매치.
8. `git status --porcelain -- docs/plans vibe-doctor-mcp-write-improvement-v1.8.0` → 빈 출력.

### Current proof and non-proof

Generator Final report는 증거를 반드시 두 칸으로 분리한다: **fresh evidence**(이번 세션에서 실제 확인한 것 — Windows sandbox 특성상 대부분 static inspection과 grep)와 **non-proof**(skipped / blocked / inferred / proxy / historical — 예: "테스트는 작성했으나 실행하지 못함, Orchestrator 실행 대기"). 실행하지 못한 검증을 통과로 표기하는 것을 금지한다.

---

## 필수 참조 (구현 전 읽기 순서)

1. `vibe-doctor-mcp-write-improvement-v1.8.0/prompt/UPSTREAM_IMPLEMENTATION_PROMPT.md` — Core diagnosis + MCP-001·002·003 절 + "preserve stricter or newer behavior" 조항. MCP-004 이후 절은 경계 확인용으로만 읽는다.
2. `vibe-doctor-mcp-write-improvement-v1.8.0/specs/MCP-001-primary-publish-facade.md`, `MCP-002-chunked-upload-fallback.md`, `MCP-003-completion-contract.md` — DoD 3종.
3. `vibe-doctor-mcp-write-improvement-v1.8.0/03_PUBLISH_REVIEW_PACKAGE_SPEC.md` — 입출력 계약 리터럴(§2 input, §4 ChunkedUploadRequired, §5 receipt/conflict), §6 atomicity, §7 idempotency, §8 claim, §9 internal reuse, §10 security.
4. `vibe-doctor-mcp-write-improvement-v1.8.0/05_COMPLETION_CONTRACT_AND_PROMPT_SPEC.md` — §2 completionContract 형태, §3 프롬프트 필수 문구 리터럴, §4 최종 응답 계약, §5 negative 목록, §6 design 공용.
5. `vibe-doctor-mcp-write-improvement-v1.8.0/02_TOOL_CATALOG_ASIS_TOBE.md` — §3 description 재작성 리터럴 (publish/begin/put/finalize 4종 — ack/cancel 재작성은 vpb-11).
6. 현행 구현 anchor (라인은 2026-07-16 main 기준):
   - `.vibe/harness/src/pro-bridge/mailbox/store.ts` — `mutate` 큐+lease(493~531행), `claimRequestUnsafe`(1061~1074), `beginResultUnsafe`(1080~1149), `putResultFileUnsafe`(1158~1272), `finalizeResultUnsafe`(1286~1529: journal prepared→…→committed 순서, 멱등 replay 분기 1316~1329, importer 호출 1381~1408), `writeStatus`(1939~1955: raw 기록), `commitJson`(617~630), `readFinalizeJournal`(1715~1721), `removePath`(1763~1771), `findOpenUpload`(1976~1987), `TERMINAL_STATES`(36~41), `MAX_CHUNK_BYTES`(42).
   - `.vibe/harness/src/pro-bridge/mailbox/tools.ts` — `definition()` 헬퍼(103~129: WRITE_SCOPE/INJECTION_DEFENSE 자동 결합), `get_request`(241~253), `create_design_request`(151~229: web-origin reviewPrompt + `next` 문구), `finalize_result`(285~306: 해시 생략 서버 보충 — facade가 재사용할 manifest 보충 패턴), `MailboxToolOptions`(23~26).
   - `.vibe/harness/src/pro-bridge/mailbox/server.ts` — tools/call 매핑(296~323) — **무변경 확인용**.
   - `.vibe/harness/src/pro-bridge/prompt-composer.ts` — `renderPrompt` 섹션 A~I(276~329), `renderOutputContract` G섹션(233~274), H섹션 manual 문구(321~322).
   - `.vibe/harness/src/lib/config.ts` — `ProBridgeMcpConfig`(54~57), `DEFAULT_PRO_BRIDGE_MCP_CONFIG`(102~105), `resolveProBridgeConfig`(141~).
   - `.vibe/harness/src/commands/pro-bridge.ts` — `runMcpServer`(1204~1263: createMailboxTools 옵션 주입 지점 1223~1226).
   - `.vibe/harness/src/pro-bridge/contract.ts` — `REQUIRED_RESULT_FILES`(43~46), `computePayloadSha256`, lifecycle 전이표 — 읽기만.
7. 기존 테스트 스타일: `pro-bridge-mailbox.test.ts`(withRoot/request 헬퍼, 12툴 카탈로그 케이스 416~431, finalize 해시 케이스 446~516), `pro-bridge-mcp-server.test.ts`(포트 0 실서버 + rpc 헬퍼, tools/list 311~317), `pro-bridge-composer.test.ts`, `test/helpers/pro-bridge-result-fixture.ts`(`buildCompliantResultBundle` — vpb-09 시맨틱 계약을 통과하는 파일 세트 생산; publish 입력 files로 그대로 재사용).
8. `docs/context/pro-bridge-setup.md` — 갱신 대상 §4(리뷰 왕복)·§Web-origin 현행 문구.

---

## 기술 사양

### A. MCP-001 — `publish_review_package` 파사드

**A-1. 타입 (store.ts additive export; 필드명은 03 §2·§4·§5 리터럴 고정)**:

```ts
// lib/schemas/pro-bridge.ts (단일 소스)
export interface PublishLimits { maxFiles: number; maxTotalBytes: number; maxFileBytes: number }
export const DEFAULT_PUBLISH_LIMITS: PublishLimits =
  { maxFiles: 32, maxTotalBytes: 131_072, maxFileBytes: 49_152 };

// store.ts
interface PublishPackageFile { path: string; mediaType: 'text/markdown' | 'application/json'; content: string }
interface PublishPackageInput {
  proposedFolder: string;                 // FOLDER_NAME_PATTERN 재사용
  disposition: ReviewDisposition;         // 기존 enum 재사용
  summary: {
    title: string;
    reviewedRepository: string; reviewedBaseSha: string; reviewedHeadSha: string;
    p0: number; p1: number; p2: number; p3: number;
    limitations: string[];
  };
  files: PublishPackageFile[];
  clientPublicationId: string;            // /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
  reviewerDeclaration?: ReviewResultManifest['reviewerDeclaration'];  // 생략 시 기본값 (A-3)
}
interface PublishReceipt {
  status: 'result-ready'; requestId: string; resultId: string; proposedFolder: string;
  resultManifestSha256: string; fileCount: number; totalBytes: number;
  revision: number; imported: false; idempotentReplay: boolean;
}
interface ChunkedUploadRequired {
  status: 'chunked-upload-required'; requestId: string; uploadSessionId: string;
  maxChunkBytes: number;                  // = MAX_CHUNK_BYTES (1 MiB)
  requiredFiles: string[];                // = request.outputContract.requiredFiles
  requiredNextTools: ['put_result_file', 'finalize_result'];
  limits: PublishLimits; exceeded: string[];   // limits/exceeded는 additive 발견성 필드
}
interface PublicationConflict {
  status: 'conflict';
  reason: 'request-terminal' | 'claimed-by-another-reviewer'
    | 'different-result-already-finalized' | 'request-sha-mismatch'
    | 'publication-id-content-mismatch';       // 03 §7 "same id, different content" 대응 additive reason
  existingResultId?: string; detail: string;
}
// 공개 API
publishReviewPackage(requestId: string, input: PublishPackageInput, limits?: PublishLimits):
  Promise<PublishReceipt | ChunkedUploadRequired | PublicationConflict>
```

`resultId`는 결정적으로 `rev<revision>-<resultManifestSha256 앞 12 hex>`로 고정한다 (멱등 replay에서 동일 값 보장).

**A-2. 전체 흐름 — 단일 `this.mutate(requestId, …)` 안에서 순서 고정**:

1. **전처리 (무변경 단계)**: 요청 로드(`requireRequest`) + 상태 확인. terminal(imported/cancelled/expired/failed) → `conflict: request-terminal` 반환 (expired만 기존 `requireActiveStatus`의 `expired` throw 유지 — 기존 에러 계약 보존). `summary.reviewedRepository !== request.repository.fullName` 또는 `reviewedHeadSha !== request.git.headSha` 또는 `reviewedBaseSha !== request.git.baseSha` → `conflict: request-sha-mismatch` (03 §10 서버 측 바인딩).
2. **canonical manifest 서버 파생**: `ReviewResultManifest`를 서버가 전량 구성 — schemaVersion, requestId, `requestPayloadSha256 = request.payloadSha256`, repositoryFullName/reviewedBaseSha/reviewedHeadSha = request 값(1에서 일치 검증 완료), `resultKind` = request.kind 매핑(goal_audit→audit, feature_design→design), proposedFolder/disposition = 입력, `files[]` = 각 파일의 UTF-8 byteLength·sha256 서버 계산 + 입력 mediaType, `findingsSummary` = summary.p0~p3, `reviewerDeclaration` = A-3, createdAt = 주입 now, `payloadSha256 = computePayloadSha256(...)`. **모델이 해시를 계산할 필요가 완전히 사라진다.** `manifestSha = payloadSha256`.
3. **멱등/충돌 판정 (§7 순서 고정 — 한도 검사보다 먼저)**:
   - publication record(A-5)에 clientPublicationId 존재 ∧ 기록된 manifestSha == 파생 manifestSha ∧ 해당 revision이 result index에 존재 → **기존 receipt 반환** (`idempotentReplay: true`).
   - record 존재 ∧ manifestSha 불일치 → `conflict: publication-id-content-mismatch`.
   - record 부재 ∧ 현재 finalized manifest hash == manifestSha (result-ready) → receipt 재구성 + record 기록 후 반환 (`idempotentReplay: true`) — 저수준 finalize 후 publish 재호출 수렴.
   - result-ready ∧ manifestSha 불일치 → `conflict: different-result-already-finalized` + `existingResultId` (revision 경로는 기존 `begin_result(revisionOf)` 안내를 detail에 포함 — facade는 revision을 발행하지 않는다).
4. **한도 검사 (MCP-002)**: files.length > maxFiles ∨ Σbyte > maxTotalBytes ∨ 단일 파일 > maxFileBytes → **fallback 경로** (B절): ready면 `claimRequestUnsafe`, 이후 `beginResultUnsafe`(revision 1; 기존 rev-1 open upload 재사용 멱등) 수행 후 `ChunkedUploadRequired` 반환. `uploadSessionId = 'staging-rev<revision>'`. **파일 내용은 일절 스테이징하지 않는다.**
5. **정상 경로**: pre-state 캡처(status.state/detail, open upload 존재 여부, journal 존재 여부) → ready면 `claimRequestUnsafe` → `beginResultUnsafe`(또는 기존 rev-1 upload 재사용) → 파일별 `putResultFileUnsafe`(chunkIndex 0/chunkCount 1, chunkSha256 = sha256(bytes)) → 2에서 파생한 manifest로 `finalizeResultUnsafe` → receipt 구성 → publication record 기록(A-5) → 반환 (`idempotentReplay: false`).

기존 Unsafe 내부 헬퍼가 private이므로 store **내부에** 구현한다 — tools.ts에서 공개 메서드를 조합하는 방식(호출당 lease 획득/해제)은 원자성이 깨지므로 금지.

**A-3. reviewerDeclaration 기본값**: 입력 생략 시 `{ surface: 'chatgpt-web', requestedMode: 'pro', githubConnectorUsed: true, limitations: input.summary.limitations }`. 입력 제공 시 그대로 사용 (기존 manifest 스키마 검증 통과 필수). FINDINGS.json과의 교차 검증은 기존 importer(vpb-09 A-2)가 finalize 안에서 그대로 수행한다 — facade에서 재구현 금지.

**A-4. Atomicity / rollback (03 §6 — 부분 result-ready 0)**: 5단계 중 어느 지점에서든 throw 시, rethrow 전에 같은 lease로:
   - (a) **이번 호출이 생성한** staging 디렉터리만 `removePath` (호출 전부터 열려 있던 upload는 보존);
   - (b) journal이 이번 호출 중 생성되었고 phase가 `'prepared'`면 journal 파일 제거. **phase가 revision-installed 이상이면 절대 제거 금지** — vpb-08 reconcile roll-forward 소관 (in-process 결정적 실패는 전부 prepared 이하에서 발생한다: importer invalid/refused는 journal advance 전에 throw);
   - (c) status가 이번 호출 중 변경되었고 journal이 부재(또는 (b)에서 제거)면 캡처한 pre-state를 raw `writeStatus`로 원복;
   - (d) 원 에러 rethrow (MailboxStoreError는 기존 server 매핑대로 isError data로 표면).
   결과 불변식: 실패한 publish 뒤 `getStatus`는 pre-publish 상태, `getResultManifest`는 null(초회 기준), `inspectMailboxHealth`는 진단 0건, 동일 clientPublicationId 재시도 안전(실패는 record를 남기지 않는다 — **record는 성공 시에만 기록**). 프로세스 크래시 중단은 vpb-08 journal/reconcile 복구에 위임 — residual로 보고.

**A-5. Publication record (멱등 저장소)**: `resultDir(requestId)/publications.json` — `{ schemaVersion: 'vibe-pro-bridge-publication-v1', publications: { [clientPublicationId]: { manifestSha256, revision, resultId, fileCount, totalBytes, title, recordedAt } } }`. `commitJson`으로 원자 기록, 기존 parse* 패턴의 방어적 파서(손상 시 `invalid-input` throw). finalize 성공 후 record 기록이 실패해도 재시도가 3단계 세 번째 분기로 수렴함을 주석으로 명시. **`MailboxHealthState`/`inspectHealthEntry`는 확장하지 않는다** (5상태 union 불변). `cleanupOwnedTemps`는 파일을 건드리지 않으므로(디렉터리만 재귀) 안전 — 확인만.

**A-6. 툴 등록 (tools.ts)**: zod strict input — `requestId`, `proposedFolder`(FOLDER_NAME_PATTERN), `disposition`(ReviewDispositionSchema), `summary`(strict), `files`(min 1, path는 `isSafeRelativePath` refine + **중복 path refine 거부**), `clientPublicationId`(위 패턴), `reviewerDeclaration` optional. description은 02 §3 리터럴 기반: "Use this when a Vibe goal audit, implementation review, or feature design is complete and the user asked to save the package for CLI import. This is the required final publication step. Do not merely print the files in chat." (WRITE_SCOPE/INJECTION_DEFENSE는 definition()이 자동 결합). 카탈로그 위치: `claim_request` 바로 뒤, `begin_result` 앞 — **고정** (테스트 리터럴 대조).

### B. MCP-002 — 한도 + chunked fallback

1. **config**: `ProBridgeMcpConfig.publishLimits: PublishLimits`, 기본 `DEFAULT_PUBLISH_LIMITS`. `resolveProBridgeConfig`가 per-field 병합(부분 지정 시 나머지 기본값). `runMcpServer` → `createMailboxTools(store, { …, publishLimits })` → `store.publishReviewPackage(…, limits)`.
2. **fallback 응답**: A-2 4단계. `exceeded`에는 초과한 한도명을 담는다(예: `['maxTotalBytes']`). 세션이 이미 열려 있는 상태에서 동일 oversize 재호출 → 동일 응답 멱등 (beginResultUnsafe의 rev-1 재사용 분기). 단일 파일이 maxFileBytes 초과여도 fallback으로 처리 가능하다 — put_result_file의 1 MiB chunk 한도가 실전 상한이다.
3. **저수준 description 재작성** (02 §3 리터럴 기반, 의미 보존 범위에서 축약 허용):
   - `begin_result`: "Use this only when publish_review_package returned chunked-upload-required, when an existing upload session must be resumed, or to open a result revision linked to the current manifest. Do not use it as the default publication path."
   - `put_result_file`: "Use this only for an active upload session returned by publish_review_package or begin_result. Upload exactly the requested file or chunk and preserve the returned upload session identity."
   - `finalize_result`: "Use this only after every file required by the active chunked upload has been stored. This is the final fallback step and must return status=result-ready." + **기존 해시 생략 문장 유지**.
   `acknowledge_import`/`cancel_request` 재작성과 annotation 전면 정비는 vpb-11 — 이번에 손대지 않는다.
4. **facade/저수준 manifest parity** (MCP-002 DoD): 같은 파일 세트를 facade와 저수준 경로로 각각 발행하면 canonical manifest hash가 동일해야 한다 — T2가 증명한다.

### C. MCP-003 — get_request 완료 계약

`get_request` 반환을 `{ ...request, completionContract }`로 확장 (top-level request 필드 전부 보존 — deep-equal 소비자 대비 additive sibling 한 개만 추가):

```ts
completionContract: {
  publicationRequired: true,
  primaryFinalTool: 'publish_review_package',
  requiredFinalStatus: 'result-ready',
  normalPackageMaxBytes: limits.maxTotalBytes,          // 05 §2 리터럴 필드
  normalPackageLimits: { maxFiles, maxTotalBytes, maxFileBytes },  // additive 발견성
  requiredFiles: request.outputContract.requiredFiles,
  fallback: { triggerStatus: 'chunked-upload-required', tools: ['put_result_file', 'finalize_result'] },
  chatOnlyOutputCompletesRequest: false,
}
```

### D. 프롬프트 템플릿 — 양 wire (MCP-003)

**D-1. composer (CLI-origin — manual prompt.md와 mailbox get_request 공용 텍스트)**: `renderPrompt`에 완료 계약 섹션 추가 (H 확장 또는 신규 섹션, re-lettering 허용). 필수 리터럴 문장 (테스트가 grep):
- `The task is incomplete until the Bridge returns status=result-ready.`
- `Do not finish by only printing Markdown in chat.`
- fallback 지시: chunked-upload-required 수신 시 요청된 파일 전부 업로드 후 finalize_result 호출.
- 최종 응답에 requestId, resultId, proposedFolder, resultManifestSha256 포함 지시 (05 §4).
- publish 툴 부재 시: `If the publication tool is unavailable, report that the Bridge app tool surface is incomplete. Do not claim the request is complete.`
- **manual carve-out (모순 방지)**: mailbox 툴이 대화에 붙어 있지 않으면(manual wire) 완전한 vibe-bundle 블록 출력 자체가 완료 경로임을 명시 — 기존 H섹션 계약("Phase 1 is manual…")과 G섹션 vibe-bundle 계약은 그대로 유지된다. 두 경로의 적용 조건(툴 표면 유무)을 문장으로 구분해 한 프롬프트 안에서 충돌하지 않게 한다.
- 05 §5 negative 최소 반영: begin_result만 부르고 성공 주장 금지, conflict 회피용 cancel+재생성 금지 (2문장 이내).

**D-2. tools.ts create_design_request (web-origin)**: inline reviewPrompt에 D-1의 리터럴 2문장 + receipt 포함 지시 + 툴 부재 보고 지시 추가 (web-origin은 mailbox wire 전제이므로 manual carve-out 불요). `next` 필드를 publish 우선으로 교체: `'publish_review_package — one call publishes the package; on chunked-upload-required follow put_result_file × N → finalize_result'` (기존/신규 반환 지점 2곳 모두).

**D-3. `docs/context/pro-bridge-setup.md`**: §4 리뷰 왕복 — `get_request → publish_review_package` 2콜을 정상 경로로, 기존 `begin/put/finalize` 서술은 "한도 초과 fallback 또는 명시 재개" 경로로 격하 (finalize 해시 생략 문단 유지). §Web-origin — `claim_request → begin_result → put_result_file 반복 → finalize_result` 나열을 publish 우선 + fallback 순서로 교체.

### E. MCP별 closure 매핑 표

| Spec | 구현 지점 (파일:심볼) | 복원되는 설계 불변식 | Proof |
|---|---|---|---|
| MCP-001 | store.ts: `publishReviewPackage` + rollback + publications.json; tools.ts: 13번째 툴 | 정상 리뷰 = get_request → publish 1콜; 부분 result-ready 0; 3중 멱등; importer 단일 검증 경로 무손상 | T1~T14 + predicate 4·6·7 |
| MCP-002 | lib/schemas: PublishLimits; config.ts: publishLimits; store.ts: 한도 분기 + 세션 개방; tools.ts: 저수준 description | 한도는 발견 가능·설정 가능; fallback은 구조화 계획으로만 진입; facade/저수준 manifest parity | T2·T15~T18·T22 + predicate 4 |
| MCP-003 | tools.ts: get_request completionContract + web-origin 템플릿; prompt-composer.ts: 완료 계약 섹션; setup.md | chat-only 출력은 완료가 아님; receipt 없는 완료 주장 불가; manual wire 계약 무모순 유지 | T19~T21·T23~T26 + predicate 5 |

### F. 범위 아님 (vpb-11/12 + residual)

- MCP-004 annotation 전면 정비·outputSchema·`_meta.ui.visibility`·카탈로그 audit, MCP-006 `bridge_capabilities`·doctor, MCP-005 OAuth scope, MCP-007 golden dataset.
- facade 경유 revision 발행 (result-ready + 신규 내용 → conflict + 저수준 revision 경로 안내가 이번 계약).
- 03 §11 telemetry, 실 ChatGPT Developer Mode 재실행/Refresh 절차 (사용자 참여 항목), v1.8.1 release closure (iteration 종료 시).

---

## Tests to add

node:test `describe`/`it`, 주입 `now`, `mkdtemp` 임시 루트, `buildCompliantResultBundle` fixture 재사용(계약 통과 파일 세트), 낮은 한도 주입으로 oversize 케이스를 작게 유지 — **실 sleep·실 네트워크(로컬 포트 0 서버 제외) 금지**. **아래 `it()` 케이스명 26종은 리터럴로 고정한다** (Orchestrator가 출력에서 grep으로 대조).

`pro-bridge-publish.test.ts` (신규 — store/tools 레벨, T1~T18):

정상 경로:
1. `publishes a complete package in one call and returns the result-ready receipt` — ready 상태에서 1콜 → status/requestId/resultId/proposedFolder/resultManifestSha256/fileCount/totalBytes/revision/imported 전 필드 assert + getStatus result-ready
2. `produces a manifest identical to the low-level finalize path for the same package` — 동일 파일 세트를 두 요청에 각각 facade/저수준으로 발행 → manifest payloadSha256 동일 (parity)
3. `reads a published package back through the manifest and file tools and acknowledges import` — get_result_manifest/get_result_file 왕복 + resultFilesSha256으로 acknowledge_import 성공
4. `claims a ready request atomically inside publish` — 별도 claim_request 없이 ready → result-ready
5. `continues publishing a request the session already claimed` — claimed 상태에서 성공

멱등/충돌:
6. `returns the existing receipt for an exact publish replay` — 동일 입력 재호출 → 동일 resultId/manifestSha + `idempotentReplay: true` + revision 증가 없음
7. `returns a conflict when the same client publication id carries different content` — reason `publication-id-content-mismatch`
8. `converges to the existing receipt when the same manifest was already finalized` — 저수준 finalize 후 동일 내용 publish → result-ready receipt
9. `returns different-result-already-finalized with the existing result id` — result-ready + 다른 내용 → conflict + existingResultId
10. `returns request-terminal for a cancelled request`
11. `returns request-sha-mismatch when the summary binding disagrees with the request`

원자성:
12. `restores the request state and leaves no result when publish validation fails` — 필수 파일 누락 또는 FINDINGS 계약 위반 주입 → throw + getStatus == pre-state(ready) + getResultManifest null + staging 부재
13. `reports a diagnostics-free mailbox after a failed publish` — inspectMailboxHealth 진단 0건 (journal/staging 잔존물 0)
14. `retries safely with the same client publication id after a failed publish` — 실패 후 교정 내용 + 동일 id → 성공 (실패는 record 미기록)

Fallback:
15. `returns chunked-upload-required with an open upload session when limits are exceeded` — uploadSessionId/maxChunkBytes/requiredFiles/requiredNextTools/limits/exceeded 전 필드 + findOpenUpload 관측 가능(begin 수행됨) + 파일 미스테이징
16. `repeats the same fallback plan while the upload session stays open` — oversize 재호출 → 동일 응답 멱등
17. `completes the fallback plan through put_result_file and finalize_result` — fallback 후 저수준으로 result-ready 도달
18. `routes a single file above the per-file limit to the chunked fallback`

`pro-bridge-mailbox.test.ts` (T19~T23 + 기존 12툴 케이스 갱신):
19. `extends get_request with the completion contract while preserving request fields` — completionContract 전 필드 deep-equal + 기존 request 필드 top-level 보존
20. `announces the publish limits in the get_request completion contract` — 주입 publishLimits가 normalPackageMaxBytes/normalPackageLimits에 반영
21. `exposes thirteen tools with publish_review_package before the fallback uploaders` — 13개 이름 배열 리터럴 (기존 `exposes twelve tools…` 케이스를 이 이름으로 교체)
22. `marks the low-level upload tools as fallback-only in their descriptions` — begin/put/finalize 3종에 fallback 문구 + finalize 해시 생략 문장 잔존
23. `steers web origin design requests to publish_review_package first` — create_design_request 반환 `next` + reviewPrompt 리터럴 2문장

`pro-bridge-composer.test.ts` (T24~T26):
24. `states the result-ready completion contract in the composed review prompt` — 리터럴 2문장 + receipt 필드 4종 지시 존재
25. `keeps the manual vibe-bundle wire as an explicit completion path without contradiction` — manual carve-out 문장 + 기존 vibe-bundle 계약(G/H) 잔존
26. `instructs the model to report an incomplete bridge tool surface when the publish tool is missing`

기존 파일 갱신 (의도된 행동 전환 — Final report에 케이스별 사유):
- `pro-bridge-mcp-server.test.ts:316` `tools.length` 12 → 13 (`lists the mailbox tools over tools list` 케이스 내).
- `round trips a chunked upload from claim to result manifest through tools call` 등 저수준 회귀는 **무변경 통과**가 요구사항이다 — description 갱신 외 저수준 행동이 변하면 안 된다.

공통 원칙: conflict 케이스는 reason **리터럴**까지 assert. 멱등 케이스는 revision 미증가·record 단일성을 assert. 원자성 케이스는 pre-state 원복 + health 무진단을 assert. 시간 전부 주입.

---

## 실행 제약

- **Windows sandbox**: Generator는 npm/네트워크/테스트 실행 불가 — static inspection과 코드 작성만. 실행 검증(typecheck/self-test/targeted)은 Orchestrator가 수행한다. 실행하지 못한 검증을 통과로 보고하지 말 것.
- **신규 의존성 0, 신규 스크립트 0.** `package.json` 무변경. 해시는 `node:crypto`만.
- NodeNext ESM — 상대 import는 `.js` 확장자. UTF-8 (BOM 없음). 기존 한국어 사용자 메시지 톤 유지 (setup.md).
- 테스트는 `.vibe/harness/test/` 직속, node:test만 — 신규 파일은 `vibe:self-test` glob(`test/*.test.ts`)에 자동 포함된다.
- 예상 규모 ~700 LOC (테스트 포함) — 상한이 아니라 규모 감각이다. 계약 충족과 iter-2 불변식 보존이 우선.

---

## 완료 체크리스트 (Verification)

### 기계 검증 (Orchestrator 실행)

- [ ] `npm run vibe:typecheck` exit 0
- [ ] `npm run vibe:self-test` exit 0 (identity·lifecycle·health·importer·schemas·e2e 로스터 무손상, 저수준 chunked 왕복 무변경 통과)
- [ ] targeted 4파일 exit 0 + 리터럴 케이스명 26종 전부 출력에 존재 (proof predicate 3)
- [ ] `publish_review_package`/`chunked-upload-required`/`publishLimits` grep (predicate 4)
- [ ] 프롬프트 리터럴 2종 각 ≥2 파일 (predicate 5)
- [ ] 불변 파일 git diff 빈 출력 — importer/contract/vibe-bundle/scope-resolver/tunnel/transports/goal-source/package.json/config.json (predicate 6)
- [ ] 기존 12툴 이름 grep 전부 잔존 (predicate 7) + `git status --porcelain -- docs/plans vibe-doctor-mcp-write-improvement-v1.8.0` 빈 출력 (predicate 8)

### Inspection / demo AC (Orchestrator·Evaluator·사용자)

- [ ] **모델-facing 표면 transcript 2종 확보** (CLI/프로토콜 제품의 identity/payoff 증거): ① 로컬 서버 tools/list JSON 스냅샷 — 13툴 + publish description "Use this when…" + 저수준 3툴 fallback 문구, ② get_request 응답 JSON 1건 — completionContract 전 필드. (targeted 테스트 출력 또는 로컬 기동 왕복으로 채취)
- [ ] 검증 비약화 (Evaluator 대조): facade가 importer/finalize 검증을 **한 번 더 통과**시키는 경로이고 우회로가 아닌가. rollback이 journal roll-forward(phase ≥ revision-installed)를 침범하지 않는가. publication record가 성공 시에만 기록되는가. get_request 확장이 additive sibling인가.
- [ ] 멱등 판정 순서 (Evaluator 대조): idempotency/conflict 판정이 한도 검사보다 앞서는가 — oversize로 발행된 기존 결과의 exact replay가 fallback으로 튕기지 않는가.
- [ ] manual wire 무모순 (Evaluator 대조): 한 프롬프트 안에서 mailbox 완료 계약과 vibe-bundle 완료 경로가 툴 표면 유무 조건으로 명확히 분리되는가.
- [ ] 실 ChatGPT Developer Mode Journey B 재실행·앱 Refresh — **사용자 참여 항목, 이번 Sprint 범위 밖** (roadmap 종료 조건 1에 따라 분리 보고).
- [ ] >5 파일이므로 **Evaluator 소환은 Must**.

---

## Final report 요구 (Generator 출력 필수 형식)

1. **`## Wiring Integration`** — `.vibe/agent/_common-rules.md` §14 W1~W14 각 항목 `touched / n/a / skipped+reason`. 예상: W2 n/a+근거 (`.vibe/harness/{src,test}/**` glob이 sync-manifest에 기등록 — 신규 test 파일 자동 포함), W11 n/a+근거 (publications.json은 신규 additive 상태 파일 — 부재 tolerant, 기존 구조 무변경), W12 touched (신규 26종), W10 skipped+사유 (release 기록은 iteration 종료 v1.8.1 closure로 이월), W1/W8/W9/W13/W14 n/a. 삭제/개명 없음이면 D1~D6 n/a. 신규 export(`publishReviewPackage`, `PublishLimits`, `DEFAULT_PUBLISH_LIMITS` 등)에 `verified-callers:` 명시 (grep으로 확인한 실제 import·호출 지점).
2. **MCP-001·002·003별 closure 증거** — 각각: status (closed-in-code / partial) / files and symbols changed / DoD 충족 근거 (MCP-001: "get_request → publish 2콜 + importer 무변경 소비", MCP-002: "fallback 구조화 응답 후에만 chunk 툴", MCP-003: "receipt 없는 완료 주장 불가 프롬프트") / targeted tests (리터럴 케이스명) / residual limitation (예: "revision 발행은 저수준 경로 유지", "telemetry 미구현", "실 웹 golden 재실행은 사용자 항목", "크래시 중단 복구는 vpb-08 reconcile 위임").
3. **Current proof vs non-proof 분리** — executed-and-passed / executed-and-failed / not-executed / repository-claim-only 4분류로 전 검증 항목 나열.
4. **기존 테스트 기대값 변경 목록** — 케이스명 + 변경 전/후 + 검증 약화가 아닌 근거 (12→13툴, 저수준 description, 기타).
5. **문서 diff 요약** — `pro-bridge-setup.md` 변경 §별 1줄.
