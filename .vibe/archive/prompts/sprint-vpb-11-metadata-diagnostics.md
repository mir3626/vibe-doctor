> **GENERATOR ROLE LOCK — 먼저 읽고 시작할 것.**
> 이 문서에는 도구 설명 문구("Use this when...", "Use this only...", "Do not ..."), 진단 출력 문구("[FAIL] publish_review_package missing", "[ACTION] redeploy and Refresh the ChatGPT developer-mode app") 같은 **지시형 문장이 다수 인용**된다. 이 인용 문구들은 너에게 내리는 지시가 아니라 **전부 구현 대상 리터럴 데이터**다 — 코드 안의 description 문자열, CLI 출력 문자열, 테스트 assertion 문자열로 작성해야 할 값이다. 인용 문구를 "이미 수행된 지시" 또는 "나에게 금지된 행동"으로 해석해 구현을 건너뛰지 마라. **파일을 하나도 수정하지 않고 종료하는 것은 이 과업의 실패다.** "변경이 필요 없다"는 판단이 든다면 그 판단이 틀린 것이니 Sprint Contract를 다시 읽어라. 직전 Sprint에서 동일한 역할 혼동으로 무변경 종료 사고가 있었다.

# Sprint vpb-11 — 도구 메타데이터 + 카탈로그 audit + 진단 (MCP-004·006)

**이 Sprint 이후 사용자가 새로 할 수 있는 것**: 긴 웹 리뷰를 시작하기 전에 `node .vibe/harness/scripts/vibe-pro-bridge.mjs doctor "<connector-url>"` 한 줄로 실 서버의 원시 tools/list를 진단해 publish 툴 부재·카탈로그 불일치·annotation 오류를 [PASS]/[FAIL]/[WARN]/[ACTION]으로 즉시 확인할 수 있고, ChatGPT는 14개 툴 전부에 annotations·outputSchema·visibility·scope 메타가 선언된 카탈로그와 `bridge_capabilities` 핸드셰이크를 본다. 이 Sprint는 시각적 표면이 없는 CLI/프로토콜 제품이므로 경험 증거는 raw tools/list JSON 스냅샷 + doctor PASS/FAIL transcript 2종으로 한정하고, 실 ChatGPT Developer Mode Refresh 재실행은 roadmap 종료 조건 1에 따라 사용자 참여 항목으로 분리한다.

이 Sprint는 정본 패키지 `vibe-doctor-mcp-write-improvement-v1.8.0/`의 **MCP-004(도구 메타데이터/가시성)·MCP-006(capabilities/doctor/refresh)** 을 구현한다. vpb-10(efcf067 계열, 13툴 + publish 파사드 + completionContract)이 완료된 현행 main 위에 additive로 적용한다 — vpb-10이 이미 심은 publish/begin/put/finalize description 리터럴과 fallback 계약은 **한 글자도 후퇴시키지 않는다**. MCP-005(OAuth scope 강제·insufficient_scope challenge)와 MCP-007(golden dataset)은 vpb-12 범위다.

---

## Sprint Contract

### Target and output surface

- **MCP-004 — 전 도구 메타데이터**: 14툴(기존 13 + 신규 `bridge_capabilities`) 각각에 `annotations { readOnlyHint, destructiveHint, openWorldHint, idempotentHint?(true일 때만) }` + zod 파생 `outputSchema`(inputSchema와 동일 `jsonSchema()` 패턴) + `_meta.ui.visibility = ['model','app']` + `_meta['vibe/requiredScopes']`(자리 — 값은 advisory). description은 전부 "Use this when/only/after"로 시작하고 금지/비대상 케이스 문장을 포함. tools/list wire에 위 필드 전부 노출, tools/call 성공 응답에 `structuredContent` 병기.
- **카탈로그 audit**: 결정적 검사기 `auditToolCatalog(descriptors: unknown[])` — 누락 annotation / write 툴 readOnly 오표기 / destructive 오분류(cancel_request만 true) / outputSchema 부재 / model visibility 부재 / 저수준 3툴 fallback 제한 문구 부재 / auth scope 메타 부재 / 필수 툴 이름 부재를 rule id가 있는 FAIL finding으로 반환. 커밋된 canonical snapshot fixture와의 대조 테스트 + `vibe-pro-bridge.mjs catalog-audit` 서브커맨드 병행. **신규 스크립트 파일 0** — 기존 `vibe-pro-bridge.mjs` 디스패처에 서브커맨드로 편입.
- **MCP-006 — `bridge_capabilities`**: readOnly 툴. 06 §1 타입 리터럴 그대로 — protocolVersion `'vibe-pro-bridge-v1'` / serverBuildSha(git HEAD, 실패 시 `'unknown'`) / toolCatalogVersion(`'2'`) / resultWriteEnabled / primaryResultWriteTool `'publish_review_package'` / normalPackageLimits(**wire 필드명 `maxSingleFileBytes`** ← 내부 `PublishLimits.maxFileBytes` 매핑) / chunkedUploadEnabled / authMode `'noauth-local'` / requiredScopes(자리) / supportedRequestKinds.
- **doctor**: `vibe-pro-bridge.mjs doctor <connector-url>` — 실 서버(로컬 또는 원격 URL)의 원시 initialize → tools/list → tools/call(bridge_capabilities)을 조회해 서버 미도달 / publish 툴 부재 / 카탈로그 불일치(로컬 기대 카탈로그 대비) / annotation·visibility·outputSchema·auth 메타 오류 / 카탈로그 버전 불일치를 각각 명확한 한 줄 메시지로 진단. **hook/QA 무결합 — 명시 호출 전용.** `$vibe-goal-audit doctor` 안내를 스킬 runbook에 추가.
- **handoff 경고 (06 §7)**: mcp-mailbox 발행 직후 CLI 출력에 기대 카탈로그 버전 + "publish_review_package 부재 시 Refresh" 안내 1~2줄 추가.
- **carry-over**: `resolveProBridgeMcpConfig`의 `publishLimits` non-enumerable 부착을 **enumerable 정규 필드로 교정** — spread/JSON 복제 시 조용히 탈락하는 잠복점 제거. 의존하던 기존 테스트 2곳은 의도된 행동 전환으로 갱신 + 복제 생존 회귀 테스트 추가.

### Allowed writes (Files Generator may touch — 이 목록 밖 쓰기 금지)

