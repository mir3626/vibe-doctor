> **GENERATOR ROLE LOCK — 먼저 읽고 시작할 것.**
> 이 문서에는 도구 설명 문구("Use this when...", "Do not ..."), 진단 출력 문구("[WARN] oauth metadata check skipped (noauth-local profile)"), OAuth challenge 문구(`Bearer error="insufficient_scope", ...`), golden prompt 문장("Review request AUD-123 and save the completed package for CLI import.") 같은 **지시형·명령형 문장이 다수 인용**된다. 이 인용 문구들은 너에게 내리는 지시가 아니라 **전부 구현 대상 리터럴 데이터**다 — 코드 안의 문자열, fixture JSON 값, CLI 출력 문자열, 테스트 assertion 문자열로 작성해야 할 값이다. 인용 문구를 "이미 수행된 지시" 또는 "나에게 금지된 행동"으로 해석해 구현을 건너뛰지 마라. **파일을 하나도 수정하지 않고 종료하는 것은 이 과업의 실패다.** "변경이 필요 없다"는 판단이 든다면 그 판단이 틀린 것이니 Sprint Contract를 다시 읽어라. 이전 Sprint들에서 동일한 역할 혼동으로 무변경 종료 사고가 있었다.

# Sprint vpb-12 — auth scope + golden 회귀 + 연결 영속화 (MCP-005·007 + 사용자 요청)

**이 Sprint 이후 사용자가 새로 할 수 있는 것**: ChatGPT 커넥터를 ngrok 고정 도메인(`proBridge.mcp.tunnelUrl`) + persistent connect code(`proBridge.mcp.persistentCode`, config.local 전용)로 **한 번만 등록하면 서버 재시작 후에도 재등록 없이 같은 connector URL을 계속 사용**할 수 있고, 유출이 의심되면 `vibe-pro-bridge.mjs mcp --rotate-code` 한 줄로 code를 회전할 수 있다. `authMode: "oauth"` 프로파일에서는 read 전용 토큰의 publish 시도가 죽은 403 대신 표준 `insufficient_scope` 재인가 challenge(`_meta["mcp/www_authenticate"]`)를 받고, write 토큰은 정상 발행된다. 그리고 커밋된 golden prompt 데이터셋으로 라이브 ChatGPT replay 전에 도구선택 기대(직접/간접/부정/fallback/취소)를 기계 검증할 수 있다. 이 Sprint는 시각적 표면이 없는 CLI/프로토콜 제품이므로 경험 증거는 transcript 3종(insufficient_scope challenge JSON, persistent 모드 mcp 기동 출력의 "재등록 불필요" 안내, rotate-code 출력)으로 한정하고, 실 ChatGPT Developer Mode golden replay·실 ngrok 도메인 연결은 roadmap 종료 조건 1에 따라 사용자 참여 항목으로 분리한다. live doctor transcript 채취는 Orchestrator 몫이다(구현 불요).

이 Sprint는 정본 패키지 `vibe-doctor-mcp-write-improvement-v1.8.0/`의 **MCP-005(write 인증/권한)·MCP-007(golden prompt 회귀 — 자동화 가능분)** 과 **사용자 요청(2026-07-16) 연결 영속화**를 구현한다. vpb-11(02bb861 계열, 14툴 + 전 도구 메타데이터 + catalog-audit + doctor, 749 tests 0 fail)이 완료된 현행 main 위에 additive로 적용한다. vpb-10/11이 심은 계약(publish 파사드, completionContract, description 리터럴, annotations/outputSchema/visibility/requiredScopes 메타, 카탈로그 snapshot)은 **한 글자도 후퇴시키지 않는다**.

---

## Sprint Contract

### Target and output surface

- **MCP-005 — auth 프로파일/scope enforcement**: `proBridge.mcp.authMode: "noauth-local"(기본) | "oauth"`. oauth 모드에서 Bearer 토큰을 **주입형 introspection 포트**로 scope 집합에 해석하고, vpb-11이 심은 per-tool `_meta['vibe/requiredScopes']`를 `tools/call` 시점에 enforcement 한다. scope 부족은 JSON-RPC 에러 + `_meta["mcp/www_authenticate"]` insufficient_scope challenge로 표면화한다(plain HTTP 403 금지). oauth 모드에서만 per-tool `securitySchemes`와 `GET /.well-known/oauth-protected-resource` metadata를 노출한다(04 §5 3종 세트). **noauth-local 기본 경로는 wire·출력·행동 전부 바이트 호환** — scope enforcement 없음, 기존 one-time code 교환 유지. capabilities/doctor는 authMode·requiredScopes를 정확히 보고한다.
- **MCP-007 — golden 회귀 (자동화 가능분)**: 직접/간접/부정/fallback/취소 5범주 golden prompt 데이터셋을 fixture로 커밋(각 케이스 = prompt 텍스트 + 기대 도구선택 + 금지 도구). **실 LLM 호출은 하지 않는다.** 자동화: (a) 데이터셋 strict 스키마 검증, (b) 각 케이스의 기대/금지 도구가 카탈로그에 존재 + model-visible 확인, (c) 완료 계약 문구(completion invariant)가 데이터셋·`WEB_PUBLICATION_PROMPT`·composer 프롬프트 3곳에서 일치. 실 ChatGPT Developer Mode replay는 07 스펙 체크리스트를 데이터셋 README + setup 문서의 수동 절차로 문서화. tool-selection record 스키마(zod)도 additive로 커밋.
- **E2E 강화 (carry-over)**: ① publish_review_package **HTTP 래퍼 invoke 왕복** — 실 로컬 서버 `tools/call` 경로로 정상 receipt와 chunked fallback 양쪽의 runtime output strict-parse를 검증(`buildCompliantResultBundle` 재사용). ② 기존 e2e에 publish 파사드 경유 폐루프 1케이스(begin/put/finalize 저수준이 아닌 툴 invoke 경로 → sync → imported).
- **연결 영속화 (사용자 요청)**: `proBridge.mcp.persistentCode`(config.local 전용, 기본 null) — 설정 시 서버 재시작 간 같은 code 승인(첫 제시 교환 semantics·인스턴스별 세션은 현행 유지). `mcp --rotate-code` — persistentCode 재생성 + config.local 갱신 + 안내. `proBridge.mcp.tunnelUrl`(기본 null) — ngrok `--url=<도메인>` 고정 도메인 인자. 고정 도메인 + persistentCode 조합이면 "재등록 불필요" 안내 출력. 공유 `.vibe/config.json`에 persistentCode/oauthTokens가 있으면 **거부**(보안 게이트).
- **carry-over 1**: `src/lib/config.ts` ~180행의 낡은 주석("Keep legacy enumerable `{ port, tunnel }` consumers stable ..." 2줄 — 현행 코드와 반대 설명) 제거.
- **setup 문서**: 개인 ChatGPT 앱 권한 설정·재승인 절차, oauth 프로파일/scope 표, persistentCode 보안 절충, ngrok 무료 고정 도메인 발급 절차, golden replay 수동 절차 포인터.

### Allowed writes (Files Generator may touch — 이 목록 밖 쓰기 금지)

