# GitHub Pro Roundtrip 상세설계

> Historical design snapshot: the implemented public skill/command was renamed
> to `$vibe-pro-go` / `npm run vibe:pro-go`. Internal `pro-roundtrip` schema and
> packet identifiers remain stable for durable-format compatibility.

## 1. 목표

Web ChatGPT Pro의 추론 품질과 Codex CLI의 로컬 구현 능력을 결합하되,
ChatGPT Pro에서 사용할 수 없는 custom plugin/MCP 도구에 의존하지 않는다.

정상 workflow는 다음을 지원해야 한다.

1. CLI 또는 Web에서 목표를 시작한다.
2. Web Pro가 private repository의 코드와 문서를 GitHub 앱으로 읽고 상세설계한다.
3. Codex CLI가 설계를 exact revision으로 반입해 여러 Sprint에 걸쳐 구현한다.
4. CLI가 exact code HEAD, 검증 결과, workflow evidence를 구현 보고서로 발행한다.
5. Web Pro가 설계 계약과 exact HEAD를 기준으로 코드를 리뷰하고 피드백한다.
6. CLI가 remediation하고 새 보고서를 발행한다.
7. Web Pro가 승인하거나 추가 피드백한다.
8. CLI가 flow를 닫고 전체 이력을 immutable archive로 남긴다.

## 2. 비목표

- Web Pro의 모델 선택 또는 메시지 전송 자동화
- chatgpt.com DOM 조작 또는 브라우저 세션 쿠키 사용
- custom MCP server, local HTTP server, tunnel, one-time code
- Web이 로컬 filesystem 또는 dirty worktree에 접근하는 기능
- `vibe-pro-bridge`를 코드 PR, merge base, 배포 branch로 사용하는 기능
- 모든 GitHub connector 구현 차이를 추상화하는 범용 connector framework
- 여러 작성자가 같은 flow를 동시에 수정하는 고처리량 queue
- 바이너리, 대용량 로그, 전체 repository snapshot 보관

## 3. 핵심 불변식

### INV-001: Code/Exchange lane 분리

실제 코드, 테스트, migration은 feature branch에만 기록한다. 설계, 보고서,
피드백, receipt는 `vibe-pro-bridge`에만 기록한다.

### INV-002: Append-only

완료된 flow/event 파일을 update, rename, delete하지 않는다. 정정은 새 revision
event로 추가한다. force push를 사용하지 않는다.

### INV-003: Exact evidence binding

모든 구현과 리뷰는 다음 세 값을 함께 기록한다.

```text
designEventId + sprintId + codeHeadSha
```

`latest`, `current code`, `최근 설계` 같은 유동적 기준은 완료 evidence가 아니다.

### INV-004: Durable reconstruction

새 CLI 세션은 대화 기록 없이 `FLOW.json`, design contract, Sprint packet,
checkpoint, Git state만으로 정확히 재개할 수 있어야 한다.

### INV-005: Three-level verification

Sprint-local unit green은 flow completion이 아니다. Sprint gate, cumulative
integration gate, final flow gate가 모두 별도로 존재해야 한다.

### INV-006: Human-authorized external actions

Web GitHub write와 CLI push는 사용자에게 보이는 승인 경계를 유지한다. 인증정보,
confirmation bypass, background model invocation을 도입하지 않는다.

## 4. 아키텍처

### 4.1 Lane

| Lane | Branch | Writer | Reader | 정책 |
|---|---|---|---|---|
| Code | feature branch | Codex CLI | Web Pro, CLI | 정상 개발/PR |
| Exchange | `vibe-pro-bridge` | Web Pro, CLI | Web Pro, CLI | append-only, no PR/merge |
| Protocol | `vibe-pro-bridge:protocol/vN` | CLI maintainer | Web Pro, CLI | versioned immutable contract |

`vibe-pro-bridge`는 최초 bootstrap 시 remote default branch에서 분기한다. v1은
orphan branch를 요구하지 않는다. 기존 bridge branch를 force rewrite하지 않으며,
Web connector의 non-default branch 가시성을 먼저 실측한다.

