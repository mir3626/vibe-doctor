# Sprint vpb-09 — 시맨틱 계약 + 토큰/리비전/App Server (remediation Phase 6·8a·9·10)

**이 Sprint 이후 사용자가 새로 할 수 있는 것**: 사용자는 (1) "설치 성공 = 실행 가능한 리뷰 패키지"를 신뢰할 수 있다 — 구조만 갖춘 무의미한 FINDINGS.json이나 한 줄짜리 구현 프롬프트는 이름 붙은 사유와 함께 거부된다. (2) `vibe:pro-mcp`가 출력하는 connector URL이 유출되어도 해당 서버 인스턴스 밖에서는 무가치하며, Ctrl+C 한 번으로 모든 세션 자격이 revoke된다. (3) 같은 폴더에 대한 세 번째 이후 교정 리뷰를 수동 이름 변경 없이 최저 가용 `-revN`으로 설치하고 provenance에서 revision 체인을 추적할 수 있다. (4) manual wire 리뷰어가 마침내 실제 patch 바이트를 프롬프트 안에서 받는다 — 실 리뷰(AUD-20260715-tlo6jc)의 reviewer limitation "The supplied patch bytes were not exposed"를 직접 닫는 payoff다. (5) Codex App Server goal source의 unavailable 확정 판정과 실측 절차를 문서에서 확인할 수 있다. 이 Sprint는 시각적 표면이 없는 CLI 제품이므로 경험 증거는 CLI transcript 3종(체크리스트 참조)으로 한정한다.

이 Sprint는 실 웹 ChatGPT Pro 리뷰(AUD-20260715-tlo6jc) remediation 패키지 중 **Phase 6 (VPB-AUD-P2-003 시맨틱 result-package 계약)**, **Phase 8 전반 (VPB-AUD-P2-004 토큰 transport)**, **Phase 9 (VPB-AUD-P3-002 revN 일반화)**, **Phase 10 (VPB-AUD-P2-001 App Server 확정 문서화 분기)** 를 구현하고, seam c(manual wire patch 미전달)와 vpb-08 Evaluator carry-over(manual.ts tmp 파일명 pid+nonce)를 편입한다. Phase 11~13(실 Web Pro 3-journey acceptance, 독립 whole-workflow audit, release closure)은 **이번 범위가 아니다.**

**P2-001 판정 근거 (Orchestrator 실측)**: 이 환경의 codex CLI는 v0.144.3이며 `codex app-server` 서브커맨드 존재 여부와 JSON-RPC 표면은 미검증이다. Generator는 샌드박스에서 프로세스 실행이 불가하므로, remediation Phase 10의 「검증 불가 시」 분기를 그대로 적용한다 — **unavailable 확정 문서화 + reconstruction을 절대 `exact`로 라벨하지 않음 보증 + 실측 절차 문서**. 실 API 어댑터 구현은 실측 가능해진 뒤 별도 Sprint다.

---

## Sprint Contract

### Target and output surface

- **P2-003**: importer가 FINDINGS.json을 버전드 스키마(`vibe-goal-audit-findings-v1`)로 검증하고, manifest `findingsSummary`와 배열 길이를 대조하며, `prompt/CLI_MAIN_SESSION_PROMPT.md`의 8요소(repository/reviewed SHA/mandatory reading/implementation order/immutable boundaries/prohibited operations/verification commands/stop conditions/final report)를 normalized heading 기반으로 시맨틱 검증한다. 정확 문구 강제 금지. 위반 시 사용자에게 이름 붙은 에러 코드로 거부 사유가 보인다.
- **P2-004**: `vibe:pro-mcp`가 고정 bearer `?token=` URL 대신 **one-time connect code URL**(`?code=`)을 출력한다. 첫 유효 제시에서 교환되어 인스턴스 스코프 세션 바인딩이 되고, 타 인스턴스 code·미교환 만료 code·제거된 `?token=` 파라미터는 401, shutdown 시 전량 revoke, 어떤 로그/파일에도 재사용 가능 capability 값이 남지 않는다.
- **P3-002**: importer 충돌 설치가 `<folder>-rev2` 고정에서 **최저 가용 `<folder>-revN`**으로 일반화되고, provenance에 revision 번호·직전(predecessor) 폴더·predecessor result hash가 기록된다.
- **P2-001**: `codex-app-server.ts` 주석과 `docs/context/pro-bridge-setup.md`에 unavailable 확정 + 실측 절차가 문서화되고, 비-app-server goal source가 `exact`로 라벨되지 않음이 테스트로 보증된다.
- **seam c**: 상한 내 patch가 리뷰 프롬프트에 fenced diff로 인라인되고(양 wire 공통), 상한 초과 시 manual outbox `patch.diff` 파일 첨부 안내로 대체된다.

### Allowed writes (Files Generator may touch — 이 목록 밖 쓰기 금지)

