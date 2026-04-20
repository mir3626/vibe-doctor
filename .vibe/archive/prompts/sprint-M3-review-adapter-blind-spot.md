---
sprint-id: sprint-M3-review-adapter-blind-spot
iteration: iter-7
finding: dogfood10 review-4 Finding A — /vibe-review adapter-health smoke blind-spot rubric
loc-budget: 60 (buffered 70)
new-scripts: 0
harness-version-bump: true
harness-version-from: 1.4.3
harness-version-to: 1.5.0
final-sprint-of-iteration: true
planner: sprint-planner (fresh Opus subagent, iter-7 M3)
---

## Goal

`/vibe-review` 가 "adapter-health blind-spot" 를 구조적으로 감지하지 못해 dogfood10
iter-1 에서 "트렌딩 위젯에 Reddit 만 나오고 GeekNews / DCInside 는 0 items" 가
사용자 배포 후에야 노출된 사건을 재발 방지한다. 본 Sprint 는 세 축을 묶는다:

1. **Inputs** — `collectReviewInputs()` 가 `productFetcherPaths` (Next.js
   `app/api/**/route.*` 계열) 를 결정적 ordering 으로 수집.
2. **Rubric** — `/vibe-review` SKILL.md 의 Automatic Checks 에 "Adapter-health
   blind-spot (🔴 Blocker)" 항목을 추가, e2e smoke 파일이 각 adapter basename 을
   probe 하지 않으면 Blocker 1건 auto-seed 하도록 **계약** 을 문서화.
3. **Ledger** — `harness-gaps.md` 에 `gap-external-adapter-blind-spot` 신규 row
   를 `closed` + `covered_by: sprint-M3-review-adapter-blind-spot` 로 append.

동시에 iter-7 최종 Sprint 이므로 `package.json.harnessVersion` 을 `1.4.3` → `1.5.0`
으로 한 줄 bump 하여 `vibe-sprint-commit.mjs` 의 auto-tag 경로가 annotated tag
`v1.5.0` 을 생성하도록 한다.

---

## 제약

### Core invariant — 절대 건드리지 말 것

- `scripts/**` 어떤 `.mjs` / `.sh` / `.cmd` 도 수정 금지.
- `src/lib/review.ts` 의 기존 export 시그니처 (함수 이름, 인자, 반환 타입 기존 필드)
  유지. `ReviewInputs` 에 **오직 한 필드** (`productFetcherPaths: string[]`) 만 append.
- 기존 `test/vibe-review-inputs.test.ts` case 의 describe/it 이름·계약·assertion
  **수정 금지**. 신규 case 1건만 describe 블록 끝에 append.
- `package.json` 의 `version` (`0.1.0`), `scripts`, `dependencies`,
  `devDependencies`, 기타 메타 키는 건드리지 않는다. **오직** `harnessVersion` 한
  줄만 변경.
- `.vibe/agent/handoff.md`, `session-log.md`, `sprint-status.json`,
  `iteration-history.json` 편집 금지 — 이건 `vibe-sprint-complete.mjs` /
  `vibe-sprint-commit.mjs` 가 관리.
- `_common-rules.md`, `CLAUDE.md` 는 본 Sprint scope out.
- `docs/context/harness-gaps.md` 의 **기존 row** 는 건드리지 말고, 표 끝에 신규 row
  한 줄만 append. 특히 `gap-review-catch-wiring-drift` row (wiring-registration
  계열, 별개 gap) 는 touch 금지.
- `.claude/skills/vibe-review/SKILL.md` 의 "Adapter-health blind-spot" append 외
  다른 rubric / 섹션 / 문단 편집 금지.

### Scope out

- `/vibe-review` 가 실제 e2e 파일을 grep 하여 finding 을 seed 하는 **구현 로직**
  (`src/lib/review.ts` 안 adapter-health seed 함수) 은 본 Sprint 에 포함하지 않는다.
  본 Sprint 는 (a) inputs 수집과 (b) rubric 계약 문서화까지만 다룬다. 실행 시
  구현은 다음 iteration backlog (soft freeze 원칙 준수: new scripts 0건 + 150 LOC
  cap + dogfood evidence 축적 후).
- `adapter-health` finding 의 자동 seed 로직을 **테스트로 검증하지 않는다** — 본
  Sprint test 는 `productFetcherPaths` 입력 수집만 검증.

### Common rules

- `.vibe/agent/_common-rules.md §14` Wiring Integration 체크리스트 (W1~W14 / D1~D6)
  를 Final report 의 `## Wiring Integration` 섹션에 빠짐없이 보고한다.
