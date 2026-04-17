# dogfood8 인계 — iter-3 완료 브리핑

## iter-3 요약

이 메시지는 dogfood8 세션 첫 입력으로 그대로 붙여 넣기 위한 브리핑입니다.

작업 대상은 `C:\Users\Tony\Workspace\vibe-doctor` 입니다.

iter-3는 self-evolution harness를 실제 사용 흐름에서 더 가볍고 덜 잊히게 만드는 라운드입니다.

완료된 Sprint는 다음과 같습니다.

- N1 `rule-audit-diet`: `CLAUDE.md` rule audit 내용을 292 lines에서 248 lines로 줄였습니다.
- N2 `critical-bug-triage`: archive prompt staging, Codex status tick, auto-tag self-test, dogfood8 handoff를 처리했습니다.
- N3: 아직 미착수입니다. progressive MD 재구조화와 `mode: "human" | "agent"` 기본값 도입이 예정되어 있습니다.

Harness version은 `1.4.0`에서 `1.4.1`로 승격되었습니다.

N1 기준 검증 상태는 `199 tests pass / 0 fail / 1 skip` 이었습니다.

N2는 `scripts/vibe-sprint-commit.mjs`의 production commit 경로로 `v1.4.1` annotated tag 생성을 self-test합니다.

dogfood8에서는 새 규칙이 실제 사용 중 마찰을 줄였는지, 반대로 복원해야 할 rule 손실이 있는지 관찰해야 합니다.

## 자동 tag self-test 결과

N2 Sprint commit 직후 아래 명령으로 tag 존재를 확인합니다.

```bash
git tag -l v1.4.1
```

기대 출력:

```text
v1.4.1
```

N2 commit stdout에는 아래 라인이 포함되어야 합니다.

```text
[vibe-sprint-commit] harness-tag: created v1.4.1 (prev=1.4.0)
```

위 라인이 `skipped (tag v1.4.1 already exists)` 로 바뀌면 이전 세션에서 tag가 이미 만들어진 것입니다.

위 라인이 `FAILED` 로 바뀌면 수동 tag를 만들지 말고 원인만 기록합니다.

dogfood8 시작 시에는 `git tag -l v1.4.1` 결과와 N2 Final report의 commit stdout을 대조합니다.

## dogfood8 진입 체크리스트

- `node scripts/vibe-preflight.mjs` 를 실행하고 blocking error가 없는지 확인합니다.
- `npm run vibe:sync --dry-run` 을 실행해 `v1.4.0` 또는 `v1.4.1` tag 기반 manifest pull이 정상인지 확인합니다.
- `.vibe/audit/iter-3/rules-deleted.md` 의 `two-tier-audit-convention` cluster가 dogfood8 실행 중 마찰을 만들면 incident로 기록합니다.
- `.vibe/audit/iter-3/rules-deleted.md` 의 실패 에스컬레이션 cluster가 필요한 순간이 있었는지 기록합니다.
- `.vibe/audit/iter-3/rules-deleted.md` 의 항상 지킬 것 cluster 삭제가 실제 품질 저하로 이어졌는지 관찰합니다.
- `.vibe/audit/iter-3/rules-deleted.md` 의 필요할 때만 읽을 문서 cluster가 누락으로 느껴지는지 확인합니다.
- 새 `mode: "human"` default가 `/vibe-init` Step 1-0에서 제시되는지는 N3 미완료 상태에서는 해당 없음으로 처리합니다.
- `scripts/vibe-status-tick.mjs` 가 Codex 호출마다 `.vibe/agent/tokens.json` 을 자동 갱신하는지 1회 이상 육안 확인합니다.

Status tick 확인 예시는 다음과 같습니다.

```bash
cat .vibe/agent/tokens.json
```

확인할 필드는 다음과 같습니다.

- `updatedAt`
- `cumulativeTokens`
- `elapsedSeconds`
- `sprintTokens`

Codex 호출이 성공했는데 `tokens.json` 이 변하지 않으면 `run-codex` wrapper stderr의 `status-tick` 라인을 확인합니다.

`status-tick: skipped reason=no-sprint` 는 현재 Sprint ID를 찾지 못한 상태입니다.

`status-tick: skipped reason=no-tokens` 는 Codex 출력에서 token count를 찾지 못한 상태입니다.

`status-tick: skipped reason=cli-failed` 는 `vibe-status-tick.mjs` 호출 자체가 실패한 상태입니다.

## 이상 발견 시 feedback template

dogfood8 종료 후 `/vibe-review` 에 append할 feedback은 아래 JSON skeleton을 사용합니다.

```json
{
  "iteration": "dogfood8",
  "sprint": "iter-3",
  "signal_type": "agent",
  "priority_score": 10,
  "recommended_approach": "script-wrapper",
  "summary": "",
  "evidence": [
    {
      "path": "",
      "quote": "",
      "observed_at": "2026-04-17T00:00:00.000Z"
    }
  ],
  "proposed_next_sprint": ""
}
```

`signal_type` 값은 다음 중 하나로 고릅니다.

- `agent`: agent가 반복해서 잊거나 잘못 수행한 문제입니다.
- `token`: context budget, rule 길이, prompt 중복 때문에 생긴 문제입니다.
- `user`: 사용자가 수동으로 기억하거나 실행해야 해서 생긴 문제입니다.

`priority_score` 계산식은 다음과 같습니다.

```text
10 * agent + 5 * token + 1 * user
```

`recommended_approach` 우선순위는 다음과 같습니다.

```text
script-wrapper > md-rule > config-default > user-action
```

같은 문제가 script로 막을 수 있으면 markdown rule을 늘리지 않습니다.

같은 문제가 config default로 해결되면 사용자 행동 지시를 늘리지 않습니다.

증거는 가능한 한 파일 경로, stderr 라인, session-log 라인 중 하나로 남깁니다.

## 복원 가이드

iter-3 rule trim이 과도했다고 판단되면 아래 절차로 복원합니다.

1. `.vibe/audit/iter-3/rules-deleted.md` 에서 문제 cluster를 찾습니다.
2. 해당 cluster의 `restoration_decision: pending` 값을 `restoration_decision: restored(<dogfood8 commit sha>)` 로 바꿉니다.
3. 같은 cluster의 `original_text:` 내용을 확인합니다.
4. `CLAUDE.md` 의 가장 가까운 관련 섹션에 `original_text:` 를 재삽입합니다.
5. 복원 이유와 dogfood8 증거를 `.vibe/agent/session-log.md` 에 `[decision]` 으로 남깁니다.

복원은 한 번에 하나의 cluster만 처리합니다.

복원 후에는 `node scripts/vibe-rule-audit.mjs --scan-transcripts` 를 다시 실행해 삭제 ledger와 실제 rule 상태가 맞는지 확인합니다.

복원 여부가 애매하면 `restoration_decision: pending` 을 유지하고 incident만 feedback template에 남깁니다.

N3가 완료된 뒤에는 `mode: "human"` 기본값과 progressive MD 구조가 dogfood8 진입 마찰을 줄였는지도 함께 평가합니다.