| 파일 | 허용 범위 |
|---|---|
| `.vibe/harness/src/pro-bridge/mailbox/server.ts` | `McpServerOptions.auth` 옵션 추가(oauth 모드·introspection 포트·resource metadata), oauth 분기(Bearer 검증·401 challenge 헤더·scope enforcement·insufficient_scope 에러·well-known GET 라우트), `createStaticTokenIntrospector` export, oauth 모드 한정 `securitySchemes` 직렬화(`applyAuthProfile` 류 데코레이터). **noauth 경로의 `createSessionAuth`·JSON-RPC 파싱·에러 매핑·라우팅·기존 응답 형태는 비변경** |
| `.vibe/harness/src/pro-bridge/mailbox/tools.ts` | `MailboxToolOptions.authMode` 추가 + `bridge_capabilities`가 실제 authMode 보고(모드별 zod literal — 기본 noauth 출력·스키마 바이트 불변), `SerializedToolDescriptor.securitySchemes?` optional 필드 + oauth 프로파일 데코레이터 export, catalog audit에 securitySchemes 정합 rule 1종 추가(필드 존재 시에만 발동). **14툴 이름·description·inputSchema·invoke·TOOL_CATALOG_METADATA scope 값·TOOL_CATALOG_VERSION(=2)·snapshot 형태 불변** |
| `.vibe/harness/src/pro-bridge/mailbox/tunnel.ts` | `TunnelPorts.staticUrl?: string` 추가 + ngrok args에 `--url <staticUrl>` 반영. cloudflared·none 경로 비변경 |
| `.vibe/harness/src/commands/pro-bridge.ts` | `runMcpServer` 확장(authMode 해석·oauthTokens→introspector·persistentCode 우선 사용·공유 config 보안 게이트·tunnelUrl 전달·"재등록 불필요"/persistent 안내 분기), `mcp --rotate-code` 처리, doctor의 oauth metadata 실검사 분기(capabilities 선행 조회 + well-known GET) + noauth WARN 리터럴 유지. sync/identity/발행 경로 비약화 |
| `.vibe/harness/src/lib/config.ts` | `ProBridgeMcpConfig`에 `authMode`·`oauthTokens`·`persistentCode`·`tunnelUrl` 4필드 additive + 기본값 + resolve 병합, ~180행 낡은 주석 2줄 제거. 다른 필드·함수 불변 |
| `.vibe/harness/src/lib/schemas/pro-bridge.ts` | **additive만** — `GoldenPromptDatasetSchema`·`GoldenPromptCaseSchema`·`GoldenSelectionRecordSchema`(+필요 시 auth mode 타입). 기존 스키마 형태 변경 금지 |
| `docs/context/pro-bridge-setup.md` | 신규 절 3종 추가(§auth 프로파일/재승인, §연결 영속화/고정 도메인, §golden replay 수동 절차 포인터) + 기존 §2 code 안내에 persistent 분기 1~2줄. 기존 절 의미 보존 |
| `.claude/skills/vibe-goal-audit/SKILL.md` | 안내 **추가만** — persistent 연결·rotate-code·golden replay 포인터 3~5줄 (기존 절 무수정) |
| `.vibe/harness/test/fixtures/golden-prompts/dataset.json` | **신규 fixture** — golden prompt 데이터셋 (커밋 대상, runtime authority 아님) |
| `.vibe/harness/test/fixtures/golden-prompts/README.md` | **신규** — 수동 replay 체크리스트(07 §7 수치 목표 + 06 §6 Inspector 증거 목록 + record 기록 형식) |
| `.vibe/harness/test/pro-bridge-auth.test.ts` | **신규 파일** — T1~T13 |
| `.vibe/harness/test/pro-bridge-golden.test.ts` | **신규 파일** — T14~T19 |
| `.vibe/harness/test/pro-bridge-mcp-server.test.ts` | 신규 케이스 T20~T21 추가만 |
| `.vibe/harness/test/pro-bridge-e2e.test.ts` | 신규 케이스 T22 추가만 |
| `.vibe/harness/test/pro-bridge-command.test.ts` | 신규 케이스 T23~T28 추가만 |
| `.vibe/harness/test/pro-bridge-catalog.test.ts` | 신규 케이스 T29 추가만 |
| `.vibe/harness/test/pro-bridge-doctor.test.ts` | 신규 케이스 T30~T31 + doctor 내부 순서 변경(capabilities 선행)으로 불가피한 기존 기대값 최소 조정만 (Explicit exceptions 참조) |

### Do NOT modify

- `.vibe/harness/src/pro-bridge/mailbox/store.ts`, `prompt-composer.ts`, `importer.ts`, `contract.ts`, `vibe-bundle.ts`, `scope-resolver.ts`, `transports/**`, `goal-source/**` — 전부 읽기 전용. golden 테스트가 composer 프롬프트의 완료 계약 문구를 검증하지만 **composer는 읽기만** 한다.
- `.vibe/harness/test/fixtures/pro-bridge-catalog-snapshot.json` — **무변경이 byte-compat의 증거다.** 이 fixture가 바뀌면 noauth 기본 wire를 깬 것이니 설계로 돌아가라.
- `.vibe/harness/test/pro-bridge-publish.test.ts` — 무변경 통과가 요구사항.
- **vpb-10/11 산출 계약 비후퇴**: 14툴 이름·description 리터럴·inputSchema·invoke 행동·`WEB_PUBLICATION_PROMPT`·completionContract·`INJECTION_DEFENSE`/`WRITE_SCOPE` 결합·`TOOL_CATALOG_METADATA`의 requiredScopes 값·`TOOL_CATALOG_VERSION = 2`·`auditToolCatalog` 기존 rule·`buildCatalogSnapshot` 형태 — 전부 그대로.
- server.ts **noauth 경로**: one-time connect code 교환·session token·Origin 거부·`token` 파라미터 거부·배치 거부·MailboxStoreError isError 매핑·tools/call 성공/에러 응답 형태 — 행동 불변. persistentCode는 `connectCode` 값의 출처가 바뀌는 것일 뿐 server.ts 인증 로직은 동일하게 동작한다.
- 기존 mailbox request/result 데이터·상태 파일 형태 불변. oauth·golden·rotate 어느 것도 mailbox 상태를 새로 만들지 않는다(rotate는 config.local만 편집).
- hook/sprint/QA 스크립트, `.claude/settings.json`, `package.json`(신규 의존성 0·신규 npm 스크립트 0), `.vibe/config.json`, `.vibe/config.local.json`(**소스 코드에서의 편집 기능 구현은 rotate-code 소관이지만, Generator가 이 repo의 실 config 파일을 직접 수정하는 것은 금지**), `.vibe/harness/scripts/**`(신규 스크립트 파일 0 — `vibe-pro-bridge.mjs`는 인자 패스스루라 무수정으로 `mcp --rotate-code`가 통한다), git tag, `docs/plans/**`, 정본 패키지 `vibe-doctor-mcp-write-improvement-v1.8.0/**`.
- oauth/doctor/golden을 어떤 훅·정기 QA에도 연결하지 않는다 — 정본 상위 불변("No hook or routine QA integration", "Do not add routine project test overhead to downstream Stop hooks").
- 실 네트워크/실 LLM/실 ngrok·cloudflared 실행 금지 — 전부 포트 주입 fake(로컬 포트 0 실서버 fixture는 허용, 기존 패턴).

### Explicit exceptions

