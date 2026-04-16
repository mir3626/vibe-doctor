# vibe-sync batch approval UX 개선

## 현상

`npm run vibe:sync -- --from ../vibe-doctor` 실행 시 conflict 파일이 많으면 **매 파일마다 y/N 프롬프트** 가 반복되어 번거롭다. 사용자가 전체 변경 계획을 먼저 보고, 한 번에 승인하거나 개별 승인 모드를 선택할 수 있어야 한다.

## 기대 UX

### 1. Plan summary 먼저 표시 (기존 renderPlanTable 재활용)

```
Sync plan: vibe-doctor v1.1.1 → v1.2.0

| action        | path                               | detail                    |
|---------------|-------------------------------------|---------------------------|
| replace       | scripts/vibe-preflight.mjs          | harness file updated       |
| replace       | scripts/run-codex.sh                | harness file updated       |
| section-merge | CLAUDE.md                           | HARNESS:core-framing, ...  |
| json-merge    | .claude/settings.json               | hooks                      |
| new-file      | scripts/vibe-interview.mjs          |                            |
| conflict      | scripts/vibe-sprint-complete.mjs    | locally modified           |
| conflict      | .vibe/agent/_common-rules.md        | locally modified           |
| skip          | docs/context/product.md             | project-owned              |

Files: 12 replace, 2 section-merge, 1 json-merge, 3 new-file, 2 conflict, 5 skip
Migrations: 1.1.0, 1.2.0
```

### 2. Conflict 가 있으면 선택지 표시

```
2 conflict(s) detected (locally modified harness files).

Choose:
  [a] Accept all — 모든 conflict 을 upstream 으로 교체 (현재 로컬 수정 유실)
  [i] Individual — 각 conflict 를 하나씩 확인하며 y/N 선택
  [s] Skip all — 모든 conflict 를 건너뛰고 나머지만 적용
  [c] Cancel — 아무것도 적용하지 않고 종료

> 
```

### 3. Conflict 가 없으면 바로 확인

```
No conflicts. 18 actions will be applied.

Proceed? [Y/n] 
```

(빈 입력 / y / yes → 진행, n / no → cancel)

### 4. --force 플래그 동작 유지

`--force` 시 모든 conflict 을 자동 replace, 프롬프트 표시 안 함 (기존 그대로).

## 수정 대상

**`src/commands/sync.ts` 1개 파일만 수정.**

### 구체적 변경

1. `renderPlanTable()` 뒤에 **summary 라인** 추가: action type 별 카운트.
2. `resolveConflicts()` 함수를 **`approveAndResolve()` 로 rename + UX 재설계**:
   - conflict 가 없으면 간단히 `Proceed? [Y/n]` 1회 물어봄 (기존엔 스킵했음 — 이제는 전체 plan 확인 맥락에서 1회 승인).
   - conflict 가 있으면 [a/i/s/c] 4가지 선택지.
   - `[a]`: 기존 `--force` 와 동일 로직.
   - `[i]`: 기존 `resolveConflicts` 의 per-file y/N 루프.
   - `[s]`: 모든 conflict 을 skip.
   - `[c]`: throw Error("Cancelled by user") 또는 process.exit(0).
3. `main()` 에서 호출 순서:
   - `renderPlanTable` → stdout 출력.
   - summary line 출력.
   - `approveAndResolve(plan.actions, force)` 호출 (dry-run 이면 여기서 return).
4. 기존 `--force` flag 의 동작 불변. `--json` mode 에서 approval 프롬프트 표시 안 함 (기존대로 machine output).

### 코드 스타일
- 기존 파일 200줄 이내. 추가 코드 ~40-60 LOC.
- readline 은 이미 import 됨. 추가 import 없음.
- 출력은 process.stdout.write (기존 패턴).

## 기존 테스트 영향

`test/sync.test.ts` 는 `buildSyncPlan` 만 테스트. `resolveConflicts` / `main` 흐름은 테스트되지 않음. 따라서 이 변경은 **기존 테스트 결과에 영향 0**.

## 완료 기준

| 조건 | 검증 |
|---|---|
| `npx tsc --noEmit` 0 errors | tsc |
| `npm test` 기존 pass 수 유지 | npm test |
| `--force` 동작 불변 | 코드 리뷰 |
| `--dry-run` 에서 plan table + summary 출력 후 종료 | 수동 smoke |
| `--json` 에서 approval 프롬프트 없음 | 코드 리뷰 |
| conflict 0건 → `Proceed? [Y/n]` 1회 | 수동 smoke |
| conflict N건 → `[a/i/s/c]` 선택지 | 수동 smoke |

## Final report
§_common-rules §9. Verification 표에 위 조건 결과.
