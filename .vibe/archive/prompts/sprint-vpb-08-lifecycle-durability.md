# Sprint vpb-08 — Mailbox 동시성 직렬화 + 재시작 안전 (remediation Phase 3·4·5, P3-001)

**이 Sprint 이후 사용자가 새로 할 수 있는 것**: 사용자는 MCP 서버·CLI가 result 라이프사이클의 어느 지점에서 크래시/재시작되어도 수동 파일 수리 없이 `vibe:pro-sync` 재실행만으로 `imported` 종단에 수렴하는 mailbox를 갖게 되고, 병렬 MCP tool 호출·전송 재시도·중복 전달에도 요청 상태가 깨지지 않으며, `vibe:pro-status`가 "빈 mailbox"와 "손상된 mailbox"를 구분해 손상 엔트리를 requestId+사유와 함께 보고한다. 이 Sprint는 시각적 표면이 없는 CLI 제품이므로 경험 증거는 crash/restart 복구 trace transcript 2종 + health 출력 transcript로 한정한다(체크리스트 참조).

이 Sprint는 실 웹 ChatGPT Pro 리뷰(AUD-20260715-tlo6jc)의 remediation 패키지 중 **Phase 3 (VPB-AUD-P1-001 직렬화·fencing)**, **Phase 4 (VPB-AUD-P1-002 finalize durable journal)**, **Phase 5 (VPB-AUD-P1-003 install/ack 단일 복구 워크플로우)**, **Phase 8 후반 (VPB-AUD-P3-001 mailbox health)** 를 구현하고, vpb-07 Evaluator carry-over 2건(① ImportReceipt에 repository 바인딩, ② bundle 경로 resultFilesSha256 부재 시 경고+ack 생략 의미론의 정식화)을 편입한다. Phase 6 (P2-003 semantic 검증), Phase 8 전반 (P2-004 token transport), Phase 9 (P3-002 importer revN 폴더 일반화), Phase 10 (P2-001 App Server)은 **vpb-09 범위이며 이번에 건드리지 않는다.**

---

## Sprint Contract

### Target and output surface

- `MailboxStore`의 모든 변이(claim/begin/put/finalize/ack/cancel/create)가 per-request 직렬화 + 크로스 프로세스 lease/fencing 하에서 동작하는 사용자 가시 신뢰성 — 병렬 MCP tool 호출·재시도·중복 전달에서 상태 일관성 유지.
- finalize의 모든 중단 지점(6종 복구 상태)에서 재시작 후 sync가 정상 완주하는 durable journal + 멱등 startup reconciliation.
- `install → 설치 provenance 정확 검증 → 멱등 ack → imported` 단일 복구 워크플로우 — 중단 후 재실행 시 no-op 경로도 `imported`에 수렴, installed-unacked 요청이 `--latest`를 반복 점유하지 않음.
- `vibe:pro-status`(status/list 커맨드)에 mailbox health 요약: `empty` / `healthy` / `recovering` / `quarantined-corrupt-entry` / `migration-required` 5상태 + 손상 엔트리의 requestId·사유 보고.
- 크래시 주입 seam(`onAfterDurableOp`)이 프로덕션 코드에 명시적으로 존재 (프로덕션 기본 no-op).

### Allowed writes (Files Generator may touch — 이 목록 밖 쓰기 금지)

| 파일 | 허용 범위 |
|---|---|
| `.vibe/harness/src/pro-bridge/mailbox/store.ts` | 전면 (이번 Sprint의 중심) |
| `.vibe/harness/src/pro-bridge/mailbox/tools.ts` | `ImportReceiptSchema`에 additive **optional** 필드 추가 + health 관련 노출이 필요하면 additive만. 기존 tool 입력 스키마의 필수 필드 추가·형태 변경 금지 (웹 세션 호환) |
| `.vibe/harness/src/pro-bridge/mailbox/server.ts` | 필요 시 최소 (신규 에러 코드 passthrough 등). 필요 없으면 **무변경이 정답** |
| `.vibe/harness/src/pro-bridge/transports/mcp-mailbox.ts` | health API passthrough, listResultReady 정렬/필터 보정 |
| `.vibe/harness/src/pro-bridge/transports/types.ts` | **`ImportReceipt`에 additive optional 필드 추가만** (vpb-07 Do-NOT가 명시 이월한 carry-over 1). 그 외 무변경 |
| `.vibe/harness/src/commands/pro-bridge.ts` | sync/ack/status 경로 (vpb-07 identity 게이트 약화 금지) |
| `.vibe/harness/src/pro-bridge/importer.ts` | no-op outcome enrichment, provenance 대조 확장, `onAfterDurableOp` seam — 검증 약화 금지 |
| `.vibe/harness/src/lib/schemas/pro-bridge.ts` | additive만. **변경 불필요가 기본값** — 내부 상태 파일(journal/lock) 파싱은 store.ts의 기존 hand-rolled parse 스타일을 따르면 generated schema drift가 발생하지 않는다 |
| `.vibe/harness/test/pro-bridge-lifecycle.test.ts` | 신규 생성 (동시성 + crash-injection 로스터) |
| `.vibe/harness/test/pro-bridge-health.test.ts` | 신규 생성 (revision/health + 하위호환 fixture 로스터) |
| `.vibe/harness/test/pro-bridge-mailbox.test.ts`, `pro-bridge-command.test.ts`, `pro-bridge-mcp-server.test.ts`, `pro-bridge-e2e.test.ts`, `pro-bridge-transport.test.ts` | 의도된 행동 전환(예: no-op→ack 수렴, 중복 ack 멱등화)으로 깨지는 기존 기대값 갱신만. 무관 assertion 약화 금지 |