| 파일 | 허용 범위 |
|---|---|
| `.vibe/harness/src/lib/schemas/pro-bridge.ts` | additive만 — `FindingsFileSchema` + severity enum + prompt 계약 descriptor(요구 8요소 × synonym 패턴) export. 기존 스키마 형태 변경 금지 |
| `.vibe/harness/src/pro-bridge/importer.ts` | P2-003 계약 검증(구조 에러/계약 에러 이원화 + no-op carve-out) + P3-002 revN 선택 일반화 + provenance additive optional 필드. vpb-07 identity·vpb-08 seam(`onAfterDurableOp`) 비약화 |
| `.vibe/harness/src/pro-bridge/prompt-composer.ts` | G섹션 출력 계약 갱신(FINDINGS 스키마 스켈레톤 안내) + inline patch 섹션 + oversize 안내. 섹션 re-lettering 허용 |
| `.vibe/harness/src/pro-bridge/mailbox/server.ts` | 인증 모델 교체(one-time code 교환/세션/revoke). RPC 라우팅·origin 거부·body 상한·MCP 계약 불변 |
| `.vibe/harness/src/commands/pro-bridge.ts` | `runMcpServer` 출력(connect code URL·안내문) + manual patch artifact 호출·안내 + 필요 최소. sync/identity 경로 비약화 |
| `.vibe/harness/src/pro-bridge/transports/manual.ts` | `writeJson` tmp 이름 pid+nonce(최소 diff) + patch artifact 메서드 추가 |
| `.vibe/harness/src/pro-bridge/goal-source/codex-app-server.ts` | 주석/문서화만 — 반환값·시그니처 불변 (`unavailable` / `codex-app-server-api-unverified` 유지) |
| `.vibe/harness/src/pro-bridge/mailbox/tools.ts` | 필요 시 최소. **기본 무변경이 정답** (tool 스키마 필수 필드 추가·형태 변경 금지 — 웹 세션 호환) |
| `.vibe/harness/src/pro-bridge/mailbox/store.ts` | 필요 시 최소. **기본 무변경이 정답** (revN은 importer 소관, 토큰은 server 소관) |
| `.vibe/harness/src/pro-bridge/scope-resolver.ts` | 필요 시 최소. `PatchAttachment.diffText`가 이미 존재하므로 **기본 무변경이 정답** |
| `.vibe/harness/scripts/vibe-gen-schemas-impl.ts` | FINDINGS 스키마 출력 등록 1행 추가만 (`pro-bridge-findings.json` → `.vibe/harness/schemas/pro-bridge-findings.schema.json`) |
| `docs/context/pro-bridge-setup.md` | 토큰 모델 갱신(§2·§3·§5) + App Server unavailable 확정·실측 절차 신규 § + patch 전달 안내 |
| `.vibe/harness/test/pro-bridge-importer.test.ts`, `pro-bridge-schemas.test.ts`, `pro-bridge-composer.test.ts`, `pro-bridge-mcp-server.test.ts`, `pro-bridge-goal-source.test.ts`, `pro-bridge-transport.test.ts`, `pro-bridge-command.test.ts` | 신규 케이스 추가 + **의도된 행동 전환**(토큰 모델·G섹션 문구·rev2 고정 해제)으로 깨지는 기존 기대값 갱신만. 무관 assertion 약화 금지 |

### Do NOT modify

- `.vibe/harness/src/pro-bridge/contract.ts` — 직접 편집 금지 (lib/schemas 재수출로 신규 export가 자동 노출된다). lifecycle transition 표 불변.
- `.vibe/harness/src/pro-bridge/mailbox/tunnel.ts` — 터널 로그 통제는 문서(setup.md)로만.
- `goal-source/{resolver,vibe-goal-iterate,handoff,git-reconstruction,scope,types}.ts` — 읽기만. `exact` 라벨 가드는 테스트로 증명한다 (fallback provider들은 이미 `high`/`reconstructed`만 반환).
- `transports/{mcp-mailbox,workspace-agent,responses-api,types}.ts`, `vibe-bundle.ts`.
- **vpb-07 identity 불변식 비약화**: `resolveCurrentRepositoryIdentity` / `bindRepositoryIdentity` / fail-closed 분기 / `--dangerously-override-repository-identity` / `--accept-unbound-web-origin` / unbound 게이트 — 의미·강도 불변. `pro-bridge-identity.test.ts` 기대값 약화 금지.
- **vpb-08 lifecycle 불변식 비약화**: per-request 큐+lease/fencing, finalize journal 6-state 수렴, no-op→멱등 ack 수렴, out-of-band ack의 "index 존재 시 정확 일치" 게이트, health 5상태, `onAfterDurableOp` seam. `pro-bridge-lifecycle.test.ts`·`pro-bridge-health.test.ts` 기대값 약화 금지.
- **기존 설치 패키지 소급 강제 금지**: `docs/plans/2026-07-15-*` 전부 읽기 전용 (테스트 fixture로 읽기는 허용). 신규 시맨틱 계약은 신규 반입에만 적용되고, 이미 설치된 동일-identity 패키지의 no-op→ack 복구를 절대 막지 않는다 (사양 A-5 carve-out).
- `package.json` (신규 의존성/스크립트 0), 버전 표면, git tag(`v1.8.0` 불이동), `.vibe/config.json`, `.vibe/config.local.json`.
- 검증 약화 절대 금지: path traversal/containment, UTF-8, size, chunk/file/request/result SHA, repository/reviewed-head 바인딩, receipt 정확 일치. 시맨틱 계약 추가가 기존 구조 검증을 대체하지 않는다 — 순수 additive.
- Authorization 헤더 인증 경로 제거 금지 — 헤더 경로는 유지·선호가 remediation 원문이다.

### Explicit exceptions

- `vibe-gen-schemas-impl.ts`는 roadmap allowed writes 밖이지만 신규 durable 계약(FINDINGS 스키마)의 gen-schemas 등록을 위해 **출력 맵 1행 추가에 한해** 명시 허용한다. 생성물 `.vibe/harness/schemas/pro-bridge-findings.schema.json`은 Generator가 손으로 쓰지 않는다 — Orchestrator가 `npm run vibe:gen-schemas -- --write`로 생성 후 drift 재검증한다.
- **시맨틱 계약의 no-op carve-out**(사양 A-5)은 "검증 우회"가 아니라 vpb-08 P1-003 복구 불변식(같은 identity 재반입 → imported 수렴)의 보존이다 — 계약 에러만 있고 동일-identity 폴더가 이미 있으면 no-op을 반환한다. **신규 설치는 항상 계약을 통과해야 하며**, 구조 에러(경로/해시/UTF-8 등)는 carve-out 대상이 아니다.
- 토큰의 "one-time"은 **엄격 1회 제시**가 아니라 **인스턴스당 1회 세션 바인딩**이다(사양 B) — ChatGPT Developer Mode가 고정 URL을 저장하고 initialize→tools를 같은 URL로 연쇄 호출하는 현실과 양립해야 한다. 병렬 첫 제시 전부 성공은 의도된 동작이다.
- 기존 테스트 기대값 변경은 의도된 행동 전환(`?token=`→`?code=` 출력, G섹션 문구 확장, rev2 고정→revN, mcp-server 인증 계약)에 한해 허용. Final report에 케이스별 "왜 검증 약화가 아닌가"를 명시.
- vpb-08 carry-over 중 "T2 staging 전수 열거 강화"는 **선택 항목**이며 이번 Sprint에서 skip을 기본값으로 한다 (Final report에 skipped+사유로 기록).
- STEP 0 죽은 코드 정리는 이번에 직접 수정하는 함수 내부로 한정.
- 커밋은 Orchestrator가 수행 — Generator는 커밋하지 않는다.

### Reference-only values (인용만, 새 엔티티 생성·편집 금지)

