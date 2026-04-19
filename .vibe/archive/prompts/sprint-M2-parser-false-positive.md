# Sprint M2 — parser false-positive regression fix (harness-dogfood9)

- **Sprint id**: `sprint-M2-parser-false-positive`
- **Goal**: dogfood9 review-14 의 수용된 실 regression 2건 해소 — (a) `collectPendingRestorationDecisions()` 가 iter-4 O3 가 append 한 post-decision (delete-confirmed) 섹션을 pending 으로 잘못 seed, (b) `scripts/vibe-sprint-complete.mjs` 가 iter-1 의 `## Sprint M1 — Schema foundation (state files)` 같은 inline-id bullet 헤딩을 못 잡아 `warning=roadmap-id-missing` 노이즈 다발 방출.
- **AC summary**: (1) parser 가 delete-confirmed 섹션 skip, (2) heading parser 가 제목줄 직접 파싱 실패 시 body 의 `- **id**:` bullet fallback, (3) 회귀 테스트 2종 추가, (4) `npx tsc --noEmit` + `npm test --silent` 모두 exit 0.
- **LOC budget**: add ≤ 35 (test 포함 ≤ 60 권장 상한, 초과 시 report 에 이유).
- **Scripts 추가**: 0. `.vibe/sync-manifest.json` 변경: 0.
- **Do NOT modify**: `scripts/run-codex.{sh,cmd}`, `scripts/vibe-status-tick.mjs`, O1/O2/O3 산출물 (interview*, preflight-roadmap-iteration, sprint-planner.md, LOCKFILE_BLACKLIST 로직).
- **Sandbox**: Codex 는 Windows MINGW bash 가능 구간까지만 수행. build/E2E 금지.
- **공용 규칙**: `.vibe/agent/_common-rules.md` 전체 준수 (§1 우회 금지, §2 install 금지, §8 최소 테스트, §9 Final report 형식, §13 sandbox-bound invariants, §14 Wiring Integration).

---

## 1. 배경 (minimal, Generator 가 재조사할 필요 없는 팩트만)

dogfood9 (iter-5 product-only Penguin Run) 5 Sprint 자율 완주 직후 upstream `/vibe-review` 를 돌려 review-14 를 받았다. 수용된 실 regression 2건이 본 Sprint 대상.

### 1.1 parser false-positive (review → auto-seed 4건)

- **증상**: `/vibe-review` 를 돌릴 때마다 4건의 pending restoration entry (`two-tier-audit-convention`, `실패-에스컬레이션`, `항상-지킬-것`, `필요할-때만-읽을-문서`) 가 findings 에 자동 시드됨. 실제로는 iter-4 에서 delete-confirmed 처리된 항목.
- **원인 파일**: `.vibe/audit/iter-3/rules-deleted.md` — 파일 맨 아래에 iter-4 O3 가 append 한 섹션 하나가 있다:

  ```
  ## iter-4 판정 (2026-04-19)

  - 판정 일자: 2026-04-19 (iter-4 O3 sprint 종결 시점)
  - 4건 모두 `restoration_decision: delete-confirmed`
  - `two-tier-audit-convention` — ... **delete-confirmed**.
  - `실패-에스컬레이션` — ... **delete-confirmed**.
  - `항상-지킬-것` — ... **delete-confirmed**.
  - `필요할-때만-읽을-문서` — ... **delete-confirmed**.
  - 다음 감사 (`vibe-rule-audit.mjs`) 에서 본 4건은 closed-ledger 로 간주.
  ```

- **현재 parser 동작** (`src/lib/review.ts` 기존 구현, 구조만 재서술):
  - `collectPendingRestorationDecisions(root)` → `collectRulesDeletedFiles()` 로 `.vibe/archive/rules-deleted-*.md` + `.vibe/audit/iter-*/rules-deleted.md` 를 모아 각 파일에 `parseRestorationSections(markdown, sourceFile)` 호출.
  - `parseRestorationSections` 는 markdown 을 `split(/\r?\n(?=##\s+)/)` 로 `## `-heading 섹션으로 쪼갠 뒤, 각 섹션 body 에서 `restoration_decision: pending` scalar 를 찾으면 `PendingRestoration` 으로 push. tier/reason 은 `restorationValue(lines, key)` 로 추출.
  - iter-4 판정 섹션 안 bullet 들에는 원본 rule slug 가 backtick 으로 언급되지만, 그 bullet 들 자체가 `restoration_decision: pending` 을 포함하지 않으므로 해당 **섹션 자체는 pending 으로 안 잡힘**. 그러나 이 섹션 **이전** 네 개의 rule 섹션 (`## two-tier-audit-convention — …` 등) 이 여전히 `restoration_decision: pending` 을 들고 있어서 pending 으로 시드됨. = 파일 내 결정이 뒤에 있는데 parser 는 앞 섹션 만 보고 판단 → false-positive.