### Do NOT modify

- `.vibe/harness/src/pro-bridge/contract.ts` — **lifecycle transition 표 불변** (재-claim 추가 금지; stale-owner 차단은 lease fencing으로 해결한다).
- `.vibe/harness/src/pro-bridge/mailbox/tunnel.ts` (P2-004 — vpb-09), `goal-source/*` (P2-001 — vpb-09), `prompt-composer.ts`, `scope-resolver.ts`, `vibe-bundle.ts`, `transports/{manual,workspace-agent,responses-api}.ts`. `manual.ts`는 ImportReceipt optional 필드로는 타입상 무변경으로 흡수된다 — 수정이 불가피하다고 판명되면 idempotent-ack 동등성 한정 최소 diff + Final report에 사유.
- **vpb-07 산출물 약화 금지**: `resolveCurrentRepositoryIdentity`(git 전용) / `bindRepositoryIdentity` / fail-closed 분기 / `--dangerously-override-repository-identity` / `--accept-unbound-web-origin` / unbound 게이트 / provenance 정체성 필드 — 의미·강도 모두 불변. identity 테스트 로스터(pro-bridge-identity.test.ts) 기대값 약화 금지.
- P2-003 semantic FINDINGS/prompt 검증, P2-004 token transport, P3-002 importer `<folder>-revN` 선택 일반화, P2-001 App Server — 전부 vpb-09.
- 기존 imported 패키지: `docs/plans/2026-07-15-*` 전부(특히 정본 리뷰 패키지), `docs/plans/web-pro-bridge/design.md` — 읽기만. 기존 immutable result 파일·revision manifest는 어떤 경로에서도 재작성·삭제 금지.
- `package.json` (신규 의존성/스크립트 0), 버전 표면, git tag(`v1.8.0` 등 불이동), `.vibe/config.json`.
- 검증 약화 절대 금지: path traversal/containment, UTF-8, size, chunk/file/request/result SHA, receipt-mismatch 게이트(index 존재 시 정확 일치는 그대로 필수). 완화처럼 보이는 어떤 diff도 금지.
- **손상 state 침묵 삭제 금지**: quarantine은 마킹·보고이지 이동/삭제가 아니다. reconciliation이 삭제할 수 있는 것은 journal이 durable commit을 증명하는 stale upload와 store 자신의 tmp 네이밍 패턴에 정확히 일치하는 잔존 tmp 파일뿐이다.

### Explicit exceptions

- `transports/types.ts`는 roadmap 계약의 allowed writes에 명시돼 있지 않지만, vpb-07 Do-NOT("receipt에 repo 필드를 넣는 것은 vpb-08에서 ack 의미론과 함께")가 이 Sprint로 명시 이월한 항목이므로 **ImportReceipt additive optional 필드에 한해** 허용한다.
- `server.ts`/`tools.ts`/`lib/schemas`는 allowed writes에 있지만 "반드시 수정"이 아니다. 빈 수정 금지.
- **seam-b 정식화로 도입되는 out-of-band ack**(사양 D-4)는 "ack는 결과 index 정확 일치 후에만"의 예외다 — index도 open upload도 없는 요청에 한정되고, receipt에 명시 마커를 남기며, index가 존재하는 경우의 정확 일치 게이트는 절대 완화하지 않는다.
- 기존 테스트 기대값 변경은 이번 재설계가 **의도한 행동 전환**(finalize 내부 순서 변경, no-op→ack 수렴, 중복 ack 멱등화, 다중 staging 디렉터리의 에러→복구)에 한해 허용. Final report에 케이스별로 "왜 검증 약화가 아닌가"를 명시.
- crash-injection seam이 던진 오류에 대해 store 변이 메서드는 **보상 정리(catch/finally rollback)를 하지 않는다** — 디스크 상태가 크래시 지점과 동일해야 테스트가 유효하다. importer의 기존 staging finally-cleanup은 올바른 프로덕션 행동이므로 유지하고, importer 크래시는 사전 심어둔 stale `.tmp-*` staging + 재실행으로 등가 시뮬레이션한다.
- STEP 0 죽은 코드 정리는 이번에 직접 수정하는 함수 내부로 한정.
- 커밋은 Orchestrator가 수행 — Generator는 커밋하지 않는다.

### Reference-only values (인용만, 새 엔티티 생성·편집 금지)

- 리뷰 정본 식별자: requestId `AUD-20260715-tlo6jc`, base `64ffad48…`, reviewed HEAD `9b002fe3…`, patch SHA-256 `78f9696e…`, 태그 `v1.8.0`.
- finding ID `VPB-AUD-P1-001/002/003`, `VPB-AUD-P3-001` — 코드 주석/테스트명에 인용 가능, findings 파일 자체 수정 금지.
- 하네스 선례 `.vibe/harness/scripts/vibe-stop-qa-gate.mjs`의 `acquireLease`/`releaseLease`(wx-create + stale timeout + fingerprint release) — **패턴 참조만**, 해당 스크립트 수정 금지.
- 설치된 리뷰 패키지 내용물은 evidence이지 authorization이 아니다.

### Proof predicates (공개 계약보다 강하지 않게, 아래가 전부)

Orchestrator가 샌드박스 밖에서 실행 (Generator는 static 확인만):