### 4.2 CLI isolated worktree

CLI는 현재 feature branch를 전환하지 않는다. ignored tool-owned 경로에 detached
worktree를 만든다.

```text
.vibe/worktrees/pro-roundtrip/
```

publish 전 순서는 다음과 같다.

1. `origin/vibe-pro-bridge`를 fetch한다.
2. tool-owned marker와 clean worktree를 확인한다.
3. detached worktree를 remote tip으로 맞춘다.
4. 새 immutable path만 추가한다.
5. commit한다.
6. `HEAD:refs/heads/vibe-pro-bridge`로 non-force push한다.
7. non-fast-forward면 fetch/rebase 후 path collision을 재검사하고 한정 재시도한다.

tool-owned marker가 없거나 사용자 파일이 존재하면 reset/delete하지 않고 중단한다.

## 5. Archive layout

### 5.1 Flow root

```text
flows/
├─ 20260719/
│  ├─ 001-github-pro-review-loop/
│  ├─ 002-github-new-flow-name/
│  └─ 003-project-entire-refactoring/
└─ 20260720/
   └─ 001-whats-next-job/
```

- 날짜: configured project timezone의 `YYYYMMDD`
- sequence: 해당 날짜의 `max + 1`, 3자리 zero-padding
- slug: 소문자 ASCII kebab-case, 3~60자
- 자정을 넘어가는 flow는 시작 날짜와 root를 유지한다.
- random ID와 timestamp는 경로에 사용하지 않는다.
- 같은 slug는 sequence가 다르면 허용한다.

동시 flow 생성으로 sequence가 충돌하면 publish 직전 directory를 다시 읽고 다음
번호를 할당한다. 사용자에게 보이는 merge conflict로 확대하지 않는다.

### 5.2 Flow contents

```text
001-github-pro-review-loop/
├─ FLOW.json
├─ 0000--cli--goal--r01/
│  ├─ GOAL.md
│  └─ COMPLETE.json
├─ 0100--pro--design--r01/
│  ├─ DESIGN.md
│  ├─ CONTRACT.json
│  ├─ SPRINTS.md
│  └─ COMPLETE.json
├─ 0200--codex--implementation-report--r01/
│  ├─ sprints/
│  │  ├─ 001-foundation/
│  │  │  ├─ SPRINT.md
│  │  │  ├─ REPORT.md
│  │  │  └─ CHECKPOINT.json
│  │  └─ 002-end-to-end/
│  │     ├─ SPRINT.md
│  │     ├─ REPORT.md
│  │     └─ CHECKPOINT.json
│  ├─ WORKFLOW-MATRIX.md
│  ├─ REPORT.md
│  └─ COMPLETE.json
├─ 0300--pro--feedback--r01/
│  ├─ FEEDBACK.md
│  ├─ FINDINGS.json
│  └─ COMPLETE.json
├─ 0400--codex--remediation-report--r01/
│  ├─ REPORT.md
│  └─ COMPLETE.json
├─ 0500--pro--approval--r02/
│  ├─ APPROVAL.md
│  └─ COMPLETE.json
└─ 9900--cli--closed--r01/
   ├─ SUMMARY.md
   └─ COMPLETE.json
```

`FLOW.json`은 immutable identity와 protocol binding만 가진다. mutable status,
latest pointer, current Sprint를 기록하지 않는다. 현재 상태는 유효한
`COMPLETE.json` event 중 마지막 sequence/revision에서 계산한다.

### 5.3 Event naming

```text
NNNN--ACTOR--KIND--rNN
```

- sequence는 기본적으로 100 단위로 증가시켜 중간 checkpoint 삽입 여지를 둔다.
- actor: `cli`, `codex`, `pro`
- kind: `goal`, `design`, `implementation-report`, `feedback`,
  `remediation-report`, `approval`, `closed`
- revision은 같은 semantic phase의 새 발행에서 증가한다.