- **`serializeToolDescriptor` 시그니처 불변 유지 — `.map` footgun**: 이 함수는 `options.tools.map(serializeToolDescriptor)` 형태로 5곳에서 호출되므로 **optional 두 번째 파라미터를 추가하면 `.map`의 index가 주입되는 사고가 난다**. 기존 시그니처를 유지하고, oauth 프로파일은 별도 데코레이터(예: `applyAuthProfile(descriptor, authMode)`)로 후처리하라.
- **noauth-local에서 securitySchemes 미부착**: 04 §4는 로컬 프로파일에 `securitySchemes: [{ type: 'noauth' }]`를 "may use"라 했지만, Sprint 상위 제약(기본 경로 바이트 호환)이 우선한다 — noauth wire는 필드 자체를 생략하고 oauth 모드에만 부착한다. 의도적 deviation으로 Final report에 기록하라.
- **TOOL_CATALOG_VERSION 2 유지**: oauth는 새 카탈로그가 아니라 **같은 카탈로그의 wire 프로파일**이다. snapshot·버전·doctor 기대는 기본(noauth) 프로파일로 고정하고, oauth 파생분(securitySchemes, capabilities.authMode)은 결정적 데코레이션으로 취급한다. 06 §4의 "auth change → Refresh" 권고는 oauth 옵트인 시 setup 문서 안내로 충족한다.
- **`_meta`를 JSON-RPC 에러 응답의 top-level에 두는 것**: JSON-RPC 2.0 엄격 해석으로는 비표준 멤버지만, 정본 04 §5가 "runtime `_meta["mcp/www_authenticate"]`"를 요구하고 클라이언트 linking UI가 이를 소비한다. top-level `_meta`와 `error.data` 양쪽에 병기해 호환성을 이중화하라(아래 A-4 형태 고정).
- **oauth 모드는 실 ChatGPT OAuth linking을 완주하지 않는다**: 실 OAuth Authorization Server 구현은 범위 밖. MCP-005 DoD("read-only token gets a proper reauthorization flow")는 **프로토콜 표면 3종**(protected-resource metadata + per-tool securitySchemes + runtime www_authenticate challenge)과 테스트(T7~T9)로 충족하고, 실 AS 연동·실 ChatGPT linking UI 왕복은 residual로 보고한다. `authorization_servers`는 config 없이 빈 배열 기본.
- **golden 데이터셋의 기대 도구선택은 실 LLM 검증이 아니다**: 자동 테스트는 스키마·카탈로그 정합·계약 문구만 검증한다. recall 100% / false publication 0% 같은 07 §7 수치는 README의 수동 replay 목표 수치로만 기록한다.
- **rotate-code가 config.local.json을 쓰는 것**: 제품 런타임 기능(사용자 실행 커맨드)이며, Generator가 repo의 실 설정 파일을 직접 편집하는 것과 다르다. 테스트는 임시 repoRoot에서만 파일을 쓴다.
- **doctor 내부 순서 변경**: 서빙 모드에 맞는 기대 카탈로그를 만들기 위해 `bridge_capabilities` 호출을 tools/list 대조보다 앞당기는 것을 허용한다. 이로 인해 기존 doctor 테스트의 출력 순서 기대가 깨지면 **최소 조정 + 케이스별 사유 보고** — 그 외 기존 기대값 갱신 목표는 0이다. 기존 vpb-11 doctor 리터럴([FAIL]/[WARN]/[ACTION] 문구)은 전부 보존한다.
- **persistentCode 안내로 인한 mcp 출력 분기**: 기본 경로(persistentCode/tunnelUrl 미설정)의 mcp 출력은 현행과 동일해야 하며(기존 테스트 "connect code once" 무수정 통과), 신규 안내 줄은 옵트인 분기에서만 출력한다. 기존 "URL의 code는 1회 교환용입니다 — ... 서버 재시작 시 무효화" 문구는 persistent 분기에서만 대체 문구로 교체한다.
- STEP 0 죽은 코드 정리는 직접 수정하는 함수 내부로 한정. 커밋은 Orchestrator가 수행 — Generator는 커밋하지 않는다.

### Reference-only values (인용만, 새 엔티티 생성·편집 금지)

- 정본 패키지 `vibe-doctor-mcp-write-improvement-v1.8.0/**` 전체 — 읽기 전용.
- `AUD-123`, `UPL-123` — golden fixture 안의 **리터럴 프롬프트 데이터**다. 실 mailbox request를 만들거나 조회하지 마라.
- 07 §7 수치 목표(direct recall 100%, negative 0%, completion 100%, median write calls 1, partial visibility 0)와 06 §6 Inspector 증거 목록 — README/setup 문서 인용용, 자동화 금지.
- v1.8.0 commit `6051105`, vpb-11 commit `02bb861`, v1.8.1 릴리즈/태그 — 문서 인용용. 릴리즈·push·태그는 Orchestrator/사용자 소관.
- ngrok 가입·authtoken·도메인 발급 URL/절차 — setup 문서의 사용자 절차 기술용. 코드가 ngrok API를 호출하지 않는다.
- `.vibe/config.local.json`의 실제 값 — 코드가 런타임에 읽고 쓰는 대상이지만 이 repo의 실 파일은 Generator가 건드리지 않는다.

### Proof predicates (공개 계약보다 강하지 않게, 아래가 전부)

Orchestrator가 샌드박스 밖에서 실행 (Generator는 static 확인만):

1. `npm run vibe:typecheck` → exit 0.
2. `npm run vibe:self-test` → exit 0 (749 baseline + 신규 — publish/identity/lifecycle/health/importer/e2e/catalog/doctor 로스터 무손상).
3. targeted: `node --import tsx --test .vibe/harness/test/pro-bridge-auth.test.ts .vibe/harness/test/pro-bridge-golden.test.ts .vibe/harness/test/pro-bridge-mcp-server.test.ts .vibe/harness/test/pro-bridge-e2e.test.ts .vibe/harness/test/pro-bridge-command.test.ts .vibe/harness/test/pro-bridge-catalog.test.ts .vibe/harness/test/pro-bridge-doctor.test.ts .vibe/harness/test/pro-bridge-mailbox.test.ts .vibe/harness/test/pro-bridge-publish.test.ts` → exit 0, Tests to add의 **리터럴 케이스명 31종 전부** 출력에 존재, publish/mailbox 무변경 통과.
4. **byte-compat 증거**: `node .vibe/harness/scripts/vibe-pro-bridge.mjs catalog-audit` → exit 0 + `git diff -- .vibe/harness/test/fixtures/pro-bridge-catalog-snapshot.json` → 빈 출력.
5. grep (auth): `rg "mcp/www_authenticate" .vibe/harness/src/pro-bridge/mailbox/server.ts` ≥1. `rg "insufficient_scope" .vibe/harness/src/pro-bridge/mailbox/server.ts` ≥1. `rg "oauth-protected-resource" .vibe/harness/src/pro-bridge/mailbox/server.ts .vibe/harness/src/commands/pro-bridge.ts` — 두 파일 모두 ≥1. `rg "createStaticTokenIntrospector" .vibe/harness/src` ≥2 (정의+호출).
6. grep (config/영속화): `rg "authMode|oauthTokens|persistentCode|tunnelUrl" .vibe/harness/src/lib/config.ts` — 4필드 전부 존재. `rg "rotate-code" .vibe/harness/src/commands/pro-bridge.ts` ≥1. `rg "staticUrl" .vibe/harness/src/pro-bridge/mailbox/tunnel.ts` ≥1. `rg "Keep legacy enumerable" .vibe/harness/src/lib/config.ts` → **0 매치**.
7. grep (golden): `rg -F "Review request AUD-123 and save the completed package for CLI import." .vibe/harness/test/fixtures/golden-prompts/dataset.json` = 1 (나머지 canonical 4문장도 각 1). `rg "GoldenPromptDatasetSchema" .vibe/harness/src/lib/schemas/pro-bridge.ts` ≥1.
8. 불변 파일 회귀 가드: `git diff -- .vibe/harness/src/pro-bridge/mailbox/store.ts .vibe/harness/src/pro-bridge/prompt-composer.ts .vibe/harness/src/pro-bridge/importer.ts .vibe/harness/src/pro-bridge/contract.ts .vibe/harness/src/pro-bridge/vibe-bundle.ts .vibe/harness/src/pro-bridge/scope-resolver.ts .vibe/harness/src/pro-bridge/transports .vibe/harness/src/pro-bridge/goal-source .vibe/harness/test/pro-bridge-publish.test.ts .vibe/harness/test/fixtures/pro-bridge-catalog-snapshot.json package.json .vibe/config.json .vibe/config.local.json .claude/settings.json` → 빈 출력.
9. 신규 스크립트 0: `git status --porcelain -- .vibe/harness/scripts docs/plans vibe-doctor-mcp-write-improvement-v1.8.0` → 빈 출력.
10. noauth 리터럴 보존: `rg -F "[WARN] oauth metadata check skipped (noauth-local profile)" .vibe/harness/src/commands/pro-bridge.ts` ≥1 (또는 동일 리터럴을 생성하는 코드 경로 — 테스트 T31이 출력으로 증명). `rg "TOOL_CATALOG_VERSION = 2" .vibe/harness/src/pro-bridge/mailbox/tools.ts` = 1.

### Current proof and non-proof

Generator Final report는 증거를 반드시 두 칸으로 분리한다: **fresh evidence**(이번 세션에서 실제 확인한 것 — Windows sandbox 특성상 대부분 static inspection과 grep)와 **non-proof**(skipped / blocked / inferred / proxy / historical — 예: "테스트는 작성했으나 실행하지 못함, Orchestrator 실행 대기"). 실행하지 못한 검증을 통과로 표기하는 것을 금지한다. golden dataset JSON은 Generator가 수기로 작성하므로 "스키마 정합은 테스트 실행 전까지 미증명"을 non-proof로 명시하고, Orchestrator가 targeted 테스트로 확인하는 절차를 report에 제안하라.

---

## 필수 참조 (구현 전 읽기 순서)