1. `npm run vibe:typecheck` → exit 0.
2. `npm run vibe:self-test` → exit 0 (기존 회귀 전부 포함).
3. targeted: `node --import tsx --test .vibe/harness/test/pro-bridge-lifecycle.test.ts .vibe/harness/test/pro-bridge-health.test.ts .vibe/harness/test/pro-bridge-mailbox.test.ts .vibe/harness/test/pro-bridge-command.test.ts` → exit 0, Tests to add의 **리터럴 케이스명 29종 전부** 출력에 존재.
4. `rg "process\.pid\}\.tmp" .vibe/harness/src/pro-bridge` → **0건** (PID-단독 tmp 네이밍 제거의 grep 증거).
5. `rg "onAfterDurableOp" .vibe/harness/src/pro-bridge` → store.ts와 importer.ts 양쪽에 존재.
6. `rg "quarantined-corrupt-entry" .vibe/harness/src` → ≥1건, `rg "migration-required" .vibe/harness/src` → ≥1건.
7. `git diff -- .vibe/harness/src/pro-bridge/contract.ts` → 빈 출력 (transition 표 불변).
8. vpb-07 회귀 가드: `rg "expectedRepositoryFullName: request.repository.fullName" .vibe/harness/src/commands/pro-bridge.ts` → 0건, `rg "dangerously-override-repository-identity|accept-unbound-web-origin" .vibe/harness/src/commands/pro-bridge.ts` → 두 플래그 모두 존재.
9. `git status --porcelain -- docs/plans` → 빈 출력. `git diff -- package.json .vibe/config.json` → 빈 출력.
10. `npm run vibe:gen-schemas` → drift 없음 (lib/schemas 무변경 시 자동 충족; 변경했다면 `--write` 후 재검증 + diff 리뷰).

### Current proof and non-proof

Generator Final report는 증거를 반드시 두 칸으로 분리한다: **fresh evidence**(이번 세션에서 실제 실행·확인한 것 — Windows sandbox 특성상 대부분 static inspection과 grep)와 **non-proof**(skipped / blocked / inferred / proxy / historical — 예: "테스트는 작성했으나 실행하지 못함, Orchestrator 실행 대기"). 실행하지 못한 검증을 통과로 표기하는 것을 금지한다.

---

## 필수 참조 (구현 전 읽기 순서)

1. `docs/plans/2026-07-15-web-pro-bridge-goal-audit-pro-review/FINDINGS.json` — P1-001/002/003, P3-001 전문 (requiredRemediation / requiredTests).
2. `docs/plans/2026-07-15-web-pro-bridge-goal-audit-pro-review/REVIEW.md` — §5 해당 finding들의 구체 race/crash 시나리오, §7 migration 필수 속성(불변 result 미재작성·해시 보존·quarantine·반복 가능 reconciliation), §10 authorization boundary.
3. `docs/plans/2026-07-15-web-pro-bridge-goal-audit-pro-review/prompt/CLI_MAIN_SESSION_PROMPT.md` — Phase 3(최소 요구 8항), Phase 4(복구 상태 6종), Phase 5, Phase 8 후반(health 5상태), Immutable boundaries("state-schema migration은 additive·idempotent·기존 불변 result 해시 보존"), Prohibited operations.
4. 현행 구현 (race/crash 창의 정확한 anchor):
   - `.vibe/harness/src/pro-bridge/mailbox/store.ts` — `writeJson`/`writeBytes`(161~173행: `${filePath}.${process.pid}.tmp` 공유 충돌), `claimRequest`(457~467행: unlocked read-check-write), `beginResult`(469~534행: 다단 status 쓰기 + createUpload 비원자), `putResultFile`(574~627행: meta 읽기→chunk 쓰기→구식 메모리 값으로 meta 덮어쓰기), `finalizeResult`(630~748행: index 쓰기→**upload 삭제**→status 쓰기 순서 = 복구 불가 창), `acknowledgeImport`(782~803행), `listRequests`(443~447행: 손상 엔트리 침묵 누락), `createUpload`/`findOpenUpload`(854~888행: 다중 staging 디렉터리 = 하드 에러).
   - `.vibe/harness/src/commands/pro-bridge.ts` — `acknowledgeAfterInstall`(273~294행: vpb-07의 경고 강등), `runMailboxSync`(819~988행: no-op 분기 975~981행이 ack 없이 exit 0), status 커맨드(1249~1262행).
   - `.vibe/harness/src/pro-bridge/importer.ts` — `noOpOutcome`(346~371행), `existingProvenance`(319~344행), `ImportOutcome` no-op variant(96행: installedPath/resultFilesSha256 없음).
   - `.vibe/harness/src/pro-bridge/transports/{mcp-mailbox,manual}.ts`, `mailbox/{tools,server}.ts` — receipt 스키마와 ack 라우팅.
5. 크로스 프로세스 lease 선례: `.vibe/harness/scripts/vibe-stop-qa-gate.mjs` 235~271행 (`acquireLease`: wx-create, EEXIST 시 staleness 판정, stale 시 제거 후 재시도 / `releaseLease`: fingerprint 일치 시만 삭제).
6. 기존 테스트 스타일: `.vibe/harness/test/pro-bridge-mailbox.test.ts` (주입 `now`, `mkdtemp` 임시 bridgeRoot, request/manifest 헬퍼), `pro-bridge-command.test.ts` (FakeGit·captureIo).

---

## 기술 사양

### A. 동시성 모델 — P1-001 (Phase 3)