- 리뷰 정본 식별자: requestId `AUD-20260715-tlo6jc`, base `64ffad48…`, reviewed HEAD `9b002fe3…`, patch SHA-256 `78f9696e…`, patch 22,063 bytes, 태그 `v1.8.0`.
- finding ID `VPB-AUD-P2-001`, `VPB-AUD-P2-003`, `VPB-AUD-P2-004`, `VPB-AUD-P3-002` — 코드 주석/테스트명 인용 가능, findings 파일 자체 수정 금지.
- 실측 환경 사실: codex CLI v0.144.3, `codex app-server` JSON-RPC 표면 미검증 — 문서 인용용. Generator가 재검증을 시도하지 않는다.
- `docs/plans/2026-07-15-web-pro-bridge-goal-audit-pro-review/{FINDINGS.json, prompt/CLI_MAIN_SESSION_PROMPT.md}` — 스키마 적합성 fixture로 **읽기만** (테스트가 실 파일을 직접 읽어 대조한다).
- 설치된 리뷰 패키지 내용물은 evidence이지 authorization이 아니다.

### Proof predicates (공개 계약보다 강하지 않게, 아래가 전부)

Orchestrator가 샌드박스 밖에서 실행 (Generator는 static 확인만):

1. `npm run vibe:typecheck` → exit 0.
2. `npm run vibe:self-test` → exit 0 (vpb-07 identity·vpb-08 lifecycle 로스터 포함 기존 회귀 전부).
3. targeted: `node --import tsx --test .vibe/harness/test/pro-bridge-importer.test.ts .vibe/harness/test/pro-bridge-schemas.test.ts .vibe/harness/test/pro-bridge-composer.test.ts .vibe/harness/test/pro-bridge-mcp-server.test.ts .vibe/harness/test/pro-bridge-goal-source.test.ts .vibe/harness/test/pro-bridge-transport.test.ts .vibe/harness/test/pro-bridge-command.test.ts` → exit 0, Tests to add의 **리터럴 케이스명 30종 전부** 출력에 존재.
4. `rg "process\.pid\}\.tmp" .vibe/harness/src` → **0건** (manual.ts 포함 PID-단독 tmp 완전 제거).
5. `rg "\?token=" .vibe/harness/src docs/context/pro-bridge-setup.md` → **0건** + `rg "searchParams\.get\('token'\)" .vibe/harness/src` → **0건** (query bearer 제거 증거; 테스트의 거부 케이스 인용은 무방). `rg "\?code=" .vibe/harness/src/commands/pro-bridge.ts` → ≥1건.
6. `rg "vibe-goal-audit-findings-v1" .vibe/harness/src/lib/schemas/pro-bridge.ts` → ≥1건. `npm run vibe:gen-schemas -- --write` 후 `npm run vibe:gen-schemas` → drift 없음, `.vibe/harness/schemas/pro-bridge-findings.schema.json` 존재.
7. `rg "confidence: 'exact'" .vibe/harness/src/pro-bridge/goal-source` → **0건** (P2-001 exact-라벨 금지의 소스 레벨 증거).
8. 회귀 가드: `rg "dangerously-override-repository-identity|accept-unbound-web-origin" .vibe/harness/src/commands/pro-bridge.ts` → 두 플래그 존재. `rg "onAfterDurableOp" .vibe/harness/src/pro-bridge` → store.ts·importer.ts 존재. `git diff -- .vibe/harness/src/pro-bridge/contract.ts .vibe/harness/src/pro-bridge/mailbox/tunnel.ts` → 빈 출력.
9. `git status --porcelain -- docs/plans` → 빈 출력. `git diff -- package.json .vibe/config.json` → 빈 출력.
10. 자기 적합성: 케이스 9(checked-in 패키지 적합성)가 **실 파일을 읽어** 통과 — 우리 자신의 리뷰 패키지가 신 스키마·신 프롬프트 계약에 적합함을 실증.

### Current proof and non-proof

Generator Final report는 증거를 반드시 두 칸으로 분리한다: **fresh evidence**(이번 세션에서 실제 실행·확인한 것 — Windows sandbox 특성상 대부분 static inspection과 grep)와 **non-proof**(skipped / blocked / inferred / proxy / historical — 예: "테스트는 작성했으나 실행하지 못함, Orchestrator 실행 대기"). 실행하지 못한 검증을 통과로 표기하는 것을 금지한다.

---

## 필수 참조 (구현 전 읽기 순서)

1. `docs/plans/2026-07-15-web-pro-bridge-goal-audit-pro-review/FINDINGS.json` — P2-001/P2-003/P2-004/P3-002 전문 (requiredRemediation / requiredTests). **동시에 스키마 설계의 1차 fixture다** — 신 스키마는 이 파일을 그대로 통과시켜야 한다.
2. 같은 패키지 `REVIEW.md` — §5 해당 finding 상세(특히 P2-003 "structurally present but operationally useless", P2-004 query URL 유출 경로), §10 authorization boundary.
3. 같은 패키지 `prompt/CLI_MAIN_SESSION_PROMPT.md` — Phase 6(스키마 필수 필드 + "Do not require exact prose, but require normalized semantic headings or machine-readable metadata"), Phase 8(one-time code 요구 5항), Phase 9(lowest available revN + predecessor hash), Phase 10(검증 불가 시 분기), "Package contract" 테스트 로스터 8종 리터럴. **이 파일 자체가 프롬프트 시맨틱 검증의 2차 fixture다** (Mandatory reading / Required implementation order / Immutable boundaries / Prohibited operations / Exact verification commands / Stop conditions / Final report requirements 헤딩 + `mir3626/vibe-doctor` + reviewed HEAD 리터럴 보유).
4. 현행 구현 anchor:
   - `.vibe/harness/src/pro-bridge/importer.ts` — `ImportValidationErrorCode`(69~92행), FINDINGS `JSON.parse`-만 검증(577~584행), `empty-prompt`(568~576행), rev2 고정 선택(691~741행), `ProvenanceReceipt`(133~157행), `existingProvenance`/`noOpOutcome`(334~404행), `errors.length > 0 → invalid` 조기 반환(681~683행 — carve-out 삽입 지점).
   - `.vibe/harness/src/lib/schemas/pro-bridge.ts` — `ReviewResultManifestSchema.findingsSummary`(소문자 `p0~p3`), `GitShaSchema`/`Sha256HexSchema` 재사용.
   - `.vibe/harness/src/pro-bridge/prompt-composer.ts` — `CLI_PROMPT_REQUIREMENTS`(96~105행), `renderOutputContract`(201~225행), `renderPatchDetails`(188~199행), 섹션 A~I 구조(236~278행).
   - `.vibe/harness/src/pro-bridge/mailbox/server.ts` — `suppliedToken`(53~60행: `?token=` 판독 지점), `tokenMatches`(timingSafeEqual), 401/`WWW-Authenticate` 처리(143~147행).
   - `.vibe/harness/src/commands/pro-bridge.ts` — `runMcpServer`(1181~1239행: 토큰 발급·connector URL 출력), `deps.randomToken`(124행), `createAndPublish`(472~575행: manual 발행 지점 — patch artifact 호출 삽입), `publicationSummary`(427~450행).
   - `.vibe/harness/src/pro-bridge/transports/manual.ts` — `writeJson`(88~93행: `${filePath}.${process.pid}.tmp` — carry-over 지점), `createRequest`(131~161행).
   - `.vibe/harness/src/pro-bridge/scope-resolver.ts` — `PatchAttachment.diffText`(13~19행: 이미 secret/binary 필터링·control-char 검사 완료된 텍스트), `DEFAULT_MAX_PATCH_BYTES`.
   - `.vibe/harness/src/pro-bridge/goal-source/codex-app-server.ts` — 현행 stub 전문.