1. `vibe-doctor-mcp-write-improvement-v1.8.0/specs/MCP-005-write-auth-and-permissions.md`, `specs/MCP-007-golden-prompt-and-e2e.md` — DoD 2종.
2. `vibe-doctor-mcp-write-improvement-v1.8.0/04_METADATA_AUTH_PERMISSION_SPEC.md` — §4 OAuth 프로파일(scope 이름 5종·프로파일별 필요 scope), §5 재인가(3종 세트 필수 + "plain HTTP 403 or prose error is insufficient").
3. `vibe-doctor-mcp-write-improvement-v1.8.0/07_TEST_AND_ACCEPTANCE_PLAN.md` — §4 OAuth 테스트 6항목, §6 golden prompt matrix(canonical 5문장 리터럴), §7 Developer Mode 수치 목표, §10 CI 경계.
4. `vibe-doctor-mcp-write-improvement-v1.8.0/prompt/UPSTREAM_IMPLEMENTATION_PROMPT.md` — MCP-005·007 절 + 상위 불변(hook 무결합, push/배포 금지).
5. `vibe-doctor-mcp-write-improvement-v1.8.0/06_DIAGNOSTICS_AND_APP_REFRESH.md` — §1 BridgeCapabilities의 `authMode: 'noauth-local' | 'oauth'` 타입, §2 doctor 체크 목록("OAuth metadata reachable", "write scope advertised").
6. `vibe-doctor-mcp-write-improvement-v1.8.0/05_COMPLETION_CONTRACT_AND_PROMPT_SPEC.md` — §3 완료 계약 문구(golden 데이터셋 completionInvariant의 근거), §5 negative 금지 행동(negative/cancel 케이스 forbiddenTools 설계 근거).
7. 현행 구현 anchor (라인은 2026-07-16 main 기준):
   - `.vibe/harness/src/pro-bridge/mailbox/server.ts` — `McpServerOptions`(13~24), `createSessionAuth`(94~144: noauth 경로 — 비변경), 401 처리(220~224: oauth 분기 삽입 지점), 라우팅(204~219: well-known GET 삽입 지점), tools/call(288~316: scope enforcement 삽입 지점), `sendRpcError`(51~60).
   - `.vibe/harness/src/pro-bridge/mailbox/tools.ts` — `TOOL_CATALOG_METADATA`(116~131: per-tool requiredScopes 정답표 — 불변·enforcement의 근원은 `_meta['vibe/requiredScopes']`), `BridgeCapabilitiesOutputSchema`(310~338: authMode literal 모드 분기 대상), capabilities invoke(680~703), `serializeToolDescriptor`(736~745: 시그니처 불변 — `.map` 호출 5곳), `SerializedToolDescriptor`(727~734), `auditToolCatalog`(775~879: rule 추가 지점).
   - `.vibe/harness/src/commands/pro-bridge.ts` — `runMcpServer`(1458~1525: connectCode 생성 1472·createMailboxTools 옵션 1483~1488·connector URL 출력 1510~1518), doctor(1327~1429: OAuth WARN 자리 1426·capabilities 호출 1405~1425·`localCatalogDescriptors` 1187~1193), `callMcp`(1278~1306: GET용 헬퍼는 별도), 커맨드 라우팅(1541~1556·1716~1723), `ProBridgeDeps`(120~148: fetchPort·randomToken·mcpServer·tunnel 주입 seam).
   - `.vibe/harness/src/pro-bridge/mailbox/tunnel.ts` — `TunnelPorts`(8~11), ngrok args(66~69), `extractUrl`(39~54: ngrok json url 추출 — 고정 도메인에도 동작).
   - `.vibe/harness/src/lib/config.ts` — `ProBridgeMcpConfig`(67~71), `DEFAULT_PRO_BRIDGE_MCP_CONFIG`(118~122), `resolveProBridgeMcpConfig`(158~186: **낡은 주석 180~181 제거 대상**), `loadConfig`(393~402: shared+local 병합 — 보안 게이트는 병합 전 shared 원본을 봐야 하는 이유).
   - `.vibe/harness/src/lib/schemas/pro-bridge.ts` — additive 삽입 위치 참고 (기존 export 뒤).
8. 기존 테스트 anchor: `pro-bridge-mcp-server.test.ts`(82~158: fixture/rpc/callTool 헬퍼 — auth 테스트가 재사용할 패턴, 17~18: 주입 code/token), `pro-bridge-command.test.ts`(678~742: mcp 서브커맨드 주입 패턴 — mcpServer.start가 받는 옵션 캡처로 authMode/introspector/connectCode 검증, 706: "code 정확히 1회" 기존 불변), `pro-bridge-e2e.test.ts`(255~393: mcp mailbox 왕복 — T22가 publish 파사드 버전으로 병렬 추가), `test/helpers/pro-bridge-result-fixture.ts`(`buildCompliantResultBundle`), `pro-bridge-doctor.test.ts`(vpb-11 T12~T19 — 리터럴 보존 대상).
9. `docs/context/pro-bridge-setup.md` — 현행 절 구성(§1~5·포트·Web-origin·doctor·Refresh). `.claude/skills/vibe-goal-audit/SKILL.md` — 현행 절 구성.

---

## 기술 사양

### A. MCP-005 — oauth 프로파일 + scope enforcement (server.ts)

**A-1. 옵션 (additive)**:

```ts
export type ProBridgeAuthMode = 'noauth-local' | 'oauth';
export interface McpServerAuthOptions {
  mode: ProBridgeAuthMode;                                        // 기본 'noauth-local'
  introspectToken?: (token: string) => Promise<readonly string[] | null>;  // oauth 필수
  resource?: string;            // canonical MCP resource URL (예: https://d.ngrok.app/mcp)
  authorizationServers?: readonly string[];                       // 기본 []
}
// McpServerOptions.auth?: McpServerAuthOptions — 미지정 시 현행 noauth 경로 그대로.
```

oauth 모드인데 `introspectToken`이 없으면 `startMcpServer`가 즉시 throw (설정 오류를 기동 시점에 표면화).

**A-2. oauth 요청 인증**: 모든 `POST /mcp`는 `Authorization: Bearer <token>` 필수. `?code=`/`?token=` 쿼리 경로는 oauth 모드에서 **전부 거부**(401). introspection이 null을 반환하면 401 + 헤더:

```text
WWW-Authenticate: Bearer resource_metadata="<resourceOrigin>/.well-known/oauth-protected-resource"
```

(`resourceOrigin`은 `auth.resource`의 origin. resource 미지정 시 로컬 URL 기반.) body는 현행 401과 동일한 `{ error: 'unauthorized' }` 유지. initialize/ping/tools/list는 **유효 토큰이면 scope와 무관하게 허용**(discovery는 scope-gate 대상 아님).

**A-3. scope enforcement (tools/call)**: 알려진 툴 해석 후 invoke 전에 `required = tool._meta['vibe/requiredScopes']`, `missing = required − granted`. `missing`이 비어있지 않으면 invoke 하지 않고 A-4 에러 반환. `bridge_capabilities`는 required가 `[]`라 항상 통과. noauth 모드는 이 검사 자체가 없다(현행).

