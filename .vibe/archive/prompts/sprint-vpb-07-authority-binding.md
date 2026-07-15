# Sprint vpb-07 — Fail-closed repository authority + 바인딩 seam (remediation Phase 2·7)

**이 Sprint 이후 사용자가 새로 할 수 있는 것**: 사용자는 다른 저장소의 리뷰 패키지가 현재 저장소에 설치되는 것을 기본 차단하는 fail-closed `vibe:pro-sync`를 쓸 수 있고, 실측(2026-07-15 12:51)에서 실패했던 두 왕복 — ① transport=mcp-mailbox에서 `--from` 번들 설치가 성공했는데도 에러로 오보되던 것, ② mailbox로 생성한 요청의 결과가 manual vibe-bundle로 돌아올 때 "일치하는 outbox 요청이 없습니다"로 거부되던 것 — 을 실제로 완주할 수 있다. 바인딩 메타데이터가 전혀 없는 Web-origin 패키지는 이제 명시 승인 플래그 없이는 설치되지 않는다. 이 Sprint는 시각적 표면을 건드리지 않으므로 경험 증거는 CLI 출력 transcript로 한정한다(체크리스트 참조).

이 Sprint는 실 웹 ChatGPT Pro 리뷰(AUD-20260715-tlo6jc)의 remediation 패키지 중 **Phase 2 (VPB-AUD-P1-004 fail-closed identity)** 와 **Phase 7 (VPB-AUD-P2-002 manual trust gate)**, 그리고 Orchestrator 실측 seam 2건을 구현한다. Phase 3~5 (P1-001/002/003 — 동시성·finalize journal·ack 의미론)는 **vpb-08 범위이며 이번에 건드리지 않는다.**

---

## Sprint Contract

### Target and output surface

- `npm run vibe:pro-sync` (== `vibe-pro-bridge sync`)의 모든 모드(`--latest` / 암묵 단일 result / positional requestId / `--from`·클립보드 번들)에서 저장소 정체성이 fail-closed로 강제되는 사용자 가시 동작.
- 설치 성공 시 성공 요약 + nextAction 출력이 반드시 나오는 것 (mailbox 후처리 실패가 성공을 가리지 않음).
- mailbox 생성 요청 + manual wire 결과의 cross-transport 바인딩 성공.
- unbound Web-origin 반입의 기본 거부 + 고마찰 승인 경로.
- `.bridge/provenance.json`에 정체성·승인 기록 필드 추가 (additive).

### Allowed writes (이 목록 밖 쓰기 금지)

| 파일 | 허용 범위 |
|---|---|
| `.vibe/harness/src/commands/pro-bridge.ts` | 전면 (sync 경로 중심) |
| `.vibe/harness/src/pro-bridge/importer.ts` | 전면 (검증 약화 금지) |
| `.vibe/harness/src/pro-bridge/transports/manual.ts` | 전면 |
| `.vibe/harness/src/pro-bridge/transports/mcp-mailbox.ts` | 전면 |
| `.vibe/harness/src/pro-bridge/mailbox/store.ts` | **읽기 조회 API 추가만.** lifecycle 변이 메서드(`claimRequest`/`beginResult`/`putResultFile`/`finalizeResult`/`acknowledgeImport`/`cancelRequest`/`writeStatus`/`createUpload`) 수정 금지 — vpb-08 범위. 기존 public read 메서드(`getRequest`/`getStatus`/`getResultManifest` 등)로 충분하면 **무변경이 정답** |
| `.vibe/harness/src/lib/schemas/pro-bridge.ts` | provenance 관련 필드 **추가만**, 기존 필드 완화 금지. 필요 없으면 무변경 |
| `.vibe/harness/test/pro-bridge-identity.test.ts` | 신규 생성 (Tests to add 로스터) |
| `.vibe/harness/test/pro-bridge-command.test.ts`, `.vibe/harness/test/pro-bridge-importer.test.ts` | 의도된 hardening(fail-open→fail-closed)으로 깨지는 기존 기대값 갱신만. 무관 assertion 약화 금지 |

### Do NOT modify