5. 기존 테스트 스타일: `pro-bridge-importer.test.ts`(bundle/files 헬퍼), `pro-bridge-mcp-server.test.ts`(포트 0 실서버 + fetch + 로그 마스킹 케이스), `pro-bridge-command.test.ts`(FakeGit·captureIo·`randomToken` 주입, 636행 connector URL 기대값), `pro-bridge-composer.test.ts`.
6. `docs/context/pro-bridge-setup.md` — 갱신 대상 §2·§3·§5 현행 문구.

---

## 기술 사양

### A. P2-003 — 시맨틱 result-package 계약 (Phase 6)

**A-1. 버전드 FINDINGS 스키마** (`lib/schemas/pro-bridge.ts`, additive export):

`FindingsFileSchema` — zod, **loose**(비-strict; 리뷰어의 추가 필드 허용). 필수 필드는 remediation Phase 6 리터럴 + 정본 fixture의 실 형태를 따른다:

- `schemaVersion`: literal `'vibe-goal-audit-findings-v1'` (정본 fixture가 이미 이 값을 사용한다 — audit/design 양 kind 공용 wire 버전으로 고정하고, kind-중립 개명은 미래 v2로 미룬다).
- `requestId`: string min 1.
- `repository`: `{ fullName: /^[^/\s]+\/[^/\s]+$/ }` loose.
- `snapshot`: `{ baseSha: GitShaSchema, headSha: GitShaSchema }` loose (reviewed refs).
- `disposition`: string min 1.
- `summary`: `{ P0, P1, P2, P3: int ≥ 0 }` loose (`total` 등 추가 필드 허용).
- `reviewerDeclaration`: `{ surface: string, requestedMode: string, githubConnectorUsed: boolean, limitations: string[] }` loose.
- `P0`/`P1`/`P2`/`P3`: 각각 finding 배열. finding = `{ id: string min 1, severity: z.enum(['P0','P1','P2','P3']), title: string min 1 }` loose.

**A-2. 시맨틱 교차 검증** (importer, zod 통과 후):

| 검사 | 실패 코드 (additive `ImportValidationErrorCode`) | 조건부 skip |
|---|---|---|
| 배열 `PN`의 모든 finding이 `severity === 'PN'` | `findings-severity-mismatch` | 없음 |
| `summary.PN === PN.length` (4개 전부) | `findings-summary-mismatch` | 없음 |
| manifest 존재 시 `manifest.findingsSummary.pN === summary.PN` | `findings-summary-mismatch` | manifest 부재 → 기존 `result-manifest-unavailable` skip 체계로 흡수 |
| request 존재 시 `findings.requestId === 유효 requestId` | `findings-binding-mismatch` | request 부재 → `findings-request-binding-skipped` 기록 |
| manifest 존재 시 `findings.repository.fullName === manifest.repositoryFullName` && `findings.snapshot.headSha === manifest.reviewedHeadSha` | `findings-binding-mismatch` | manifest 부재 → skip |
| zod 자체 실패 (필수 필드/schemaVersion 부재 포함) | `findings-schema-violation` | 없음 |

FINDINGS.json이 존재하는 모든 반입(audit·design 공통 — 양 kind 모두 required file)에 적용. 기존 `findings-parse-error`(JSON.parse)는 유지하고 그 다음 단계로 스키마 검증을 얹는다.

**A-3. 프롬프트 시맨틱 검증** (`prompt/CLI_MAIN_SESSION_PROMPT.md`):

- 검증 방식: **normalized semantic heading** — 프롬프트 전체를 정규화(소문자화, 마크다운 장식 제거)한 뒤 요구 요소별 synonym 패턴 매칭. **정확 문구 강제 금지** — 패턴은 synonym family다.
- 요구 요소 8종과 최소 synonym family (정확한 regex는 Generator 재량이되 아래 4조건 필수 — (a) 정본 fixture 프롬프트 통과, (b) 한 줄 프롬프트 불통과, (c) 정확 문구 비강제, (d) descriptor를 `lib/schemas/pro-bridge.ts`에서 데이터로 export해 importer 검증·composer G섹션 안내가 **단일 소스** 공유):
  1. repository identity — 기대 fullName 리터럴 포함 (기대값 = `manifest.repositoryFullName ?? request.repository.fullName`; 둘 다 부재 → `prompt-repository-binding-skipped` 기록 후 통과).
  2. reviewed SHA — 기대 headSha 리터럴 포함 (기대값 = `manifest.reviewedHeadSha ?? request.git.headSha`; 부재 → `prompt-reviewed-head-binding-skipped`).
  3. mandatory reading (`mandatory reading` / `required reading` / `must read` …)
  4. implementation order (`implementation order` / `implementation sequence` / `implementation phases` …)
  5. immutable boundaries (`immutable boundar` / `invariant` …)
  6. prohibited operations (`prohibited` / `forbidden` …)
  7. verification commands (`verification command` / `exact verification` / `verification steps` …)
  8. stop conditions + final report (`stop condition` … / `final report` …) — 각각 별도 매칭.