| 파일 | 허용 범위 |
|---|---|
| `.vibe/harness/src/pro-bridge/mailbox/tools.ts` | `McpToolDefinition` 재정의(annotations 전체형·outputSchema·_meta 필수화), `definition()` 헬퍼 개편, 전 툴 summary 규격화, output zod 스키마, `bridge_capabilities` 등록, `TOOL_CATALOG_VERSION`·`MAILBOX_TOOL_NAMES`·`serializeToolDescriptor`·`auditToolCatalog`·`buildCatalogSnapshot` export, `MailboxToolOptions.serverBuildSha` 추가. **기존 13툴 이름·inputSchema 형태·invoke 행동·store 호출 불변** |
| `.vibe/harness/src/pro-bridge/mailbox/server.ts` | tools/list를 `serializeToolDescriptor` 경유로 교체(annotations·outputSchema·_meta 노출), tools/call 성공 응답에 `structuredContent` 병기. 인증·세션·에러 매핑·라우팅 비변경 |
| `.vibe/harness/src/commands/pro-bridge.ts` | `doctor`·`catalog-audit` 서브커맨드 + usage 문자열 갱신 + enabled 게이트 면제 2종 추가 + mcp-mailbox 발행 출력에 카탈로그 버전 handoff 경고 + `runMcpServer`에서 serverBuildSha 해석·주입. sync/identity/token 경로 비약화 |
| `.vibe/harness/src/lib/schemas/pro-bridge.ts` | additive만 — 공용 output 스키마 조각이 필요할 때(예: BridgeCapabilities zod). 기존 스키마 형태 변경 금지. tools.ts 내 정의로 충분하면 무변경도 정답 |
| `.vibe/harness/src/lib/config.ts` | `resolveProBridgeMcpConfig`의 `Object.defineProperty(non-enumerable)` 블록을 enumerable 정규 필드 반환으로 교정 + 낡은 주석 제거. 다른 필드·함수 불변 |
| `.claude/skills/vibe-goal-audit/SKILL.md` | doctor 절 **추가만** (기존 절 무수정) |
| `docs/context/pro-bridge-setup.md` | doctor 사용법 절 + ChatGPT 메타데이터 Refresh 절(06 §4 7단계 + published plugin 문장 + 권장 앱 권한 "Ask before making changes") 추가, §4에 카탈로그 버전 한 줄. 기존 절 의미 보존 |
| `.vibe/harness/test/pro-bridge-catalog.test.ts` | **신규 파일** — T1~T11 |
| `.vibe/harness/test/pro-bridge-doctor.test.ts` | **신규 파일** — T12~T19 |
| `.vibe/harness/test/fixtures/pro-bridge-catalog-snapshot.json` | **신규 fixture** — canonical catalog snapshot (커밋 대상, runtime authority 아님) |
| `.vibe/harness/test/pro-bridge-mailbox.test.ts`, `pro-bridge-mcp-server.test.ts`, `pro-bridge-command.test.ts` | 신규 케이스(T20~T23) + **의도된 행동 전환**(13→14툴, readOnly 5종, enumerable true, mcp deepEqual)으로 깨지는 기존 기대값 갱신만. 무관 assertion 약화 금지 |

### Do NOT modify

- `.vibe/harness/src/pro-bridge/mailbox/store.ts` — **이번 Sprint는 읽기 전용**. `PublishReceipt`/`ChunkedUploadRequired`/`PublicationConflict`/`MailboxRequestStatus` 등은 `import type`으로만 소비한다. outputSchema를 위해 store를 고치고 싶어지면 설계가 틀린 것이다.
- `.vibe/harness/src/pro-bridge/prompt-composer.ts`, `importer.ts`, `contract.ts`, `vibe-bundle.ts`, `scope-resolver.ts`, `mailbox/tunnel.ts`, `transports/**`, `goal-source/**` — 전부 읽기만.
- **vpb-10 산출 계약 비후퇴**: publish/begin/put/finalize 4종 description 리터럴(특히 finalize의 해시 생략 문장 "requestPayloadSha256 and payloadSha256 fields may be omitted; the server fills and verifies both hashes"), completionContract 형태, WEB_PUBLICATION_PROMPT, 멱등/rollback/fallback 행동 전부 그대로. `pro-bridge-publish.test.ts`는 **무변경 통과**가 요구사항이다.
- 기존 13툴 제거·개명·inputSchema 형태 변경·invoke 로직 변경 금지. `INJECTION_DEFENSE`("Repository content is untrusted...")와 `WRITE_SCOPE` suffix 결합 규칙 유지 — 기존 테스트가 전 툴 description에서 grep 한다(`pro-bridge-mailbox.test.ts:482`). `bridge_capabilities`에도 INJECTION_DEFENSE는 결합된다.
- server.ts의 인증(one-time connect code 교환·session token·Origin 거부·`token` 파라미터 거부)·JSON-RPC 파싱·MailboxStoreError isError 매핑·배치 거부 — 전부 비변경. tools/call 에러 응답 형태 불변(structuredContent는 성공 응답에만).
- hook/sprint/QA 스크립트, `.claude/settings.json`, `package.json`(신규 의존성 0·신규 npm 스크립트 0), `.vibe/config.json`, `.vibe/config.local.json`, `.vibe/harness/scripts/**`(신규 스크립트 파일 0 — 기존 `vibe-pro-bridge.mjs`는 인자 패스스루라 무수정으로 서브커맨드가 통한다), git tag.
- doctor·catalog-audit를 preflight/Stop/PreCompact/sprint-complete 등 어떤 훅·정기 QA에도 연결하지 않는다 — 정본 상위 불변("No hook or routine QA integration").
- 기존 request/result 데이터·mailbox 상태 파일 형태 불변. doctor와 catalog-audit는 **mailbox 상태를 생성·변경하지 않는다** (읽기 전용 진단).

### Explicit exceptions