**모델 (고정)**: 단일 프로세스 내 **per-request FIFO 직렬 큐** + 크로스 프로세스 **파일 기반 stale-safe exclusive lease with fencing fingerprint**. ChatGPT UI가 순차적이라는 가정 금지 (remediation 명시). CLI(`vibe:pro-sync`)와 MCP 서버(`vibe:pro-mcp`)는 실제로 같은 store를 다른 프로세스에서 공유하므로 in-process 큐만으로는 부족하다.

구현 요건 (메커니즘 세부는 Generator 재량이되 의미는 고정):

1. **뮤테이션 경계**: `createRequest`(동일 id 경합 포함), `claimRequest`, `beginResult`, `putResultFile`, `finalizeResult`, `acknowledgeImport`, `cancelRequest`, 그리고 reconciliation(사양 B)의 변이 부분 — 전부 per-request 큐 + lease 안에서 실행. 읽기 전용 API(`getRequest`/`getStatus`/`listRequests`/`getResultManifest`/`getResultFile`)는 lease를 잡지 않는다.
2. **In-process 큐**: requestId별 promise chain(FIFO). 큐에 들어간 작업이 던져도 체인은 다음 작업으로 진행. 내부 헬퍼가 큐를 재진입해 데드락 나지 않도록 public entry에서만 enqueue (내부용 unsafe 경로 분리).
3. **Cross-process lease**: `bridgeRoot/locks/<requestId>.lock` (경로·이름은 재량이되 `requests/`·`results/` 엔트리 스캔과 health 판정에 잡히지 않는 위치). 내용: `{ fingerprint(crypto nonce), acquiredAt }`. wx-create; EEXIST면 `acquiredAt` staleness 판정(주입 `now()` 기준, threshold는 옵션 주입 가능 — 테스트에서 실 sleep 금지); stale이면 제거 후 재획득. 획득 실패는 짧은 재시도 후 명시 에러 (무한 대기 금지).
4. **Fencing**: 각 변이는 자신의 fingerprint를 보유하고, **durable commit 지점 직전에 lease 파일의 fingerprint가 여전히 자신인지 재확인**한다. 불일치(= stale 판정된 자신의 lease를 다른 actor가 깨고 인수) 시 additive 에러 코드 `stale-owner`(`MailboxErrorCode`에 추가)로 거부. 이것이 "stale owners cannot complete reclaimed work"의 구현이다 — contract.ts transition 표 변경 없이 달성한다.
5. **Phase 3 최소 요구 8항 매핑** (전부 충족 증명 대상):
   - claim 원자성 → 큐+lease 내 read-check-write; 동시 claim 2건 = 정확히 1건 성공, 1건 lifecycle-violation.
   - begin 원자성 → 큐+lease 내에서 status 다단 전이 + upload 생성이 한 직렬 단위; 동시 begin 2건 = 1 open upload, 두 번째는 동일 revision 멱등 반환.
   - revision당 1 open upload → `createUpload`가 기존 staging 존재 시 생성하지 않음; `findOpenUpload`의 다중 staging 하드 에러는 유지하되 reconciliation이 journal 근거로 정리 가능한 경우만 정리.
   - chunk append 병렬 안전 → put이 직렬화되므로 meta.json은 매 호출 최신 디스크 상태에서 갱신; 병렬 인덱스 유실 불가. 동일 chunk 중복=멱등(현행 유지), 상충 chunk=거부(현행 유지).
   - finalize의 upload 변이 배제 → finalize와 put이 같은 큐에서 직렬화; finalize commit 후 도착한 put은 `no-open-upload`.
   - ack의 revision 변이 배제 → ack와 `beginResult(revisionOf)`가 같은 큐에서 직렬화; ack가 이기면 imported에서 begin은 lifecycle-violation.
   - stale owner 차단 → 4의 fencing.
   - PID 초과 유니크 tmp → `writeJson`/`writeBytes` tmp 이름에 crypto nonce 포함 (예: `${filePath}.${pid}.${nonce}.tmp`). 잔존 tmp는 state가 아니다 — health 판정에서 제외하고, store 자신의 정확한 tmp 패턴에 일치하는 것만 reconciliation이 제거할 수 있다.

### B. finalize durable journal + 멱등 reconciliation — P1-002 (Phase 4)

**journal**: `results/<requestId>/` 아래 journal 파일 (이름 재량, 예: `journal.json`). finalize는 **어떤 파괴적 작업(특히 upload 삭제)보다 먼저** durable commit 마커(대상 revision, manifestSha256, resultFilesSha256, phase)를 기록한다. 필수 순서 불변식:

- (i) commit 마커가 존재하기 전에는 유일한 resumable upload를 삭제하지 않는다.
- (ii) upload 삭제는 finalize의 durable 작업 중 **마지막**이다.
- (iii) journal 자체 쓰기도 atomic(tmp+rename)이며, journal 부재는 "구 레이아웃 정상"으로 해석한다 (하위호환).

**복구 상태 6종 → 수렴 표** (remediation Phase 4 리터럴; startup reconciliation은 멱등이고 불변 파일 내용을 절대 변이하지 않는다):

