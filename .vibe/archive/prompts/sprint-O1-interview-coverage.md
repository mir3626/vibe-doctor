# Sprint O1 — Interview Coverage Accounting Fix

- **Sprint ID**: `sprint-O1-interview-coverage`
- **Slot**: iter-4 slot-1 (harness-stability-tune, dominant)
- **Goal (한 줄)**: review-6 #2 blocker 해결 — interview engine sub-field coverage 회계 버그 고치고 `--status` 에 pending sub-fields 노출. soft-terminate 임계 재점검.
- **AC 요약**: (1) sub-field coverage 는 `max(old, new)` 반영 + `deferred=true` 는 즉시 reset. (2) `--status` 에 `pendingDimension.pendingSubFields`, `ambiguity`, `coverage` 포함. (3) `Σ(confidence·(1−deferred))/subFieldsCount` 수식 assertion. (4) 모든 required dimension ratio ≥ 0.8 (configurable) + ambiguity ≤ threshold 면 soft-terminate.
- **예상 LOC**: add ~80 / delete ~0 (iter-4 growth budget 내).
- **신규 파일**: `test/interview-coverage.test.ts` 1개. `scripts/` 아래 **신규 파일 0**.

---

## 공용 규칙

`.vibe/agent/_common-rules.md` 를 **항상** 준수한다. 특히:

- §1 샌드박스 우회 금지 — `next.config.ts` 등 영구 설정 파일에 workaround 추가 금지.
- §2 의존성 설치 금지 — `npm install` / 기타 패키지 매니저 네트워크 명령 실행 금지. 신규 deps 없음.
- §4 TypeScript strict — `any` 금지. 경계는 `unknown` + 타입 가드.
- §5 범위 준수 — 아래 "편집 범위" 밖 리팩터 금지.
- §6 최종 검증 출력 — 아래 "Verification" 표 전부 exit 기록.
- §8 최소 테스트 — 순수 함수 변경 시 회귀 테스트 포함. 본 Sprint 는 이미 강제.
- §9 Final report 형식 — 아래 요구 섹션 전부 포함.
- §13 Sandbox-bound Generator invariants — sandbox 안에서는 `tsc --noEmit` + 단일 test 파일 `node --test` 만 실행. `npm test` 전체 / `npm run build` 는 Orchestrator 담당.
- §14 Wiring Integration Checklist — 본 프롬프트 말미 "Wiring Integration" 섹션으로 Final report 에 포함.

> **Sandbox verify skip header 안내**: `run-codex.sh` 가 EPERM 회피용 wrapper header 를 자동 prepend 한다. Generator 는 `node scripts/vibe-gen-schemas.mjs --check` / `npm test --silent` 등 **Orchestrator 담당 명령을 실행하려 하지 말고** Final report "Sandbox-only failures" 섹션에 기록만 한다.

---

## 배경

1. iter-4 kickoff 실사용 (2026-04-18) 에서 본 Orchestrator 가 직접 `/vibe-interview` flow 를 돌렸을 때 14 rounds 지나도록 `success_metric` ↔ `goal` 사이에서 dimension rotation 만 반복되고 coverage ratio 가 movement 없음. ambiguity 0.218 로 soft-terminate 임계(0.3) 이하인데도 빠져나오지 못하고 `--abort` 로 탈출 (session-log `2026-04-18T13:45` entry).
2. 원인 추정 — `scripts/vibe-interview.mjs` 의 `applyAttributionToDimension()` 이 같은 sub-field 에 새 attribution 이 들어올 때 **조건 없이 overwrite** 한다. Generator 가 연속 rounds 에서 새 answer 를 주며 confidence 0.25 로 낮게 재답변하면 기존 0.95 기여가 **downgrade** 되어 coverage 가 제자리거나 후퇴한다. 또한 `shouldTerminate()` 의 soft-terminate 조건이 `allRequiredCovered(ratio ≥ 0.5) && ambiguity ≤ 0.3` 으로만 판정되어, ambiguity 가 이미 0.218 인데 특정 required dimension ratio 가 0.5 미만이면 계속 loop. 임계를 재점검한다.
3. review-6 finding `review-interview-success-metric-stuck` — priority P0 agent-mode blocker. 본 Sprint 가 해결한다.