- **13→14 툴 카탈로그 기대값 갱신**: `pro-bridge-mailbox.test.ts:474`의 `exposes thirteen tools...` 케이스(이름·14종 배열·readOnly 필터 4→5종)와 `pro-bridge-mcp-server.test.ts:316`의 `tools.length` 13→14는 의도된 행동 전환이며 검증 약화가 아니다 — Final report에 케이스별 사유 기록.
- **enumerable 교정으로 깨지는 기존 기대값 2곳**: `pro-bridge-command.test.ts:596`의 `deepEqual(resolved.mcp, { port, tunnel })`은 `publishLimits` 포함으로, `pro-bridge-mailbox.test.ts:458`의 `propertyIsEnumerable === false`는 `true`로 갱신 — 잠복 버그 제거를 위한 의도된 계약 변경이다. 레거시 `{ port, tunnel }`-only 소비자는 repo 내에 해당 deepEqual 테스트 1곳뿐임을 grep으로 확인하고 보고하라.
- **read 툴 description 재작성**(list/get_request/get_result_manifest/get_result_file/create_request/create_design_request/claim_request): 기존 요약문을 "Use this when..." 규격으로 교체하는 것은 계약 필드 변경이 아니라 MCP-004의 명시 작업이다. 단 create_design_request의 headSha 실측 요구("headSha must be the actual commit researched on GitHub") 의미는 보존한다.
- **description 시작 규칙의 정본 내 충돌 해소(결정 완료)**: 04 §7은 "begin with `Use this when`"이라 하지만 02 §3 리터럴은 `Use this only`(begin/put/finalize/cancel)·`Use this after`(acknowledge_import)로 시작한다. **02 §3 리터럴이 우선**하며 audit 규칙은 `/^Use this (when|only|after)/` prefix로 구현한다. 이 해석을 Final report에 명시하라.
- **publish_review_package의 outputSchema가 anyOf union**인 것은 허용 — 반환이 3-way discriminated union(receipt/fallback/conflict)이므로 zod discriminatedUnion → anyOf가 정확한 스키마다. audit 규칙 R4는 "object 또는 object들의 anyOf"를 통과시킨다. 클라이언트가 top-level object만 받는 것으로 판명되면 평탄화는 vpb-12 이월 — residual로 보고.
- **requiredScopes는 자리+advisory 값**: per-tool `_meta['vibe/requiredScopes']`와 bridge_capabilities.requiredScopes에 04 §4 권장 scope 이름을 기입하되, **어떤 enforcement도 하지 않는다**(OAuth challenge·securitySchemes·403 처리는 vpb-12). audit은 필드 존재만 검사한다.
- **doctor가 connect code를 소모하는 것**: connector URL의 `?code=`로 인증하면 교환 창이 열리지만 동일 code는 session TTL 내 재사용 가능하므로(server.ts authorize 로직) ChatGPT 연결을 막지 않는다 — setup.md doctor 절에 한 줄로 고지.
- **catalog-audit/doctor의 enabled 게이트 면제**: `config.enabled === false`여도 status/list처럼 실행 허용 — 외부 발행이 없는 읽기 전용 진단이기 때문이다.
- `catalog-audit --update-snapshot`이 test fixture를 재작성하는 것은 dev 도구 동작이며 "테스트가 스스로 fixture를 고쳐 통과" 패턴이 아니다 — 테스트 본체는 절대 fixture를 쓰지 않는다.
- STEP 0 죽은 코드 정리는 직접 수정하는 함수 내부로 한정. 커밋은 Orchestrator가 수행 — Generator는 커밋하지 않는다.

### Reference-only values (인용만, 새 엔티티 생성·편집 금지)

- 정본 패키지 `vibe-doctor-mcp-write-improvement-v1.8.0/**` 전체 — 읽기 전용.
- MCP-005·007 산출물(OAuth scope enforcement, securitySchemes, `_meta["mcp/www_authenticate"]`, golden prompt dataset, persistent connect code) — 언급 가능, **구현 금지** (vpb-12 소관).
- 04 §4의 scope 이름 5종(`bridge.request.read`, `bridge.request.write`, `bridge.result.read`, `bridge.result.write`, `bridge.import.ack`) — 이번 Sprint에서는 **advisory 메타데이터 문자열**로만 사용.
- 04 §5 OAuth 재인가(www_authenticate·insufficient_scope)와 04 §4 securitySchemes — 문서 인용만, 코드 금지.
- 06 §6 Inspector workflow·Developer Mode golden prompt — 문서(setup.md)에 절차로 기술 가능, 자동화 금지.
- v1.8.0 commit `6051105`, vpb-10 commit — 문서 인용용.
- `docs/plans/**` 설치 패키지 — 읽기 전용.

### Proof predicates (공개 계약보다 강하지 않게, 아래가 전부)

Orchestrator가 샌드박스 밖에서 실행 (Generator는 static 확인만):

1. `npm run vibe:typecheck` → exit 0.
2. `npm run vibe:self-test` → exit 0 (726 baseline + 신규 — publish/identity/lifecycle/health/importer/e2e 로스터 무손상).
3. targeted: `node --import tsx --test .vibe/harness/test/pro-bridge-catalog.test.ts .vibe/harness/test/pro-bridge-doctor.test.ts .vibe/harness/test/pro-bridge-mailbox.test.ts .vibe/harness/test/pro-bridge-mcp-server.test.ts .vibe/harness/test/pro-bridge-command.test.ts .vibe/harness/test/pro-bridge-publish.test.ts` → exit 0, Tests to add의 **리터럴 케이스명 23종 전부** 출력에 존재, publish.test.ts 무변경 통과.
4. `node .vibe/harness/scripts/vibe-pro-bridge.mjs catalog-audit` → exit 0 (실 카탈로그 14툴 + 커밋된 snapshot 일치 + rule finding 0).
5. grep: `rg "bridge_capabilities" .vibe/harness/src/pro-bridge/mailbox/tools.ts` ≥1. `rg "TOOL_CATALOG_VERSION" .vibe/harness/src/pro-bridge/mailbox` ≥1. `rg "catalog-audit|'doctor'" .vibe/harness/src/commands/pro-bridge.ts` ≥1. `rg "outputSchema" .vibe/harness/src/pro-bridge/mailbox/server.ts` ≥1. `rg -c "Use this" .vibe/harness/src/pro-bridge/mailbox/tools.ts` ≥14.
6. doctor 리터럴: `rg "publish_review_package missing" .vibe/harness/src/commands/pro-bridge.ts` ≥1. `rg "redeploy and Refresh the ChatGPT developer-mode app" .vibe/harness/src/commands/pro-bridge.ts` ≥1. `rg "Expected tool catalog" .vibe/harness/src/commands/pro-bridge.ts` ≥1.
7. enumerable 교정: `rg "defineProperty" .vibe/harness/src/lib/config.ts` → 0 매치 (publishLimits 관련 블록 제거 확인; 다른 defineProperty가 원래 없음을 전제 — 있으면 라인 명시 보고).
8. 불변 파일 회귀 가드: `git diff -- .vibe/harness/src/pro-bridge/mailbox/store.ts .vibe/harness/src/pro-bridge/prompt-composer.ts .vibe/harness/src/pro-bridge/importer.ts .vibe/harness/src/pro-bridge/contract.ts .vibe/harness/src/pro-bridge/vibe-bundle.ts .vibe/harness/src/pro-bridge/scope-resolver.ts .vibe/harness/src/pro-bridge/mailbox/tunnel.ts .vibe/harness/src/pro-bridge/transports .vibe/harness/src/pro-bridge/goal-source .vibe/harness/test/pro-bridge-publish.test.ts package.json .vibe/config.json .claude/settings.json` → 빈 출력.
9. 신규 스크립트 0: `git status --porcelain -- .vibe/harness/scripts` → 빈 출력. `git status --porcelain -- docs/plans vibe-doctor-mcp-write-improvement-v1.8.0` → 빈 출력.
10. 기존 13툴 이름 + bridge_capabilities 전부 잔존: `rg "'(create_request|create_design_request|list_pending_requests|get_request|claim_request|publish_review_package|begin_result|put_result_file|finalize_result|get_result_manifest|get_result_file|acknowledge_import|cancel_request|bridge_capabilities)'" .vibe/harness/src/pro-bridge/mailbox/tools.ts` → 14종 전부 매치.

### Current proof and non-proof