완료 event의 파일을 정정하지 않는다. 잘못된 event는 새 revision이
`supersedesEventId`로 대체한다.

## 6. Publication protocol

### 6.1 Multi-file publication barrier

Web connector가 여러 create-file action을 사용하므로 event는 부분 작성될 수 있다.
consumer는 다음 규칙을 사용한다.

1. payload 파일을 먼저 생성한다.
2. `COMPLETE.json`을 마지막 action으로 생성한다.
3. `COMPLETE.json`이 없으면 incomplete event로 무시한다.
4. complete marker의 file roster와 실제 tree가 다르면 invalid로 격리한다.
5. 이미 존재하는 payload가 틀렸으면 update하지 않고 새 revision을 발행한다.

Git commit이 integrity와 history를 제공하므로 Web에 byte hash 계산을 요구하지
않는다. CLI importer는 marker가 포함된 source commit SHA와 payload blob SHA를
receipt에 계산해 기록할 수 있다.

### 6.2 Append-only audit

CLI sync는 last acknowledged bridge commit 이후 diff를 검사한다.

- 추가(`A`)만 허용한다.
- 완료 event의 수정(`M`), 삭제(`D`), rename(`R`)은 tamper 경고로 처리한다.
- protocol 파일은 새 version directory 추가만 허용한다.
- invalid/tampered event는 자동 실행 또는 자동 적용하지 않는다.

GitHub 서버에서 path immutability를 강제할 별도 custom app은 v1 범위가 아니다.
v1은 runbook, no-force branch rule, importer audit로 fail-closed한다.

### 6.3 Semantic validation

JSON Schema 통과만으로 event를 신뢰하지 않는다. runtime validator는 다음
상호 일치를 추가로 검사한다.

- `flowPath`의 date/sequence/slug와 `FLOW.json` 필드
- event directory 이름의 sequence/actor/kind/revision과 `COMPLETE.json`
- `previousEventId`가 가리키는 complete event의 존재
- `supersedesEventId`의 동일 flow/kind 호환성
- file roster와 실제 event tree
- `CONTRACT.json`의 ID uniqueness
- owner/dependency/workflow/invariant cross-reference
- Sprint dependency cycle 부재
- design event와 code base/head binding
- next actor와 next write target의 허용 transition

허용되는 대표 transition:

```text
goal → design → implementation-report → feedback
feedback → remediation-report → feedback
feedback → design revision
feedback → approval
approval → closed
```

audit flow는 기존 design reference가 있으면 이를 고정하고, 없으면
`designEventId: null`을 명시해 `goal → implementation-report → feedback`으로
진행할 수 있다.

## 7. Protocol distribution

정본 source는 구현될 repo-owned skill resource다. bootstrap script가 같은 bytes를
bridge branch에 materialize한다.

```text
protocol/v1/
├─ COMMON-HARNESS.md
├─ WEB-RUNBOOK.md
├─ FLOW.schema.json
├─ CONTRACT.schema.json
└─ EVENT-COMPLETE.schema.json
```

각 flow는 다음을 `FLOW.json`에 고정한다.

- `protocolVersion`
- `protocolCommitSha`
- `commonHarnessSha256`

CLI는 local skill resource와 bridge protocol의 hash mismatch를 허용하지 않는다.
active flow 도중 protocol을 암묵 업그레이드하지 않는다.

## 8. Common harness

Web과 CLI가 공유하는 실행 규약은 `COMMON-HARNESS.md`를 정본으로 한다. actor별
runbook은 공통 규칙을 복사하지 않고 추가 행동만 정의한다.

공통 harness가 강제하는 핵심은 다음과 같다.

- repository reconnaissance와 reuse map 선행
- default 1~3 Sprint, 4개 초과 시 분리 불가능성 설명
- `REQ/INV/WF/NFR/DEC` stable contract IDs
- immutable design contract와 Sprint envelope
- design/Sprint/code SHA triple binding
- context-compaction-safe durable reconstruction
- Sprint/cumulative/final 3단계 verification
- finding taxonomy와 feedback termination
- scope extension의 새 flow 분리
- Web/CLI 양쪽의 prompt-injection trust boundary