**A-4. insufficient_scope 응답 (HTTP 200, JSON-RPC 에러 — plain 403 금지)**. 단일 scope 부족 시 리터럴 고정:

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "error": {
    "code": -32001,
    "message": "insufficient_scope: bridge.result.write is required",
    "data": {
      "requiredScopes": ["bridge.result.write"],
      "missingScopes": ["bridge.result.write"],
      "mcp/www_authenticate": "Bearer error=\"insufficient_scope\", error_description=\"bridge.result.write is required\", scope=\"bridge.result.write\""
    }
  },
  "_meta": {
    "mcp/www_authenticate": "Bearer error=\"insufficient_scope\", error_description=\"bridge.result.write is required\", scope=\"bridge.result.write\""
  }
}
```

복수 scope 부족 시 `scope`/`error_description`은 RFC 6750 방식 공백 결합(`"bridge.request.read bridge.result.write"` / `"... are required"`가 아닌 `"<joined> is required"` 단일형 유지 — 리터럴 단순성 우선). challenge 문자열 빌더를 단일 함수로 두고 테스트가 리터럴로 assert 한다.

**A-5. protected resource metadata (oauth 모드 전용)**: `GET /.well-known/oauth-protected-resource` → 200 + 

```json
{
  "resource": "<auth.resource>",
  "authorization_servers": [],
  "scopes_supported": ["bridge.request.read", "bridge.request.write", "bridge.result.read", "bridge.result.write", "bridge.import.ack"],
  "bearer_methods_supported": ["header"]
}
```

인증 불요(공개 metadata, RFC 9728). noauth 모드에서는 현행대로 404. POST /mcp 외 라우팅 분기는 이 GET 1종만 추가.

**A-6. static introspector**: `createStaticTokenIntrospector(tokens: Record<string, readonly string[]>)` export — 모든 엔트리를 순회하며 `timingSafeEqual` 비교(조기 종료로 인한 타이밍 누출 방지), 일치 시 scope 배열, 불일치 시 null. 실 OAuth AS 구현·원격 introspection 호출은 하지 않는다 — 포트 주입 지점만.

**A-7. securitySchemes (oauth 모드 전용 wire)**: `SerializedToolDescriptor.securitySchemes?: Array<{ type: 'oauth2'; scopes: readonly string[] }>` optional 필드 + 데코레이터 `applyAuthProfile(descriptor, mode)` — oauth일 때만 각 툴의 requiredScopes로 부착(`scopes: [...requiredScopes]`, capabilities는 `[]`). server.ts tools/list가 자기 모드로 데코레이트. **noauth 직렬화는 필드 자체 생략 — 바이트 불변.** `buildCatalogSnapshot`은 securitySchemes를 포함하지 않는다(snapshot 불변).

### B. capabilities·catalog·doctor의 authMode 정합

- `MailboxToolOptions.authMode?: ProBridgeAuthMode`(기본 'noauth-local'). capabilities invoke가 이 값을 반환. **output zod는 모드별 literal**(`z.literal(authMode)`)로 구성해 noauth 기본 outputSchema JSON이 현행과 바이트 동일하게 유지 — 기존 export `BridgeCapabilitiesOutputSchema`는 noauth 인스턴스로 보존.
- `auditToolCatalog`에 rule 1종 additive: `security-scheme-mismatch` — descriptor에 `securitySchemes` **필드가 존재할 때만** 발동, `scopes`가 `_meta['vibe/requiredScopes']`와 불일치하거나 형태가 다르면 FAIL. 필드 부재(noauth 카탈로그)는 통과 — 기존 snapshot·audit 결과 불변.
- doctor: initialize 후 `bridge_capabilities`를 **먼저** 호출해 served authMode를 얻고(실패 시 'noauth-local' 가정 + 기존 skip/FAIL 처리 유지), 그 모드로 로컬 기대 카탈로그를 데코레이트해 tools/list를 대조한다. 이어서:
  - served 'oauth' → connector origin의 `/.well-known/oauth-protected-resource`를 GET: 200 + `scopes_supported`가 5종 전부 포함 → `[PASS] oauth protected resource metadata`, 아니면 `[FAIL] oauth protected resource metadata unreachable: <reason>` + exit 1. 추가로 publish 툴 descriptor에 `bridge.result.write` scope의 securitySchemes가 보이면 `[PASS] write scope advertised`, 아니면 `[FAIL] write scope advertised missing`.
  - served 'noauth-local' → 기존 리터럴 `[WARN] oauth metadata check skipped (noauth-local profile)` 유지.
- 기존 vpb-11 doctor 리터럴·exit 규칙(FAIL≥1→1, WARN만→0) 전부 보존.

### C. MCP-007 — golden prompt 데이터셋 + 자동화 가능분

**C-1. 스키마 (lib/schemas/pro-bridge.ts, additive)**:

```ts
export const GoldenPromptCategorySchema = z.enum(['direct', 'indirect', 'fallback', 'negative', 'cancel']);
export const GoldenPromptCaseSchema = z.object({
  id: z.string().regex(/^(direct|indirect|fallback|negative|cancel)-[0-9]{2}$/),
  category: GoldenPromptCategorySchema,
  prompt: z.string().min(1),
  expectedTools: z.array(z.string().min(1)),
  forbiddenTools: z.array(z.string().min(1)),
  expectedFinalStatus: z.enum(['result-ready']).nullable(),
  source: z.enum(['acceptance-plan', 'authored']),
  notes: z.string().optional(),
}).strict();
export const GoldenPromptDatasetSchema = z.object({
  schemaVersion: z.literal('vibe-pro-bridge-golden-prompts-v1'),
  toolCatalogVersion: z.literal(2),
  completionInvariant: z.literal('The task is incomplete until the Bridge returns status=result-ready.'),
  cases: z.array(GoldenPromptCaseSchema).min(15),
}).strict();  // + superRefine: id 유일성, 범주별 ≥3
export const GoldenSelectionRecordSchema = z.object({
  schemaVersion: z.literal('vibe-pro-bridge-golden-selection-v1'),
  caseId: z.string().min(1),
  replayedAt: IsoDateTimeSchema,
  surface: z.enum(['chatgpt-developer-mode', 'mcp-inspector']),
  selectedTools: z.array(z.string()),
  finalStatus: z.string().nullable(),
  pass: z.boolean(),
  notes: z.string().optional(),
}).strict();
```

**C-2. fixture `.vibe/harness/test/fixtures/golden-prompts/dataset.json`**: 총 ≥15 케이스, 범주별 ≥3. 07 §6의 canonical 5문장은 `source: 'acceptance-plan'`으로 **verbatim** 포함:

| id | prompt (리터럴) | expectedTools | forbiddenTools |
|---|---|---|---|
| direct-01 | `Review request AUD-123 and save the completed package for CLI import.` | get_request, publish_review_package | begin_result, put_result_file, finalize_result |
| indirect-01 | `Finish this Vibe review and make the result available to my CLI.` | publish_review_package | begin_result, put_result_file, finalize_result |
| fallback-01 | `Resume upload session UPL-123 using the returned chunk plan.` | put_result_file, finalize_result | (없어도 됨 — publish 재호출 금지 취지면 publish_review_package) |
| negative-01 | `Explain what request AUD-123 is asking for.` | get_request | publish_review_package, begin_result, put_result_file, finalize_result, cancel_request |
| cancel-01 | `Cancel request AUD-123.` | cancel_request | publish_review_package |

나머지 케이스(`source: 'authored'`)는 05 §5 negative 금지 행동(chat-only Markdown, begin_result 후 성공 주장, 취소 후 재생성 등)과 실사용 표현 변주로 Generator가 작성하되 범주 불변식(C-3)을 전부 만족시켜라. `expectedFinalStatus`는 direct/indirect/fallback = `'result-ready'`, negative/cancel = `null`.

**C-3. 자동 테스트 불변식** (실 LLM 없음):
- 데이터셋이 `GoldenPromptDatasetSchema` strict parse 통과.
- 모든 expectedTools/forbiddenTools 이름 ∈ `MAILBOX_TOOL_NAMES`, expectedTools의 각 툴은 카탈로그에서 `_meta.ui.visibility`에 'model' 포함.
- direct/indirect: `publish_review_package` ∈ expectedTools ∧ ∉ forbiddenTools. fallback: put_result_file·finalize_result ∈ expectedTools. negative: forbiddenTools ⊇ {publish_review_package, begin_result, put_result_file, finalize_result} ∧ expectedTools는 전부 readOnly 툴. cancel: cancel_request ∈ expectedTools ∧ publish_review_package ∈ forbiddenTools.
- `completionInvariant` === `WEB_PUBLICATION_PROMPT`의 첫 문장(tools.ts) === composer 생성 프롬프트(§H)에 포함된 문장 — 3면 일치.

**C-4. `README.md` (fixture 디렉터리)**: 수동 replay 절차 — 07 §7(직접/간접/부정 각 ≥10회, 목표: direct recall 100% / negative false publication 0% / completion 100% / median write calls 1 / partial visibility 0) + 06 §6 Inspector 증거 5종 목록 + record 기록 형식(GoldenSelectionRecordSchema 필드 설명 + JSON 예시 1개) + setup.md Refresh 절 포인터. record 파일은 커밋하지 않는다(사용자 산출물).

### D. E2E 강화 (carry-over 2·3)

- **T20 (mcp-server.test.ts)**: 실 로컬 서버(`startMcpServer`, port 0, noauth) + `callTool` 헬퍼로 request 생성 → `tools/call publish_review_package`(compliant 4파일, `buildCompliantResultBundle`) → structuredContent가 `status: 'result-ready'` receipt 전 필드(requestId/resultId/proposedFolder/resultManifestSha256/fileCount/totalBytes/revision/imported/idempotentReplay:false) — **definition() 내부의 output strict-parse가 실 HTTP 경로에서 통과함을 증명**. 동일 인자 재호출 → `idempotentReplay: true`.
- **T21**: 한도 초과 패키지(주입 publishLimits 축소) → `status: 'chunked-upload-required'` 분기가 동일 경로에서 strict-parse 통과 + requiredNextTools 리터럴 `['put_result_file','finalize_result']`.
- **T22 (e2e.test.ts)**: 기존 mcp mailbox 왕복과 병렬로 — audit 발행 → claim → **publish_review_package invoke 한 번**(begin/put/finalize 미사용) → `sync --latest` → 설치 파일 존재 + provenance/imported sha 일치 + 상태 'imported'. 저수준 경로 기존 케이스는 무수정 유지.

### E. 연결 영속화 (config + commands + tunnel)

**E-1. config 필드 (config.ts additive)**:

```ts
export interface ProBridgeMcpConfig {
  port: number;
  tunnel: string;
  publishLimits: PublishLimits;
  authMode: string;                                     // 'noauth-local' 기본 — 검증은 commands
  oauthTokens: Record<string, readonly string[]> | null; // 기본 null — config.local 전용
  persistentCode: string | null;                        // 기본 null — config.local 전용
  tunnelUrl: string | null;                             // 기본 null
}
```

`DEFAULT_PRO_BRIDGE_MCP_CONFIG`·`resolveProBridgeMcpConfig` 병합(override ?? base ?? default) 확장. `ProBridgeConfigInput['mcp']` Partial에 자연 포함되는지 타입 확인. **180~181행 낡은 주석 제거**(carry-over 1).

**E-2. runMcpServer 확장 (commands/pro-bridge.ts)**:
1. **보안 게이트**: `<repoRoot>/.vibe/config.json`을 raw로 읽어(부재 시 통과) `proBridge.mcp.persistentCode` 또는 `proBridge.mcp.oauthTokens`가 있으면 exit 1 + "보안: persistentCode/oauthTokens는 git 미추적 .vibe/config.local.json에만 두세요" 취지 메시지. `mcp`와 `mcp --rotate-code` 양쪽에서 검사.
2. **authMode 해석**: `resolveTunnelKind` 패턴의 검증 함수 — 'noauth-local'/'oauth' 외 값은 throw. oauth일 때: `config.mcp.oauthTokens`가 null/빈 객체면 exit 1 + 설정 안내. 있으면 `createStaticTokenIntrospector`로 포트 구성해 `startMcpServer`의 `auth` 옵션으로 주입(`resource`는 `tunnelUrl ? tunnelUrl + '/mcp' : 로컬 URL 기반`). oauth 모드 connector URL은 `?code=` 없이 출력 + "Bearer 토큰 인증 — 실 ChatGPT OAuth linking은 Authorization Server 연동이 필요하며 범위 밖(Inspector/doctor/테스트 검증용)" 안내 1~2줄. oauth 모드에서 persistentCode가 설정돼 있으면 "oauth 모드에서는 persistentCode가 사용되지 않습니다" 경고 1줄.
3. **persistentCode (noauth)**: connectCode 결정을 `config.mcp.persistentCode ?? deps.randomToken?.() ?? randomBytes(32).toString('base64url')` 우선순위로. persistentCode는 길이 ≥22 검증(미달 시 exit 1 + rotate-code 안내). persistent 분기 출력: 기존 "1회 교환용 ... 재시작 시 무효화" 문구 대신 "이 code는 재시작 간 유지됩니다(첫 제시 교환·인스턴스별 세션은 동일). 유출 시 `vibe-pro-bridge.mjs mcp --rotate-code`로 회전하세요." 기본 분기(null)는 현행 출력 그대로.
4. **tunnelUrl**: https:// 검증(아니면 exit 1). kind==='ngrok'이면 `startTunnel`에 `staticUrl` 전달. kind==='cloudflared'이며 tunnelUrl 설정 시 경고 1줄("cloudflared named tunnel은 범위 밖 — quick tunnel로 계속") 후 무시. tunnel 성공 publicUrl이 tunnelUrl과 일치하고 persistentCode도 설정이면 안내: "connector URL이 재시작 후에도 동일합니다 — ChatGPT 재등록 불필요."
5. **`mcp --rotate-code`**: 서버를 기동하지 않는다. `<repoRoot>/.vibe/config.local.json`을 read-modify-write(부재 시 생성, 기존 필드 보존, 2-space indent + trailing newline)로 `proBridge.mcp.persistentCode = randomBytes(32).toString('base64url')` 기록 → 새 connector URL 형태(`<tunnelUrl ?? http://127.0.0.1:<port>>/mcp?code=<new>`) 1회 출력 + "code가 바뀌었으므로 이번 1회는 ChatGPT 커넥터 URL 갱신이 필요합니다" 안내 → exit 0. 이전 code는 출력하지 않는다.