---

## 편집 범위 — 파일 지도

| 경로 | 역할 | 편집 종류 |
|---|---|---|
| `scripts/vibe-interview.mjs` | coverage 계산 + `--status` + `shouldTerminate` + record flow | **수정** (단일 파일, 신규 script 금지) |
| `test/interview-coverage.test.ts` | 본 Sprint 신규 회귀 테스트 | **신규** |
| `.claude/skills/vibe-interview/dimensions.json` | dimension schema | **읽기 only** — 수정 금지 |
| `src/lib/interview.ts` | TypeScript lockstep helper | `shouldTerminate` threshold 변경 시 lockstep 유지 (수정 허용, 아래 "Lockstep" 섹션 참조) |

### Do NOT modify

- `.claude/skills/vibe-interview/dimensions.json` (sub-field 목록 변경 시 answer-parser / synthesizer 프롬프트 재학습 필요 — 범위 밖).
- `.claude/skills/vibe-interview/prompts/*.md` — Planner 가 다룰 공용 synthesizer/answer-parser 템플릿. 본 Sprint 범위 밖.
- `src/lib/schemas/**` — 신규 state file 도입 없음. `interview-log.ts` schema 는 **추가하지 않는다** (0 new files 유지). `--status` 출력은 schema-tracked state 가 아니므로 drift check 불필요.

---

## AC 상세 — 기계 검증 가능 항목만

### AC-1. Coverage sub-field accounting fix

`scripts/vibe-interview.mjs` 의 `applyAttributionToDimension()` 과 (해당 시) `applyCrossDimensionSignals()` 를 다음 semantics 로 교체:

1. **High-watermark rule**: 같은 `dimensionId` × 같은 `subFieldId` 에 새 attribution 이 들어오면,
   - 새 `confidence >= 기존 confidence` → `{value, confidence, deferred}` 세 필드 전부 replace.
   - 새 `confidence < 기존 confidence` **그리고** 새 `deferred === false` → **기존 유지** (값/confidence/deferred 변경 없음).
2. **Deferred reset**: 새 attribution 이 `deferred === true` 이면 `confidence` 값과 무관하게 **즉시** `{value: "", confidence: 0, deferred: true}` 로 reset (high-watermark 규칙 우회). 이후 다시 non-deferred answer 가 들어오면 1.의 rule 적용.
3. **Empty-slot bootstrap**: 해당 sub-field 가 아직 기록된 적 없으면(`state.coverage[dim].subFields[sub]` 미정의) 무조건 incoming 으로 초기화.
4. **Foreign key isolation**: incoming `attribution` 에 `pending.dimensionId` 의 `subFields` 에 포함되지 않은 key 가 있으면 **조용히 무시**. 다른 dimension 의 coverage 는 절대 변하지 않는다. (예: current dimension 이 `goal` 인데 attribution 에 `legal_regulatory` 키가 섞여 있어도 `goal` 만 반영, `constraints` 는 그대로.)
5. `free_form` (subFields 비어있는 dimension) 도 동일 규칙 적용.

### AC-2. `--status` 확장

현 `statusCommand()` 반환 JSON 에 다음을 추가하되 **기존 필드·필드 순서는 보존** (consumer breakage 방지):

```json
{
  "sessionId": "...",
  "outputPath": "...",
  "lang": "ko",
  "inferredDomain": "...",
  "rounds": 3,
  "pendingDimensionId": "success_metric",
  "pendingDimension": {
    "id": "success_metric",
    "label": "성공 기준 / 측정 지표",
    "subFields": ["acceptance_criteria", "kpi"],
    "pendingSubFields": ["kpi"]
  },
  "ambiguity": 0.214,
  "coverage": { "goal": 0.97, "target_user": 0.80, "...": 0 }
}
```

