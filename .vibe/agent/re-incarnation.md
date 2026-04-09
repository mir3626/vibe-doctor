# Orchestrator Re-incarnation Protocol

> 컨텍스트 압축 직후 또는 완전히 새 세션에서 Orchestrator가 부팅될 때 **무손실로 직전
> 상태를 복원**하기 위한 프로토콜. 이 파일의 지시는 기계적으로 따른다.

## 왜 이 프로토콜이 필요한가

Sub-agent는 **context checkpoint 메커니즘**이다. 하지만 Orchestrator 자신은 상주하는
단일 인스턴스이기 때문에, 자동 context 압축이 발생하면 tone/language/현재 작업/왜
그렇게 결정했는지 같은 정보가 조용히 손실된다. dogfood 2 세션 중 실제로 한국어↔영어,
반말↔존댓말 전환이 반복되며 관찰되었다.

→ Orchestrator 역시 **필요 시 재인스턴스화 가능한 역할**로 취급한다. 상태는 파일에
있고, 새 Orchestrator는 그 파일들을 읽어 부팅한다.

## Boot sequence (반드시 이 순서)

새 Orchestrator는 사용자에게 첫 응답을 하기 전에 다음을 기계적으로 수행한다.

1. **`CLAUDE.md`** — 역할 제약, 트리거 매트릭스, 항상 지킬 것. Claude Code harness가
   시스템 프롬프트에 자동 주입하므로 별도 Read 불필요.
2. **auto-memory** — Claude Code harness가 `MEMORY.md` 인덱스를 자동 주입한다. 그 인덱스를
   훑어 **필요한 shard만** Read 도구로 명시적으로 연다 (특히 `feedback_language_tone.md`,
   `feedback_autonomous_execution.md`, 진행 중 프로젝트의 `project_*.md`). auto-memory
   자체는 자동 주입되므로, shard 본문이 필요할 때만 경로를 명시해서 Read한다.
3. **`.vibe/agent/sprint-status.json`** — `Read`로 직접 열어 현재 Sprint id와 handoff 필드
   (`currentSprintId`, `lastActionSummary`, `openIssues`, `orchestratorContextBudget`,
   `preferencesActive`, `updatedAt`)를 확인.
4. **`.vibe/agent/handoff.md`** — narrative 상태 박제. Mission, 역할 제약, trigger matrix,
   P0 task list, last action, **Next action**. 여기 §7 "Next action"이 재부팅 후 첫 작업이다.
5. **관련 Sprint 프롬프트 / Generator final report** — handoff가 가리키는 파일만 선택적으로 읽는다.

읽기 끝나면 사용자에게 한 줄 복귀 확인: "복구: {currentSprintId} — {lastActionSummary}.
다음: {next action 한 줄}." 그 후 Next action부터 재개.

## Checkpoint 규정 (현재 Orchestrator가 언제 handoff를 갱신하는가)

다음 시점마다 `handoff.md` + `sprint-status.json`의 `handoff` 필드를 동시에 갱신한다.

- **Must**: 각 P0/P1 항목 완료 직후, Sprint status 변경 시, 사용자 중요 결정 합의 직후
- **Must**: `orchestratorContextBudget`이 본인 판단 "medium → high"로 올라갔다고 느낄 때
  (압축 임박 신호)
- **Should**: 10개 이상의 연속 tool call을 실행한 직후

갱신 비용은 작고, 압축 손실 비용은 크다. 의심되면 갱신한다.

## Context budget self-assessment

`orchestratorContextBudget` 값 가이드:

- **low** — 세션 초반, 읽은 파일 <5, tool call <20. 어떤 작업이든 직접 수행 가능.
- **medium** — 다수의 파일 읽음, 긴 sub-agent 결과 수신, 큰 diff 다룸. Planner/Evaluator
  Should 트리거를 적극 고려.
- **high** — 이미 한 차례 압축 발생했거나, 직전 응답에서 명백한 context drift(잘못된 파일
  경로 기억, 이미 한 작업 중복 시도) 감지. **지금 즉시** handoff 갱신 → 가능하면 현재
  작업을 Generator/Evaluator로 위임해 격리.

## Re-incarnation 트리거 (드물지만 명시)

사용자가 "새 세션에서 이어가자" 또는 "compact and continue" 유사 요청을 하거나, 본인이
`high` 상태에서 즉시 필요한 체크포인트를 마친 경우, 다음 문장으로 마무리한다:

> "handoff.md 갱신 완료. 새 세션에서 `.vibe/agent/handoff.md`부터 읽고 이어가면 됨."

그 외의 경우에는 자발적 재인스턴스화를 사용자에게 권하지 않는다 — 자동 압축이 알아서
발생한다.

## 금지 사항

- handoff.md를 **읽지 않고** 재개 선언 금지.
- `lastActionSummary`에 "작업 계속 중"처럼 무의미한 문장 금지 — 구체 명사 + 동사.
- 사용자 preferencesActive에 없는 tone/language를 추측해서 사용 금지.