| # | 디스크 상태 | 수렴 동작 |
|---|---|---|
| 1 | upload open, no revision | 정상 in-flight — resumable로 보존 (변이 없음) |
| 2 | revision 파일 완성, manifest 부재 | journal의 exact-manifest 근거로 finalize 재개 가능 상태 유지; 재개는 동일 manifest의 finalize 재호출로 수렴 |
| 3 | manifest 완성, index 부재 | journal 근거로 index 완성 또는 finalize replay로 수렴 |
| 4 | index 완성, upload 존재 | journal이 해당 revision commit을 증명하고 `upload.revision <= index.current`면 stale upload 제거 + journal 종결; `upload.revision == index.current + 1`이고 journal이 무관하면 정당한 신규 revision upload로 보존; 그 외(revision gap 등)는 **quarantine 보고, 침묵 삭제 금지** |
| 5 | index 완성, upload 부재, status `result-uploading` | status를 `result-ready`로 승격 |
| 6 | status `result-ready` | 이미 수렴 — no-op |

**reconciliation 트리거**: (a) 모든 변이 entry의 첫 단계 (큐+lease 안), (b) 공개 API `reconcileRequest(requestId)` (health/status 경로에서 사용 가능). 읽기 API는 변이하지 않는다 (`getStatus`의 기존 imported 파생은 유지).

**exact-manifest replay**: 어떤 크래시 지점 이후에도 동일 manifest로 `finalizeResult` 재호출 → 정확히 **1개 revision + 1개 resultFilesSha256** (중복 revision 없음, `idempotentReplay` 플래그 정확). revision finalize(status가 `result-ready`로 유지되는 경로)에도 상태 2~4가 동일하게 적용된다.

### C. 크래시 주입 seam — `onAfterDurableOp`

- `MailboxStoreOptions`와 `ImportContext`에 additive optional hook: `onAfterDurableOp?: (event: { scope: string; step: string; requestId?: string; path?: string }) => void | Promise<void>`. **프로덕션 기본 no-op.**
- store의 각 durable 연산(atomic rename commit, journal 쓰기, upload 삭제, status 쓰기, imported.json 쓰기 등) 직후 라벨된 이벤트로 호출. step 라벨은 안정된 리터럴 (테스트가 지정 지점에서 결정적으로 중단할 수 있어야 한다).
- hook이 던지면 store 메서드는 **보상 정리 없이 그대로 전파** — 디스크 상태 = 크래시 지점. 테스트는 이후 **새 MailboxStore 인스턴스**(= 재시작 모델)로 수렴을 증명한다. 실 프로세스 kill·실 sleep 금지.

### D. install → provenance 검증 → 멱등 ack 단일 워크플로우 — P1-003 (Phase 5) + carry-over 2건

1. **ImportReceipt 바인딩 (carry-over 1)**: `transports/types.ts`의 `ImportReceipt`, store의 `MailboxImportReceipt`, tools의 `ImportReceiptSchema`에 additive **optional** 필드 추가: `repositoryFullName?: string` (+ 필요 시 `resultManifestSha256?: string`). 필수화 금지 — 디스크의 기존 imported.json(구 receipt)이 계속 파싱되어야 한다. `acknowledgeImport`는 receipt가 repository를 실으면 request의 `repository.fullName`과 정확 일치를 강제하고, 기존 `resultFilesSha256` 정확 일치 게이트는 그대로 유지한다. command의 receipt 생성부(`acknowledgeAfterInstall` 및 no-op 수렴 경로)는 vpb-07의 `bindRepositoryIdentity` 산출(current fullName)을 receipt에 싣는다.
2. **멱등 ack**: status가 이미 `imported`이고 기존 imported.json이 동일 identity(requestId + resultFilesSha256)이면 `acknowledgeImport`는 lifecycle-violation이 아니라 **성공 no-op**. 다른 identity면 `receipt-mismatch`. ack 내부 크래시(imported.json 쓰기와 status 쓰기 사이)는 기존 `getStatus` 파생 + reconciliation(status를 imported로 수렴)으로 복구.
3. **no-op 수렴 경로 (핵심)**: `runMailboxSync`의 no-op 분기(현행 975~981행: 출력 후 exit 0)를 재설계한다 —
   - importer `no-op` outcome을 additive로 enrich: `installedPath`, 설치 provenance에서 읽은 `resultFilesSha256` (+ 판독한 provenance repository). `existingProvenance` 파서 확장은 tolerant 유지 (구 provenance 판독 불변).
   - command는 **폴더명 존재만으로 ack하지 않는다**: 설치 provenance의 resultFilesSha256 == store 현재 revision의 resultFilesSha256, provenance repository == request repository(vpb-07 로직 유지)를 검증한 뒤에만 receipt를 구성해 멱등 ack → `imported` 수렴 메시지 출력. 불일치면 ack하지 않고 사유를 출력한다 (기존 vpb-07 `repository-mismatch` invalid 경로 유지).
4. **out-of-band ack (carry-over 2 정식화, seam-b 후속)**: mailbox 요청의 결과가 manual wire로 도착해 store에 finalized result index가 없는 경우 — 현행은 ack가 `not-found`로 실패하고 경고 강등되어 요청이 영구 result-ready/claimed로 남는다. 정식화: `acknowledgeImport`에서 **index도 open upload도 없고** 요청이 비터미널이며 receipt의 requestId+repository가 request와 일치하면, receipt에 명시 마커(additive optional 필드, 예: `verification: 'out-of-band'`)를 기록하고 imported로 종결한다. **index가 존재하는 경우의 정확 일치 게이트는 절대 완화 금지.** bundle 경로의 "resultFilesSha256 부재 시 경고+ack 생략" 임시 분기는 이 정식화로 대체한다 (typed importer는 installed 시 항상 resultFilesSha256을 반환하므로 부재 분기는 도달 불가 방어 코드로 축소).
5. **--latest 점유 방지**: 수렴 자체가 1차 해법이다 — installed-unacked 요청은 다음 sync에서 3의 경로로 imported가 되어 ready 목록에서 빠진다. 추가로, `--latest` 선택이 no-op 수렴으로 끝난 경우 잔여 result-ready 요청 수를 안내해 다음 sync를 유도한다 (같은 실행에서 자동 연쇄 설치는 금지 — 명시 커맨드 원칙 유지).