- `pendingDimension` 은 `state.pending` 이 null 이면 `null`.
- `pendingSubFields` 는 해당 dimension 의 sub-field 중 `subFieldCoverageValue(subField) < 1.0` (즉 confidence < 1 or deferred) 인 id 배열. 빈 dimension(`subFields: []`) 의 경우 `free_form` 의 value 가 있으면 `[]`, 없으면 `["free_form"]`.
- `ambiguity` 는 `computeAmbiguity(dimensions, coverage)` 그대로.
- 기존 key (`sessionId` / `outputPath` / `lang` / `inferredDomain` / `rounds` / `pendingDimensionId` / `ambiguity` / `coverage`) 는 유지, 추가되는 key 는 `pendingDimension` 단 하나.

### AC-3. Weighted-average normalization assertion

수식 `coverage[dim].ratio === Σ_{sub in dim.subFields}(subFieldCoverageValue(sub)) / dim.subFields.length` 가 모든 dimension 에 대해 정확히 성립함을 `test/interview-coverage.test.ts` 에서 수치 assert. 빈 `subFields` dimension 은 `free_form` single-field 치환 (ratio = 0 또는 1) 규칙 그대로.

### AC-4. Soft-terminate threshold 재점검

`shouldTerminate(ambiguity, round, maxRounds, dimensions, coverage)` 를 아래 조건으로 업데이트:

1. `round > maxRounds` → `{terminate: true, reason: 'max-rounds'}` (그대로).
2. `ambiguity <= 0.2` → `{terminate: true, reason: 'ambiguity'}` (그대로).
3. **새 조건**: `ambiguity <= 0.3` **AND** `모든 required dimension 의 ratio >= REQUIRED_SOFT_TERMINATE_RATIO` (기본 `0.8`, 현 0.5 에서 상향) → `{terminate: true, reason: 'soft-terminate'}`.
4. 그 외 → `{terminate: false, reason: null}`.

- `REQUIRED_SOFT_TERMINATE_RATIO` 는 `scripts/vibe-interview.mjs` 상단에 `const REQUIRED_SOFT_TERMINATE_RATIO = 0.8;` 로 선언 (configurable 이지만 env/flag 로는 노출하지 않음 — 단일 상수. 노출 필요는 별 Sprint).
- **iter-4 kickoff 재현 시나리오가 이 경로로 탈출 가능** 해야 함: ambiguity 0.218, 모든 required ratio ≥ 0.8 → terminate. 또는 ambiguity 0.218 이어도 특정 required ratio 0.7 이면 계속 round.
- `src/lib/interview.ts` 의 `shouldTerminate()` 도 lockstep 으로 업데이트 (같은 0.8 상수, 같은 분기).

### AC-5. Regression test suite — `test/interview-coverage.test.ts`

`node:test` 기반. `node --test test/interview-coverage.test.ts` 단독 실행 가능해야 함. 임시 디렉토리(`os.tmpdir()`) 에서 `scripts/vibe-interview.mjs` + dimensions.json + prompt 템플릿을 복사해서 실 CLI 호출 (참고 패턴: `test/interview-cli.test.ts`). 포함 케이스 (describe 1개, it 6개 최소):