**E-3. tunnel.ts**: `TunnelPorts.staticUrl?: string` — ngrok args를 `['http', String(port), '--url', staticUrl, '--log', 'stdout', '--log-format', 'json']`으로 (staticUrl 있을 때만 `--url` 쌍 삽입). `extractUrl`은 무수정(고정 도메인도 json url 필드로 나온다). cloudflared/none 경로 비변경.

### F. 문서 + 스킬

- **`docs/context/pro-bridge-setup.md`** 신규 절 3종 (한국어 톤 유지):
  1. **"인증 프로파일 (noauth-local / oauth)"** — authMode 설명, oauth는 config.local의 `oauthTokens: { "<token>": ["bridge.request.read", ...] }` 정적 매핑 + scope 5종 표(04 §4: Web 리뷰 = request.read + result.write, CLI importer = result.read + import.ack), insufficient_scope challenge가 무엇이고 클라이언트가 어떻게 재인가하는지 2~3줄, 실 OAuth AS는 범위 밖 명시. **개인 ChatGPT 앱 권한·재승인 절차 문단**: 권장 "Ask before making changes"(신뢰 후 "Ask only before important changes"), write 확인 대화상자가 재인가 지점이라는 설명, 권한 변경 후 앱 Refresh 절차 포인터(기존 Refresh 절).
  2. **"연결 영속화 (persistentCode + 고정 도메인)"** — 기본은 세션 한정 임의 code(보안 우선)임을 먼저 명시 → 옵트인 절차: ① ngrok 가입 → authtoken 등록 → 무료 고정 도메인 1개 발급 → `proBridge.mcp.tunnelUrl` 설정, ② `mcp --rotate-code`로 persistentCode 생성, ③ ChatGPT 커넥터 1회 등록 → 이후 재시작해도 재등록 불필요. **보안 절충**: 개인용 옵트인, config.local은 git 미추적(`git check-ignore .vibe/config.local.json`으로 확인), code가 장수 자격이 되므로 유출 의심 시 즉시 rotate, 공유 config.json에 넣으면 서버가 기동을 거부. cloudflared named tunnel은 도메인/계정 필요라 범위 밖(quick tunnel 유지).
  3. **"Golden prompt 회귀"** — 데이터셋 위치(`.vibe/harness/test/fixtures/golden-prompts/`), 자동 검증 범위(스키마·카탈로그 정합·계약 문구)와 수동 replay(README 체크리스트, 07 §7 수치 목표) 구분, record 스키마 안내 1줄.
  - 기존 §2 출력 설명에 persistent 분기 존재 1~2줄 추가(기존 문장 의미 보존).
- **`.claude/skills/vibe-goal-audit/SKILL.md`**: 말미 안내 추가만 — persistent 연결/rotate-code 존재 + setup.md 절 포인터, golden replay는 명시 수동 절차(hook/QA 무결합) 1줄.