### 1.2 sprint-complete heading parser (warning noise)

- **증상**: `node scripts/vibe-sprint-complete.mjs <sprintId> passed` 실행 시 stderr 로 `[vibe-sprint-complete] warning=roadmap-id-missing headingLine=<N>` 다수 출력. exit code 는 0 (동작 영향 없음) 이지만 다른 경고를 가림.
- **원인 파일**: `scripts/vibe-sprint-complete.mjs` 의 `parseRoadmapSprintIds(roadmapMd)`:

  ```js
  if (!/^## Sprint M\d+/.test(lines[index] ?? '')) { continue; }
  // ... up to 6 lines below, match `- **id**: \`([^`]+)\``
  ```

  iter-1 roadmap 의 실제 헤딩:

  ```
  ## Sprint M1 — Schema foundation (state files)

  - **id**: `sprint-M1-schema-foundation`
  ```

  제목 패턴 `^## Sprint M\d+` 까지는 매치됨. 하지만 inline id bullet 은 `- **id**: \`sprint-M1-schema-foundation\`` 이라 regex 가 정상 매치되어야 하지만, iter-1 일부 헤딩은 빈 줄 위치나 blockquote/텍스트 삽입으로 offset 6 내에서 bullet 을 못 찾는 케이스 발생 → `matchedId` 가 null 로 빠져 경고 출력. (현재 roadmap 전체에 `^## Sprint M\d+` 헤딩은 10개 이상 존재 — `grep -n "^## Sprint M" docs/plans/sprint-roadmap.md` 로 재확인.)

- **목표 수정**: 현재 6줄 lookahead 를 확대(예: 12줄) + bullet 정규식 유연화 (앞공백/제목 뒤 이탤릭 등). 여전히 못 찾으면 경고 유지 (진짜 잘못된 헤딩 보호). 기존 정상 매칭 케이스 회귀 X.

### 1.3 Non-regression invariants

- iter-4 O3 가 정리한 `delete-confirmed` ledger entry 4건은 본 Sprint 이후에도 ledger 파일에 그대로 보존된다 (history 로 남긴 것). 파서에서만 제외.
- 기존 `rules-deleted` 파일 중 **iter-4 판정 섹션이 없는** 구버전 (dogfood 프로젝트 등) 은 그대로 pending 을 반환 — backward compat.

---

## 2. Files to modify

| path | edit | expected delta |
|---|---|---|
| `src/lib/review.ts` | `parseRestorationSections()` 또는 새 helper `collectDeleteConfirmedSlugs(markdown)` 를 추가하고 `parseRestorationSections` 이 반환 직전 해당 slug 를 필터. | add ~15, delete 0 |
| `scripts/vibe-sprint-complete.mjs` | `parseRoadmapSprintIds()` 의 lookahead 범위 / bullet regex 보강. | add ~5, delete ~2 |
| `test/vibe-review-inputs.test.ts` | "delete-confirmed 섹션이 pending 을 suppress 한다" case 1개 추가 (기존 backward compat case 는 그대로 유지 — 이미 있음). | add ~35 |
| `test/sprint-commit.test.ts` (기존) 또는 `test/sprint-complete-heading-parser.test.ts` (신규, 택 1) | iter-1 스타일 heading fixture 로 warnings 0 검증. `parseRoadmapSprintIds` export 가 없으므로 `computeCurrentPointerBlock` 경유 간접 검증 또는 함수 export 1개 추가 (선택 시 `src/lib/review.ts` 처럼 named export). | add ~25 |
| `docs/release/v1.4.3.md` | 신규 1-page release note draft (M2 섹션만, M3 섹션은 후속 Sprint 에서 append). | new file ~20 line |

(모든 Write 전에 해당 파일을 Read 로 확인. 이미 존재하는 test 파일은 Edit 만.)

---

## 3. Parser 교정 — AC-1 상세 (rules-deleted delete-confirmed skip)