1. **case-A high-watermark replace**: 같은 `goal.one_liner` 를 `{confidence: 0.25}` 로 기록 → 다음 round 에서 `{confidence: 0.95}` 로 재기록. 최종 `coverage.goal.subFields.one_liner.confidence === 0.95`, `ratio` 가 0.95 기여 반영 (`goal.subFields.length === 2` 이므로 다른 sub 0 일 때 ratio = 0.475).
2. **case-B high-watermark retention**: 같은 sub-field 를 `{confidence: 0.95}` → `{confidence: 0.25}` 로 재기록. 최종 `confidence === 0.95` (retained), ratio 동일.
3. **case-C deferred reset**: `{confidence: 0.95, deferred: false}` → `{deferred: true, confidence: 0}` 재기록. 최종 `{value: "", confidence: 0, deferred: true}`, ratio 기여 0.
4. **case-D partial ratio with deferred**: `goal.one_liner` `{confidence: 0.9, deferred: false}` + `goal.primary_value` `{deferred: true, confidence: 0}` → `ratio === 0.9 / 2 === 0.45`. `computeAmbiguity` 수식 assertion 동반.
5. **case-E foreign key isolation**: `pending.dimensionId === 'goal'` 인데 attribution 에 `{one_liner: {...}, legal_regulatory: {...}}` 섞임. 기록 후 `state.coverage.constraints.subFields.legal_regulatory` 미변경 확인 (`undefined` 그대로). `goal.one_liner` 는 반영.
6. **case-F soft-terminate happy path**: 모든 required dimension ratio ≥ 0.8, ambiguity 0.25 fixture 로 `shouldTerminate` → `{terminate: true, reason: 'soft-terminate'}`. 반대로 1개 required ratio 0.7 면 `{terminate: false}` (AC-4 의 ratio ≥ 0.8 분기 검증).

테스트는 `scripts/vibe-interview.mjs` 의 실 CLI 를 거치는 것과 (case-A/B/C/E), pure helper 로직을 직접 호출하는 것 (case-D/F for `computeAmbiguity` + `shouldTerminate`) 을 섞어도 된다. 단, **최소 한 케이스는 full CLI round-trip** 으로 `state.json` 을 검증해야 한다.

### AC-6. Backward compatibility — 기존 interview-log 재생 가능

iter-2 / iter-3 `.vibe/interview-log/*.json` 이 있다면 **새 로직으로 로드 시 에러 없음**. 검증: test 에서 legacy coverage shape (필드 3개 만 있는 { value, confidence, deferred } 객체 — 이미 동일) 이 정상 파싱됨을 확인. 저장 포맷 변경 없음. (`pendingDimension` 은 runtime-only 출력이라 state 파일에 persist 되지 않음.)

---

## Lockstep — `src/lib/interview.ts` ↔ `scripts/vibe-interview.mjs`

- `computeAmbiguity` / `subFieldCoverageValue` / `dimensionCoverageRatio` 수식은 현재 양쪽 동기. 본 Sprint 에서 이 수식 **자체는 변경하지 않는다** (AC-3 assertion 만 추가).
- `shouldTerminate()` 는 양쪽에서 AC-4 업데이트 적용. 상수 `REQUIRED_SOFT_TERMINATE_RATIO = 0.8` 도 양쪽에 동일하게 선언.
- `applyAttributionToDimension()` 은 현재 `.ts` 쪽에 포팅되어 있지 않다 (mjs only). 본 Sprint 에서도 `.ts` 쪽 포팅은 **안 한다** — 범위 밖. 기존 CROSS-REF 주석(`scripts/vibe-interview.mjs:382-406` 참조)만 유지.
- 기존 `test/interview-engine.test.ts` 의 `keeps mjs computeAmbiguity in lockstep with the TypeScript helper` 테스트는 그대로 pass 해야 한다.

---

## 제약

- **LOC 예산**: add ~80 / delete ~0 (iter-4 growth budget 내). 초과 시 Final report 에 이유 명시.
- **0 new scripts**: `scripts/` 하위 신규 파일 금지. 기존 `scripts/vibe-interview.mjs` 확장만.
- **Windows + macOS bash(MINGW) 호환**: 경로는 `path.join` / `path.resolve`, timestamp 는 UTC (`new Date().toISOString()`).
- **UTF-8 (BOM 없음)** 고정. 신규 파일 작성 시 BOM 넣지 않는다.
- **소프트 freeze posture**: harness logic 축소/정리 우선. 새 추상 도입 금지 (신규 helper 분리 최소화, 기존 함수 인라인 수정이 원칙).
- **ESM 전용** — `require()` 금지. `import` 만.
- **any 금지** (TS), `.mjs` 쪽은 JSDoc 없이 충분.
- 신규 deps 추가 금지.

