# Upstream handoff — dogfood10 iter-1 post-review (2026-04-21)

> 이 문서는 **vibe-doctor 업스트림 저장소** 의 메인 Orchestrator 세션에 붙여 넣어
> 다음 iteration 을 착수할 때 사용하는 **fresh-context 인계 프롬프트**다. 받는 세션은
> 이 repo (dogfood10) 를 보지 못한다는 전제 하에 필요한 컨텍스트를 모두 포함한다.
>
> **붙여 넣는 곳**: `vibe-doctor` 업스트림 저장소에서 `/vibe-iterate` 또는 새 Sprint
> kickoff turn. 본 프롬프트 자체는 user prompt 로 한 번만 사용하면 된다.

---

## 컨텍스트 요약

`dogfood10` 은 2026-04-20 ~ 04-21 기간에 vibe-doctor harness (v1.4.3) 로 **첫 iter-1
MVP** 를 완주한 다운스트림 프로젝트다. 산출물은 **Next.js 15 + React 19 RSC 기반 개인
AI 대시보드**로, 4 Sprint (M1 shell / M2 mock widgets / M3 trending real data / M4
polish+deploy) 로 완료 후 `/vibe-review` 를 돌렸다. 4-sprint 리뷰가
`docs/reports/review-4-2026-04-21.md` 로 남았고 **1 blocker / 1 structural / 2 friction /
2 polish** finding 을 생성했다. 이 중 **harness 업스트림에서만 해결 가능한 4건** 을 본
인계에서 다룬다.

중요: dogfood10 product code (app/, components/, lib/) 는 **손대지 말 것**. 본 인계는
오직 vibe-doctor **템플릿** (`scripts/`, `src/`, `.claude/`, `.vibe/` harness 영역, `CLAUDE.md`,
`docs/context/*.md` template defaults, `AGENTS.md`, `sync-manifest.json`) 만 다룬다.

iter-3 closure 이후 freeze posture 가 적용된다: **iteration 당 net ≤ +150 LOC, 0 new
scripts**. 아래 4개 finding 을 그 예산 안에서 prioritize 하라.

---

## Finding A — `/vibe-review` 에 adapter-health smoke blind-spot rubric 추가

### 증상

dogfood10 M4 sprint-commit 은 exit 0 으로 통과했지만, 실제 배포 후 사용자가 "트렌딩에
레딧만 보이고 GeekNews / DCInside 는 0 items" 를 발견 → Orchestrator hotfix 투입
(`2c0925f fix(sources): GeekNews Atom + DCInside gall_tit 파서 교체`). Playwright
smoke 는 `/interest` (mock 위젯) 의 `a[target=_blank]` rel 속성만 검증했기에 실 adapter
가 0 items 반환해도 통과했다.

### 업스트림 요청

`.claude/skills/vibe-review/SKILL.md` 의 Automatic Checks 섹션에 아래 rubric 항목을
추가:

> **Adapter-health blind-spot**: 프로젝트에 `app/api/*/route.ts` 또는 동등한 데이터
> fetcher 가 존재 + `e2e/` 에 Playwright smoke 가 있는데, 그 smoke 가 해당 route 의
> 응답을 개별적으로 assertion 하지 않는 경우 🔴 Blocker 1건을 auto-seed.
> - helper 수집 입력에 `productFetcherPaths: string[]` (ripgrep 으로 `app/api/**/route.ts` 목록)
>   필드 추가.
> - rubric 문구: "adapter 가 소리 없이 0 items 반환해도 smoke 가 통과하는 상태는 production
>   broken feature 를 의미함 — probe-based assertion 또는 contract test 필요."

구현 경로: `src/lib/review.ts` 의 `collectReviewInputs()` 에 `productFetcherPaths` 추가
+ SKILL.md rubric 섹션에 item 1건. test: `test/vibe-review-inputs.test.ts` 확장 1 case
(smoke 파일이 route 파일명을 문자열로 포함하는지 grep).

### 예상 LOC

20 (SKILL.md 문구) + 25 (`review.ts` 확장) + 15 (test case) = **~60 LOC**.

### `harness-gaps.md` ledger 업데이트

`gap-review-catch-wiring-drift` (현재 `open`) 를 closed 로 전이시키는 **부분 구현**
이다. `gap-external-adapter-blind-spot` 같은 새 id 로 신규 append 해도 되고, 기존 gap
의 covered_by 를 업데이트해도 된다 — 업스트림 판단에 맡김.

---

## Finding B — Codex 403 single-point-of-failure fallback