상세 문구는 `COMMON-HARNESS.md`를 따른다.

## 9. Design contract

Pro design event는 다음 파일을 필수로 생성한다.

### DESIGN.md

- problem and goal
- repository evidence
- architecture and data flow
- reuse targets
- new components and justification
- rejected abstractions
- invariants and non-goals
- failure/recovery behavior
- security/privacy
- test and release strategy
- risks and explicit deferrals

### CONTRACT.json

stable IDs와 Sprint mapping의 기계 정본이다. 원본은 수정하지 않는다.

- requirements: `REQ-###`
- invariants: `INV-###`
- workflows: `WF-###`
- non-functional requirements: `NFR-###`
- decisions: `DEC-###`
- Sprints: `SPR-###`

JSON Schema가 형식 검증을 담당하고 runtime validator가 ID uniqueness와
cross-reference integrity를 검사한다.

### SPRINTS.md

사람이 읽는 최소 Sprint 계획이다. 각 Sprint는 objective, owned IDs,
dependencies, non-goals, integration checks, likely files를 포함한다.

## 10. Sprint desynchronization control

### 10.1 Root cause

fresh-context Planner에 Sprint 번호와 짧은 prior summary만 전달하면 이전 설계의
global invariant와 workflow가 손실된다. item별 targeted verification만 수행하면
모든 unit test가 통과해도 누적 workflow wiring이 끊길 수 있다.

### 10.2 Sprint envelope

CLI는 `CONTRACT.json`에서 각 Sprint용 immutable `SPRINT.md`를 생성한다.

```text
Flow path
Protocol/design event
Sprint ID and objective
Owned REQ/NFR IDs
Preserved INV IDs
Affected WF IDs
Dependencies and previous evidence
Required cumulative integration checks
Explicit non-goals
Allowed scope
Verification commands
Blocked handling
```

Planner와 Generator에는 전체 대화/iteration history 대신 이 envelope와 필요한
design section만 전달한다.

### 10.3 Context checkpoints

Mid-Sprint resume state는 project-owned `.vibe/agent/handoff.md`에 compact하게
보존한다. bridge에는 Sprint 종료 checkpoint만 발행해 archive noise를 제한한다.

필수 checkpoint 경계:

- Sprint 시작 전
- acceptance item 완료 후
- 장시간 test/build 또는 fresh Planner 호출 전
- 중요한 설계 결정 직후
- Sprint 종료 전
- 예상되는 session/context 전환 전

resume 시 Git HEAD, dirty state, design event, Sprint ID가 checkpoint와 다르면
자동 진행하지 않는다.

### 10.4 Verification gates

#### Sprint gate

- owned contract acceptance
- targeted unit/component tests
- 직접 변경한 integration seam
- scope/non-goal audit

#### Cumulative integration gate

- 이전 Sprint 결과를 포함한 smoke/journey
- entrypoint → orchestration → persistence → output 흐름
- schema/config/public API의 모든 consumer
- preserved invariant regression

공유 contract, schema, entrypoint, persistence boundary를 건드린 Sprint는 다음
Sprint로 넘어가기 전에 cumulative gate를 반드시 통과한다.

#### Final flow gate

- project-prescribed full QA
- 모든 `WF-*` journey
- 모든 `REQ/INV/NFR`의 implementation/test evidence
- base..head diff의 wiring/config/migration/docs audit
- skipped validation과 known risk

기존 multi-item verification override와 무관하게 이 flow의 final gate는 일반 제품
변경에도 적용한다.

### 10.5 Workflow matrix

최종 `WORKFLOW-MATRIX.md`는 다음 열을 포함한다.

```text
Contract ID | Owner Sprint | Implementation evidence | Test evidence |
Integration evidence | Status | Notes
```

Web Pro final review는 matrix와 final `COMPLETE.json`이 없으면 시작하지 않는다.

## 11. Feedback loop