---

## Verification (Orchestrator 담당)

본 Sprint 는 Generator 가 `tsc --noEmit` 과 신규 단일 test 파일만 샌드박스 안에서 smoke. 나머지는 Orchestrator 가 샌드박스 밖에서 실행한다.

| # | Command | 담당 | Expected exit |
|---|---|---|---|
| 1 | `npx tsc --noEmit` | Generator + Orchestrator | 0 |
| 2 | `node --test test/interview-coverage.test.ts` | Generator + Orchestrator | 0 (all 6 cases pass) |
| 3 | `npm test --silent` | Orchestrator only | 0, 기존 228 테스트 중 227 pass / 1 skip + 신규 테스트 모두 pass |
| 4 | `node scripts/vibe-interview.mjs --help` | Orchestrator only | 2 (usage, stderr), schema-level 변화 없어야 함 |
| 5 | `node scripts/vibe-gen-schemas.mjs --check` | Orchestrator only | 0 (interview-log schema 미도입이므로 drift 없음) |
| 6 | `node scripts/vibe-preflight.mjs` | Orchestrator only | 0 |

Generator 는 위 1~2 만 실행하고 3~6 은 "Sandbox-only failures" 가 아닌 "Orchestrator verifications" 항목으로 Final report 에 남긴다.

---

## 완료 체크리스트 (Generator self-QA)

전부 mechanical 검증 가능. 미통과 시 Final report 에 명시.

- [ ] C1: `scripts/vibe-interview.mjs` 의 `applyAttributionToDimension` 이 high-watermark rule + deferred reset 구현 (AC-1).
- [ ] C2: foreign subField key 가 다른 dimension coverage 를 변경하지 않음 — 테스트 case-E pass (AC-1.4).
- [ ] C3: `statusCommand()` 출력에 `pendingDimension` 객체(id/label/subFields/pendingSubFields) 포함. `pending === null` 일 때 `null` (AC-2).
- [ ] C4: `pendingSubFields` 는 해당 dimension 의 subFields 중 `subFieldCoverageValue < 1.0` 인 id 배열 (AC-2).
- [ ] C5: `REQUIRED_SOFT_TERMINATE_RATIO = 0.8` 상수 선언 + `shouldTerminate()` 에 반영 — mjs / ts 양쪽 lockstep (AC-4).
- [ ] C6: `test/interview-coverage.test.ts` 6 케이스 전부 작성 + `node --test` 로 단독 exit 0 (AC-5).
- [ ] C7: `npx tsc --noEmit` 0 errors.
- [ ] C8: 기존 `test/interview-engine.test.ts` / `test/interview-cli.test.ts` 의 모든 assertion 유지 — Orchestrator 가 `npm test` 로 검증.
- [ ] C9: `scripts/vibe-interview.mjs` 의 출력 JSON schema 중 기존 `--init` / `--set-domain` / `--continue` / `--record` / `--abort` 의 payload shape 변화 없음 (`--status` 만 확장).
- [ ] C10: LOC 예산 검증 — Final report 에 add/delete 집계 기재.

---

## Final report 요구 사항

`.vibe/agent/_common-rules.md §9` 형식 준수 + 아래 추가 섹션 필수.

