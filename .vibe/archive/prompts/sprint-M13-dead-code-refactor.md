# Sprint M13 — dead code / wiring gap 전면 리팩토링 (v1.3.1)

## 배경

v1.3.0 배포 후 전면 감사에서 다수의 dead code + wiring gap 발견. 핵심:
1. `archiveSprintPrompts` 버그로 M1~M12 아카이빙 전량 실패 → `docs/prompts/` 에 20개 stale 파일 누적.
2. `scripts/run-claude.{sh,cmd}` 는 실 호출 없는 stub.
3. 기타 naming drift.

## 범위 (엄격)

### 1. `scripts/vibe-sprint-complete.mjs` 의 `archiveSprintPrompts` 버그 수정

현재 (line ~329):
```js
const matches = readdirSync(promptDir).filter(
  (entry) => entry.startsWith(`${sprintId}-`) && entry.endsWith('.md'),
);
```

문제: `sprintId === 'sprint-M5-native-interview'` 이면 `sprint-M5-native-interview-` 로 시작하는 파일만 매치. 실제 `sprint-M5-native-interview.md` 는 매치 안 됨.

**수정 대안 1 (권장)** — 정확한 파일 하나 OR `<sprintId>-<suffix>.md` 둘 다 커버:
```js
const matches = readdirSync(promptDir).filter((entry) => {
  if (!entry.endsWith('.md')) return false;
  const base = entry.slice(0, -3); // strip .md
  return base === sprintId || base.startsWith(`${sprintId}-`);
});
```

이렇게 하면:
- `sprint-M5-native-interview.md` ✓ (base === sprintId 매치)
- `sprint-M5-native-interview-fix.md` ✓ (base.startsWith(sprintId+'-') 매치)
- `sprint-M5.md` (다른 sprint 의 partial 이름) → base !== sprintId 이고 startsWith 실패 → 제외

**기존 테스트 검증**: `test/sprint-status.test.ts` 또는 신규 test 추가하여 위 3가지 케이스 모두 커버.

### 2. Retroactive 아카이빙 — 스크립트 실행으로는 불가

`docs/prompts/` 에 쌓인 20개 M1~M12 sprint prompt 파일을 `.vibe/archive/prompts/` 로 **이동** (git mv). 하지만 이건 본 Sprint 의 Generator 산출이 아니라 **Orchestrator 가 별도 수행**. 본 Sprint 프롬프트는 함수 수정 + test 만 다룬다.

### 3. `scripts/run-claude.{sh,cmd}` 제거

- `scripts/run-claude.sh` 삭제
- `scripts/run-claude.cmd` 삭제
- `.vibe/sync-manifest.json` 의 `files.harness[]` 에서 두 경로 제거

근거: 현재 실 호출처 0. 주석에도 "not wired". 미래 provider 편입 시 Sprint 에서 재생성하면 됨 (YAGNI).

### 4. `test/run-codex-wrapper.test.ts` 의 run-claude 테스트 케이스 정리

run-claude 를 삭제하므로 만약 해당 테스트에 run-claude 를 참조하는 케이스가 있으면 함께 제거. (현재 test 는 run-codex 중심이므로 영향 없을 가능성 높지만 확인 필요.)

### 5. 기타 dead reference 스캔

`grep -rln "run-claude" .` 으로 나오는 모든 참조 파일 검토:
- `README.md` — run-claude 언급 있으면 삭제 또는 "미래 provider 용 placeholder" 설명이었는지 확인 후 섹션 제거
- `.vibe/sync-manifest.json` — harness 배열에서 제거 (§3 과 중복)
- `docs/plans/sprint-roadmap.md` — M2 slot 의 "run-claude stub" 언급은 historical 이므로 유지 가능
- `docs/prompts/sprint-M*.md` — archived 대상이라 유지 가능

**유지 vs 삭제 판단**: 현재 런타임에 영향 주는 곳만 제거. docs 히스토리는 유지.

### 6. `run-codex-wrapper.test.ts` 의 skipped 테스트 (M2 legacy)

현재 1개 test skip 상태 ("returns normalized version output for healthy codex" — cmd wrapper). 본 Sprint 에서는 **건드리지 않음** (별개 미해결 항목, M10 에서 TODO 처리 중).

## 범위 밖

- CLAUDE.md 업데이트 (Orchestrator 가 직접)
- Orphan prompts 이동 (Orchestrator 가 직접 `git mv`)
- harness-gaps.md 갱신 (Orchestrator)
- docs/prompts 의 sync-*.md 등 trash 정리 (Orchestrator)
- naming drift (`vibe:config-audit` vs `audit-config.ts`) 는 별도 polish sprint

## 완료 기준

| 조건 | 검증 |
|---|---|
| tsc 0 errors | `npx tsc --noEmit` |
| npm test pass 유지 | `npm test` |
| archiveSprintPrompts 새 unit test 통과 | 위 3케이스 검증 |
| run-claude 파일 실제 삭제 | `test ! -f scripts/run-claude.sh && test ! -f scripts/run-claude.cmd` |
| sync-manifest 에서 run-claude 엔트리 0개 | `grep run-claude .vibe/sync-manifest.json` no match |

## Final report
§_common-rules §9. Verification 표에 위 조건 결과.