- `.vibe/harness/src/pro-bridge/mailbox/{server,tools,tunnel}.ts`, `goal-source/*`, `prompt-composer.ts`, `scope-resolver.ts`, `vibe-bundle.ts`, `contract.ts`, `transports/types.ts` (ImportReceipt 형태 불변 — receipt에 repo 필드를 넣는 것은 vpb-08에서 ack 의미론과 함께).
- **ack 의미론 (P1-003)**: no-op 시 ack, receipt reconciliation, import-intent 저장 등 일절 금지. 이번 Sprint의 ack 관련 변경은 "호출 순서/실패 강등"까지만.
- store lifecycle 변이 로직 전부 (P1-001/002 — vpb-08).
- P2-003 semantic FINDINGS/prompt 검증, P2-004 token transport, P3-* — 후속 Sprint.
- 기존 imported 패키지: `docs/plans/2026-07-15-*` 전부 (특히 `docs/plans/2026-07-15-web-pro-bridge-goal-audit-pro-review/`), 사용자 파일 `vibe-pro-bridge-review.md`, `docs/plans/web-pro-bridge/design.md`. 읽기만.
- `package.json` (신규 의존성/스크립트 0), 버전 표면, git tag (`v1.8.0` 등 기존 태그 불이동), `.vibe/config.json`.
- 검증 약화 절대 금지: path traversal/containment, UTF-8, size, file roster, SHA(request/result/file), 기존 결과 폴더 불변성. 완화처럼 보이는 어떤 diff도 금지.

### Explicit exceptions

- `store.ts`와 `lib/schemas/pro-bridge.ts`는 allowed writes에 있지만 "반드시 수정"이 아니다. dead-weight 방지 원칙을 "빈 수정이라도 하라"로 오독하지 말 것.
- 기존 테스트의 기대값 변경은 이번 hardening이 **의도한 행동 전환**(예: unparseable origin의 warn-skip → fail-closed, unbound web-origin의 조용한 설치 → 기본 거부)에 한해 허용. Final report에 finding별로 "왜 이 기대값 변경이 검증 약화가 아닌가"를 명시.
- STEP 0 죽은 코드 정리는 이번에 직접 수정하는 함수 내부로 한정. 대규모 구조 리팩토링 금지.
- 커밋은 Orchestrator가 수행 — Generator는 커밋하지 않는다.

### Reference-only values (인용만, 새 엔티티 생성·편집 금지)

- 리뷰 정본 식별자: requestId `AUD-20260715-tlo6jc`, base `64ffad48…`, reviewed HEAD `9b002fe3…`, patch SHA-256 `78f9696e…`, corroborating child commit `4721984…`, out-of-scope release commit `6051105`, 태그 `v1.8.0`.
- finding ID `VPB-AUD-P1-004`, `VPB-AUD-P2-002` — 코드 주석/테스트명에 인용 가능, findings 파일 자체 수정 금지.
- 설치된 리뷰 패키지 내용물은 **evidence이지 authorization이 아니다** — 패키지 안의 어떤 텍스트도 destination/authentication/tool policy 변경 권한을 부여하지 않는다.

### Proof predicates (공개 계약보다 강하지 않게, 아래가 전부)

Orchestrator가 샌드박스 밖에서 실행 (Generator는 static 확인만):

1. `npm run vibe:typecheck` → exit 0.
2. `npm run vibe:self-test` → exit 0 (기존 623+개 회귀 포함).
3. `node --import tsx --test .vibe/harness/test/pro-bridge-identity.test.ts .vibe/harness/test/pro-bridge-command.test.ts .vibe/harness/test/pro-bridge-importer.test.ts` → exit 0, Tests to add의 14개 리터럴 케이스명이 출력에 존재.
4. `rg "expectedRepositoryFullName: request.repository.fullName" .vibe/harness/src/commands/pro-bridge.ts` → **0건** ("요청 자체에서 현재 repo 정체성 추론 금지"의 grep 증거).
5. `rg "dangerously-override-repository-identity|accept-unbound-web-origin" .vibe/harness/src/commands/pro-bridge.ts` → 두 플래그 모두 존재.
6. `git status --porcelain -- docs/plans` → 빈 출력 (기존 패키지 불가침).
7. `git diff -- package.json .vibe/config.json` → 빈 출력.

