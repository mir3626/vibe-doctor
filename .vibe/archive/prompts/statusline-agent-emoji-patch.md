# Statusline agent-tracking + emoji patch

## Context

iter-3 closure 후 사용자 요청. 현재 statusline 은 `vibe-status-tick.mjs` 가 Codex 호출 완료 시점에만 `tokens.json` 을 갱신 → Sprint 완료 전까지 0 으로 표시. Claude (Orchestrator + sub-agent) usage 도 전혀 tracking 안 됨.

## Deliverables (3)

### D1 — statusline live Claude usage 표시

`.claude/statusline.sh` + `.claude/statusline.ps1` 수정:

1. **stdin JSON 읽기**: Claude Code 가 statusline 실행 시 stdin 으로 JSON input (`{session_id, transcript_path, cwd, model, workspace}`) 전달. 이를 parse.
2. **transcript_path 가 존재 + 유효 파일**이면 JSONL 을 line-by-line 읽어 각 message 의 `usage.input_tokens` + `usage.output_tokens` 합산 → Claude total. (cache_read / cache_creation 은 단순화 위해 일단 제외.)
3. **stdin input 없거나 transcript 파일 없음** → Claude total = 0, 표시 생략 가능 (graceful).

### D2 — agent 별 표시 (이모지 포함)

표시 포맷:

```
🎯 <sprintId> (<pass>/<total>) | 💭 <claudeK>K | 🔧 <codexK>K | ⏱️ <elapsed>m | ⚠️ <risks> | 🏷️ <version>
```

매핑:
- `🎯` Sprint current id + `passed/total` 비율 (기존 `S` 대체)
- `💭` Claude total (Orchestrator + all sub-agents, transcript usage 합산, `K` 단위)
- `🔧` Codex total (`tokens.json.cumulativeTokens`, `K` 단위)
- `⏱️` elapsed (`tokens.json.elapsedSeconds` → minutes)
- `⚠️` open risks count
- `🏷️` version

**Windows 이모지 render**: PowerShell 은 UTF-8 output 명시 필요 (`[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`). Bash 는 그대로 UTF-8 출력. Test 에서 byte-level 로 이모지 이탈 여부 확인.

### D3 — 테스트 보강

`test/statusline-render.test.ts` (기존 파일) 확장:
- Mock stdin JSON + mock transcript → expected claude total 합산 assert.
- 이모지 포함 여부 check (bytewise).
- Legacy path (stdin 없음) → claude 표시 생략 확인.
- Windows PowerShell 경로는 기존 convention 유지.

## Acceptance criteria

1. `npx tsc --noEmit` exit 0.
2. `npm test` 0 failures. 최소 2개 신규 test (Claude live usage + 이모지 포함).
3. `echo '{"transcript_path":"...existing valid jsonl..."}' | bash .claude/statusline.sh` → 이모지 포함 realtime 출력.
4. stdin 없음 상태 (기존 호출 방식) → 과거와 동일한 출력 (이모지만 추가, claude field 는 생략).
5. Production code net LOC: 각 shell 파일 +30~50 범위.

## Files to modify

- `.claude/statusline.sh` (bash)
- `.claude/statusline.ps1` (PowerShell)
- `test/statusline-render.test.ts` (expand)

## Non-goals

- `vibe-status-tick.mjs` 동작 변경 금지 (Codex token tracking 은 그대로).
- 전체 transcript parse 가 felt 느리면 tail-only 최적화 **권장이나 scope 밖**. 지금은 full parse.
- sub-agent (Planner/Evaluator) 별 분리 tracking 금지 — transcript 에 subagent usage 가 parent 에 merged 되므로 "Claude total" 로 통합.
- cache_read / cache_creation 가산 알고리즘 정교화 금지 — `input + output` 단순 합산 유지.

## Final report contract

- Files changed table (shell/ps1/test)
- Statusline rendered sample output (이모지 포함) — 실제 실행 결과 1 줄
- Cache 미포함 단순화 근거 1 줄 (단순화 trade-off 인정)
