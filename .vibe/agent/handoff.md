# Orchestrator Handoff

ACTIVE UPSTREAM ITERATION — web-pro-bridge (iteration 1). 종료 시 이 파일을 pristine 템플릿 상태(project-not-initialized 마커 문구 포함 — git 이력 f2491be 이전 버전 참조)로 복원할 것 (roadmap 종료 조건 2).

## 1. Identity

- repo: `vibe-doctor` (upstream template — maintenance mode)
- iteration: 1 — web-pro-bridge (user /goal directive, soft freeze user-directive 진입)
- harnessVersion: `1.7.30` (iteration 종료 시 minor bump + release tag 예정)
- 모델 역할: Orchestrator=fable / Planner=fable / Generator=codex gpt-5.6-sol xhigh / Evaluator=fable (user directive 2026-07-15)
- 정본 설계: `docs/plans/web-pro-bridge/design.md` (Hybrid v2) + `vibe-pro-bridge-design/` 참조 패키지

## 2. Status

- roadmap: `sprint-vpb-01~05` (docs/plans/sprint-roadmap.md Iteration 1 섹션). 종료 조건 = Orchestrator 전체 workflow audit 반복 + 업스트림 릴리즈 마무리(상태 문서 pristine 복원, sync-manifest 등재, vibe:sync-audit 통과, 버전 bump + tag).
- sprint-vpb-01 (계약 스키마 + goal-source discovery): Generator 구현 완료. 검증 현황 — typecheck/gen-schemas(write+check)/build 통과, self-test는 template-hygiene 게이트가 활성 작업 상태와 충돌해 handoff 마커 전환으로 해소 중. 다음: self-test 재실행 → self-QA grep → Evaluator(Must, 신규 파일>5) → sprint-complete/commit.
- 알려진 회귀 (hotfix 대기): `vibe-agent-session-start.mjs`가 비-TTY stdin을 무조건 drain → run-codex.sh 파이프 프롬프트 소실. 우회 = Generator 호출 env `VIBE_SKIP_AGENT_SESSION_START=1` (모든 후속 Codex 호출에 필수). 근본 수정은 vpb-03 wiring Sprint에 편입 예정.
- Generator 호출 형식: `cat docs/prompts/<id>.md | VIBE_SKIP_AGENT_SESSION_START=1 VIBE_SPRINT_ID=<id> CODEX_MODEL=gpt-5.6-sol CODEX_EXTRA_CONFIG='-c model_reasoning_effort="xhigh"' ./.vibe/harness/scripts/run-codex.sh -`

## 3. Next Action

sprint-vpb-01 검증 마무리 → Evaluator → `vibe-sprint-complete.mjs sprint-vpb-01-contracts-discovery passed` → `vibe-sprint-commit.mjs`. 이후 vpb-02(composer+importer) Planner 소환부터 동일 루프 반복. 압축 복원 시 이 파일 + session-log + sprint-status 먼저 읽을 것.
