# Statusline format tune (post-iter-3.2 follow-up)

## Deliverables (2)

### D1 — 소모시간 위치를 두번째로 이동

현재 순서: `🎯 sprint | 💭 claude | 🔧 codex | ⏱️ elapsed | ⚠️ risks | 🏷️ version`

변경 후: `🎯 sprint | ⏱️ elapsed | 💭 Claude <N>K | 🔧 Codex <N>K | ⚠️ risks | 🏷️ version`

### D2 — 에이전트 별 토큰 이모티콘 뒤에 에이전트 명 추가

- `💭 <N>K` → **`💭 Claude <N>K`**
- `🔧 <N>K` → **`🔧 Codex <N>K`**

## Files

- `.claude/statusline.sh`
- `.claude/statusline.ps1`
- `test/statusline.test.ts` (기존 assertion regex / literal 업데이트)

## Acceptance

1. `npm test` 0 failures. 2분 내 완료.
2. `npx tsc --noEmit` 0 errors.
3. `bash .claude/statusline.sh` 실행 결과 순서가:
   `🎯 ... | ⏱️ 0m | 🔧 Codex 0K | ⚠️ 1 | 🏷️ v1.4.1` (stdin 없을 때 — 💭 Claude 블록 생략)
4. env var gate + transcript_path 유효 상태에서는 `🎯 ... | ⏱️ ... | 💭 Claude <N>K | 🔧 Codex <N>K | ⚠️ ... | 🏷️ ...`.

## Non-goals

- stdin gate / env var 로직 변경 금지.
- 이모지 자체 교체 금지.
- Claude / Codex 외 다른 agent (Planner / Evaluator) 별도 표시 금지 — 기존 통합 유지.