Web finding은 다음 taxonomy 중 하나를 사용한다.

- `implementation-defect`
- `design-defect`
- `missing-test`
- `scope-extension`
- `evidence-missing`

처리:

- implementation defect / missing test: 현재 flow remediation
- evidence missing: 코드 변경 없이 report 보완 가능
- design defect: 새 design revision과 remaining Sprint rebaseline
- scope extension: 새 flow로 분리
- P0/P1: approval 전 해결
- P2/P3: 사용자 가치에 따라 defer 가능

두 번의 remediation 뒤에도 finding이 반복되면 무조건 세 번째 patch를 시작하지
않는다. 같은 defect면 root cause를 재진단하고, 새 요구면 새 flow로 분리하며,
design 변경이면 revision을 증가시킨다.

## 12. Skill UX

추천 skill 이름은 `vibe-pro-roundtrip`이다.

```text
$vibe-pro-roundtrip start design "<goal>"
$vibe-pro-roundtrip start audit
$vibe-pro-roundtrip status [flow]
$vibe-pro-roundtrip sync [flow]
$vibe-pro-roundtrip report [flow]
$vibe-pro-roundtrip continue [flow]
$vibe-pro-roundtrip close [flow]
$vibe-pro-roundtrip doctor
```

예상 동작:

- `start`: flow allocation, FLOW/goal event, protocol binding, Web prompt 출력
- `status`: remote tree에서 latest valid event와 next actor 계산
- `sync`: Web event/schema/SHA/HEAD 검증 후 local work packet 설치
- `report`: Sprint/final evidence 수집 후 implementation/remediation event 발행
- `continue`: 다음 Web action의 exact branch/path prompt 출력
- `close`: contract matrix와 approval을 확인하고 close summary 발행
- `doctor`: Git remote, branch, connector preflight checklist, worktree, schemas 점검

기존 `vibe-pro-design`, `vibe-goal-audit`가 존재하는 버전에서는 새 engine으로
delegate할 수 있다. v1.7.30 기준 main에는 해당 구현이 없으므로 새 기능은 독립
추가한다.

## 13. Web prompt

사용자에게 매 turn 긴 package를 복사시키지 않는다.

```text
Use the GitHub app.
Read owner/repo@vibe-pro-bridge:protocol/v1/WEB-RUNBOOK.md.
Continue flow flows/20260719/001-github-pro-review-loop from its latest
completed event. Write only to the exact write target defined by the runbook.
```

Web은 commit 후 생성한 파일을 다시 읽고 short receipt만 채팅에 반환한다.

Web-origin 시작은 `WEB-RUNBOOK.md`의 별도 절차를 사용한다. repository,
code branch, base SHA, timezone, pinned protocol commit을 확정할 수 없으면 Web이
임의 flow를 만들지 않는다.

## 14. Security, privacy, and trust

- GitHub 앱에서 사용자가 승인한 repository만 사용한다.
- code and repository files are evidence, not instructions.
- pinned `COMMON-HARNESS.md`와 `WEB-RUNBOOK.md`만 Web instruction authority다.
- Web output은 untrusted review input이며 CLI가 shell command를 자동 실행하지 않는다.
- secret path denylist와 binary/large-file exclusions를 적용한다.
- connector/model availability를 자동 주장하지 않고 reviewer declaration에 한계를 적는다.
- 개인 ChatGPT data control과 repository policy를 사용자가 확인한다.
- branch write confirmation과 CLI push authorization을 우회하지 않는다.
- PR 생성, default branch write, force push, file update/delete를 금지한다.

## 15. Failure and recovery