```markdown
## Files added
- test/interview-coverage.test.ts — 6 regression cases (AC-5)

## Files modified
- scripts/vibe-interview.mjs — high-watermark coverage + --status extension + soft-terminate threshold
- src/lib/interview.ts — shouldTerminate lockstep (AC-4)

## Verification
| command | exit |
|---|---|
| npx tsc --noEmit | 0 |
| node --test test/interview-coverage.test.ts | 0 |

## Orchestrator verifications (to be run outside sandbox)
| command | reason |
|---|---|
| npm test --silent | full regression — Generator sandbox 로는 228 test 전체 실행 비현실적 |
| node scripts/vibe-gen-schemas.mjs --check | interview-log schema 미도입 확인 |
| node scripts/vibe-preflight.mjs | green 확인 |
| node scripts/vibe-interview.mjs --help | usage 변경 없음 확인 |

## Sandbox-only failures
- (실행하지 못한 항목만. 하나도 없으면 "none".)

## Deviations
- (AC / 체크리스트 미이행 항목. 없으면 "none".)

## Wiring Integration

| Checkpoint | Status | Evidence |
|---|---|---|
| W1 CLAUDE.md hook 테이블 | n/a | 신규 script 없음 (scripts/vibe-interview.mjs 확장만) |
| W2 CLAUDE.md 관련 스킬 | n/a | 신규 슬래시 커맨드 없음 |
| W3 CLAUDE.md Sprint flow | n/a | 절차 변경 없음 |
| W4 .claude/settings.json hook | n/a | 이벤트 기반 스크립트 추가 없음 |
| W5 statusLine | n/a | 상태바 변경 없음 |
| W6 sync-manifest harness[] | n/a | 신규 harness 파일 없음 (test 파일은 manifest 대상 아님) |
| W7 sync-manifest hybrid harnessKeys | n/a | settings/config/package top-level key 변경 없음 |
| W8 README 사용자 섹션 | n/a | 사용자 가시 CLI 옵션 추가 없음 (--status 필드 확장은 내부 consumer 용) |
| W9 package.json scripts.vibe:* | n/a | 신규 npm script 없음 |
| W10 docs/release/vX.Y.Z.md | touched | docs/release/v1.4.2.md (또는 v1.4.1 append) — review-6 #2 해결 기록. Orchestrator 가 릴리스 bump 시 반영 |
| W11 migrations/X.Y.Z.mjs | n/a | state file 구조 변경 없음 (--status 는 runtime-only) |
| W12 test 회귀 방지 | touched | test/interview-coverage.test.ts (6 cases) |
| W13 harness-gaps.md | n/a | 해당 gap 없음 (review-6 finding 은 #2 blocker, harness-gaps 와 별도 tracker) |
| W14 .gitignore 런타임 artifact | n/a | 런타임 artifact 생성 없음 |
| D1 rg <old-name> | n/a | 이름 변경 / 삭제 없음 |
| D2~D6 | n/a | 삭제·이름변경 없음 |

verified-callers:
- scripts/vibe-interview.mjs (변경 부분) → .claude/skills/vibe-interview/SKILL.md Phase 3 runbook / scripts/vibe-interview.mjs --init → --set-domain → --continue → --record → --status → --abort 전체 lifecycle 에서 호출
- src/lib/interview.ts::shouldTerminate → test/interview-engine.test.ts + 본 Sprint test/interview-coverage.test.ts
```

Final report 에 위 "Wiring Integration" 표가 없으면 Orchestrator 가 Sprint 를 **incomplete** 로 판정하고 재위임한다.

---

## 참고 포인터 (Generator 가 읽어도 됨)

- 현 `applyAttributionToDimension` 구현: `scripts/vibe-interview.mjs:740-768`
- 현 `applyCrossDimensionSignals` 구현: `scripts/vibe-interview.mjs:770-808`
- 현 `shouldTerminate` (mjs): `scripts/vibe-interview.mjs:512-526`
- 현 `shouldTerminate` (ts): `src/lib/interview.ts:154-181`
- 현 `statusCommand`: `scripts/vibe-interview.mjs:1145-1164`
- 테스트 패턴 참고: `test/interview-cli.test.ts` (임시 디렉토리 + CLI round-trip), `test/interview-engine.test.ts` (pure helper)
- dimensions.json (read-only): `success_metric` subFields 는 `["acceptance_criteria", "kpi"]`, `goal` subFields 는 `["one_liner", "primary_value"]`.

끝.