### G. closure 매핑 표

| Spec | 구현 지점 (파일:심볼) | 복원되는 설계 불변식 | Proof |
|---|---|---|---|
| MCP-005 auth/scope | server.ts: auth 옵션/enforcement/challenge/well-known/introspector; tools.ts: authMode 보고 + securitySchemes 데코레이터; commands: oauth 배선; config: authMode/oauthTokens | read 토큰은 읽기만, write 토큰은 발행, 부족 scope는 표준 재인가 challenge — plain 403 없음 (DoD) | T1~T13 + predicate 5·10 |
| MCP-005 문서 | setup.md §인증 프로파일/앱 권한·재승인 | 사용자가 앱 권한과 재인가 절차를 문서로 수행 가능 | inspection 항목 |
| MCP-007 golden | schemas: Golden* 3종; fixture dataset.json + README; golden.test.ts | 릴리즈 golden set이 기계 검증 가능한 형태로 존재, 라이브 replay는 문서화된 수동 절차 | T14~T19 + predicate 7 |
| MCP-007 E2E | mcp-server.test.ts T20~T21; e2e.test.ts T22 | publish 파사드의 runtime strict-parse 경로와 폐루프가 툴 invoke 경로로 증명 | T20~T22 |
| 영속화 (사용자 요청) | config 4필드; commands: persistentCode/rotate/보안 게이트/재등록 안내; tunnel: staticUrl | 앱 1회 등록 후 영구 재사용 + 유출 시 회전 + 비밀의 config.local 격리 | T23~T28 + predicate 6 |
| carry-over 1 | config.ts 주석 제거 | 코드와 반대인 설명 제거 | predicate 6 (0 매치) |

### H. 범위 아님 (residual로 보고)

- 실 OAuth Authorization Server·토큰 발급/갱신·실 ChatGPT OAuth linking UI 왕복, `authorization_servers` 실값 구성.
- 실 ChatGPT Developer Mode golden replay(수치 측정)·실 ngrok/cloudflared 기동·live doctor transcript(Orchestrator/사용자 항목).
- cloudflared named tunnel, wrong audience/tenant 검증(07 §4 — 단일 사용자 로컬 mailbox 전제라 tenant 개념 없음 — residual 명시), v1.8.1 릴리즈/태그/push.
- doctor의 OAuth 토큰 실검증(metadata 도달성·scope 광고 확인까지만).

---

## Tests to add

node:test `describe`/`it`, 주입 `now`, `mkdtemp` 임시 루트, 실 sleep·외부 네트워크 금지(로컬 포트 0 실서버는 허용 — 기존 fixture 패턴 재사용). **아래 `it()` 케이스명 31종은 리터럴로 고정한다** (Orchestrator가 출력에서 grep으로 대조).

`pro-bridge-auth.test.ts` (신규, T1~T13 — `pro-bridge-mcp-server.test.ts`의 fixture/rpc 헬퍼 패턴 복제 + auth 옵션 주입):
1. `keeps the noauth-local wire byte-compatible without security schemes` — noauth 서버 tools/list의 어떤 descriptor에도 `securitySchemes` 키 부재 + capabilities outputSchema에 'oauth' 문자열 부재
2. `serves oauth tools list with per-tool security schemes` — oauth 서버: 14툴 전부 securitySchemes 존재, publish의 scopes가 `['bridge.result.write']`, capabilities는 `[]`
3. `reports the running auth mode through bridge capabilities` — oauth 서버의 capabilities 호출 → `authMode: 'oauth'`; 기본 서버 → `'noauth-local'`
4. `rejects missing or unknown bearer tokens with a resource metadata challenge` — 무토큰/오토큰 → 401 + `WWW-Authenticate` 헤더에 `resource_metadata=` 포함
5. `rejects the connect code query path in oauth mode` — `?code=` → 401
6. `allows discovery calls with a valid token that has no scopes` — 빈 scope 토큰으로 initialize/ping/tools/list/bridge_capabilities 성공
7. `lets a read scope token read the request but not publish` — `['bridge.request.read']` 토큰: get_request 성공, publish → -32001 (07 §4 첫 두 항목)
8. `returns the mcp www authenticate challenge on missing write scope` — 응답 `_meta['mcp/www_authenticate']`와 `error.data['mcp/www_authenticate']` 모두 리터럴 `Bearer error="insufficient_scope", error_description="bridge.result.write is required", scope="bridge.result.write"` + HTTP status 200(403 아님)
9. `publishes successfully after reauthorization with a write scope token` — 같은 서버에 write scope 토큰으로 재시도 → result-ready receipt (DoD)
10. `enforces the import ack scope on acknowledge import` — result.write만 있는 토큰의 acknowledge_import → insufficient_scope(scope 리터럴 `bridge.import.ack`)
11. `serves oauth protected resource metadata with the five bridge scopes` — GET well-known → 200 + scopes_supported 5종 + bearer_methods_supported
12. `keeps protected resource metadata absent in noauth-local mode` — noauth 서버 GET well-known → 404
13. `matches static oauth tokens with timing safe comparison and rejects unknown tokens` — `createStaticTokenIntrospector` 단위: 등록 토큰 → scope 배열, 미등록 → null, 빈 문자열 → null

`pro-bridge-golden.test.ts` (신규, T14~T19):
14. `parses the committed golden prompt dataset with the strict schema` — strict parse + 케이스 ≥15 + 범주별 ≥3 + id 유일
15. `keeps the five canonical golden prompts from the acceptance plan verbatim` — 07 §6 5문장 리터럴이 각 범주에 `source: 'acceptance-plan'`으로 존재
16. `binds every golden case tool reference to a model visible catalog tool` — 모든 도구명 ∈ MAILBOX_TOOL_NAMES + expectedTools는 model-visible
17. `enforces publish expectations per golden category` — direct/indirect publish 포함, fallback put+finalize 포함, expectedFinalStatus 규칙
18. `forbids publication tools in negative and cancel golden cases` — negative의 forbiddenTools 4종 이상 + expectedTools 전부 readOnly, cancel의 publish 금지
19. `embeds the completion invariant in the web publication prompt templates` — dataset.completionInvariant === WEB_PUBLICATION_PROMPT 첫 문장 === composeReviewPrompt 산출물 포함 문장 (composer는 읽기만)

`pro-bridge-mcp-server.test.ts` (T20~T21 추가만):
20. `publishes a compliant package through the http tool call wrapper and replays idempotently`
21. `returns the chunked upload fallback through the http tool call wrapper`

`pro-bridge-e2e.test.ts` (T22 추가만):
22. `round trips an audit request through the publish facade tool path`

`pro-bridge-command.test.ts` (T23~T28 추가만 — 678행 mcp 주입 패턴 재사용, mcpServer.start가 받는 옵션 캡처):
23. `mcp subcommand reuses the configured persistent code across restarts` — persistentCode 설정 config로 2회 기동 → 두 번 모두 같은 connectCode 전달 + persistent 안내 문구 출력 + 기본 경로 테스트(기존 678) 무수정 통과
24. `mcp subcommand refuses persistent secrets in the shared config` — 임시 repoRoot의 `.vibe/config.json`에 persistentCode 존재 → exit 1 + 보안 메시지 (oauthTokens 케이스 포함)
25. `rotates the persistent code into the local config with guidance` — `['mcp','--rotate-code']` → config.local.json 생성/갱신(기존 필드 보존) + 새 code ≥22자 + 서버 미기동(주입 start 미호출 assert) + 갱신 안내 + exit 0
26. `passes the reserved ngrok domain to the tunnel and reports a stable connector url` — tunnel 'ngrok' + tunnelUrl + persistentCode → 주입 tunnel.start가 staticUrl 수신 + publicUrl 일치 시 "재등록 불필요" 안내 출력
27. `warns that cloudflared ignores the fixed tunnel domain` — cloudflared + tunnelUrl → 경고 1줄 + quick tunnel 계속 + exit 0
28. `starts the oauth server with introspection from configured tokens` — authMode oauth + oauthTokens config → mcpServer.start가 auth.mode 'oauth' + 동작하는 introspect 포트 수신(등록 토큰 → scopes) + connector URL에 `?code=` 부재; oauthTokens 없는 oauth → exit 1