### Current proof and non-proof

Generator Final report는 증거를 반드시 두 칸으로 분리한다: **fresh evidence**(이번 세션에서 실제 실행·확인한 것 — Windows sandbox 특성상 대부분 static inspection과 grep)와 **non-proof**(skipped / blocked / inferred / proxy / historical — 예: "테스트는 작성했으나 실행하지 못함, Orchestrator 실행 대기"). 실행하지 못한 검증을 통과로 표기하는 것을 금지한다.

---

## 필수 참조 (구현 전 읽기 순서)

1. `docs/plans/2026-07-15-web-pro-bridge-goal-audit-pro-review/FINDINGS.json` — P1-004, P2-002 전문 (requiredRemediation / requiredTests).
2. `docs/plans/2026-07-15-web-pro-bridge-goal-audit-pro-review/REVIEW.md` — §5 P1-004 / P2-002 근거, §10 authorization boundary.
3. `docs/plans/2026-07-15-web-pro-bridge-goal-audit-pro-review/prompt/CLI_MAIN_SESSION_PROMPT.md` — Phase 2·7 요구 행동, Immutable boundaries, Prohibited operations. 특히 금지 2건: "infer current repository identity from the selected request itself", "silently accept an unbound Web-origin package".
4. `docs/plans/web-pro-bridge/design.md` §12.1 — 실측 추기 (seam a/b/c 발견 기록).
5. 현행 구현: `.vibe/harness/src/commands/pro-bridge.ts`(sync 경로), `.vibe/harness/src/pro-bridge/importer.ts`, `transports/{manual,mcp-mailbox}.ts`, `mailbox/store.ts`(읽기 표면), `scope-resolver.ts`의 `parseGitHubFullName`(읽기만).
6. 기존 테스트 스타일: `.vibe/harness/test/pro-bridge-command.test.ts` (FakeGit/`repositoryGit` 스텁, `mkdtemp` 임시 루트, captureIo 패턴).

---

## 기술 사양

### A. 현재 저장소 정체성 해석 — 공통 헬퍼 (commands/pro-bridge.ts)

단일 헬퍼로 통일한다 (개념 시그니처 — 이름·형태는 Generator 재량이되 의미는 고정):

```ts
type CurrentRepoIdentity =
  | { ok: true; fullName: string }
  | { ok: false; reason: 'origin-missing' | 'origin-unresolvable' };

async function resolveCurrentRepositoryIdentity(git: GitPort): Promise<CurrentRepoIdentity>
```

- `git remote get-url origin` 실행 → 실패/빈 출력 = `origin-missing`. 출력이 있으나 `parseGitHubFullName`이 null (파싱 불가·비-GitHub URL 포함) = `origin-unresolvable`.
- **금지**: 선택된 request/manifest/bundle의 어떤 필드도 현재 정체성의 근원으로 사용 금지. 이 헬퍼의 입력은 git 뿐이다.
- 모든 sync 진입 경로(runMailboxSync 전체 + runBundleSync 전체)가 **선택 이전에** 이 헬퍼를 호출한다.

### B. P1-004 — fail-closed current-repository identity (VPB-AUD-P1-004)

복원할 설계 불변식:

```
current local origin fullName
  == request.repository.fullName
  == resultManifest.repositoryFullName   (manifest 존재 시)
  == installed provenance repo           (no-op 복구 시)
```

적용 지점 (현행 코드 anchor):