Generator Final report는 증거를 반드시 두 칸으로 분리한다: **fresh evidence**(이번 세션에서 실제 확인한 것 — Windows sandbox 특성상 대부분 static inspection과 grep)와 **non-proof**(skipped / blocked / inferred / proxy / historical — 예: "테스트는 작성했으나 실행하지 못함, Orchestrator 실행 대기"). 실행하지 못한 검증을 통과로 표기하는 것을 금지한다. snapshot fixture는 Generator가 손으로 계산해 커밋하되, 해시 필드가 실행 없이는 검증 불가함을 non-proof로 명시하고 **Orchestrator가 `catalog-audit --update-snapshot`으로 재생성 후 diff 0을 확인**하는 절차를 report에 제안하라.

---

## 필수 참조 (구현 전 읽기 순서)

1. `vibe-doctor-mcp-write-improvement-v1.8.0/specs/MCP-004-tool-metadata-and-visibility.md`, `specs/MCP-006-capabilities-doctor-refresh.md` — DoD 2종.
2. `vibe-doctor-mcp-write-improvement-v1.8.0/04_METADATA_AUTH_PERMISSION_SPEC.md` — §1 annotations, §2 visibility, §3 structured outputs 필드, §6 분류 규칙, §7 audit 항목. §4~5(OAuth)는 경계 확인용으로만.
3. `vibe-doctor-mcp-write-improvement-v1.8.0/06_DIAGNOSTICS_AND_APP_REFRESH.md` — §1 BridgeCapabilities 타입 리터럴, §2 doctor 체크·출력 예시 리터럴, §3 버전 권고, §4 Refresh 절차, §5 앱 권한, §7 stale 감지 handoff 문구.
4. `vibe-doctor-mcp-write-improvement-v1.8.0/02_TOOL_CATALOG_ASIS_TOBE.md` — §2 툴별 메타데이터 매트릭스(annotation 정답표), §3 description 리터럴(acknowledge_import·cancel_request 이번 적용), §4 프로파일 지침.
5. `vibe-doctor-mcp-write-improvement-v1.8.0/prompt/UPSTREAM_IMPLEMENTATION_PROMPT.md` — MCP-004·006 절 + 상위 불변(기존 툴 유지, hook 무결합, push/배포 금지).
6. 현행 구현 anchor (라인은 2026-07-16 main 기준):
   - `.vibe/harness/src/pro-bridge/mailbox/tools.ts` — `McpToolDefinition`(39~45: annotations가 `{ readOnlyHint }`뿐 — 이번에 전체형으로), `definition()`(163~189: readOnly true일 때만 annotations 부착 — 개편 대상), `jsonSchema()`(156~161: outputSchema에 재사용), 카탈로그 순서(203~445), `WEB_PUBLICATION_PROMPT`(147~154 — 불변), `INJECTION_DEFENSE`/`WRITE_SCOPE`(23~25 — 불변).
   - `.vibe/harness/src/pro-bridge/mailbox/server.ts` — tools/list(281~295: annotations만 조건부 노출 — serializer 경유로 교체), tools/call(296~323: 성공 시 structuredContent 병기 지점 306~309), serverInfo 기본값(200).
   - `.vibe/harness/src/pro-bridge/mailbox/store.ts`(**읽기 전용**) — `PublishReceipt`(134~145), `ChunkedUploadRequired`(147~156), `PublicationConflict`(158~169), `MailboxRequestStatus`(171~179), `MailboxHealth`(205~208), `publishReviewPackage`(1262~) — output zod의 `satisfies z.ZodType<...>` 대조원.
   - `.vibe/harness/src/commands/pro-bridge.ts` — `ProBridgeDeps.fetchPort`(130)·`io`(106~110)·`git`(113) 주입 seam, `gitHead()`(409~428), `createGit()`(352~358), enabled 게이트(1359~1362), 커맨드 라우팅(1364~1450: usage 1448), `runMcpServer`(1204~1264: createMailboxTools 호출 1223~1227, mcp-mailbox 발행 출력 블록 584~588 — handoff 경고 추가 지점).
   - `.vibe/harness/src/lib/config.ts` — `resolveProBridgeMcpConfig`(158~188: defineProperty 블록 180~186 교정 대상).
   - `.vibe/harness/scripts/vibe-pro-bridge.mjs` — 인자 패스스루 래퍼 (무수정으로 서브커맨드 동작).
7. 기존 테스트 anchor: `pro-bridge-mailbox.test.ts`(444~472 publish limits 케이스 — 458 enumerable assert, 474~488 thirteen tools 케이스, 482 INJECTION_DEFENSE 전수 grep, 490~ fallback description 케이스 — 무변경 통과 대상), `pro-bridge-mcp-server.test.ts`(145~157 rpc/callTool 헬퍼 — content[0].text 파싱이라 structuredContent 병기에 안전, 311~319 tools/list 13 케이스), `pro-bridge-command.test.ts`(596 legacy mcp deepEqual), `test/helpers/pro-bridge-result-fixture.ts`(`buildCompliantResultBundle` — outputSchema 왕복 테스트의 파일 세트로 재사용).
8. `docs/context/pro-bridge-setup.md` — 현행 절 구성(§1~5, 포트, Web-origin, 옵션 어댑터). `.claude/skills/vibe-goal-audit/SKILL.md` — 현행 절 구성.

---

## 기술 사양

### A. MCP-004 — McpToolDefinition 전체형 + definition() 개편

**A-1. 인터페이스 (tools.ts)**:

```ts
export interface McpToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
  idempotentHint?: true;            // true일 때만 존재 (스펙: "where true")
}
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;   // 필수화
  annotations: McpToolAnnotations;         // 필수화
  _meta: {
    ui: { visibility: readonly string[] }; // 전 툴 ['model','app']
    'vibe/requiredScopes': readonly string[];  // 자리 — advisory
  };
  invoke(args: unknown): Promise<unknown>;
}
```

`definition()` 입력에 `output: z.ZodTypeAny`, `annotations`(또는 분류 프리셋), `requiredScopes: readonly string[]`를 추가하고 `readOnly?: boolean` 단일 플래그를 대체한다. description 결합 규칙(summary + WRITE_SCOPE(비-readOnly만) + INJECTION_DEFENSE)은 유지.

**A-2. annotation 정답표 (02 §2 매트릭스 — audit·snapshot·테스트가 전부 이 표를 대조)**:

| tool | readOnly | destructive | openWorld | idempotentHint | requiredScopes (advisory) |
|---|---|---|---|---|---|
| list_pending_requests | true | false | false | true | `['bridge.request.read']` |
| get_request | true | false | false | true | `['bridge.request.read']` |
| get_result_manifest | true | false | false | true | `['bridge.result.read']` |
| get_result_file | true | false | false | true | `['bridge.result.read']` |
| bridge_capabilities | true | false | false | true | `[]` (scope-free handshake) |
| create_request | false | false | false | true | `['bridge.request.write']` |
| create_design_request | false | false | false | true | `['bridge.request.write']` |
| claim_request | false | false | false | **생략** (conditional) | `['bridge.request.write']` |
| publish_review_package | false | false | false | true | `['bridge.result.write']` |
| begin_result | false | false | false | true | `['bridge.result.write']` |
| put_result_file | false | false | false | true | `['bridge.result.write']` |
| finalize_result | false | false | false | true | `['bridge.result.write']` |
| acknowledge_import | false | false | false | true | `['bridge.import.ack']` |
| cancel_request | false | **true** | false | true | `['bridge.request.write']` |