### 증상

dogfood10 iter-1 hotfix 시 Codex CLI 가 `https://chatgpt.com/backend-api/codex/responses`
에 대해 **403 Forbidden 을 3회 연속** 반환 (2026-04-21 UTC 15:27 ~ 15:31). 사용자
토큰은 98% 여유 상태였기에 원인 불명 (rate-limit / CF edge block / 계정 fingerprint
등 가능성). Generator pipeline 이 halt 하여 Orchestrator 가 **charter 상수 역할 제약을
1회 깨고 직접 `.ts` 편집** → session-log `[decision][orchestrator-hotfix]` 기록.

### 업스트림 요청

`scripts/run-codex.sh` 에 retry 실패 시 아래 **두 가지 중 택1** 구현:

1. **(권장, +0 new scripts)** 3회 retry 실패 후 stderr 에 명시적 hint 출력:
   ```
   [run-codex] CODEX_UNAVAILABLE — 3 retries exhausted (last exit=1, 403 Forbidden).
                 Orchestrator 는 아래 중 하나 선택:
                 (1) 시간차 재시도 (quota 아닌 edge block 일 수 있음)
                 (2) 사용자 승인 하에 Orchestrator 직접 편집
                     → session-log 에 [decision][orchestrator-hotfix] 기록 필수
                 (3) `.vibe/config.json.providers` 에 fallback provider 추가 후 재시도
   ```
   추가로 `.vibe/agent/codex-unavailable.flag` (ephemeral, gitignored) 를 touch 하여
   Orchestrator 가 기계적으로 감지 가능하도록 machine-readable hint 제공.

2. **(비권장)** `.vibe/config.json.providers.fallback` 필드 추가 + auto-fallback 체인
   구현. 복잡도 높고 charter 가 "Generator = Codex 상수" 를 선언했기에 디자인 충돌.

### 예상 LOC

옵션 1: **~25 LOC** (`run-codex.sh` 조건부 blob + `.gitignore` 1줄 추가). Tests: 기존
`test/run-codex-wrapper.test.ts` 에 "3회 exit!=0 후 flag 파일 생성 + stderr hint" 1
case 추가 (~15 LOC).

### 문서

`CLAUDE.md` Extensions 의 `## 훅 강제 메커니즘` 표에 `codex-unavailable.flag` 소비
프로토콜 1줄 추가 + `docs/context/codex-execution.md` 에 403 troubleshooting 섹션 append.

---

## Finding C — app-LOC threshold breach detection

### 증상

Charter 의 Evaluator 프로토타입 면제 조건: "**LOC < 2000** + self-QA 통과". 실제 audit
trigger 는 `sprintsSinceLastAudit >= everyN (5)` 만 감시. dogfood10 M3~M4 구간에서 app
TS/TSX LOC 가 **2216** 으로 threshold 를 넘겼는데 Evaluator 는 한 번도 소환되지 않았다.
`sprintsSinceLastAudit = 4 < 5` 이었기 때문. rule 과 enforcement 의 drift.

### 업스트림 요청

`scripts/vibe-audit-lightweight.mjs` (기존 스크립트, +0 new scripts 원칙 준수) 에 아래
추가:

- 현재 iteration 의 **app-code LOC heuristic** 집계. heuristic: `find <projectRoots>
  -name "*.ts" -o -name "*.tsx" -o -name "*.py" -o -name "*.rs" -o -name "*.go"
  | grep -v node_modules | xargs wc -l` 합계. `projectRoots` 는 `.vibe/config.json` 의
  새 선택 필드 `audit.projectRoots: ["app", "components", "lib"]` 또는 default `["src"]`.
- 합계 > `audit.prototypeLocThreshold` (default 2000) 면 sprint-status.json 의
  `pendingRisks` 에 `{level: "INFO", code: "LOC_THRESHOLD_BREACH", message: "app
  LOC <N> > <threshold> — Evaluator prototype 면제 조건 초과"}` 주입.
- Orchestrator 는 pendingRisk INFO 를 읽어 Evaluator Must 소환 결정.

### 예상 LOC

config field 1 (optional, backward-compat) + audit 로직 ~30 LOC + tests 2 case ~25 LOC =
**~55 LOC**.

### Charter / 문서

`CLAUDE.md` Extensions `## Sub-agent 소환 트리거 매트릭스 상세` 의 Evaluator 예외 문단
에 "LOC_THRESHOLD_BREACH pendingRisk 가 존재하면 예외 무효, Evaluator Must 소환" 1줄
추가.