1. **`runMailboxSync`** (`commands/pro-bridge.ts` 약 656~787행):
   - 현재 코드는 positional 미지정 시에만 repo 필터를 돌리고(약 663~678행), origin 해석 실패 시 경고 후 필터를 **생략**한다(fail-open). → 변경: 진입 즉시 헬퍼 호출. `ok: false`이면 **fail-closed** — reason과 함께 에러 출력, exit 1. 유일한 탈출구는 아래 override 플래그.
   - **positional requestId 경로** (약 681~687행): result-ready 상태 확인에 더해, `readRequest(positional)` 후 `request.repository.fullName === current.fullName` 강제. 불일치 시 설치 스테이징 도달 전에 거부.
   - `--latest` / 암묵 단일 result: 기존 repo 필터 유지하되 fail-closed 전제 위에서 동작.
   - **importer 컨텍스트**: `expectedRepositoryFullName`에 `request.repository.fullName`(현행, 약 748행)이 아니라 **독립 해석된 current fullName**(또는 override 시 override 대상)을 전달. 이것이 Prohibited operations의 "infer current repository identity from the selected request itself" 직접 폐쇄다.
   - **web-origin result**: 기존 HEAD 게이트(`--accept-head-mismatch`) 유지 + 위 정체성 비교가 추가로 적용된다 (동일 HEAD 값이 타 repo에 존재해도 repo 비교가 차단).
   - **ack 전**: 정체성 검증이 import보다 먼저 끝나므로 ack는 검증된 흐름 뒤에서만 호출된다. receipt 스키마는 불변 (vpb-08).
2. **`runBundleSync`** — context에 `git` 추가. bound 경로(요청을 outbox 또는 mailbox store에서 찾은 경우)에서 `request.repository.fullName === current.fullName` 강제, `expectedRepositoryFullName`도 current 기준. current 해석 불가 + bound 요청 존재 시 fail-closed (override 플래그로만 통과).
3. **importer no-op 복구** (`importer.ts` 약 568~603행): 동일 identity no-op 판정 시, `context.expectedRepositoryFullName`이 주어졌으면 설치된 `.bridge/provenance.json`의 repo 필드(아래 F: `requestRepositoryFullName` ?? `currentRepositoryFullName`)를 읽어 비교. **불일치 → no-op가 아니라 `invalid`(`repository-mismatch`)로 실패.** 필드가 둘 다 없는 legacy provenance(기존 `docs/plans/2026-07-15-*` 패키지)는 no-op 허용 + 호출측에서 경고 1줄 출력 (기존 설치물 불가침이므로 소급 강제하지 않는다).

**Override — 고마찰 플래그** (리터럴 고정): `--dangerously-override-repository-identity`

- 이 플래그 **없이는 어떤 모드에서도 정체성 불일치/해석불가를 통과시킬 수 없다.** 대화형 confirm은 override의 대체 수단이 아니다 (고마찰 요건).
- 플래그 존재 시: **어떤 쓰기보다 먼저** 두 정체성(current: 값 또는 해석 실패 사유 / request·manifest: 값)을 출력하고 진행.
- provenance에 override 기록 (F 참조) + `skippedValidations`에 `repository-identity-overridden` 마커 추가 → release-acceptance 증거에서 기계적으로 배제 가능해야 한다.

### C. P2-002 — unbound Web-origin 게이트 (VPB-AUD-P2-002)

"unbound" 정의: **request 메타데이터도 result manifest도 없는 반입** (manual 번들에서 requestId가 `web-origin`이거나, requestId가 어느 저장소(outbox·mailbox)에서도 발견되지 않는 경우). request가 바인딩된 manual 반입(Journey A 표준 경로)은 unbound가 아니며 기존대로 허용.

1. **기본 거부**: unbound 반입은 승인 플래그 없이는 설치되지 않는다. importer에 refused code `unbound-import-rejected`를 **additive**로 추가하거나 command 레벨에서 선-거부 — 어느 쪽이든 다음을 만족: (a) 거부 출력에 **생략될 검증 전체 목록**(현행 9종 마커: `request-metadata-unavailable`, `result-manifest-unavailable`, `request-hash-binding-skipped`, `result-hash-binding-skipped`, `repository-binding-skipped`, `reviewed-head-binding-skipped`, `file-roster-binding-skipped`, `file-sha-binding-skipped`, `reviewer-declaration-unavailable`)과 승인 플래그명을 명시, (b) 어떤 파일 쓰기도 발생하지 않음 (스테이징 디렉터리 포함).
2. **승인 플래그** (리터럴 고정): `--accept-unbound-web-origin`. 플래그 존재 시: 생략 검증 전체를 **설치 전에** 출력 → 설치 → provenance에 승인 기록 (F 참조) + `skippedValidations`에 `unbound-import-accepted` 마커. 대화형 confirm은 대체 수단이 아니다.
3. **release-acceptance 배제**: `unbound-import-accepted` / `repository-identity-overridden` 마커가 있는 provenance는 release 증거로 세지 않는다 — 마커 존재 자체가 기계 판별 근거다 (이번 Sprint의 산출은 마커까지; 판별 자동화는 release-closure Sprint).