### E. mailbox health — P3-001 (Phase 8 후반)

1. **store health API** (이름 재량, 예: `inspectMailboxHealth()`): 반환에 5상태 리터럴 고정 — `empty` / `healthy` / `recovering` / `quarantined-corrupt-entry` / `migration-required` + 엔트리별 진단 `[{ requestId, problem, detail }]`.
   - `empty`: requests 루트 부재 또는 엔트리 0.
   - `healthy`: 전 엔트리 파싱 성공 + 미해결 journal/발산 없음.
   - `recovering`: reconciliation이 수렴시킬 수 있는 발산 존재 (미종결 journal, 상태 5 등).
   - `quarantined-corrupt-entry`: 파싱 불가/불완전 엔트리 존재 (corrupt request.json, status.json 부재, partial result index). **requestId와 파싱 실패 사유를 보존해 보고하고, 엔트리를 유효한 요청으로 취급하지 않으며, 이동/삭제하지 않는다.**
   - `migration-required`: 알 수 없는 상위 schemaVersion 등 현재 코드가 additive하게 해석할 수 없는 레이아웃.
   - 우선순위(복수 존재 시 대표 상태): migration-required > quarantined-corrupt-entry > recovering > healthy > empty. 전체 상태와 별개로 엔트리별 진단은 전부 나열.
2. `listRequests`의 시그니처·정렬은 유지 (손상 엔트리는 여전히 유효 목록에서 제외) — 침묵이 사라지는 지점은 health API와 status 커맨드다.
3. **CLI 표면**: `vibe:pro-status`(status/list 커맨드, mcp-mailbox transport일 때)가 기존 테이블 뒤에 health 요약을 출력: `mailbox health: <state>` 1줄 + quarantined/migration 엔트리가 있으면 requestId·사유를 라인별로. health 조회 실패가 status 전체를 죽이지 않게 (경고 강등).
4. health 스캔은 읽기 전용 (reconciliation을 자동 실행하지 않는다 — `recovering` 보고만; 수렴은 변이 경로가 수행).

### F. 스키마·하위호환

- 모든 신규 디스크 산출물(journal, lock)과 신규 필드(receipt optional 필드)는 **additive**. 기존 `.vibe/pro-bridge/` 구 레이아웃(journal 없음, 구 receipt, 구 provenance)은 무마이그레이션으로 계속 동작한다 — 하위호환 fixture 테스트로 증명 (Tests to add 28).
- 기존 불변 result 파일·revision manifest·resultFilesSha256 해시는 어떤 코드 경로에서도 보존. reconciliation은 반복 실행 가능(멱등)해야 한다.
- `lib/schemas/pro-bridge.ts`를 건드린 경우에만 Orchestrator가 `vibe:gen-schemas -- --write` 재생성 + diff 리뷰 (기본값은 무변경).

### G. Finding별 closure 매핑 표

| Finding | Phase | 구현 지점 (파일:심볼) | 복원되는 설계 불변식 | Proof |
|---|---|---|---|---|
| VPB-AUD-P1-001 | 3 | `store.ts`: per-request 큐 + lease/fencing(`stale-owner`), nonce tmp(`writeJson`/`writeBytes`), 직렬화된 `claimRequest`/`beginResult`/`putResultFile`/`finalizeResult`/`acknowledgeImport` | 최소 요구 8항 (A-5) — 병렬 호출·재시도·중복 전달에서 단일 소유·무손실·일관 상태 | 동시성 9종 (T1~T9) + proof predicate 4 |
| VPB-AUD-P1-002 | 4 | `store.ts`: finalize journal, `reconcileRequest`, 재배열된 finalize 순서(upload 삭제 최후) | commit 마커 이전 resumable upload 미삭제; 6-state 멱등 수렴; exact-manifest replay = 단일 revision·단일 해시 | crash-injection T10~T12 + revision T15~T18 |
| VPB-AUD-P1-003 | 5 | `commands/pro-bridge.ts`: no-op 수렴 경로·receipt 생성; `importer.ts`: no-op enrichment; `store.ts`/`types.ts`/`tools.ts`: receipt repository 바인딩 + 멱등 ack + out-of-band ack | install→정확 provenance 검증→멱등 ack→imported; 폴더명만으로 ack 금지; installed-unacked의 --latest 비점유 | T13~T14, T23~T28 |
| VPB-AUD-P3-001 | 8 후반 | `store.ts`: health API; `commands/pro-bridge.ts`: status 출력 | 빈 mailbox ≠ 손상 mailbox; 손상 엔트리는 requestId+사유로 보고, 침묵 삭제 없음 | T19~T22, T29 |

### H. vpb-09 경계 (명확히 긋는다)

- **이번 범위**: store 레벨 revision 체인(`staging-revN`, index revN — 임의 N)의 finalize·journal·복구. 로스터의 rev2/rev3/revision gap/동일 revision no-op는 전부 **store 레벨**이다.
- **vpb-09 (P3-002)**: importer의 docs/plans `<folder>-rev2` 고정 선택을 lowest-available `<folder>-revN`으로 일반화 + predecessor 해시 provenance 바인딩. 이번 Sprint에서 importer의 revision 폴더 선택 로직은 **수정 금지**.
- **vpb-09 (P2-003/P2-004/P2-001)**: FINDINGS 시맨틱 스키마, 토큰 transport, App Server — 금지.