---

## Finding D — Generator scope-discipline: unit test 자발 생성 차단

### 증상

dogfood10 Codex 가 Planner prompt 에 없는 `test/*.test.ts` 파일을 **3회 자발 생성** (M2
`test/seed.test.ts`, M3 `test/cache.test.ts` + `test/sources-index.test.ts`). 매번
Orchestrator 가 `rm` 으로 cleanup. `conventions.md` 는 "MVP 에 unit test 없음" 을 명시
했지만 Generator 가 이를 무시하는 패턴이 반복됨.

### 업스트림 요청

`.vibe/agent/_common-rules.md` (Generator prompt 에 `run-codex.sh` 가 자동 prepend 하는
파일) 에 새 섹션 추가:

```md
## §15 Scope discipline (unit test 생성 금지 default)

Planner prompt 가 명시적으로 unit test 파일 생성을 요구하지 **않는 한**, Generator 는
`test/**/*.test.ts`, `src/**/*.test.ts`, `__tests__/` 디렉터리 등 unit test 파일을
스스로 만들지 않는다. Test 가 필요하다고 판단되면 Final report `## Wiring Integration`
섹션의 W12 에 "propose: test file X — blocked by §15" 로 기록만 남기고 stop.

이 규칙은 프로토타입/MVP 가 명시적으로 smoke + type check 만으로 충분하다고 선언한
conventions.md 의 테스트 섹션을 Generator 레벨로 hoist 한 것이다. 해제는 Planner 가
"Tests to add: [...]" 섹션을 Sprint prompt 에 명시했을 때만.
```

### 예상 LOC

_common-rules.md 1 섹션 **~12 LOC** + test (e.g. `run-codex.sh` 의 `--rules-include`
검증) 1 case ~10 LOC = **~22 LOC**.

### 부가 효과

향후 downstream 이 "unit test 포함" 을 원하면 Planner prompt 에 명시하면 되므로
opt-in semantic. 명시가 없는 default 에서는 Generator 가 우회하지 않는다.

---

## 받는 세션이 먼저 할 것

1. 본 프롬프트를 `docs/plans/iter-<N>-upstream-handoff.md` 같은 경로에 저장 후
   `git log --oneline -10` 으로 현재 upstream branch 상태 확인.
2. `.vibe/config.json.harnessVersion` 현재 값 확인 → next bump 후보 (예: v1.4.3 → v1.5.0
   if 4건 전부 포함, 또는 v1.4.4 if subset).
3. **freeze posture 준수** 확인: net +150 LOC 예산 안에서 4건 우선순위.
   - 현재 예상 합계: A (60) + B (40) + C (55) + D (22) = **177 LOC** → 예산 초과.
   - 권장: **B + D** (62 LOC) 를 iter-<N> 에, **A + C** (115 LOC) 를 iter-<N+1> 로
     split. 이유: B+D 는 incident 실증 2건 직접 해소 (hotfix 원인 + 반복 scope creep),
     A+C 는 preventive / drift detection 이라 다음 iter 로 이연 가능.
4. Sprint 로드맵 작성 시 각 finding id (`review-smoke-adapter-blind-spot` 등) 를 Sprint
   scope 에 명시적으로 reference.
5. 각 Sprint 완료 후 `sync-manifest.json` 에 변경된 harness 경로 반영 확인.
6. iteration 종료 시 `docs/handoff.md` 에 "iter-<N> closure: addresses dogfood10
   review-4 findings B+D" 한 줄 기록.

---

## 제약 (Must)

- **dogfood10 product code 수정 금지** — 본 인계는 upstream template 만 다룸.
- Charter / freeze posture 가 정하는 **net ≤ +150 LOC / iter**, **0 new scripts**
  절대 준수. 새 스크립트 필요 시 기존 스크립트 확장으로 해결.
- `scripts/vibe-interview.mjs`, `scripts/vibe-sprint-complete.mjs`,
  `scripts/vibe-sprint-commit.mjs`, `scripts/run-codex.{sh,cmd}` 의 **core invariant**
  (UTF-8, retry, state machine) 는 보존. 기능 추가는 옵션/flag 로 접근.
- 변경 파일은 `.vibe/agent/_common-rules.md §14` 의 W1~W14 / D1~D6 checklist 를 Sprint
  Final report `## Wiring Integration` 섹션에 보고.
- commit 은 `scripts/vibe-sprint-commit.mjs <sprintId> passed` 래퍼로만. `harnessVersion`
  bump 시 auto-tag 활성화.

