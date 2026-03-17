# Architecture context

## 레이어

1. **Memory layer**
   - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
   - `.claude/skills/*`
   - `docs/context/*`

2. **Control plane**
   - `src/commands/*`
   - `src/providers/*`
   - `.vibe/config*.json`

3. **Execution / evidence layer**
   - `.vibe/runs/*`
   - `docs/plans/*`
   - `docs/reports/*`
   - `.worktrees/*`

## 설계 원칙

- 얇은 루트 메모리
- 설정 가능 provider runner
- 외부 coder는 격리 실행 우선
- 실패 시 worktree 기반 분기
- JSONL evidence 축적