- `.vibe/agent/_common-rules.md §15` — 일반적으로 Generator 는 자발적 test 생성
  금지지만, **본 Sprint 는 Planner 가 test case 1건 append 를 명시적으로 지시**
  했으므로 §15 opt-in 으로 간주한다. 단 제약:
  - **신규 test 파일 생성 금지**. 기존 `test/vibe-review-inputs.test.ts` 에 case 1건
    append 만 허용.
  - 지시된 case 이름·assertion set 을 literal 로 따르고 추가 case 임의 생성 금지.

---

## 변경 지점

### §1) `src/lib/review.ts` — `ReviewInputs` 확장 + `collectReviewInputs()` 확장

#### 1-a. 타입 확장

`ReviewInputs` interface 의 **마지막 필드 다음** (즉 `pendingRestorations: PendingRestoration[]` 다음 줄) 에 정확히 한 필드를 추가한다:

```ts
productFetcherPaths: string[];
```

필드 의미: 해당 프로젝트의 Next.js 스타일 data-fetcher route 파일 경로 목록
(repo-relative posix 정규화 + ascending sort). 프로젝트 루트에 `app/` 도
`src/app/` 도 없으면 빈 배열.

#### 1-b. 수집 로직

`collectReviewInputs()` 의 `Promise.all` 블록 또는 그 다음에 `productFetcherPaths`
를 채운다. 아래 의도를 만족하면 구현 형태는 Generator 판단에 위임한다:

- **탐색 대상**: 프로젝트 루트의 `app/` 과 `src/app/` **두 루트를 독립적으로** 재귀
  탐색. 각 루트가 존재하지 않으면 해당 루트는 건너뛴다.
- **수집 조건**: 파일 basename 이 정확히 `route.ts` / `route.tsx` / `route.mjs`
  / `route.js` 중 하나인 파일만 수집.
- **skip 디렉터리**: 탐색 중 만나는 디렉터리 이름이 `node_modules` / `.next` /
  `dist` / `.vibe` 중 하나면 해당 서브트리 전체 skip. (임의의 깊이에서도.)
- **정규화**: 수집된 각 경로는 `path.relative(resolvedRoot, abs).replace(/\\/g, '/')`
  형태로 posix separator 로 변환. (이 파일은 이미 같은 패턴을 `loadPriorReviewIssues`
  내부에서 사용하고 있음 → 동일 스타일 채택.)
- **ordering**: 반환 배열은 ascending `localeCompare` sort — 결정적 ordering 필수.
- **반환 객체**: 기존 `return { handoff, ... pendingRestorations }` 객체에
  `productFetcherPaths` 한 필드를 append. 기존 필드 순서·값 **절대 변경 금지**.
- **import 신규**: 가능하면 기존 `readdir` / `stat` import 재사용. 새 dependency
  추가 금지. `node:fs/promises` 에서 `readdir` 가 이미 import 되어 있으므로
  `{ withFileTypes: true }` 옵션만 쓰면 된다.

### §2) `.claude/skills/vibe-review/SKILL.md` — Automatic Checks 섹션 rubric 항목 추가

기존 "Automatic Checks" 섹션의 **마지막 bullet 다음 줄** 에 빈 줄을 두고, 아래
블록을 literal 그대로 추가한다 (헤딩 `###` 레벨은 Automatic Checks 내부에서
신규 하위 heading 으로 삽입):