---

## 증거 링크 (dogfood10 내부 — 참고용, 수정 금지)

- Review 원본: `docs/reports/review-4-2026-04-21.md`
- Hotfix 원인 커밋: `2c0925f fix(sources): GeekNews Atom + DCInside gall_tit 파서 교체`
- Sprint commits: `5baa525 (M1)` · `10395b3 (M2)` · `5ba28bf (M3)` · `0a312a7 (M4)`
- Session-log `[decision][orchestrator-hotfix]` entry: `.vibe/agent/session-log.md` 최상단
- 현재 harness-gaps ledger: `docs/context/harness-gaps.md` (`gap-review-catch-wiring-drift`
  open 상태)
- Generator unit-test 자발 생성 사례 근거: git log 로 `M2/M3 Sprint` commit 직후 Orchestrator 가
  `rm test/seed.test.ts` / `rm test/cache.test.ts` / `rm test/sources-index.test.ts`
  를 실행한 흔적 (문서화 안 된 cleanup — 본 인계에서 명시화됨).

---

## 기대 결과

- `vibe-doctor` 업스트림에서 1~2 iteration 후 v1.5.0 (또는 v1.4.4) release.
- dogfood10 등 downstream 은 `/vibe-sync` 로 새 version 을 pull 해 Finding B+D+(가능 시
  A+C) 이득을 받는다.
- `harness-gaps.md` 의 `gap-review-catch-wiring-drift` 가 closed 상태로 이행.
- 다음 dogfood 프로젝트에서 동일 3종 friction 재발 방지.

---

## 업스트림 리뷰 결정 (2026-04-21)

본 핸드오프는 upstream Orchestrator 리뷰 후 아래와 같이 확정됐다:

**iter-7 scope**: A + B + D (predicted 122 LOC, 148 LOC buffered). target **v1.5.0**.
**iter-8 scope (후속)**: C (predicted 55 LOC). target **v1.5.1**.

### iter-7 sprint 분할

| Sprint | Finding | 주 산출물 | 예상 LOC | 예상 LOC (15% buffer) |
|--------|---------|-----------|----------|----------------------|
| M1 | B — Codex 403 fallback | `scripts/run-codex.sh` stderr hint + `.vibe/agent/codex-unavailable.flag` + `.gitignore` + `test/run-codex-wrapper.test.ts` 1 case + `CLAUDE.md` 훅 표 1줄 + `docs/context/codex-execution.md` 403 섹션 | 40 | 50 |
| M2 | D — Generator scope discipline | `.vibe/agent/_common-rules.md` §15 신규 섹션 + `test/run-codex-wrapper.test.ts` `--rules-include` 검증 1 case | 22 | 28 |
| M3 | A — adapter-health smoke rubric | `src/lib/review.ts` `productFetcherPaths` 필드 + `.claude/skills/vibe-review/SKILL.md` Automatic Checks 섹션 rubric 1 항목 + `test/vibe-review-inputs.test.ts` 1 case + `docs/context/harness-gaps.md` 새 id `gap-external-adapter-blind-spot` append | 60 | 70 |
| **합계** | | | **122** | **148** |

### 설계 보강 (리뷰 합의)

- **A**: `harness-gaps.md` 에 **신규 id** `gap-external-adapter-blind-spot` 로 append (기존 `gap-review-catch-wiring-drift` 는 wiring-registration gap 으로 별개 — covered_by 병합 금지).
- **B**: `.vibe/agent/codex-unavailable.flag` **TTL/clearance 규칙 명시** — 다음 성공 `run-codex.sh` exit 0 시 auto-remove. flag 내부에 timestamp 1줄 기록 → Orchestrator freshness 판단 가능.
- **C (iter-8 예정)**: `find + wc -l` 대신 `git ls-files <root> | xargs wc -l` 로 tracked source 만 카운트 (symlink / generated / node_modules 회피 자동).
- **D**: 1차는 문서-only. 재발 시 iter-8 이후 `run-codex.sh` post-process diff grep enforcement 로 승격 옵션 유지.

### M1 → M2 → M3 실행 순서 근거

- M1 (B) 먼저: 가장 critical, charter breach incident 해소. pipeline 안정성 복원.
- M2 (D) 다음: 가장 cheap, 누적 scope creep 차단. Sprint 기간 짧음.
- M3 (A) 마지막: 가장 LOC 큰 일. M1/M2 실적 확보 후 budget 여유 확인하고 진입. 초과 조짐 시 A 는 iter-8 로 이월.
