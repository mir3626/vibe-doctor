# Task — sprint-commit scope filter: exclude `.vibe/agent/daily/*.jsonl`

## Bug

`test/sprint-commit.test.ts` 의 `"extends lastSprintScope across sequential
sprint commits without rewriting prior entries"` 테스트가 다음과 같이 실패한다:

```
  + actual - expected
    [
      'src/a.ts',
  +   '.vibe/agent/daily/2026-04-20.jsonl',
      'src/b.ts'
    ]
```

원인: 최근 `scripts/vibe-sprint-complete.mjs` 에 추가한 daily-log emit 이 sprint 완료
시점에 `.vibe/agent/daily/<date>.jsonl` 파일을 생성 (또는 append) 하고, 이어지는
`scripts/vibe-sprint-commit.mjs` 의 `detectedScope` 필터가 이 경로를 제외하지 않아
`lastSprintScope` 에 섞여 들어간다.

## Fix

`scripts/vibe-sprint-commit.mjs` 의 다음 필터(현재 ~L443):

```js
const detectedScope = changedFiles.filter(
  (relativePath) => !STATE_FILES.has(relativePath) && !relativePath.startsWith('.vibe/archive/'),
);
```

에 daily-log prefix 제외 조건을 추가:

```js
const detectedScope = changedFiles.filter(
  (relativePath) =>
    !STATE_FILES.has(relativePath) &&
    !relativePath.startsWith('.vibe/archive/') &&
    !relativePath.startsWith('.vibe/agent/daily/'),
);
```

- `.vibe/agent/daily/` 는 **scope 추적 대상 아님** (사용자 코드가 아니라 agent 생성
  state jsonl). 단 `stagedTargets` 에는 기존처럼 `...changedFiles` 로 포함되어
  **commit 에는 포함**된다. 동작 의도는 commit 하되 scope 에는 들어가지 않게.
- `STATE_FILES` 를 늘리지 말고 `startsWith` 방식으로 둔다 — 파일명이 날짜별로
  동적으로 변하므로 set enumeration 이 부적절.

## `src/lib/sprint-status.ts` 도 확인

`extendLastSprintScope` 자체가 input scope 를 재필터링하는 로직을 갖고 있는지
확인한다. `test/sprint-commit.test.ts` 의 `"keeps inline scope merge logic in
lockstep with the library helper"` 테스트가 통과하려면 **inline(vibe-sprint-commit.mjs
내부)** 와 **library(src/lib/sprint-status.ts extendLastSprintScope)** 양쪽이
동일하게 동작해야 한다.

- 만약 `extendLastSprintScope` 도 자체적으로 scope 를 걸러낸다면 거기에도 동일하게
  `.vibe/agent/daily/` prefix 제외를 추가한다.
- 만약 `extendLastSprintScope` 가 단순히 "주어진 scope 배열 + previousScope 를
  dedupe merge" 만 한다면 추가 변경 없이 sprint-commit 쪽만 수정해도 lockstep 유지됨.
  그 경우 lockstep 테스트가 깨지지 않는지 확인.

확인 방법:
1. `src/lib/sprint-status.ts` 의 `extendLastSprintScope` 함수 읽기
2. 필터가 있으면 동일 패턴 추가, 없으면 그대로 둠
3. `npm test -- test/sprint-commit.test.ts` (프로젝트 기본 runner: `node --import
   tsx --test`) 전체 14 개 통과 확인

## Verification

- `node --import tsx --test test/sprint-commit.test.ts test/sprint-commit-lockfile-blacklist.test.ts`
  → 전 테스트 pass
- 새로 패치된 filter 가 기존 lockstep 테스트 깨뜨리지 않을 것

## Scope

- 파일: `scripts/vibe-sprint-commit.mjs` (+ 필요 시 `src/lib/sprint-status.ts`)
- 기타 테스트 / 문서 수정 불필요

## Report

완료 후 stderr 로:
- 수정한 파일 / 라인
- `extendLastSprintScope` 내부에 필터 추가가 필요했는지 여부
- 테스트 실행 결과 (가능하면)