**A-3. description 재작성**. 규칙: `/^Use this (when|only|after)/` prefix + 금지/비대상 케이스 문장 + 기존 의미 보존. **리터럴 고정 6종**(변경/유지):
- `publish_review_package`, `begin_result`, `put_result_file` — 현행 그대로 (vpb-10 리터럴, 무변경).
- `finalize_result` — 현행 그대로 + 해시 생략 문장 보존.
- `acknowledge_import` (02 §3 리터럴로 교체): "Use this after the local CLI importer has successfully installed and verified the exact result package. Do not use it merely because a Web review finished."
- `cancel_request` (02 §3 리터럴로 교체): "Use this only when the user explicitly asks to cancel a non-terminal request. Do not use it to restart, revise, or replace a review."

나머지 8종(create_request, create_design_request, list_pending_requests, get_request, claim_request, get_result_manifest, get_result_file, bridge_capabilities)은 아래 **권장 초안**을 기반으로 규격 준수 하에 조정 허용 (스냅샷이 최종 텍스트를 고정한다):
- create_request: "Use this when the Vibe CLI must register a prepared review request packet in the bridge mailbox. Do not compose request payloads by hand in chat; the CLI builds and hashes the packet."
- create_design_request: "Use this when the user asks in chat to design a new feature for a GitHub repository and no mailbox request exists yet. Repository, branch, and goal are user chat instructions; headSha must be the actual commit researched on GitHub. Do not invent or guess commit SHAs."
- list_pending_requests: "Use this when you need to discover open bridge work; it lists non-terminal requests newest-first. Do not use it to read a request body; call get_request."
- get_request: "Use this when starting or resuming a review to read one complete request, including its review prompt and completion contract. Do not substitute chat summaries for this request body."
- claim_request: "Use this when you are about to review a ready request and must claim it for one review session. Do not claim requests you will not review now."
- get_result_manifest: "Use this when you need the current finalized result manifest for a request. Do not call it to check progress; it returns an empty manifest until finalize succeeds."
- get_result_file: "Use this when you need to read back a UTF-8 result file listed by the current manifest. Do not use it to read repository sources."
- bridge_capabilities: "Use this when you need to check whether result writing is enabled, which tool publishes packages, the package limits, and the tool catalog version. Do not infer write support from the catalog shape."

**A-4. outputSchema — zod 파생 + 타입 동기 강제**. 각 툴의 invoke 실제 반환 형태와 정확히 일치하는 zod 스키마를 tools.ts에 정의하고 `jsonSchema()`로 직렬화해 `outputSchema`에 넣는다. 드리프트 방지 장치 필수: store 반환 타입이 있는 것은 `const PublishOutput = z.discriminatedUnion(...) satisfies z.ZodType<PublishReceipt | ChunkedUploadRequired | PublicationConflict>` 패턴으로 tsc가 어긋남을 잡게 한다(모든 store 타입은 `import type`). 툴별 반환의 근원: create_request/claim_request → store 메서드 반환 인터페이스(store.ts에서 실측), list_pending_requests → `{ requests: MailboxRequestStatus[] }`, get_request → `ReviewRequestSchema.extend({ completionContract: ... })`(strict 유지 — completionContract 형태는 vpb-10 구현 실측), publish → 3-way union(anyOf 허용 — Explicit exceptions 참조), begin/put/finalize → store 반환 실측, get_result_manifest → `{ manifest: ReviewResultManifestSchema.nullable() }`, get_result_file → `{ path, content, sha256 }`, acknowledge_import → `{ acknowledged: true }`, cancel_request → `{ cancelled: true }`, bridge_capabilities → C절. create_design_request는 created/기존 분기 union — 실제 두 반환 지점(228~234, 285~291)을 실측해 정확히 덮어라. 스키마가 서술을 못 하는 반환이 발견되면 **코드를 고치지 말고** 스키마를 실제 형태에 맞춰라 (invoke 행동 불변 원칙).

**A-5. wire 직렬화 + server.ts**. `serializeToolDescriptor(tool): { name, description, inputSchema, outputSchema, annotations, _meta }`를 tools.ts에서 export하고 server.ts tools/list가 이를 사용한다(281~295의 조건부 annotations 로직 대체). tools/call 성공 응답은 `{ content: [{ type: 'text', text }], structuredContent: result, isError: false }` — 에러 응답 형태 불변. serverInfo 기본 version을 `String(TOOL_CATALOG_VERSION)`으로 올리는 것은 허용(테스트 핀 여부 확인 후)이며 필수 아님.

### B. 카탈로그 audit + snapshot (04 §7)

**B-1. 검사기 (tools.ts export)**: `auditToolCatalog(descriptors: unknown[]): CatalogAuditFinding[]` — `{ tool: string; rule: string; message: string }[]`, tool→rule 순 정렬로 결정적. 입력은 wire 형태(unknown 관용 — doctor가 raw JSON을 그대로 먹인다). 규칙(id 고정):
- `missing-tool` — `MAILBOX_TOOL_NAMES`(14종 readonly tuple export) 중 부재.
- `missing-annotations` — readOnlyHint/destructiveHint/openWorldHint 중 boolean 아닌 것.
- `write-tool-readonly` / `read-tool-not-readonly` — A-2 표와 readOnlyHint 불일치.
- `destructive-misclassified` — cancel_request 외 destructive true, 또는 cancel_request가 false.
- `missing-output-schema` — outputSchema 부재 또는 object/anyOf-of-objects가 아님.
- `missing-model-visibility` — `_meta.ui.visibility`에 'model' 또는 'app' 부재.
- `missing-auth-scope-meta` — `_meta['vibe/requiredScopes']`가 배열이 아님 (빈 배열은 통과 — capabilities).
- `missing-fallback-restriction` — begin/put/finalize description에 `Use this only` 또는 `publish_review_package` 부재.
- `description-format` — `/^Use this (when|only|after)/` prefix 불일치.
idempotentHint 정오는 rule이 아니라 **snapshot**이 고정한다 (규칙 일반화 대신 정답표 대조).

**B-2. snapshot**: `buildCatalogSnapshot(descriptors): CatalogSnapshot` — `{ schemaVersion: 'vibe-pro-bridge-catalog-snapshot-v1', toolCatalogVersion: 2, tools: [{ name, description, annotations, visibility, requiredScopes, inputSchemaSha256, outputSchemaSha256 }] }`. 해시는 `sha256(JSON.stringify(schema))` — 단일 코드 경로라 결정적. fixture는 `.vibe/harness/test/fixtures/pro-bridge-catalog-snapshot.json`에 2-space indent + trailing newline으로 커밋 (review용 정본이며 runtime authority 아님 — 04 §7 문장 그대로).