---

## Tests to add

**파일**: `.vibe/harness/test/pro-bridge-lifecycle.test.ts` (T1~T14, T23~T27) + `.vibe/harness/test/pro-bridge-health.test.ts` (T15~T22, T28~T29). node:test `describe`/`it`, 주입 `now`/`onAfterDurableOp`/lease threshold — **실 sleep·실 프로세스 kill 금지**. `mkdtemp` 임시 bridgeRoot, 기존 mailbox 테스트의 request/manifest 헬퍼 패턴 재사용. **아래 `it()` 케이스명은 리터럴로 고정한다** (Orchestrator가 출력에서 grep으로 대조).

Concurrency — 9종 (P1-001 로스터, `Promise.all` 병렬 호출):

1. `serializes two concurrent claims to exactly one owner`
2. `serializes two concurrent begin_result calls to one open upload`
3. `keeps all parallel chunks for one file in the staged metadata`
4. `keeps parallel chunks for different files independent`
5. `accepts a duplicate identical chunk idempotently`
6. `rejects a conflicting duplicate chunk without losing staged state`
7. `serializes finalize against an active upload deterministically`
8. `returns an idempotent replay for two finalize calls with the same manifest`
9. `rejects a stale claimant after ownership transfer`

Crash-injection — 5종 (각 케이스는 해당 연산의 **모든** durable step 라벨을 순회: 주입 → 크래시 → 새 store 인스턴스로 재시작 → reconciliation/replay → 수렴 assert):

10. `converges beginResult after a crash at every durable step`
11. `converges putResultFile after a crash at every durable step`
12. `converges finalizeResult after a crash at every durable step` — **finalize 복구 trace 산출 테스트**: 각 주입 지점에서 (state, manifestSha256, resultFilesSha256) receipt 시퀀스를 배열로 수집·assert하고 출력에 남긴다. 최종 불변식: 단일 revision, 단일 resultFilesSha256, status result-ready.
13. `converges importReviewResult after a crash and a stale staging directory` (사전 심은 `.tmp-*` staging + 재실행 = 설치 수렴)
14. `converges acknowledgeImport after a crash at every durable step` (imported.json↔status 사이 크래시 포함)

Revision / health — 8종 (P1-002 revision 경로 + P3-001 로스터):

15. `finalizes a rev2 revision through the journaled lifecycle`
16. `finalizes a rev3 revision through the journaled lifecycle`
17. `reports a revision gap without silently repairing it` (예: index.current+1이 아닌 staging 잔존 → quarantine 보고 + 파일 보존)
18. `treats a same-revision finalize replay as a no-op` (idempotentReplay=true, revision 수 불변)
19. `reports corrupt request JSON as a quarantined entry`
20. `reports a missing status file as a quarantined entry`
21. `reports a partial result index as a quarantined entry`
22. `recovers a quarantined entry after the damaged file is repaired` (테스트가 파일을 유효 내용으로 복원 → health healthy + 엔트리 재사용 가능; 하네스 자동 수리 아님)

Install/ack 수렴 — 5종 (P1-003 command 레벨, FakeGit + captureIo):

23. `converges an installed-unacknowledged result to imported on the next sync` — **install/ack 복구 trace 산출 테스트**: result-ready(설치 완료·미ack) → sync 재실행 → provenance 검증 → 멱등 ack → imported의 상태·해시 receipt 시퀀스를 assert하고 출력에 남긴다.
24. `does not acknowledge a no-op whose installed provenance mismatches the current result`
25. `treats a duplicate acknowledgement with the same receipt as idempotent`
26. `frees --latest after converging an installed-unacknowledged request` (수렴 후 ready 목록에서 제외 + 잔여 ready 안내)
27. `acknowledges an out-of-band manual result for a mailbox request with an explicit marker` (D-4: index 부재 + receipt 바인딩 일치 → imported + `out-of-band` 마커; index 존재 시 정확 일치 게이트 회귀 assert 포함)

하위호환 / 표면 — 2종:

28. `keeps old-layout mailbox state readable without migration` (journal 없음 + 구 receipt/구 provenance fixture → getStatus/list/sync/ack 정상, health가 migration-required를 오보하지 않음, 불변 result 해시 보존)
29. `status command reports a quarantined entry in the mailbox health summary` (`mailbox health:` 라인 + requestId·사유 출력)

공통 assertion 원칙: 동시성 케이스는 결과 상태의 **디스크 재검증**(status.json/meta.json/result.json 직접 판독)까지 수행한다. 크래시 케이스는 반드시 새 store/command 인스턴스로 재시작을 모델링한다. quarantine 케이스는 손상 파일이 **이동/삭제되지 않았음**을 assert한다. 기존 파일 갱신: finalize 내부 순서·no-op 분기·중복 ack를 전제한 기존 기대값이 있으면 새 행동으로 갱신하고 Final report에 케이스별 사유를 남긴다.

---

## 실행 제약