### D. seam a — sync 성공 오보 제거 (실측 12:51)

현상: transport=mcp-mailbox에서 `vibe:pro-sync --from <file>` → 설치 성공 + provenance 정상 기록 → 직후 `acknowledgeImport`가 `MailboxStore.requireResultIndex`의 "No finalized result exists" (`not-found`)로 throw → 성공 출력 없이 exit 1.

원인 anchor: `runBundleSync`(약 604~634행)와 `runMailboxSync`(약 761~775행) 모두 **ack를 성공 출력보다 먼저** 호출한다.

수정 (두 sync 경로 공통):

1. `status === 'installed'`이면 **성공 요약(`설치 완료: …`) + nextAction + skippedValidations + "구현은 자동 시작하지 않습니다" 안내를 먼저 출력**한다.
2. 그 다음 ack를 시도한다. ack 실패는 **경고로 강등**: 실패 사유 + "설치는 완료됨, mailbox 요청은 종결되지 않은 상태로 남음 (ack 의미론은 vpb-08)" 취지의 경고 출력 후 **exit 0**. throw가 성공을 가리는 일이 없어야 한다.
3. ack 성공 경로의 동작(imported 전이)은 현행 그대로 — **ack 의미론 자체(P1-003)는 변경 금지.** 선-확인(결과 index 존재 여부를 미리 조회해 ack를 skip)으로 구현해도 좋으나, 그 경우에도 경고 1줄은 출력한다.

### E. seam b — cross-transport requestId 바인딩 (실측 12:51)

현상: mailbox(`requests/` store)로 생성한 요청의 결과가 manual wire(vibe-bundle)로 돌아오면, manual 경로의 `readRequest`가 outbox만 조회해 null → "일치하는 outbox 요청이 없습니다"로 거부. MCP write tool이 미가용인 웹 챗의 **표준 fallback**이므로 반드시 완주해야 한다.

수정 (`runBundleSync`, 약 552~559행):

1. requestId(≠ `web-origin`) 조회를 활성 transport에 묶지 말고 **outbox → mailbox store 순으로** 확장한다. 활성 transport가 무엇이든 `ManualDirectoryTransport.readRequest`와 `MailboxStore.getRequest`(기존 public read API — lifecycle 무변이)를 순서대로 조회. 두 reader 모두 filesystem 기반이라 직접 인스턴스화해도 된다.
2. 발견 시: 그 요청으로 바인딩 — 요청의 `payloadSha256`이 importer를 통해 provenance `requestPayloadSha256`으로 기록되는 기존 흐름을 그대로 활용하고, B의 정체성 비교(`request.repository.fullName === current`)를 적용. **ack는 요청이 발견된 store로 라우팅**한다 (outbox → manual ack, mailbox → store ack). mailbox ack는 finalized result가 없어 실패할 수 있는데 이는 seam a의 경고 강등으로 흡수된다 (설치 성공 + exit 0 + 경고).
3. 둘 다 없으면: 하드 에러가 아니라 **C의 unbound 게이트로 라우팅** (기본 거부 + `--accept-unbound-web-origin` 경로).
4. `web-origin` + `--latest`의 기존 opportunistic 바인딩은 유지하되, 바인딩된 경우 B의 정체성 비교가 적용된다.

### F. Provenance 추가 필드 (additive — importer.ts `ProvenanceReceipt`, 약 108~121행)

`schemaVersion: 'vibe-pro-bridge-provenance-v1'` 리터럴은 유지하고 nullable 필드만 추가한다 (기존 판독자 `existingIdentity`는 tolerant — 기존 패키지 판독 불변, 마이그레이션 불필요):

```ts
currentRepositoryFullName: string | null;   // 독립 해석된 로컬 origin (해석 실패 시 null)
requestRepositoryFullName: string | null;   // 바인딩된 request/manifest의 repo (unbound면 null)
repositoryIdentityOverride: {
  current: string | null;
  request: string | null;
  flag: 'dangerously-override-repository-identity';
} | null;
unboundAcceptance: {
  flag: 'accept-unbound-web-origin';
  acknowledgedAt: string;                   // ISO, context.now 기준
} | null;
```