- 실패 코드: `prompt-contract-violation` (메시지에 누락 요소명 포함, 요소별 1 에러). 기존 `empty-prompt`는 유지.

**A-4. composer G섹션(출력 계약) 갱신**: `renderOutputContract`에 리뷰어가 만들 FINDINGS.json의 **JSON 스켈레톤**을 추가한다 — `schemaVersion` 리터럴, 필수 필드, "각 finding의 severity는 자신이 속한 배열명과 같아야 한다", "summary 카운트 = 배열 길이 = finalize manifest의 findingsSummary". 프롬프트 필수 8요소 목록(`CLI_PROMPT_REQUIREMENTS`)은 A-3 descriptor와 정합하게 유지.

**A-5. 하위호환 carve-out (신규 반입만 강제)**: 에러를 두 버킷으로 나눈다 — **구조 에러**(기존 전 코드: 경로/해시/UTF-8/size/roster/바인딩 등)와 **계약 에러**(A-2·A-3의 신규 코드). 구조 에러 ≥ 1 → 즉시 `invalid` (현행과 동일). **계약 에러만 존재**하는 경우: 대상 폴더(base + revN 스캔 포함)의 동일-identity no-op이 성립하면 **no-op을 반환**한다 (이미 설치된 패키지의 재반입·ack 수렴 복구 — vpb-08 P1-003 불변식 보존, 소급 강제 금지). no-op 불성립이면 `invalid`(계약 에러). **신규 설치(installed)는 계약 에러가 하나라도 있으면 절대 도달하지 않는다.**

**A-6. gen-schemas 등록**: `vibe-gen-schemas-impl.ts` 출력 맵에 `'pro-bridge-findings.json': '.vibe/harness/schemas/pro-bridge-findings.schema.json'` + `allSchemas` 항목 추가. 생성 실행은 Orchestrator.

### B. P2-004 — one-time connect code 토큰 모델 (Phase 8 전반)

**설계 (고정)** — ChatGPT Developer Mode는 고정 URL을 저장하고 매 호출 같은 URL(query 포함)을 보낸다. 따라서 "one-time"은 엄격 1회 제시가 아니라 **인스턴스당 1회 세션 바인딩**으로 정의한다. 목표: (a) 유출된 URL은 서버 재시작 후 무가치, (b) 로그/출력 마스킹, (c) 인스턴스 스코프, (d) initialize→tools/list→tools/call 자동 연쇄와 양립.

| 이벤트 | 동작 |
|---|---|
| 서버 기동 | `connectCode` 발급 (≥32바이트 entropy base64url; `deps.randomToken` 주입 seam 유지). `connector URL: <base>/mcp?code=<connectCode>` **1회만** 출력 |
| 첫 유효 제시 (`?code=` query 또는 `Authorization: Bearer <code>`) | **교환**: `exchangedAt` 기록 + 내부 `sessionToken` 민트 (어디에도 출력·로깅 금지, 테스트용 accessor만) |
| 이후 동일 code 제시 | 세션 지속으로 승인 (교환된 code = 세션 핸들; ChatGPT 고정 URL 현실) |
| 병렬 첫 제시 (동일 code 동시 N건) | **전부 성공** — 교환은 멱등 바인딩이지 1회 소모가 아니다 |
| `Authorization: Bearer <sessionToken>` | 승인 (헤더 경로 유지·선호) |
| 미교환 code가 교환 창 초과 (`exchangeTtlMs` 주입, 기본 15분) | 401 |
| 세션 절대 TTL 초과 (`sessionTtlMs` 주입, 기본 12시간) | 401 |
| 타 인스턴스 code / 임의 값 | 401 (상태는 메모리 전용 — 인스턴스 간 어떤 자격도 전달되지 않는다) |
| **`?token=` query 파라미터** | **제거 — 항상 401** (`suppliedToken`의 query 판독 삭제) |
| shutdown (`close()` / Ctrl+C) | `revoke()` — code·sessionToken·교환 상태 전량 소거, 이후 모든 요청 401 |

구현 요건: 비교는 전부 `timingSafeEqual` 유지. 401 시 `WWW-Authenticate: Bearer` 유지. 시간은 전부 주입(`now`) — 실 sleep 금지. `McpServerOptions`의 인증 표면 교체는 재량이되(예: `token: string` → 세션 auth 객체/팩토리) MCP RPC 계약·origin 거부·body 상한은 불변.

**출력·로그 계약**: connector URL 1줄 외에 code/sessionToken이 어떤 stdout/stderr/로그 라인·파일에도 나타나지 않는다. 서버 로그는 pathname만 기록(기존 유지) — query·인증 값 절대 미기록. `runMcpServer` 안내문 갱신: "URL의 code는 1회 교환용 — 첫 연결에서 이 서버 인스턴스에 바인딩되며, 서버 재시작 시 무효. 세션 밖 저장·공유 금지."

**문서 갱신** (`pro-bridge-setup.md`): §2(출력 설명 — code URL), §3(Developer Mode 등록 — 인증 `None` 유지, "URL 내 값은 교환용 one-time code, 서버 재시작 시 connector URL 갱신 필요" 문구), §5(경계 — one-time 교환·인스턴스 스코프·shutdown revoke·재사용 가능 capability URL 미출력·터널 제공자 로그 통제 주의).

### C. P3-002 — 최저 가용 revN + predecessor provenance (Phase 9)

1. **슬롯 선택 일반화** (importer): 충돌 + `approveRevision` 승인 시 `<folder>-rev2` 고정 대신 —
   - installRoot를 1회 readdir하여 `<folder>` 및 `<folder>-rev<N>` (N = 2~99) 실존 집합을 구한다.
   - **동일-identity 스캔 우선**: base 포함 실존 전 슬롯의 provenance를 대조해 동일 result identity가 있으면 해당 슬롯 no-op 반환 (gap이 있어도 중복 설치 금지).
   - 없으면 **최저 가용 N ≥ 2** 선택 (gap 채움 — remediation 리터럴 "lowest available"). 후보명이 `FOLDER_NAME_PATTERN`(길이 80) 초과면 `invalid-folder`. N > 99 소진 시 `revision-slot-occupied` refused.