### 3.1 정확한 동작 규약

`parseRestorationSections(markdown, sourceFile)` 의 **출력물** 에서, 다음 조건 중 하나를 만족하는 rule slug 는 제외한다:

1. **동일 markdown 내에 post-decision 섹션이 있고**, 그 섹션 body 에 `` `<slug>` `` (백틱으로 감싼 slug 문자열) 과 `delete-confirmed` 가 같은 줄(또는 같은 bullet) 에 동시 등장.
2. 또는 **단일 rule 섹션 body** 에 `restoration_decision: delete-confirmed` scalar 가 `restoration_decision: pending` 외에 존재 (미래 확장성 — 같은 섹션에 나중에 판정이 append 되는 경우).

Generator 는 아래 2-pass 접근 권장 (다른 접근도 OK 하나 assert 가 통과해야 함):

- 1-pass: 기존대로 `## heading` 섹션 split + pending entry 후보 수집.
- 2-pass (신규): 같은 markdown 에서 `/^##\s+.*iter-\d+.*판정|^##\s+.*delete-confirmed/m` 같은 post-decision 섹션 헤딩 매칭 + 해당 섹션 body 에서 `` /`([a-z0-9가-힣-]+)`.*delete-confirmed/i `` 로 slug 수집. 이 집합에 포함되는 후보는 drop.

### 3.2 Regex 주의

- slug 내 한글 포함 (`실패-에스컬레이션`, `항상-지킬-것`, `필요할-때만-읽을-문서`). 기존 `parseRestorationHeading` 이 `[^a-z0-9가-힣]+` 사용하니 동일 범위 유지.
- `delete-confirmed` 매칭은 대소문자 무시 + `**delete-confirmed**` 굵게 처리 허용.
- 한 bullet 안에 slug backtick + `delete-confirmed` 가 동시 등장해야 함 (단순히 같은 섹션에 있다고 매칭하면 false-match 위험). 라인 단위 스캔 권장.

### 3.3 Test (AC-3a)

`test/vibe-review-inputs.test.ts` 의 기존 `collectPendingRestorationDecisions parses pending entries from audit ledgers` 블록은 그대로. 그 다음 새 `it('suppresses pending entries marked delete-confirmed in a post-decision section', ...)` 추가:

- fixture: 기존 2 entry (`old-rule` tier B pending + `invalid-tier` pending) 이후 빈 줄 + `## iter-4 판정 (2026-04-19)` 헤딩 + bullet `` - `old-rule` — ... **delete-confirmed** `` 포함.
- 기대: `restorations.length === 1` (`old-rule` drop, `invalid-tier` 유지).

추가로 기존 empty-ledger case 는 그대로 pass 해야 함.

---

## 4. Heading parser 교정 — AC-2 상세

### 4.1 동작 규약

`parseRoadmapSprintIds(roadmapMd)`:

- 현재: heading 라인부터 offset 1..6 사이 첫 `- **id**: \`([^`]+)\`` 매칭.
- 신규: offset 1..12 로 확장 + bullet regex 를 `/^\s*[-*]\s+\*\*id\*\*:\s*`([^`]+)`/` 로 완화 (현재도 `-` 전용 → `[-*]` 로 허용, 선행 공백 이미 `\s*` 이지만 escape 확인).
- 해당 lookahead 내에서 또 다른 `^## ` 를 만나면 현재 section 종료 (다음 Sprint heading 침범 방지). 즉 내부 루프에 `if (/^## /.test(line)) break;` 추가.
- 매칭 실패 시 기존대로 `warning=roadmap-id-missing headingLine=<N>` 유지 (진짜 비정상 헤딩 보호).

### 4.2 Backward compat

- iter-2 이후 표준 (`## Sprint M-audit — audit gate`, `## Sprint O1 — Interview coverage …` 등) 헤딩 + 빈 줄 1개 + bullet 인 경우 기존과 동일하게 1회 시도 안에 매칭. 기존 sprint-commit test 의 `computeCurrentPointerBlock` case (heading 바로 아래 bullet) 도 그대로 통과.
- 매우 오래된 iter-1 스타일 (`## Sprint M1 — Schema foundation (state files)` 후 긴 구조 bullet + 설명 줄) 도 12줄 내 첫 id bullet 을 캡처. 실측 확인: `sed -n '31,55p' docs/plans/sprint-roadmap.md`.

### 4.3 Test (AC-3b)

선택지 두 가지 중 하나:

**(A) export 추가 + 독립 테스트 파일** — 권장.

- `scripts/vibe-sprint-complete.mjs` 상단 `export function parseRoadmapSprintIds(roadmapMd)` 로 export 전환 (함수 정의 자체는 유지, 앞에 `export` 만 붙임, 타 참조 없음 → 위험 0).
- 신규 `test/sprint-complete-heading-parser.test.ts`:
  - iter-1 스타일 fixture (`## Sprint M1 — Schema foundation (state files)` + 빈 줄 + bullet `- **목표**: ...` + `- **산출**:` + 하위 indent + 빈 줄 + `- **id**: \`sprint-M1-schema-foundation\``) 을 `parseRoadmapSprintIds` 에 주입 → 반환이 `['sprint-M1-schema-foundation']` 이고 stderr warning 없음 (stderr capture: `spyOn(process.stderr, 'write')` 또는 child process spawn 으로 stderr 캡처).
  - 비정상 fixture (id bullet 없이 heading 만) → warning 1회 + 반환 `[]`.
- import 경로: `import { parseRoadmapSprintIds } from '../scripts/vibe-sprint-complete.mjs'`. `.mjs` 확장자 명시.

**(B) 기존 sprint-commit test 안에 case 추가** — export 안 건드리고 `loadSprintCompleteHelpers()` 에 `parseRoadmapSprintIds` 필드 추가 + 동적 import 로 시도.

둘 중 export 추가 (A) 권장. 더 자연스럽고 LOC 가 적다.

---

## 5. Release note (AC scaffolding)

`docs/release/v1.4.3.md` 신규 작성. 구조 참고용:

```markdown
# v1.4.3 (2026-04-XX)

## iter-6 M2 — parser false-positive regression fix

- `collectPendingRestorationDecisions` 가 `.vibe/audit/iter-*/rules-deleted.md` 내 post-decision 섹션에서 delete-confirmed 로 판정된 rule slug 는 pending 에서 제외 — dogfood9 review-14 false-positive 4건 해소.
- `scripts/vibe-sprint-complete.mjs` 의 `parseRoadmapSprintIds` 가 iter-1 스타일 heading (본문 6줄 초과 위치의 `- **id**:` bullet) 을 인식 — `warning=roadmap-id-missing` 노이즈 제거.
- regression test 2건 추가 (`test/vibe-review-inputs.test.ts`, `test/sprint-complete-heading-parser.test.ts`).

(M3 status-tick Windows regression 은 후속 Sprint 에서 동일 문서에 append.)
```

(날짜 placeholder 는 Codex 가 채우지 말고 `2026-04-XX` 로 두기 — Orchestrator 가 단일 커밋 직전에 fill in.)

---

## 6. 검증 명령 (Generator in-sandbox)

| command | expected exit |
|---|---|
| `npx tsc --noEmit` | 0 |
| `node --test --import tsx test/vibe-review-inputs.test.ts` | 0 (if node version supports; 안 되면 final report 에 sandbox-only failure 로 기록) |
| `node --test --import tsx test/sprint-complete-heading-parser.test.ts` | 0 (동일) |

Generator 가 sandbox 제약으로 `--test` 를 못 돌리는 경우 (tsx loader 미설치 등), Final report 의 Sandbox-only failures 에 `npm test --silent` 가 필요함을 명시. Orchestrator 가 샌드박스 밖에서 `npm test --silent` 전량 수행 (249 + 2 test → pass 확인).

**금지 명령** (§13): `npm test` 전량, `npm run build`, playwright/cypress 계열. 단위 스모크만.

---

## 7. Final report 요구 사항 (§9 + §14)

Generator 가 `docs/prompts/sprint-M2-parser-false-positive.md` 처리 완료 후 Final report 에 아래 섹션을 **순서대로** 포함:

```markdown
## Files added
- docs/release/v1.4.3.md — v1.4.3 release note draft (M2 섹션만)
- test/sprint-complete-heading-parser.test.ts — heading parser regression (option A 채택 시)

## Files modified
- src/lib/review.ts — delete-confirmed post-decision suppression
- scripts/vibe-sprint-complete.mjs — lookahead 확장 + parseRoadmapSprintIds export
- test/vibe-review-inputs.test.ts — delete-confirmed suppression case 추가

## Verification
| command | exit |
|---|---|
| npx tsc --noEmit | 0 |
| node --test ... | 0 또는 sandbox-only |

## Sandbox-only failures
- (해당 시) npm test 전량은 Orchestrator 가 샌드박스 밖에서 수행

## Deviations
- (없으면 "none")

## Wiring Integration

| Checkpoint | Status | Evidence |
|---|---|---|
| W1 CLAUDE.md hook 테이블 | n/a | 신규 스크립트 없음 |
| W2 관련 스킬 list | n/a | 신규 슬래시 커맨드 없음 |
| W3 Sprint flow 번호 | n/a | 사이클 변경 없음 |
| W4 settings.json hooks | n/a |  |
| W5 statusLine | n/a |  |
| W6 sync-manifest harness[] | n/a | 신규 하네스 파일 없음 |
| W7 sync-manifest hybrid keys | n/a |  |
| W8 README.md | n/a | 사용자 가시 변경 없음 (noise 감소만) |
| W9 package.json scripts | n/a |  |
| W10 docs/release/vX.Y.Z.md | touched | docs/release/v1.4.3.md (신규) |
| W11 migrations | n/a | schema 변경 없음 |
| W12 test/*.test.ts | touched | test/vibe-review-inputs.test.ts + test/sprint-complete-heading-parser.test.ts |
| W13 harness-gaps.md | n/a | 기존 gap 해결 아님 (regression fix) |
| W14 .gitignore | n/a | 런타임 artifact 없음 |

verified-callers:
- src/lib/review.ts:collectPendingRestorationDecisions → src/lib/review.ts:collectReviewInputs 내부 호출 (기존 경로 유지)
- scripts/vibe-sprint-complete.mjs:parseRoadmapSprintIds → 같은 파일 내 shouldAutoProjectReport / computeCurrentPointerBlock (기존 호출) + 신규 test
```

`## Wiring Integration` 섹션 누락 시 Sprint 미완료.

---

## 8. 금지 사항 요약

1. `.vibe/audit/iter-3/rules-deleted.md` 내용 수정 금지 (ledger history 보존).
2. iter-4 O3 판정 섹션 문구 수정 금지.
3. `scripts/run-codex.sh`, `scripts/run-codex.cmd` 수정 금지 (M3 범위).
4. `scripts/vibe-status-tick.mjs` 건드리지 않기.
5. `docs/plans/sprint-roadmap.md` 수정 금지 (현재 sprint 설명이 이미 있음).
6. `.vibe/agent/_common-rules.md` 수정 금지 (규칙 변경 아님).
7. dogfood9 저장소 또는 review-14 원본 파일 참조 금지 (upstream-only).
8. harnessVersion bump (`package.json`, `.vibe/config.json`) **본 Sprint 에서 하지 않음** — M3 완료 후 Orchestrator 가 묶어서 bump.

---

## 9. Definition of Done (Orchestrator self-QA checklist)

- [ ] `src/lib/review.ts` 수정: delete-confirmed post-decision suppression 로직 추가, 기존 export signature 유지.
- [ ] `scripts/vibe-sprint-complete.mjs` 수정: lookahead 12줄 + bullet regex 완화 + 다음 `## ` 만나면 break. `parseRoadmapSprintIds` export 추가 (option A).
- [ ] `test/vibe-review-inputs.test.ts` 에 delete-confirmed suppression case 1개 추가, 기존 2 case 그대로 통과.
- [ ] `test/sprint-complete-heading-parser.test.ts` 신규 또는 `test/sprint-commit.test.ts` 확장 — iter-1 style heading 매칭 1 case + 비정상 1 case.
- [ ] `docs/release/v1.4.3.md` 신규 작성 (M2 섹션만, 날짜 placeholder).
- [ ] `npx tsc --noEmit` exit 0.
- [ ] Orchestrator 샌드박스 밖 `npm test --silent` exit 0, 기존 test 수 + 2건 이상 증가.
- [ ] `node scripts/vibe-sprint-complete.mjs --help` 또는 dry-run 에서 `warning=roadmap-id-missing` 재발 없음 (실제 roadmap 파일 기준).
- [ ] Final report 의 `## Wiring Integration` 섹션 포함.
- [ ] 총 LOC add ≤ 35 (코드만), test + release note 포함 ≤ 100. 초과 시 Deviations 에 이유.

끝.