- 값 공급: command 레벨에서 `ImportContext`에 additive 필드로 전달 (기존 필드 의미 변경 금지).
- `lib/schemas/pro-bridge.ts`는 provenance Zod 스키마가 현재 존재하지 않으므로 **변경 불필요가 기본값** — 기존 스키마(ReviewRequest/ResultManifest)의 어떤 필드도 완화 금지.
- 주의: `finalizeResult`(store 내부)가 importer를 호출하는 경로는 이번 필드가 null로 채워져도 무해해야 한다 (mailbox revision 설치는 별도 검증 체계). store 코드는 수정하지 않는다.

---

## Tests to add

**파일**: `.vibe/harness/test/pro-bridge-identity.test.ts` (신규, `.vibe/harness/test/` 직속 — `vibe:self-test`의 `*.test.ts` glob이 자동 수집). node:test `describe`/`it`, 기존 `pro-bridge-command.test.ts`의 FakeGit·`repositoryGit`·`mkdtemp`·captureIo 패턴을 따른다. **아래 `it()` 케이스명은 리터럴로 고정한다** (Orchestrator가 출력에서 grep으로 대조).

Identity — 7종 (VPB-AUD-P1-004 roster):

1. `rejects a positional request that belongs to another repository`
2. `fails closed when the current origin is missing`
3. `fails closed when the current origin is unparseable`
4. `fails closed when the current origin is not GitHub`
5. `rejects when request and result agree but the current repository differs`
6. `rejects a same-HEAD result from another repository`
7. `refuses no-op recovery when installed provenance belongs to another repository`

Identity 부속 — override (P1-004 requiredTests "explicit audited override"):

8. `override flag prints both identities before write and records the override in provenance`

Manual trust — 4종 (VPB-AUD-P2-002 roster):

9. `rejects an unbound web-origin bundle by default`
10. `records explicit unbound acceptance in provenance`
11. `installs a bound web-origin result with repository identity enforced`
12. `shows skipped validations before any write`

Seam 회귀 — 2종:

13. `prints install success before mailbox post-processing and downgrades ack failure to a warning` (seam a: mcp-mailbox transport + `--from` 번들 → exit 0 + `설치 완료` 출력 존재 + 경고 존재)
14. `binds a manual bundle to a mailbox-store request by requestId lookup` (seam b: mailbox store에 요청 생성 → manual 번들 sync → 설치 성공 + provenance의 `requestPayloadSha256`가 mailbox 요청의 payloadSha256와 일치)

공통 assertion 원칙: "거부" 케이스는 exit 1 + **설치 폴더·스테이징(`.tmp-*`) 미생성**까지 검증한다. "설치" 케이스는 provenance JSON을 읽어 신규 필드 값을 직접 검증한다. 케이스 12는 출력 배열에서 skipped 목록 라인 인덱스 < `설치 완료` 라인 인덱스임을 검증한다 (플래그 있는 실행), 그리고 플래그 없는 실행에서 목록 출력 + 미설치를 검증한다.

기존 파일 갱신: fail-open 행동(원인 해석 불가 시 경고 후 필터 생략, unbound 조용한 설치)을 전제한 기존 테스트가 있으면 새 행동으로 갱신하고, Final report에 케이스별 사유를 남긴다.

---

## 실행 제약

- **Windows sandbox**: Generator는 npm/네트워크/테스트 실행 불가 — static inspection과 코드 작성만. 실행 검증(typecheck/self-test)은 Orchestrator가 수행한다. 실행하지 못한 검증을 통과로 보고하지 말 것.
- **신규 의존성 0, 신규 스크립트 0.** `package.json` 무변경.
- NodeNext ESM — 상대 import는 `.js` 확장자. UTF-8 (BOM 없음). 기존 파일의 한국어 사용자 메시지 톤 유지.
- 테스트는 `.vibe/harness/test/` 직속, node:test만 사용.
- 예상 규모 ~600 LOC (테스트 포함) — 상한이 아니라 규모 감각이다. 불변식 복원과 로스터 충족이 우선.