2. **provenance additive optional 필드** (`ProvenanceReceipt`, schemaVersion `vibe-pro-bridge-provenance-v1` 유지):
   - `revision?: number` — base 설치 1, revN 설치 N.
   - `revisionOf?: string | null` — predecessor **폴더명** (실존 최고 revision 폴더; gap을 채워도 predecessor는 최신 내용 보유 폴더다 — 폴더명 순서가 아니라 provenance가 체인 순서의 정본).
   - `predecessorResultSha256?: string | null` — predecessor 폴더 provenance의 result identity (`resultPayloadSha256 ?? resultFilesSha256`; 판독 불가 시 null).
   - `existingProvenance` 파서는 tolerant 유지 — 구 provenance(필드 부재) 판독 불변. 기존 설치 폴더의 provenance를 절대 재작성하지 않는다.
3. approveRevision 미승인 충돌의 `existing-folder-conflict` refused, 기존 rev2 폴더들의 동작은 불변.

### D. P2-001 — App Server unavailable 확정 (Phase 10 「검증 불가 시」 분기)

1. `codex-app-server.ts`: TODO 주석을 **확정 판정 주석**으로 교체 — (a) 판정: unavailable 확정, 근거: codex CLI v0.144.3 실측 시 `codex app-server` JSON-RPC 표면 미검증 (Orchestrator 실측, 2026-07), (b) 반환 계약 불변: `{ status: 'unavailable', reason: 'codex-app-server-api-unverified' }`, (c) private-reasoning 추출 금지 경계 유지 문구, (d) 실측 절차는 `docs/context/pro-bridge-setup.md` 해당 § 참조, (e) 실 구현은 실측 완료 후 별도 Sprint. **동작·시그니처 변경 0.**
2. `pro-bridge-setup.md` 신규 §: "Codex App Server goal source — unavailable (확정)" — 실측 절차를 **코드가 아니라 문서**로: ① `codex --version` 확인, ② `codex app-server` 서브커맨드 존재·`--help` 표면 확인, ③ JSON-RPC handshake(initialize → thread 목록 → goal 조회) 검증 항목과 성공 판정 기준, ④ private reasoning 미접근 경계, ⑤ 검증 완료 시 어댑터 구현을 별도 Sprint로 진입. 그때까지 fallback provider(`vibe-goal-iterate`→handoff→git)가 결정적으로 동작하며 결과는 `high`/`reconstructed`로만 라벨된다는 사용자 안내.
3. **exact-라벨 금지 보증 테스트**: goal-source resolver 경유 결과에서 비-app-server 출처의 `confidence`가 절대 `'exact'`가 아님을 assert (소스 grep 증거는 proof predicate 7).

### E. seam c — manual wire patch 전달

1. **inline patch 섹션** (prompt-composer, 양 wire 공통 — reviewPrompt에 실리므로 manual prompt.md와 mailbox `get_request` 모두 전달):
   - 예산: `DEFAULT_INLINE_PATCH_BYTES = 64 * 1024` (composer 상수; `ComposerInput.inlinePatchBudgetBytes?: number` 주입 가능 — config 확장은 이번 범위 아님). 정본 리뷰의 실 patch 22,063 bytes가 예산 내에 들어오는 값이다.
   - `scope.patch !== null && patch.byteLength <= 예산`이면 review dimensions와 output contract 사이에 patch 섹션 삽입: 헤더("authoritative local-only delta — GitHub base 위에 개념 적용", SHA-256, byteLength) + fenced diff. **fence 안전**: diffText 내 최장 backtick run + 1 (최소 4)의 backtick fence 사용. 섹션 re-lettering 허용 (기존 섹션 내용 전부 보존).
   - 예산 초과: 섹션 대신 기존 metadata + "patch는 인라인되지 않음 — 대화에 patch 파일을 직접 첨부하라" 명시 안내.
   - diffText는 scope-resolver가 이미 secret-path 제외·binary 제외·control-char 검사를 마친 텍스트다 — composer에서 재필터링하지 않는다 (이중 필터로 인한 불일치 방지).
2. **manual outbox patch artifact**: `ManualDirectoryTransport`에 additive 메서드(예: `writePatchArtifact(requestId, patch: { diffText, sha256, byteLength })`) — `<requestDir>/patch.diff` 기록 (atomic tmp+rename, 신규 nonce 네이밍). `createAndPublish`(manual wire)에서 scope.patch 존재 시 호출하고 경로를 출력: 예산 내면 참고 안내, 예산 초과면 "이 파일을 대화에 첨부하세요" 강조.
3. mcp-mailbox wire의 예산 초과 patch는 이번 Sprint에서 전달 수단이 없다 — Final report에 residual limitation으로 명시 (웹 리뷰어용 fetch tool 확장은 범위 밖).

### F. carry-over — manual.ts tmp nonce

`transports/manual.ts` `writeJson`(89행): `${filePath}.${process.pid}.tmp` → `${filePath}.${process.pid}.${randomBytes(16).toString('hex')}.tmp` (store.ts 624행 패턴과 동일). `node:crypto` import 추가. **최소 diff** — 다른 리팩토링 금지.

### G. Finding별 closure 매핑 표

| Finding | Phase | 구현 지점 (파일:심볼) | 복원되는 설계 불변식 | Proof |
|---|---|---|---|---|
| VPB-AUD-P2-003 | 6 | `lib/schemas/pro-bridge.ts`: `FindingsFileSchema` + prompt descriptor; `importer.ts`: A-2/A-3 검증 + A-5 carve-out; `prompt-composer.ts`: G섹션; `vibe-gen-schemas-impl.ts`: 등록 | 설치 성공 = 구조·시맨틱 계약을 모두 충족하는 실행 가능 패키지; 기존 설치 no-op 복구 비차단 | T1~T11, T29 + predicate 6·10 |
| VPB-AUD-P2-004 | 8 전반 | `mailbox/server.ts`: code 교환/세션/revoke; `commands/pro-bridge.ts`: `runMcpServer` 출력; `pro-bridge-setup.md` §2·§3·§5 | 유출 URL은 인스턴스 밖 무가치; 재사용 가능 capability 값 미출력·미로깅; shutdown 전량 revoke; 헤더 경로 유지 | T12~T19 + predicate 5 |
| VPB-AUD-P3-002 | 9 | `importer.ts`: 최저 가용 revN + 동일-identity 전 슬롯 스캔 + provenance 3필드 | revision 체인 무상한(계약 내) 설치; provenance가 체인 순서의 정본; 기존 불변 폴더 보존 | T20~T24 |
| VPB-AUD-P2-001 | 10 | `goal-source/codex-app-server.ts` 주석; `pro-bridge-setup.md` 신규 §; resolver 테스트 | 미검증 API 비구현 + 한계 공표; reconstruction은 절대 `exact`가 아님 | T25 + predicate 7 |
| seam c | — | `prompt-composer.ts`: inline 섹션; `transports/manual.ts` + `commands/pro-bridge.ts`: patch artifact | 리뷰어가 정본 delta 바이트를 실제로 수령 (실 리뷰 limitation 해소) | T26~T28 |
| carry-over (vpb-08) | — | `transports/manual.ts`: `writeJson` nonce | PID 초과 유니크 tmp — 하네스 전체 0건 수렴 | T30 + predicate 4 |