**B-3. `catalog-audit` 서브커맨드 (commands/pro-bridge.ts)**: 로컬 카탈로그 구성(`createMailboxTools(new MailboxStore({ repoRoot, now }))` — invoke 미호출·mailbox 무변경, 구성이 순수함을 확인하고 report에 명시) → serialize → audit + snapshot 대조. 출력: finding별 `[FAIL] <tool>: <rule> — <message>`, 전부 통과 시 `[PASS] catalog audit: 14 tools, 0 findings, snapshot match`. 옵션: `--snapshot <path>`(기본 fixture 경로), `--update-snapshot`(fixture 재작성 + 경로 출력, exit 0), `--json`(findings JSON). exit: finding>0 ∨ snapshot 불일치 ∨ snapshot 부재 → 1.

### C. MCP-006 — `bridge_capabilities` 툴

`MailboxToolOptions`에 `serverBuildSha?: string` 추가(기본 `'unknown'`). tools.ts에 `TOOL_CATALOG_VERSION = 2` export. 카탈로그 위치: **get_result_file 뒤, acknowledge_import 앞** (고정 — 테스트 리터럴 대조). 반환 (06 §1 필드명 리터럴):

```ts
{
  protocolVersion: 'vibe-pro-bridge-v1',
  serverBuildSha: options.serverBuildSha ?? 'unknown',
  toolCatalogVersion: String(TOOL_CATALOG_VERSION),      // '2' — 06 §1 타입이 string
  resultWriteEnabled: true,
  primaryResultWriteTool: 'publish_review_package',
  normalPackageLimits: {
    maxFiles: limits.maxFiles,
    maxTotalBytes: limits.maxTotalBytes,
    maxSingleFileBytes: limits.maxFileBytes,             // wire 이름은 스펙 리터럴
  },
  chunkedUploadEnabled: true,
  authMode: 'noauth-local',                              // OAuth 프로파일은 vpb-12
  requiredScopes: {
    reviewRead: ['bridge.request.read'],
    resultWrite: ['bridge.result.write'],
    importAck: ['bridge.result.read', 'bridge.import.ack'],
  },
  supportedRequestKinds: ReviewKindSchema.options,        // 4종
}
```

input은 `z.object({}).strict()`. `runMcpServer`에서 `serverBuildSha`를 `gitHead(createGit(repoRoot, deps.git))` 성공 시 그 SHA, 실패 시 `'unknown'`으로 해석해 `createMailboxTools` 옵션으로 주입한다.

### D. doctor 서브커맨드 (06 §2)

`vibe-pro-bridge.mjs doctor <connector-url>` — URL 필수(부재 시 usage + catalog-audit 안내, exit 1). `deps.fetchPort ?? fetch`로 순차 POST (Origin 헤더 없음, `AbortSignal.timeout(10_000)`):
1. `initialize` (protocolVersion '2025-06-18') — 실패/HTTP 401/네트워크 오류 → `[FAIL] MCP endpoint unreachable: <reason>` (401은 connector URL의 `?code=` 확인 힌트 병기), exit 1.
2. `tools/list` — 로컬 기대 카탈로그(catalog-audit와 동일 구성 경로; descriptor는 config 무관해 결정적)와 대조: 툴별 이름/annotations/`_meta`/description/inputSchema·outputSchema 해시 완전 일치 → `[PASS] <name>`, 불일치 → `[FAIL] <name>: <first mismatch>`. 기대 툴 부재 → `[FAIL] <name> missing` — **publish_review_package 부재는 반드시 리터럴 `[FAIL] publish_review_package missing`** (06 §2 출력 예시 그대로). 서버에만 있는 잉여 툴 → `[WARN] unexpected tool <name>`.
3. `tools/call bridge_capabilities` — 성공 시 toolCatalogVersion 대조: 불일치 → `[WARN] server catalog v<served>, skill expects v<local>` + `[ACTION] redeploy and Refresh the ChatGPT developer-mode app` (리터럴). 툴 자체가 없으면 2에서 이미 FAIL — 여기서는 스킵 사유만 출력.
raw audit도 병행: 수신 descriptors를 `auditToolCatalog`에 통과시켜 finding을 `[FAIL]`로 병합. exit: FAIL ≥1 → 1, WARN만 → 0. OAuth metadata 도달성 체크는 vpb-12 — `[WARN] oauth metadata check skipped (noauth-local profile)` 한 줄로 자리 표시. **어떤 훅·정기 QA에도 연결 금지, 명시 호출 전용.** enabled 게이트 면제(catalog-audit 동일).

### E. handoff 경고 + 문서 + 스킬

- **createAndPublish mcp-mailbox 출력 블록**(commands/pro-bridge.ts 584~588)에 추가: `Expected tool catalog: 2` + "publish_review_package가 웹 대화에 없으면 리뷰 시작 전에 앱을 Refresh 하세요 (doctor로 진단)." (06 §7 취지, 첫 줄은 영문 리터럴 유지 — doctor/테스트가 grep).
- **`docs/context/pro-bridge-setup.md`**: ① 신규 절 "도구 카탈로그 진단 (doctor / catalog-audit)" — 사용법, connector URL 재사용과 code 세션 의미 1줄, hook 무결합 명시. ② 신규 절 "ChatGPT 메타데이터 Refresh" — 06 §4 7단계(deploy/restart → Settings > Plugins → 앱 열기 → Refresh → 툴 목록 확인 → 새 대화 → 앱 attach → golden prompt 재실행) + published plugin은 새 metadata snapshot 재심사 필요 문장 + 권장 앱 권한 "Ask before making changes"(신뢰 후 "Ask only before important changes"). ③ §4에 카탈로그 버전(2)과 doctor 선진단 권고 한 줄. 한국어 톤 유지.
- **`.claude/skills/vibe-goal-audit/SKILL.md`**: 문서 말미에 "## 진단 doctor" 절 추가만 — `$vibe-goal-audit doctor` = `node .vibe/harness/scripts/vibe-pro-bridge.mjs doctor "<connector-url>"`, 무엇을 진단하는지 3~4줄, `[FAIL] publish_review_package missing`이면 Refresh(setup.md 참조), 정적 검사는 `catalog-audit`, 명시 호출 전용(hook/QA 무결합) 1줄.

### F. carry-over — publishLimits enumerable 교정

`resolveProBridgeMcpConfig`(config.ts 158~188)에서 `Object.defineProperty(resolved, 'publishLimits', { enumerable: false, ... })` 블록과 "Keep legacy enumerable..." 주석을 제거하고 `return { port, tunnel, publishLimits }` 평범한 enumerable 필드로 반환한다. **가드 주석이 아니라 실제 교정을 선택한 근거**: spread(`{...config.mcp}`)와 JSON 직렬화(`JSON.parse(JSON.stringify(config))`) 두 복제 경로에서 조용히 탈락하는 실전 잠복점이며, 비열거에 의존하는 소비자는 `pro-bridge-command.test.ts:596`의 deepEqual 1곳뿐이다(grep으로 재확인해 보고). 갱신: 596 deepEqual에 `publishLimits: { maxFiles: 32, maxTotalBytes: 131072, maxFileBytes: 49152 }` 포함, mailbox 458 assert를 `true`로 교체, 신규 회귀 테스트 T22(clone/spread 생존).

