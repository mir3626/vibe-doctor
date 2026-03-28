# Architecture context

<!-- 이 파일을 프로젝트 실제 구조에 맞게 수정하세요 -->

## 레이어

1. **Memory layer** — AI가 읽는 컨텍스트
   - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
   - `.claude/skills/*`
   - `docs/context/*`

2. **Control plane** — 오케스트레이션 실행
   - `src/commands/*`
   - `src/providers/*`
   - `.vibe/config*.json`

3. **Execution / evidence layer** — 실행 기록
   - `.vibe/runs/*`
   - `docs/plans/*`
   - `docs/reports/*`
   - `.worktrees/*`

## 설계 원칙

- 얇은 루트 메모리 — 상세 규칙은 shard로 분리
- Sprint 기반 개발 — Planner/Generator/Evaluator sub-agent 생성·소멸
- 설정 가능 provider runner — `.vibe/config.json` 기본값 + `.vibe/config.local.json` 로컬 override
- Generator(codex)는 격리 실행 우선
- Sprint 실패 시 Evaluator 판정 기반 에스컬레이션
- JSONL evidence 축적

## 프로젝트별 디렉터리 구조

<!-- 클론 후 실제 프로젝트 구조를 여기에 추가하세요 -->

```text
(프로젝트 디렉터리 구조를 여기에 작성)
```
