---
name: vibe-review
description: 주기적 프로세스 리뷰 드래프트 생성
---

이 스킬은 Orchestrator가 주기적 프로세스 리뷰를 재현 가능하게 작성할 때 사용한다.
리뷰를 시작할 때 아래 입력을 먼저 로드하고, 같은 입력 집합을 기준으로 findings를 만든다.

## Protocol

1. 먼저 helper를 호출해 기본 입력을 수집한다.

```bash
node --import tsx -e "import { collectReviewInputs, detectOptInGaps } from './src/lib/review.ts'; const inputs = await collectReviewInputs(); const config = (await import('./.vibe/config.json', { with: { type: 'json' } })).default; const issues = detectOptInGaps(config, { productText: inputs.productText, sessionLogRecent: inputs.recentSessionEntries }); console.log(JSON.stringify({ inputs, issues }, null, 2));"
```

2. 자동 로드 입력:
   - `.vibe/agent/handoff.md` 전체
   - `.vibe/agent/session-log.md` 최근 N entries
     - 기본값 `50`
     - `.vibe/config.json.review.recentEntries` 있으면 그 값 사용
   - `git log --oneline`
     - 기본값 최근 `20` commits
     - 최신 `review-*.md` 가 있으면 그 리뷰 이후 범위를 우선 사용
   - `.vibe/agent/sprint-status.json` 의 `pendingRisks` 중 `open` 상태만
   - `.vibe/agent/project-decisions.jsonl` 전체
   - `docs/context/harness-gaps.md` 전체

3. 출력 파일 경로:
   - `docs/reports/review-<sprintCount>-<YYYY-MM-DD>.md`
   - `<sprintCount>` 는 `sprint-status.json.sprints.filter(s => s.status === 'passed').length`

## Rubric

- 🔴 Blocker — process/harness 가 다음 Sprint 를 못 돌게 만드는 결함
- 🟡 Friction — 사용자/Orchestrator 가 반복적으로 우회하는 마찰 지점
- 🟢 Polish — UX 개선, 문구 정비
- 🔵 Structural — 아키텍처/계약 수준의 장기 개선

## Findings Format

각 finding 은 Markdown 표가 아니라 아래 YAML 블록 + 설명 bullet 로 작성한다.

```yaml
- id: review-<slug>
  severity: blocker|friction|polish|structural
  priority: P0|P1|P2|P3
  proposal: 1~2문장 요약
  estimated_loc: number
  proposed_sprint: 다음 M번호 또는 "backlog"
```

설명 bullet 에는 왜 이 이슈가 지금 relevant 한지 근거만 짧게 적는다.

## Automatic Checks

- `detectOptInGaps()` 를 호출해 M7 opt-in 누락을 먼저 시드한다.
- `.vibe/config.json.bundle.enabled === false` 이고 `product.md` 또는 interview seed 의 platform 이 `web|mobile|browser` 를 포함하면:
  - 🟡 Friction entry
  - `proposal: "frontend 프로젝트인데 bundle-size gate 가 opt-in 되지 않음"`
- `.vibe/config.json.browserSmoke.enabled === false` 이고 같은 platform 조건이면:
  - 🟡 Friction entry
  - `proposal: "frontend 프로젝트인데 browser smoke gate 가 opt-in 되지 않음"`
- 최근 session-log entries 안에 `[decision][phase3-utility-opt-in]` 가 있으면 위 두 entry 는 skip 한다.
- `docs/context/harness-gaps.md` 의 `status=open` 개수를 집계해 findings 에 반영한다.
  - open gap 이 0이 아니면 최소 1개 finding 에 ledger 상태를 근거로 연결한다.

## Report Shape

출력 문서는 아래 섹션을 순서대로 포함한다.

1. `## Inputs loaded`
   - 어떤 파일과 commit 범위를 읽었는지 기록
2. `## Findings (severity desc)`
   - severity 순서: blocker -> friction -> structural -> polish
3. `## Suggested next-sprint scope`
   - 다음 Sprint 후보 scope 를 2~5개 bullet 로 압축
4. `## Links`
   - 참조한 handoff, session-log, latest review, harness-gaps 경로

## Notes

- review 는 사람이 읽는 문서지만 입력 재현성 우선이다. 감상 대신 evidence 를 적는다.
- finding 이 없더라도 `## Findings` 에 `none` 을 쓰지 말고 residual risk 를 1~2줄 적는다.
- helper 가 반환한 입력 밖의 자료를 추가로 읽었다면 `## Inputs loaded` 에 명시한다.