### G. MCP별 closure 매핑 표

| Spec | 구현 지점 (파일:심볼) | 복원되는 설계 불변식 | Proof |
|---|---|---|---|
| MCP-004 metadata | tools.ts: McpToolDefinition/definition()/output zod/A-2 표; server.ts: serializer + structuredContent | 클라이언트 기본값에 의존하지 않는 명시 카탈로그; 모델이 산문 파싱 없이 구조화 출력 소비 | T1~T5·T20·T21 + predicate 5 |
| MCP-004 audit | tools.ts: auditToolCatalog/buildCatalogSnapshot/MAILBOX_TOOL_NAMES; commands: catalog-audit; fixture | raw tools/list가 승인된 분류 매트릭스와 기계 대조 가능 (DoD) | T8~T11·T17~T19 + predicate 4 |
| MCP-006 capabilities | tools.ts: bridge_capabilities + TOOL_CATALOG_VERSION; commands: serverBuildSha 주입 | write 지원을 카탈로그 형태에서 추론하지 않고 핸드셰이크로 확인 | T6~T7·T21 + predicate 5 |
| MCP-006 doctor/refresh | commands: doctor; setup.md Refresh 절; SKILL.md doctor 절; handoff 경고 | 긴 리뷰 시작 전 publish 툴 부재를 CLI가 식별 (DoD); stale 앱 즉시 진단 | T12~T16·T23 + predicate 6 |
| carry-over | config.ts: enumerable 교정 | config 복제 경로에서 publishLimits 무손실 | T22 + predicate 7 |

### H. 범위 아님 (vpb-12 + residual)

- MCP-005 전부: OAuth 프로파일, per-tool securitySchemes, scope enforcement, `_meta["mcp/www_authenticate"]`, insufficient_scope challenge.
- MCP-007 golden prompt dataset·tool-selection 회귀, persistent connect code·고정 터널 도메인(사용자 요청분).
- doctor의 OAuth metadata 도달성 실검사(자리 WARN만), 실 ChatGPT Developer Mode Refresh 실행(사용자 참여), Inspector 실행 증거(release closure), v1.8.1 release.
- outputSchema anyOf가 특정 클라이언트에서 거부될 경우의 평탄화 (residual로 보고).

---

## Tests to add

node:test `describe`/`it`, 주입 `now`, `mkdtemp` 임시 루트, 실 sleep·외부 네트워크 금지(로컬 포트 0 실서버는 허용 — `pro-bridge-mcp-server.test.ts` fixture 패턴 재사용). **아래 `it()` 케이스명 23종은 리터럴로 고정한다** (Orchestrator가 출력에서 grep으로 대조).

`pro-bridge-catalog.test.ts` (신규, T1~T11):
1. `declares the approved annotation matrix on every tool` — A-2 표 전체를 툴별 deep-equal (claim_request는 idempotentHint 부재까지)
2. `declares model and app visibility and scope metadata on every tool`
3. `declares an output schema on every tool with object or union shape`
4. `accepts real tool results with each declared output schema` — 실제 invoke 결과(list/get_request/publish receipt/fallback 응답/get_result_manifest/get_result_file/acknowledge_import/cancel_request/bridge_capabilities)를 각 툴의 zod output 스키마 strict parse로 왕복 — `buildCompliantResultBundle` 재사용
5. `starts every tool description with the use-this contract` — 14종 전부 `/^Use this (when|only|after)/`
6. `keeps the pinned description literals for the terminal tools` — acknowledge_import·cancel_request 02 §3 리터럴 + publish/begin/put 기존 리터럴 + finalize 해시 생략 문장 잔존
7. `reports bridge capabilities with catalog version limits and scopes` — 전 필드 assert, `maxSingleFileBytes` 매핑 포함, 주입 publishLimits 반영
8. `derives the server build sha from the injected option` — 옵션 주입 시 그 값, 미주입 시 `'unknown'`
9. `passes the deterministic catalog audit with zero findings`
10. `fails the catalog audit on each seeded misclassification` — 변조 descriptor 7종(annotation 삭제·write RO 표기·비-cancel destructive·outputSchema 삭제·visibility 삭제·scope 메타 삭제·fallback 문구 삭제) 각각 정확한 rule id
11. `matches the committed catalog snapshot fixture` — buildCatalogSnapshot vs fixture deep-equal

`pro-bridge-doctor.test.ts` (신규, T12~T19):
12. `passes the doctor against a live compliant server` — startMcpServer(port 0) + 실 fetch → exit 0 + `[PASS] publish_review_package` 출력
13. `fails the doctor when the publish tool is missing` — publish 제외 툴 배열로 서버 기동 → exit 1 + 리터럴 `publish_review_package missing`
14. `warns on a tool catalog version mismatch with a refresh action` — capabilities가 v1을 반환하는 stub 툴 → `[WARN] server catalog v1, skill expects v2` + `[ACTION]` 라인, 다른 FAIL 없으면 exit 0
15. `fails the doctor when the endpoint is unreachable` — 거부 fetch 주입 → exit 1 + unreachable 메시지
16. `fails the doctor when served annotations drift from the expected catalog` — annotations 변조 서버 → exit 1
17. `runs the catalog audit subcommand cleanly against the committed snapshot` — `runProBridge(['catalog-audit'], …)` exit 0
18. `fails the catalog audit subcommand when the snapshot drifts` — `--snapshot <변조 임시 파일>` → exit 1
19. `rewrites the snapshot fixture when update is requested` — `--update-snapshot --snapshot <임시 경로>` → 파일 생성 + 내용 일치 + exit 0

`pro-bridge-mcp-server.test.ts` (T20~T21 + 기존 갱신):
20. `returns structured content alongside text for tool calls` — structuredContent가 JSON.parse(content[0].text)와 deep-equal
21. `serves bridge capabilities over tools call` — rpc 왕복, toolCatalogVersion '2'
- 기존 `lists the mailbox tools over tools list` — 13→14 + 전 툴 annotations/outputSchema/_meta 존재 assert 추가 (의도된 전환)

`pro-bridge-command.test.ts` (T22~T23 + 기존 갱신):
22. `keeps publish limits enumerable across clone and spread` — `JSON.parse(JSON.stringify(resolved)).mcp.publishLimits`와 `{ ...resolved.mcp }.publishLimits` 모두 생존
23. `prints the expected tool catalog version in the mailbox handoff` — mcp-mailbox 발행 경로 출력에 `Expected tool catalog: 2`
- 기존 596 deepEqual — publishLimits 포함으로 갱신 (의도된 전환)

`pro-bridge-mailbox.test.ts` (기존 갱신만):
- `exposes thirteen tools with publish_review_package before the fallback uploaders` → `exposes fourteen tools with bridge_capabilities before the import closers`로 개명 + 14종 배열(bridge_capabilities는 get_result_file 뒤) + readOnly 필터 5종
- `announces the publish limits in the get_request completion contract` 내 458 enumerable assert → `true`