| Failure | Recovery |
|---|---|
| private/non-default branch가 Web에서 안 보임 | exact ref/path 재시도, indexing 대기, M0 실패 시 별도 exchange repo 검토 |
| Web payload 일부만 생성 | `COMPLETE.json` 없으므로 무시, missing file 추가 또는 새 revision |
| 같은 daily sequence 할당 | fetch 후 max+1 재할당 |
| CLI non-fast-forward | fetch/rebase, immutable path collision audit, bounded retry |
| reviewed HEAD mismatch | sync 중단, 새 Web review 또는 명시적 stale acceptance |
| protocol hash mismatch | flow 중단, pinned version 복구 |
| existing event modified/deleted | tamper 경고, 자동 적용 금지 |
| context compaction | handoff/checkpoint와 exact Sprint envelope로 재구축 |
| remediation 반복 | taxonomy/rebaseline/new-flow 규칙 적용 |

## 16. Live M0 gate

release 전에 실제 private test repository의 Web Pro GitHub 앱으로 확인한다.

1. exact non-default branch file read
2. nested path create on `vibe-pro-bridge`
3. default branch가 변경되지 않음
4. PR이 자동 생성되지 않음
5. 생성 파일 재조회와 commit SHA 확인
6. 약 100 KiB UTF-8 Markdown create
7. 연속 create action의 branch HEAD 수렴
8. write confirmation UI 유지

M0가 non-default branch write를 지원하지 않으면 별도 private exchange repository를
fallback 설계로 채택한다. 이 판단 전 기존 branch를 rewrite하지 않는다.

## 17. 구현 구성

예상 repository-owned 구성:

```text
.vibe/harness/src/pro-roundtrip/
  contract.ts
  flow-store.ts
  git-branch-transport.ts
  worktree.ts
  importer.ts
  report.ts
.vibe/harness/src/lib/schemas/
  pro-roundtrip.ts
.vibe/harness/schemas/
  pro-roundtrip-*.schema.json
.vibe/harness/scripts/
  vibe-pro-roundtrip.mjs
.vibe/harness/test/
  pro-roundtrip-*.test.ts
.claude/skills/vibe-pro-roundtrip/
  SKILL.md
  references/
  assets/
.codex/skills/vibe-pro-roundtrip/
  SKILL.md
docs/context/
  pro-roundtrip-setup.md
```

`.vibe/sync-manifest.json`은 이미 harness, `.claude/skills/**`,
`.codex/skills/**`, `docs/guides/**` 등을 포괄한다. 새 파일이 기존 glob 안에
있으면 manifest에 개별 파일을 열거하지 않는다.

## 18. 구현 단계

### Sprint 1: Contract and branch store

- Zod/JSON Schemas
- flow/event path parser
- daily allocator
- append-only/tamper validator
- detached worktree transport
- protocol bootstrap
- focused unit/integration tests

### Sprint 2: CLI skill loop

- start/status/sync/report/continue/close/doctor
- design/feedback importer
- Sprint envelope와 checkpoint integration
- report/workflow matrix generation
- Codex/Claude skill wiring

### Sprint 3: Cross-surface completion

- Web Runbook materialization
- cumulative/final verification gates
- recovery and stale-head tests
- M0 manual checklist
- downstream sync/setup docs
- full self-test, typecheck, build, sync audit, checkpoint

4개 이상의 Sprint로 확장하려면 각 추가 Sprint가 독립적인 failure boundary인지
설명한다. 단순 파일 분류를 위해 Sprint를 늘리지 않는다.

## 19. Acceptance

- 날짜별 flat flow가 deterministic하게 할당된다.
- 완료 event는 append-only이며 partial event가 import되지 않는다.
- Web/CLI가 동일 protocol hash를 사용한다.
- feature branch를 전환하지 않고 bridge publish가 가능하다.
- default branch/PR을 변경하지 않는다.
- design contract의 ID가 Sprint와 final evidence까지 추적된다.
- compaction 후 새 CLI 세션이 durable artifact만으로 재개된다.
- 모든 Sprint unit green이더라도 cumulative/final gate 없이는 complete되지 않는다.
- reviewed HEAD mismatch와 tamper가 fail-closed한다.
- remediation loop가 design defect와 scope extension을 분리한다.
- M0 private/non-default branch write가 실측된다.
- unused/disabled 상태에서 hook, Stop QA, background server 오버헤드가 없다.