### H. vpb-09 경계

- **이번 범위 아님**: Phase 11(실 Web Pro 3-journey acceptance), Phase 12(독립 whole-workflow audit), Phase 13(release closure — 버전 bump·태그·sync-manifest 종결). P1-005는 열린 상태로 유지된다.
- App Server 실 어댑터 구현 — 실측 후 별도 Sprint.
- config 스키마 확장(inline patch 예산의 config 노출), 웹 리뷰어용 patch fetch tool — 필요 판명 시 다음 Sprint backlog.

---

## Tests to add

node:test `describe`/`it`, 주입 `now`/`randomToken`/예산 — **실 sleep·실 네트워크(로컬 포트 0 서버 제외) 금지**. `mkdtemp` 임시 루트, 기존 헬퍼 패턴 재사용. **아래 `it()` 케이스명 30종은 리터럴로 고정한다** (Orchestrator가 출력에서 grep으로 대조).

Package contract — 11종 (`pro-bridge-importer.test.ts` T1~T8·T10~T11, `pro-bridge-schemas.test.ts` T9; T1~T8은 remediation "Package contract" 로스터 8종 리터럴 대응):

1. `rejects FINDINGS.json missing the P0-P3 arrays`
2. `rejects a finding whose severity does not match its array`
3. `rejects a findings file whose counts disagree with the manifest summary`
4. `rejects an empty or one-line implementation prompt`
5. `rejects a prompt missing the repository identity`
6. `rejects a prompt missing the reviewed SHA`
7. `rejects a prompt missing verification commands`
8. `rejects a prompt missing a stop condition`
9. `accepts the checked-in remediation package under the versioned findings contract` — `docs/plans/2026-07-15-web-pro-bridge-goal-audit-pro-review/`의 **실 FINDINGS.json·실 prompt 파일을 읽어** 스키마·프롬프트 계약 통과 assert (자기 적합성 — 이 패키지가 깨지면 스키마가 잘못된 것이다)
10. `returns no-op for an installed legacy package despite new contract violations` — 동일-identity 기설치 + 계약 위반 재반입 → no-op (A-5 carve-out; ack 수렴 경로 보존)
11. `keeps structural validation fatal even when a same-identity folder exists` — 구조 에러(예: file-sha-mismatch)는 carve-out 없이 invalid

Token — 8종 (`pro-bridge-mcp-server.test.ts` + command 출력은 `pro-bridge-command.test.ts` 기존 케이스 갱신):

12. `exchanges the one-time connect code and continues the session on the fixed URL` — 첫 `?code=` 요청 성공 + 동일 URL 후속 요청 연속 성공 (ChatGPT 고정 URL 흐름)
13. `rejects the removed token query parameter` — `?token=<옛 방식 값>` → 401
14. `rejects a connect code from a previous server instance` — 인스턴스 재생성 후 구 code → 401
15. `rejects an unexchanged connect code after the exchange window` — 주입 `now`로 창 초과 → 401
16. `revokes all session credentials on shutdown` — revoke 후 code·sessionToken 전부 401
17. `authorizes concurrent first requests during the initial exchange` — 동일 code `Promise.all` N건 전부 성공
18. `accepts the session credential from the authorization header` — Bearer 헤더 경로 유지
19. `masks the connect code and session token in server logs` — 로그 라인에 code/sessionToken/query 부재 (기존 마스킹 케이스 확장)

Revision — 5종 (`pro-bridge-importer.test.ts`):

20. `installs a third corrected result into the lowest available rev3 folder`
21. `fills a revision gap with the lowest available revision slot` — base·rev3 실존, rev2 공백 → rev2 선택 + predecessor는 실존 최고 revision
22. `returns no-op when any revision folder already holds the same result` — gap 너머 rev3에 동일 identity → no-op (중복 설치 금지)
23. `records the revision number and predecessor result hash in provenance` — `revision`/`revisionOf`/`predecessorResultSha256` assert
24. `rejects a revision folder that exceeds the folder name contract` — 길이 한계 → invalid-folder

App Server — 1종 (`pro-bridge-goal-source.test.ts`):

25. `never labels a non-app-server goal source as exact` — fallback provider 산출 전부 `confidence !== 'exact'`

seam c — 4종 (`pro-bridge-composer.test.ts` T26·T27·T29, `pro-bridge-transport.test.ts` T28):

26. `inlines a bounded patch into the review prompt with a safe fence` — 예산 내 diffText가 프롬프트에 존재 + diffText에 backtick run을 심어 fence 파손 없음 assert
27. `omits the inline patch and directs to the patch artifact when over budget` — 예산 초과 → 인라인 부재 + 첨부 안내 존재
28. `writes the patch artifact next to the manual request prompt` — `<requestDir>/patch.diff` 존재 + 내용 SHA-256 = `patch.sha256`
29. `announces the versioned findings contract in the output package section` — G섹션에 `vibe-goal-audit-findings-v1` 스켈레톤·severity/카운트 규칙 존재

Carry-over — 1종 (`pro-bridge-transport.test.ts`):

30. `uses pid plus nonce temporary names for manual transport writes` — 동일 목적지 동시 writeJson 무충돌 또는 tmp 네이밍 패턴 assert