공통 원칙: 리터럴 메시지는 리터럴로 assert. doctor 테스트는 io 캡처 주입(`ProBridgeIo`)으로 stdout 라인 대조. 시간 전부 주입. `pro-bridge-publish.test.ts`는 손대지 않는다.

---

## 실행 제약

- **Windows sandbox**: Generator는 npm/네트워크/테스트 실행 불가 — static inspection과 코드 작성만. 실행 검증(typecheck/self-test/targeted/catalog-audit)은 Orchestrator가 수행한다. 실행하지 못한 검증을 통과로 보고하지 말 것.
- **신규 의존성 0, 신규 스크립트 파일 0, 신규 npm 스크립트 0.** `package.json` 무변경. 해시는 `node:crypto`만. fetch는 전역 fetch + 주입 seam.
- NodeNext ESM — 상대 import는 `.js` 확장자. UTF-8 (BOM 없음). CLI 사용자 메시지는 한국어 톤 유지하되 doctor/audit의 `[PASS]/[FAIL]/[WARN]/[ACTION]` 라인은 스펙 예시 영문 리터럴.
- 테스트는 `.vibe/harness/test/` 직속 `*.test.ts` (self-test glob 자동 포함). fixture는 `test/fixtures/` 하위.
- 예상 규모 ~600 LOC (테스트 포함) — 상한이 아니라 규모 감각이다. 계약 충족과 vpb-10 불변식 보존이 우선.

---

## 완료 체크리스트 (Verification)

### 기계 검증 (Orchestrator 실행)

- [ ] `npm run vibe:typecheck` exit 0
- [ ] `npm run vibe:self-test` exit 0 (publish·identity·lifecycle·health·importer·e2e 로스터 무손상)
- [ ] targeted 6파일 exit 0 + 리터럴 케이스명 23종 전부 출력에 존재 + `pro-bridge-publish.test.ts` 무변경 통과 (predicate 3)
- [ ] `vibe-pro-bridge.mjs catalog-audit` exit 0 — 14툴·finding 0·snapshot 일치 (predicate 4). 이어서 `--update-snapshot` 재생성 후 `git diff` 0 확인 (Generator 수기 해시 검증)
- [ ] grep 세트: bridge_capabilities / TOOL_CATALOG_VERSION / doctor·catalog-audit / server outputSchema / "Use this" ≥14 (predicate 5)
- [ ] doctor 리터럴 3종 grep (predicate 6) + defineProperty 0 매치 (predicate 7)
- [ ] 불변 파일 git diff 빈 출력 — store/composer/importer/contract/vibe-bundle/scope-resolver/tunnel/transports/goal-source/publish.test/package.json/config.json/settings.json (predicate 8)
- [ ] 신규 스크립트 0 + docs/plans·정본 패키지 무변경 (predicate 9) + 14툴 이름 grep (predicate 10)

### Inspection / demo AC (Orchestrator·Evaluator·사용자)

- [ ] **모델-facing 표면 transcript 3종 확보** (CLI/프로토콜 제품의 identity/payoff 증거): ① 로컬 실서버 raw tools/list JSON — 14툴 전부 annotations·outputSchema·_meta 노출, ② doctor PASS transcript(live 서버), ③ doctor FAIL transcript(`publish_review_package missing` 리터럴 포함). targeted 테스트 출력 또는 로컬 기동 왕복으로 채취.
- [ ] 검증 비약화 (Evaluator 대조): 기존 13툴의 invoke 행동·inputSchema·store 호출이 정말 무변경인가(diff 검토). structuredContent 병기가 에러 응답 형태를 건드리지 않는가. audit 규칙이 A-2 표와 스냅샷을 이중으로 덮되 서로 모순되지 않는가.
- [ ] hook 무결합 (Evaluator 대조): doctor/catalog-audit가 어떤 훅·정기 QA·sprint 스크립트에도 연결되지 않았는가 (`.claude/settings.json`·scripts diff 0).
- [ ] scope 메타 advisory 경계 (Evaluator 대조): enforcement 코드가 한 줄도 없는가 — vpb-12 침범 여부.
- [ ] description 품질 (Evaluator 대조): 8종 초안 조정분이 prefix 규칙 + 금지 문장 + 기존 의미(특히 create_design_request headSha 실측)를 보존하는가.
- [ ] 실 ChatGPT Developer Mode Refresh + doctor 실행 — **사용자 참여 항목, 이번 Sprint 범위 밖** (roadmap 종료 조건 1에 따라 분리 보고).
- [ ] >5 파일이므로 **Evaluator 소환은 Must**.

---

## Final report 요구 (Generator 출력 필수 형식)

1. **`## Wiring Integration`** — `.vibe/agent/_common-rules.md` §14 W1~W14 각 항목 `touched / n/a / skipped+reason`. 힌트: 신규 파일 3종(test 2 + fixture 1)은 `.vibe/harness/{src,test}/**` sync-manifest glob 포함 여부를 확인해 보고(W2), SKILL.md 변경은 skill wiring 항목으로 보고, 신규 export(`bridge_capabilities` 등록, `TOOL_CATALOG_VERSION`, `MAILBOX_TOOL_NAMES`, `serializeToolDescriptor`, `auditToolCatalog`, `buildCatalogSnapshot`, `MailboxToolOptions.serverBuildSha`)에 `verified-callers:` 명시(grep으로 확인한 실제 import·호출 지점). 삭제/개명 없음이면 D1~D6 n/a.
2. **MCP-004·006별 closure 증거** — 각각: status (closed-in-code / partial) / files and symbols changed / DoD 충족 근거 (MCP-004: "raw tools/list가 승인 매트릭스와 일치 — audit·snapshot으로 기계 증명", MCP-006: "doctor가 publish 툴 부재를 리뷰 시작 전에 식별") / targeted tests (리터럴 케이스명) / residual limitation (예: "OAuth 검사·enforcement는 vpb-12", "anyOf outputSchema 클라이언트 수용성 미검증", "실 웹 Refresh는 사용자 항목").
3. **Current proof vs non-proof 분리** — executed-and-passed / executed-and-failed / not-executed / repository-claim-only 4분류로 전 검증 항목 나열. snapshot 해시 수기 계산분은 not-executed로 분류하고 Orchestrator 재생성 절차 명시.
4. **기존 테스트 기대값 변경 목록** — 케이스명 + 변경 전/후 + 검증 약화가 아닌 근거 (13→14툴, readOnly 5종, enumerable true, mcp deepEqual, tools.length 14).
5. **정본 충돌 해소 기록** — description prefix 규칙(02 §3 vs 04 §7) 해석 채택 사실 + 레거시 non-enumerable 소비자 grep 결과.
6. **문서 diff 요약** — `pro-bridge-setup.md`·`SKILL.md` 변경 절별 1줄.