`pro-bridge-catalog.test.ts` (T29 추가만):
29. `flags security schemes that contradict the required scopes in the audit` — securitySchemes를 변조 부착한 descriptor → `security-scheme-mismatch` finding, 필드 부재 descriptor → finding 없음(기존 audit 결과 불변)

`pro-bridge-doctor.test.ts` (T30~T31 추가):
30. `checks oauth protected resource metadata when the server reports oauth mode` — oauth 실서버 → `[PASS] oauth protected resource metadata` + `[PASS] write scope advertised` + exit 0; well-known 차단 주입 → `[FAIL]` + exit 1
31. `keeps the noauth metadata skip warning literal` — noauth 실서버 → 리터럴 `[WARN] oauth metadata check skipped (noauth-local profile)` 정확 출력

공통 원칙: 리터럴 메시지는 리터럴로 assert. 시간 전부 주입. 임시 루트 밖 쓰기 금지. `pro-bridge-publish.test.ts`·`pro-bridge-mailbox.test.ts`는 손대지 않는다.

---

## 실행 제약

- **Windows sandbox**: Generator는 npm/네트워크/테스트 실행 불가 — static inspection과 코드 작성만. 실행 검증(typecheck/self-test/targeted/catalog-audit)은 Orchestrator가 수행한다. 실행하지 못한 검증을 통과로 보고하지 말 것.
- **신규 의존성 0, 신규 스크립트 파일 0, 신규 npm 스크립트 0.** `package.json` 무변경. 암호 연산은 `node:crypto`만(timingSafeEqual·randomBytes). fetch는 전역 fetch + 주입 seam.
- NodeNext ESM — 상대 import는 `.js` 확장자. UTF-8 (BOM 없음). CLI 사용자 메시지는 한국어 톤, 프로토콜/진단 리터럴([PASS]/[FAIL]/[WARN]/challenge/에러 message)은 영문 리터럴.
- 테스트는 `.vibe/harness/test/` 직속 `*.test.ts`(self-test glob 자동 포함). fixture는 `test/fixtures/golden-prompts/` 하위.
- 예상 규모 ~700 LOC (테스트·fixture 포함 시 상회 가능) — 상한이 아니라 규모 감각이다. 계약 충족과 vpb-10/11 불변식 보존이 우선.

---

## 완료 체크리스트 (Verification)

### 기계 검증 (Orchestrator 실행)

- [ ] `npm run vibe:typecheck` exit 0
- [ ] `npm run vibe:self-test` exit 0 (749 baseline 로스터 무손상)
- [ ] targeted 9파일 exit 0 + 리터럴 케이스명 31종 전부 출력에 존재 + publish/mailbox 무변경 통과 (predicate 3)
- [ ] **byte-compat**: `catalog-audit` exit 0 + snapshot fixture `git diff` 빈 출력 (predicate 4)
- [ ] auth grep 세트: mcp/www_authenticate·insufficient_scope·oauth-protected-resource·createStaticTokenIntrospector (predicate 5)
- [ ] config/영속화 grep 세트: 4필드·rotate-code·staticUrl + "Keep legacy enumerable" 0 매치 (predicate 6)
- [ ] golden grep: canonical 5문장 각 1 + GoldenPromptDatasetSchema (predicate 7)
- [ ] 불변 파일 git diff 빈 출력 (predicate 8) + 신규 스크립트 0 (predicate 9) + noauth 리터럴·TOOL_CATALOG_VERSION=2 보존 (predicate 10)

### Inspection / demo AC (Orchestrator·Evaluator·사용자)

- [ ] **transcript 3종 확보** (CLI/프로토콜 제품의 identity/payoff 증거): ① insufficient_scope challenge JSON(테스트 출력 또는 로컬 oauth 서버 curl 왕복 — `_meta["mcp/www_authenticate"]` 리터럴 포함), ② persistentCode+tunnelUrl 조합 mcp 기동 출력("재등록 불필요" 안내 포함 — 주입 fake tunnel 기반 테스트 출력 허용), ③ `mcp --rotate-code` 출력(config.local 갱신 + 안내). 제품 정체성 assert: "한 번 등록한 커넥터가 재시작 후에도 살아있고, 권한 부족은 죽은 403이 아니라 재인가 경로를 안내한다."
- [ ] 검증 비약화 (Evaluator 대조): noauth 경로 diff가 정말 행동 중립인가(server.ts 인증 로직·기존 응답 형태·mcp 기본 출력). scope enforcement가 tools/call에만 걸리고 discovery를 막지 않는가. 기존 테스트 기대값 갱신이 doctor 순서 조정 외 0인가.
- [ ] 보안 경계 (Evaluator 대조): oauthTokens/persistentCode가 로그·에러 메시지·doctor 출력에 노출되지 않는가. rotate가 이전 code를 출력하지 않는가. 공유 config 게이트가 mcp·rotate 양쪽에서 동작하는가. introspector가 timing-safe인가.
- [ ] hook 무결합 (Evaluator 대조): oauth/golden/rotate가 어떤 훅·정기 QA·sprint 스크립트에도 연결되지 않았는가 (`.claude/settings.json`·scripts diff 0).
- [ ] golden 품질 (Evaluator 대조): authored 케이스들이 05 §5 금지 행동을 실제로 커버하고 범주 불변식과 모순 없는가. README 수치 목표가 07 §7 리터럴과 일치하는가.
- [ ] 실 ChatGPT Developer Mode golden replay·실 ngrok 고정 도메인 연결·live doctor transcript — **사용자/Orchestrator 참여 항목, 이번 Sprint 범위 밖** (roadmap 종료 조건 1에 따라 분리 보고).
- [ ] >5 파일이므로 **Evaluator 소환은 Must**.

---

## Final report 요구 (Generator 출력 필수 형식)

1. **`## Wiring Integration`** — `.vibe/agent/_common-rules.md` §14 W1~W14 각 항목 `touched / n/a / skipped+reason`. 힌트: 신규 파일 4종(test 2 + fixture 2)의 sync-manifest glob 포함 여부 확인(W2), SKILL.md/setup.md 변경은 문서 wiring으로 보고, 신규 export(`createStaticTokenIntrospector`, `applyAuthProfile`류 데코레이터, `McpServerAuthOptions`/`ProBridgeAuthMode`, `MailboxToolOptions.authMode`, `TunnelPorts.staticUrl`, `GoldenPromptDatasetSchema`·`GoldenPromptCaseSchema`·`GoldenSelectionRecordSchema`, config 4필드)에 `verified-callers:` 명시(grep으로 확인한 실제 import·호출 지점). 삭제/개명 없음이면 D1~D6 n/a.
2. **MCP-005·007·영속화·carry-over별 closure 증거** — 각각: status (closed-in-code / partial) / files and symbols changed / DoD 충족 근거 (MCP-005: "read 토큰 재인가 flow + write 토큰 발행 — T7~T9", MCP-007: "golden set 기계 검증 + 수동 replay 문서 — 실측 수치는 사용자 항목", 영속화: "재시작 간 동일 connector URL — T23·T26") / targeted tests (리터럴 케이스명) / residual limitation (예: "실 AS·실 ChatGPT linking 미검증", "recall/false-publication 수치 미측정", "실 ngrok 도메인 미검증").
3. **Current proof vs non-proof 분리** — executed-and-passed / executed-and-failed / not-executed / repository-claim-only 4분류로 전 검증 항목 나열. golden dataset 스키마 정합·challenge 리터럴 일치는 not-executed로 분류하고 Orchestrator targeted 실행 절차 명시.
4. **기존 테스트 기대값 변경 목록** — 목표 0. doctor 순서 조정으로 변경이 생겼다면 케이스명 + 변경 전/후 + 검증 약화가 아닌 근거.
5. **byte-compat 자기 증명** — noauth 경로에서 바뀐 wire/출력이 없다는 주장을 뒷받침하는 diff 근거(snapshot 무변경, securitySchemes 조건부 부착 지점, capabilities 모드별 스키마 구성) 나열.
6. **문서 diff 요약** — `pro-bridge-setup.md`·`SKILL.md`·golden README 변경 절별 1줄.