공통 원칙: 계약 거부 케이스는 **에러 코드 리터럴**(`findings-schema-violation` 등)까지 assert한다. 토큰 케이스는 시간을 전부 주입한다. revN 케이스는 기존 폴더 provenance가 **재작성되지 않았음**을 assert한다. 기존 파일 갱신: `?token=` 출력·G섹션 문구·rev2 고정을 전제한 기존 기대값은 새 행동으로 갱신하고 Final report에 케이스별 사유를 남긴다 (특히 `pro-bridge-command.test.ts` 636행 `mcp subcommand …` 케이스, `pro-bridge-mcp-server.test.ts` 162행 query 승인 케이스).

---

## 실행 제약

- **Windows sandbox**: Generator는 npm/네트워크/테스트 실행 불가 — static inspection과 코드 작성만. 실행 검증(typecheck/self-test/targeted/gen-schemas)은 Orchestrator가 수행한다. 실행하지 못한 검증을 통과로 보고하지 말 것.
- **신규 의존성 0, 신규 스크립트 0.** `package.json` 무변경. 토큰/nonce는 `node:crypto`만 사용.
- NodeNext ESM — 상대 import는 `.js` 확장자. UTF-8 (BOM 없음). 기존 한국어 사용자 메시지 톤 유지.
- 테스트는 `.vibe/harness/test/` 직속, node:test만. 시간 의존 전부 주입 — suite 시간 폭증 금지.
- 예상 규모 ~600 LOC (테스트 포함) — 상한이 아니라 규모 감각이다. 계약 복원과 로스터 충족이 우선.

---

## 완료 체크리스트 (Verification)

### 기계 검증 (Orchestrator 실행)

- [ ] `npm run vibe:typecheck` exit 0
- [ ] `npm run vibe:self-test` exit 0 (vpb-07 identity·vpb-08 lifecycle 로스터 무손상)
- [ ] targeted 7파일 exit 0 + 리터럴 케이스명 30종 전부 출력에 존재 (proof predicate 3)
- [ ] `rg "process\.pid\}\.tmp" .vibe/harness/src` 0건
- [ ] `rg "\?token=" .vibe/harness/src docs/context/pro-bridge-setup.md` 0건 + `rg "searchParams\.get\('token'\)" .vibe/harness/src` 0건 + `rg "\?code=" .vibe/harness/src/commands/pro-bridge.ts` ≥1건
- [ ] `npm run vibe:gen-schemas -- --write` → `pro-bridge-findings.schema.json` 생성 → `npm run vibe:gen-schemas` drift 없음
- [ ] `rg "confidence: 'exact'" .vibe/harness/src/pro-bridge/goal-source` 0건
- [ ] 회귀 가드 grep 3종 (proof predicate 8) 통과
- [ ] `git status --porcelain -- docs/plans` 빈 출력, `git diff -- package.json .vibe/config.json` 빈 출력
- [ ] 자기 적합성 케이스 9 통과 (정본 패키지가 신 계약에 적합)

### Inspection / demo AC (Orchestrator·Evaluator·사용자)

- [ ] **CLI transcript 3종 확보** (이 Sprint의 사용자 payoff 증거 — CLI 제품이므로 transcript가 identity/payoff evidence를 대신한다): ① `vibe:pro-mcp` 기동 출력 — `?code=` connector URL 1회 출력 + code/token이 다른 어떤 라인에도 없음, ② manual audit 발행 — 생성된 prompt.md에 inline patch fenced 섹션(또는 초과 시 patch.diff 첨부 안내) 존재, ③ 계약 위반 bundle 반입 거부 — 이름 붙은 에러 코드와 읽을 수 있는 한국어 사유 출력.
- [ ] 검증 약화 부재 (Evaluator 대조): 시맨틱 계약이 기존 구조 검증을 대체하지 않고 순수 additive인가. A-5 carve-out이 **동일-identity no-op에만** 적용되고 신규 설치를 절대 통과시키지 않는가. `?token=` 제거가 Authorization 헤더 경로를 훼손하지 않았는가.
- [ ] 토큰 모델의 ChatGPT 양립성 (Evaluator 대조): 교환이 멱등 바인딩(병렬 첫 제시 전부 성공)이고 엄격 1회 소모가 아닌가 — 엄격 1회면 initialize→tools 연쇄에서 즉사한다.
- [ ] 기존 설치 패키지 소급 비강제 (Evaluator 대조): `docs/plans/2026-07-15-*` 무변경 + T10 carve-out 실증.
- [ ] >5 파일이므로 **Evaluator 소환은 Must**.

---

## Final report 요구 (Generator 출력 필수 형식)

1. **`## Wiring Integration`** — `.vibe/agent/_common-rules.md` §14의 W1~W14 각 항목을 `touched / n/a / skipped+reason`으로 보고. 이번 Sprint 예상: W6 n/a+근거 (`.vibe/harness/schemas/**` glob이 sync-manifest에 기등록 — 신규 schema 파일 자동 포함), W11 n/a+근거 (provenance 신규 필드는 additive optional + tolerant 파서 — T10/T22가 하위호환 증거), W12 touched (신규 케이스 30종), W10 skipped+사유 (P1-005 미결 — release 기록은 release-closure Sprint로 이월), W1/W2/W8/W9/W13/W14 n/a. 삭제/개명 없음이면 D1~D6 n/a. 신규 export(`FindingsFileSchema`, prompt descriptor, patch artifact 메서드)에 `verified-callers:` 명시 (grep으로 확인된 실제 import·호출 지점).
2. **Finding별 closure 증거** — `VPB-AUD-P2-003`, `VPB-AUD-P2-004`, `VPB-AUD-P3-002`, `VPB-AUD-P2-001`, `seam-c`, `carry-over(tmp nonce)` 각각: status (closed-in-code / documented-unavailable / partial) / files and symbols changed / design invariant restored (한 문장) / targeted tests (리터럴 케이스명) / residual limitation (예: "mailbox wire의 예산 초과 patch 전달 수단 없음", "실 ChatGPT 커넥터에서의 code 교환 실측은 Phase 11", "App Server 실 어댑터는 실측 후 별도 Sprint").
3. **Current proof vs non-proof 분리** — executed-and-passed / executed-and-failed / not-executed / repository-claim-only 4분류로 모든 검증 항목 나열.
4. **기존 테스트 기대값 변경 목록** — 케이스명 + 변경 전/후 행동 + 검증 약화가 아닌 근거 (토큰 모델·G섹션·rev2 관련 예상 갱신 포함).
5. **문서 diff 요약** — `pro-bridge-setup.md` 변경 §별 1줄 요약 (토큰 모델 / App Server 확정 / patch 안내).