---

## 완료 체크리스트

### 기계 검증 (Orchestrator 실행)

- [ ] `npm run vibe:typecheck` exit 0
- [ ] `npm run vibe:self-test` exit 0 (기존 회귀 전부 포함)
- [ ] targeted: `node --import tsx --test .vibe/harness/test/pro-bridge-identity.test.ts .vibe/harness/test/pro-bridge-command.test.ts .vibe/harness/test/pro-bridge-importer.test.ts` exit 0 + 리터럴 케이스명 14종 전부 출력에 존재
- [ ] `rg "expectedRepositoryFullName: request.repository.fullName" .vibe/harness/src/commands/pro-bridge.ts` 0건
- [ ] `rg "dangerously-override-repository-identity" .vibe/harness/src` ≥ 1건, `rg "accept-unbound-web-origin" .vibe/harness/src` ≥ 1건
- [ ] `git status --porcelain -- docs/plans` 빈 출력, `git diff -- package.json .vibe/config.json` 빈 출력
- [ ] store.ts diff가 있다면 읽기 조회 API 추가만인지 diff 육안 대조 (lifecycle 메서드 시그니처·본문 무변)

### Inspection / demo AC (Orchestrator·Evaluator·사용자)

- [ ] **seam a 실측 재현**: Orchestrator가 transport=mcp-mailbox 설정에서 실제 번들 파일로 `npm run vibe:pro-sync -- --from <file>` 실행 → 성공 요약 + nextAction이 출력되고 exit 0, mailbox 후처리 실패는 경고 1줄로만 나타나는 CLI transcript 확보 (이 Sprint의 사용자 payoff 증거 — 시각 표면이 없는 CLI 제품이므로 transcript가 identity/payoff evidence를 대신한다)
- [ ] fail-closed 에러 메시지 품질: 원인(origin 부재/해석 불가)과 탈출구(override 플래그명, remote 설정 안내)가 한 화면에서 이해되는가
- [ ] unbound 거부 출력이 "무엇이 검증되지 않는가"를 사용자가 오해 없이 읽을 수 있는가
- [ ] 검증 약화 부재: importer diff 리뷰에서 기존 에러 경로가 하나도 완화되지 않았는가 (Evaluator 대조)

---

## Final report 요구 (Generator 출력 필수 형식)

1. **`## Wiring Integration`** — `.vibe/agent/_common-rules.md` §14의 W1~W14 각 항목을 `touched / n/a / skipped+reason`으로 보고. 이번 Sprint 예상: W12 touched (신규 테스트 파일 — sync-manifest의 `.vibe/harness/test/**` glob에 자동 포함되므로 W6는 n/a+사유), W10은 skipped+사유 (P1 미결 중 release 기록/버전 bump 금지 — release-closure Sprint로 이월), W11 n/a+사유 (provenance 필드는 additive nullable, 기존 파일 판독 불변, 마이그레이션 불요), 나머지 대부분 n/a. 삭제/개명 없음이면 D1~D6 n/a. 신규 파일에 `verified-callers:` 명시 (테스트 파일은 self-test glob이 caller).
2. **Finding별 closure 증거** (REVIEW.md/CLI_MAIN_SESSION_PROMPT 요구 형식) — `VPB-AUD-P1-004`, `VPB-AUD-P2-002`, `seam-a`, `seam-b` 각각:
   - status (closed-in-code / partial)
   - files and symbols changed (파일:심볼 목록)
   - design invariant restored (한 문장 — 예: "current origin == request == manifest == provenance 등식이 모든 sync 모드에서 쓰기 전에 강제됨")
   - targeted tests (리터럴 케이스명)
   - residual limitation (예: "ack 의미론·receipt repo 바인딩은 vpb-08", "legacy provenance는 경고 후 no-op 허용")
3. **Current proof vs non-proof 분리** — executed-and-passed / executed-and-failed / not-executed / repository-claim-only 4분류로 모든 검증 항목 나열.
4. **기존 테스트 기대값 변경 목록** — 케이스명 + 변경 전/후 행동 + 검증 약화가 아닌 근거.