```md
### Adapter-health blind-spot (🔴 Blocker)

프로젝트에 `app/api/*/route.ts` 또는 동등한 데이터 fetcher 경로 (`productFetcherPaths`
non-empty) 가 존재하고 `e2e/` / `playwright.config.*` 기반 smoke 가 있음에도, smoke
파일이 **각 route 의 응답 (items 배열 / status code) 을 개별 assertion 하지 않으면**
🔴 Blocker finding 1건을 auto-seed 한다.

- 판정 로직: `productFetcherPaths` 의 각 경로 basename (예: `geeknews`, `dcinside`) 을
  e2e smoke 파일 내용에서 **string 으로 1회 이상 등장** 하는지 grep. 매칭 없으면 해당
  adapter 는 "probe 되지 않음" 으로 간주.
- Finding 문구: "adapter <name> 이 소리 없이 0 items 반환해도 smoke 가 통과하는 상태는
  production broken feature 를 의미함 — probe-based assertion 또는 contract test 필요."
- 완화 (false-positive 회피): adapter 가 **의도적으로 mock-only** 이거나 platform 이
  web 이 아니면 (`productText` platform grep) seed 하지 않는다.
```

- 섹션 위치: "Automatic Checks" heading **안쪽** 의 맨 끝. 다음 `## Report Shape`
  heading 위.
- 다른 Automatic Checks bullet / 다른 섹션 / 기존 rubric 항목 touch 금지.
- rubric 본문 문자열 literal 정확히 일치해야 함 (self-QA grep 기반).

### §3) `test/vibe-review-inputs.test.ts` — 신규 case 1건

`describe('review inputs', ...)` 블록 내부 **마지막 it() 다음** 에 아래 case 를
추가한다. 다른 describe 블록 / 다른 case 수정 금지.

**case 이름 (literal)**:
`'collectReviewInputs includes productFetcherPaths for Next.js app/api routes'`

**case 내용 (의도 — 구현 구조는 Generator 판단)**:

1. `makeTempDir('review-fetcher-paths-')` 로 tmp root 획득.
2. 기존 `scaffoldRepo(root)` 를 먼저 호출해 `.vibe/**`, `docs/context/**`, git init
   등 minimal fixtures 를 구성한다. (기존 case 들과 동일 패턴.)
3. 다음 파일들을 `writeText` 로 scaffold (내용은 의미 없는 placeholder 허용):
   - `app/api/foo/route.ts`
   - `app/api/bar/baz/route.ts`
   - `app/api/ignored/page.ts` **(수집되지 않아야 함 — basename 불일치)**
   - `app/components/other.ts` **(수집되지 않아야 함 — basename 불일치)**
   - `src/app/api/qux/route.ts`
   - `.next/cache/route.ts` **(수집되지 않아야 함 — `.next` skip)**
   - `node_modules/whatever/route.ts` **(수집되지 않아야 함 — `node_modules` skip)**
4. `collectReviewInputs(root)` 호출.
5. assertion:
   - `assert.deepEqual(result.productFetcherPaths, [
        'app/api/bar/baz/route.ts',
        'app/api/foo/route.ts',
        'src/app/api/qux/route.ts',
      ]);`
   - (ascending `localeCompare` sort 라서 `bar/baz` 가 `foo` 보다 앞선다.)
   - 명시적 negative 확인은 위 deepEqual 이 exact match 라서 자동 커버됨.

**필수 주의**:
- `scaffoldRepo` helper 재사용 (수정 금지). 기존 test 가 요구하는 minimal
  fixtures (`.vibe/config.json`, `.vibe/agent/sprint-status.json`,
  `handoff.md`, `session-log.md`, `project-decisions.jsonl`,
  `docs/context/product.md`, `docs/context/harness-gaps.md`, git commit) 는 해당
  helper 가 이미 만든다 → 신규 scaffold 코드 중복 작성 금지.
- git commit 이후 추가 파일을 쓰면 `git log` 계산에 영향 없음 (`collectReviewInputs`
  는 git log 를 참조하지만 `productFetcherPaths` 수집과 독립).
- 신규 helper / 신규 import 추가 금지. 기존 `writeText` + `scaffoldRepo` +
  `makeTempDir` 조합으로 해결.

### §4) `docs/context/harness-gaps.md` — 신규 row append

기존 표 마지막 row (`gap-generator-test-scope-creep`) 다음 줄에 아래 row 한 줄을
append. **기존 row 는 절대 수정 금지**.

표 컬럼 스키마는 `| id | symptom | covered_by | status | script-gate | migration-deadline |`
(6-column, 기존 표 구조).

신규 row 값 (pipe-delimited, 각 필드의 literal):

- **id**: `gap-external-adapter-blind-spot`
- **symptom**: `e2e smoke 가 개별 data-fetcher route 응답을 probe 하지 않아 adapter 가 0 items 반환해도 통과. dogfood10 iter-1 배포 후 사용자 발견.`
- **covered_by**: ``/vibe-review` rubric adapter-health blind-spot + `collectReviewInputs.productFetcherPaths` (sprint-M3-review-adapter-blind-spot)``
- **status**: `closed`
- **script-gate**: `covered`
- **migration-deadline**: `+1 sprint (iter-7)`

완성된 row 1줄은 `|` 구분자 사이에 값이 정확히 채워진 markdown table row 여야 한다.
append 지점은 `gap-generator-test-scope-creep` row 바로 다음 줄.

### §5) `package.json` — harnessVersion bump

- `"harnessVersion": "1.4.3"` 를 `"harnessVersion": "1.5.0"` 로 한 줄 치환.
- (주의: 실제 현재 저장소 tree 의 `package.json` 이 `1.3.1` 을 보이면 Orchestrator
  가 prompt 주입 시 정정할 가능성이 있다. Generator 는 받은 prompt 지시대로
  `1.4.3 → 1.5.0` 을 그대로 수행한다. 최종 값이 `"1.5.0"` 임이 핵심.)
- 다른 필드 (`version`, `private`, `type`, `scripts`, `dependencies`,
  `devDependencies`, `description`, `engines`) 는 **완전히 그대로** 유지.

### §6) `.vibe/agent/handoff.md` — **생성 금지 (Orchestrator 담당)**

- 이 sprint 의 iter-7 closure 한 줄 기록은 Orchestrator 가 M3 완료 후 sprint-commit
  직전에 직접 수행한다.
- **Generator 는 `.vibe/agent/handoff.md` 를 읽거나 쓰지 말 것.** session-log,
  sprint-status.json, iteration-history.json 역시 동일.

---

## 테스트 지침

아래는 Generator 가 산출 후 스스로 돌리는 검증이다. 모두 pass 해야 한다.

```bash
npx tsc --noEmit
node --import tsx --test test/vibe-review-inputs.test.ts
```

- `npx tsc --noEmit` 는 clean pass. 새 필드를 반환 객체에 추가했으므로 `ReviewInputs`
  타입 불일치가 발생하면 즉시 수정.
- `test/vibe-review-inputs.test.ts` 전체 (기존 case + 신규 case) 가 모두 통과.
- **다른 test 파일은 돌리지 말 것** (§15 정신: 범위 밖 test 는 Orchestrator 가 별도로
  수행).

scope hint — Generator 가 이번 turn 에서 touch 하는 파일은 정확히 아래 5개:

```
src/lib/review.ts
.claude/skills/vibe-review/SKILL.md
test/vibe-review-inputs.test.ts
docs/context/harness-gaps.md
package.json
```

이 목록 밖 파일은 읽기는 허용되지만 **쓰기 금지**.

---

## 최종 self-QA 체크리스트 (Orchestrator 검증 대상)

Final report 에 아래 12개 pass/fail 을 명시한다. 각 항목은 기계적으로 검증 가능해야
한다.

1. `src/lib/review.ts` `ReviewInputs` interface 에 `productFetcherPaths: string[]`
   필드 존재.
   - 검증: `grep -n 'productFetcherPaths' src/lib/review.ts` hit ≥ 2
     (interface 선언 + collect 구현 최소 1회 + return 객체 채움 1회).
2. `collectReviewInputs()` 의 return 객체에 `productFetcherPaths` 포함, 기존 필드
   누락 없음.
   - 검증: `npx tsc --noEmit` clean + 기존 test case 1 (`collectReviewInputs
     loads handoff, session log, decisions, pending risks, and limits recent
     entries`) 여전히 pass.
3. `productFetcherPaths` 는 posix `/` 정규화 + ascending sort.
   - 검증: 구현 내 `.replace(/\\/g, '/')` 또는 동등 posix 변환 호출 + `sort` 호출
     존재. 또한 아래 신규 test case 의 deepEqual 이 pass.
4. 탐색 시 `node_modules`, `.next`, `dist`, `.vibe` 서브트리 skip.
   - 검증: 구현 내 skip directory set 또는 조건문 존재. 신규 test case 가
     `.next/cache/route.ts`, `node_modules/whatever/route.ts` 를 제외한다는 것을
     deepEqual 로 확인.
5. `.claude/skills/vibe-review/SKILL.md` 에 정확한 heading `### Adapter-health
   blind-spot (🔴 Blocker)` 존재.
   - 검증: `grep -n 'Adapter-health blind-spot' .claude/skills/vibe-review/SKILL.md`
     hit = 1.
6. rubric 문구에 `probe-based assertion` literal 포함.
   - 검증: `grep -n 'probe-based assertion' .claude/skills/vibe-review/SKILL.md`
     hit ≥ 1.
7. `test/vibe-review-inputs.test.ts` 에 case 이름 literal
   `'collectReviewInputs includes productFetcherPaths for Next.js app/api routes'`
   존재.
   - 검증: `grep -n 'productFetcherPaths for Next.js app/api routes'
     test/vibe-review-inputs.test.ts` hit = 1.
8. `node --import tsx --test test/vibe-review-inputs.test.ts` 전량 pass.
   - 검증: stdout 에 `# fail 0`.
9. `npx tsc --noEmit` clean (0 error).
   - 검증: exit 0 + stdout/stderr error 없음.
10. `docs/context/harness-gaps.md` 에 `gap-external-adapter-blind-spot` row 1회
    존재, `status=closed`.
    - 검증: `grep -c 'gap-external-adapter-blind-spot'
      docs/context/harness-gaps.md` == 1 + 같은 줄에 ` closed ` 포함.
11. `package.json.harnessVersion` 값 정확히 `"1.5.0"`.
    - 검증: `node -e "console.log(require('./package.json').harnessVersion)"`
      출력 === `1.5.0`. `version` 은 여전히 `0.1.0`.
12. 전체 코드 LOC 합계 ≤ 70 (buffered cap).
    - 검증: `git diff --stat HEAD` 기준 `.ts` + `.md` 변경분 insertion 합계가 70
      이하. `package.json` 은 1줄 교체라 net 0 ~ 1.

체크리스트 항목 중 하나라도 fail 이면 Sprint 실패로 간주한다.

---

## 리포트 형식 (Generator → Orchestrator)

Generator 는 턴 종료 응답에서 아래 섹션을 모두 포함한다.

### `## Summary`

- 1~3줄: 어떤 파일을 어떻게 건드렸는지 짧게.

### `## Files changed`

- touched 파일 5개 경로 + 각 파일의 정확한 insert/delete LOC.

### `## Commands run`

- 실제로 돌린 검증 커맨드와 종료 코드 (2개: `npx tsc --noEmit`,
  `node --import tsx --test test/vibe-review-inputs.test.ts`).

### `## Self-QA checklist`

- 위 §최종 self-QA 체크리스트 1~12 각각 pass/fail + 근거 (grep 결과 / LOC 수치).

### `## Wiring Integration` (_common-rules.md §14 준수)

각 항목에 `touched` / `n/a` + 근거:

- **W1** CLAUDE.md hook table — n/a (본 sprint 훅 변화 없음)
- **W2** 관련 스킬 목록 — touched (`.claude/skills/vibe-review/SKILL.md` rubric 추가)
- **W3** skill dispatch — n/a
- **W4** slash-command — n/a
- **W5** provider registry — n/a
- **W6** config schema — n/a
- **W7** permission preset — n/a
- **W8** statusline hook — n/a
- **W9** agent subagent frontmatter — n/a
- **W10** sync-manifest — n/a
- **W11** prompt archive — n/a
- **W12** test 회귀 방지 — touched (`test/vibe-review-inputs.test.ts` case 1건
  append; §15 opt-in 조건 충족).
- **W13** harness-gaps ledger — touched (`gap-external-adapter-blind-spot` row
  append + status=closed).
- **W14** gitignore / artifact — n/a
- **D1~D6** Delete checklist — 모두 n/a (본 sprint delete 0건).

### `## Verified-callers` (for new/modified public API)

아래 형태로 `ReviewInputs.productFetcherPaths` 의 호출자 그래프를 단 한 블록으로
보고한다. 현재 sprint 범위에서는 **호출자 없음** 이 정상이다 (inputs 수집만 추가,
consumer 는 차기 iteration). 다음과 같이 서술:

```
verified-callers:
  ReviewInputs.productFetcherPaths:
    producers:
      - src/lib/review.ts::collectReviewInputs (adds field to return object)
    consumers:
      - (none in this sprint — rubric documented only; consumer impl deferred)
    notes:
      - SKILL.md "Adapter-health blind-spot" rubric describes intended consumer contract.
```

### `## Risks / follow-ups`

- adapter-health finding 의 **실제 auto-seed 구현** (consumer 코드 + e2e smoke
  grep) 은 다음 iteration backlog. 이번 Sprint 는 rubric 계약 문서화 + inputs
  수집까지. Soft freeze 원칙 (new scripts 0건) 준수.
- `harnessVersion` bump 로 `vibe-sprint-commit.mjs` 가 annotated `v1.5.0` tag 생성
  예정 — Orchestrator 가 커밋 단계에서 확인.

---

**Planner 메모 (Orchestrator 수신용)**:
- 본 prompt 는 iter-7 최종 Sprint (M3) fresh-context 산출물이다.
- §15 opt-in 조건을 prompt 내부에 explicit 으로 선언했으므로, Generator 가 test
  파일을 건드려도 규칙 위반이 아니다 — 단 파일 1개 / case 1개 한정.
- §6 handoff.md 편집은 prompt 에서 명시적으로 "생성 금지" — Orchestrator 가 직접
  처리하므로 Generator turn 에는 포함하지 않는다.
- harnessVersion 표기는 prompt 내 사용자 선언 (`1.4.3 → 1.5.0`) 을 존중한다. 만약
  실제 tree 의 현재 값이 다르면 Orchestrator 가 commit 직전에 실사 값을 정정한 뒤
  새로운 prompt turn 을 만들지, 혹은 최종 값 `"1.5.0"` 확보만 검증할지 선택한다
  (핵심 self-QA 는 최종 값 `"1.5.0"`).