- **Windows sandbox**: Generator는 npm/네트워크/테스트 실행 불가 — static inspection과 코드 작성만. 실행 검증(typecheck/self-test/targeted)은 Orchestrator가 수행한다. 실행하지 못한 검증을 통과로 보고하지 말 것.
- **신규 의존성 0, 신규 스크립트 0.** `package.json` 무변경. lock/journal/큐는 node 내장(`node:crypto`/`node:fs`)만 사용.
- NodeNext ESM — 상대 import는 `.js` 확장자. UTF-8 (BOM 없음). 기존 한국어 사용자 메시지 톤 유지.
- 테스트는 `.vibe/harness/test/` 직속, node:test만. 시간 의존은 전부 주입(`now`, lease threshold, `onAfterDurableOp`) — 전체 suite 시간 폭증 금지 (crash-injection 순회는 최소 fixture로).
- 예상 규모 ~900 LOC (테스트 포함) — 상한이 아니라 규모 감각이다. 불변식 복원과 로스터 충족이 우선.

---

## 완료 체크리스트 (Verification)

### 기계 검증 (Orchestrator 실행)

- [ ] `npm run vibe:typecheck` exit 0
- [ ] `npm run vibe:self-test` exit 0 (기존 회귀 전부 포함, vpb-07 identity 로스터 무손상)
- [ ] targeted: `node --import tsx --test .vibe/harness/test/pro-bridge-lifecycle.test.ts .vibe/harness/test/pro-bridge-health.test.ts .vibe/harness/test/pro-bridge-mailbox.test.ts .vibe/harness/test/pro-bridge-command.test.ts` exit 0 + 리터럴 케이스명 29종 전부 출력에 존재
- [ ] `rg "process\.pid\}\.tmp" .vibe/harness/src/pro-bridge` 0건
- [ ] `rg "onAfterDurableOp" .vibe/harness/src/pro-bridge` — store.ts·importer.ts 존재
- [ ] `rg "quarantined-corrupt-entry" .vibe/harness/src` ≥1건 + `rg "migration-required" .vibe/harness/src` ≥1건
- [ ] `git diff -- .vibe/harness/src/pro-bridge/contract.ts` 빈 출력
- [ ] vpb-07 회귀 가드 grep 2종 (proof predicate 8) 통과
- [ ] `git status --porcelain -- docs/plans` 빈 출력, `git diff -- package.json .vibe/config.json` 빈 출력
- [ ] `npm run vibe:gen-schemas` drift 없음

### Inspection / demo AC (Orchestrator·Evaluator·사용자)

- [ ] **crash/restart 복구 trace 2종 확보** (이 Sprint의 사용자 payoff 증거 — CLI 제품이므로 transcript가 identity/payoff evidence를 대신한다): Orchestrator가 T12(finalize)·T23(install/ack) 실행 transcript에서 상태·해시 receipt 시퀀스(request-ready→…→result-ready / result-ready→installed→imported)를 캡처. remediation Final report의 "Include one crash/restart recovery trace for finalize and one for install/ack" 형식과 대응되는가.
- [ ] **health 출력 실측**: Orchestrator가 임시 손상 fixture(별도 mkdtemp bridgeRoot — 실 `.vibe/pro-bridge/` 오염 금지)로 status 커맨드 health 요약 transcript 확보. "빈 mailbox"와 "손상 mailbox"가 사용자에게 오해 없이 구분되는가.
- [ ] 검증 약화 부재: store/importer diff 리뷰에서 기존 SHA·정확 일치·lifecycle 게이트가 하나도 완화되지 않았는가 — 특히 out-of-band ack가 "index 존재 시 정확 일치"를 건드리지 않았는가 (Evaluator 대조).
- [ ] reconciliation·quarantine이 어떤 경로에서도 불변 result 파일을 재작성/삭제하지 않는가 (Evaluator 대조).
- [ ] >5 파일 + >500 LOC이므로 **Evaluator 소환은 Must**.

---

## Final report 요구 (Generator 출력 필수 형식)

1. **`## Wiring Integration`** — `.vibe/agent/_common-rules.md` §14의 W1~W14 각 항목을 `touched / n/a / skipped+reason`으로 보고. 이번 Sprint 예상: W12 touched (신규 테스트 2파일 — sync-manifest의 `.vibe/harness/test/**` glob 자동 포함이면 W6는 n/a+사유), W11 touched (additive 디스크 산출물·receipt 필드 — 하위호환 fixture T28이 증거), W10 skipped+사유 (P1 미결 중 release 기록/버전 bump 금지 — release-closure로 이월). 삭제/개명 없음이면 D1~D6 n/a. 신규 파일에 `verified-callers:` 명시.
2. **Finding별 closure 증거** — `VPB-AUD-P1-001`, `VPB-AUD-P1-002`, `VPB-AUD-P1-003`, `VPB-AUD-P3-001`, `carry-over-1(receipt 바인딩)`, `carry-over-2(out-of-band ack 정식화)` 각각: status (closed-in-code / partial) / files and symbols changed / design invariant restored (한 문장) / targeted tests (리터럴 케이스명) / residual limitation (예: "실 multi-process 동시 실행 검증은 Phase 11 실측, 만료된 installed-unacked 요청의 ack는 미지원").
3. **crash/restart trace 지정** — trace 산출 테스트 2종(T12, T23)의 위치·receipt 시퀀스 형식·Orchestrator 캡처 방법 명시 (Generator 자신은 non-proof로 분류).
4. **Current proof vs non-proof 분리** — executed-and-passed / executed-and-failed / not-executed / repository-claim-only 4분류로 모든 검증 항목 나열.
5. **기존 테스트 기대값 변경 목록** — 케이스명 + 변경 전/후 행동 + 검증 약화가 아닌 근거.
