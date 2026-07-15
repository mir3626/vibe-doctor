# Orchestrator Handoff

ACTIVE UPSTREAM ITERATION 2 — web-pro-bridge remediation. 종료 시 pristine 템플릿 상태(project-not-initialized 마커 — 릴리즈 커밋 6051105의 handoff 참조)로 복원할 것.

## 1. Identity

- repo: `vibe-doctor` (upstream, v1.8.0 릴리즈됨 — 태그 불이동)
- iteration: 2 — 실 Pro 리뷰(AUD-20260715-tlo6jc) remediation
- 정본: `docs/plans/2026-07-15-web-pro-bridge-goal-audit-pro-review/` (REVIEW.md, FINDINGS.json P1×5 P2×4 P3×2, prompt/CLI_MAIN_SESSION_PROMPT.md 13-phase)
- 모델 역할: Orchestrator/Planner/Evaluator=fable, Generator=codex gpt-5.6-sol xhigh (호출 env: VIBE_SKIP_AGENT_SESSION_START=1 불필요 — v1.8.0에서 stdin 회귀 수정됨, 단 유지해도 무해)

## 2. Status

- roadmap Iteration 2: vpb-07(authority/binding) → vpb-08(lifecycle durability) → vpb-09(contract/polish) → 실 3-journey(사용자 참여) → 독립 audit → v1.8.1.
- 실측 확정: Pro 챗 GitHub 커넥터·MCP write 미가용(케이스 A/B 판별 미결 — Thinking 챗 교차 실측 대기), manual fallback 왕복 성공. design.md §12.1 기록.
- Immutable boundaries (remediation 프롬프트): 검증 약화 금지, 기존 결과 폴더/태그 불변, push는 명시 승인, P1 잔존 시 릴리즈 금지.
- Orchestrator 발견 seam 3건(sync 성공 오보 / cross-transport 바인딩 / patch 바이트 미전달)은 vpb-07·09에 편입.

## 3. Next Action

vpb-07 Planner 소환(sprint-planner, model fable) → Generator(CODEX_MODEL=gpt-5.6-sol, xhigh) → 검증 → Evaluator(fable) → complete/commit 루프. 압축 복원 시 이 파일 + session-log + sprint-status + roadmap Iteration 2 섹션 먼저 읽을 것.
