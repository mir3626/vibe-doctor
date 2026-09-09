# Legacy agent delegation workflow

Read this file only after the receiving session selects the legacy profile.
Astra sessions use `.vibe/agent/astra-rules.md` and do not load this workflow.
The runtime-specific entry instructions and project one-liner come from the
rendered delegation prompt. Keep current user authorization authoritative.

## 진행 지시

1. `/vibe-init` Phase 2 부터 이어받아 **자율 진행**. 사용자 개입 기대하지 마라.
   - Phase 2 Provider 배정 은 Step 2-1 Fast-path 기본값 수용 (`claude-opus` / `codex` /
     `claude-opus`). 이미 설정된 경우 재질문 없음.
   - Phase 3 native socratic interview 는 **PO-proxy 모드** 로 완주한다. `.vibe/harness/scripts/vibe-interview.mjs`
     파이프를 그대로 사용하되 각 라운드 answer 를 Orchestrator 가 생성. 종료 후
     `session-log.md` 에 `[decision][phase3-po-proxy]` 한 줄 기록.
   - Phase 4 Step 4-0 git init + 4-0a `vibe-phase0-seal.mjs` 수행.
   - Step 4-0b agent-delegation 권한 프리셋 자동 ON (`node .vibe/harness/scripts/vibe-sprint-mode.mjs on`).
   - Phase 3 Step 3-5 에서 Orchestrator 가 Sprint 로드맵 직접 작성 (위임 금지).
2. **Pre-MVP init readiness gate**: Phase 2~4 완료 후, Sprint/MVP 구현 또는 Generator 위임을
   시작하기 전에 반드시 `npm run vibe:init-ready` 를 실행한다.
   - 실패하면 출력된 항목을 고친 뒤 `npm run vibe:init-ready` 를 재실행한다.
   - 통과 전에는 `src/**`, `app/**`, `components/**`, `lib/**`, `docs/prompts/sprint-*` 등
     MVP 구현 산출물을 만들거나 수정하지 않는다.
   - 통과하면 `.vibe/agent/session-log.md` 에 `[decision][init-ready-gate] passed before MVP work`
     한 줄을 기록한다.
3. Sprint 로드맵은 **MVP 수준 3~5 sprint 이내**. 각 Sprint 목표 <500 LOC 지향.
4. 각 Sprint 시작 전 trivial exception 3 조건 자기 평가:
   - 직전 Sprint 패턴 그대로 계승
   - 아키텍처 결정 없음
   - 체크리스트 ≤ 3 항목 + 완전 기계 검증 가능
   3 조건 모두 충족 시 sprint-planner 소환 생략 + `node .vibe/harness/scripts/vibe-planner-skip-log.mjs
   <sprintId> <reason>` 실행. 하나라도 불확실하면 sprint-planner Agent 소환 (model opus).
5. Codex Generator 위임은 상수 — `Bash("cat docs/prompts/sprint-<id>-*.md |
   ./.vibe/harness/scripts/run-codex.sh -")` 형식 유지. Agent 도구로 코드 위임 금지.
6. 각 Sprint self-QA 1 회 통과 후 `node .vibe/harness/scripts/vibe-sprint-commit.mjs <sprintId> passed`.
7. Evaluator 는 `sprintsSinceLastAudit >= audit.everyN (기본 5)`, self-QA 실패, 비-executable AC, 또는 경험형 제품의 screenshot/playthrough/identity evidence 확인이 필요할 때 소환.
   프로토타입 면제 조건 (LOC < 2000 + self-QA pass) 충족 시 Should 트리거는 면제할 수 있지만, frontend/game/visual/canvas/WebGL/Three.js/editor/dashboard identity/payoff evidence 누락은 면제하지 않는다.
8. 모든 Sprint 완료 후 별도 `vibe-project-report.mjs` 재실행 금지. 마지막 `vibe-sprint-commit.mjs`
   이 내부적으로 report 를 생성하고 브라우저를 1회 오픈한다. 이미 열린 탭이 있는데
   report 만 다시 생성해야 하면 `node .vibe/harness/scripts/vibe-project-report.mjs --no-open` 사용.

## 제약 (Must)

- 본 프로젝트 repo 만 수정. **업스트림 vibe-doctor template 수정 금지.**
- `vibe-sync` 는 upstream 반영 확인용 read-only 로만 사용 (필요 시).
- `commit` 은 항상 `vibe-sprint-commit.mjs` 래퍼 사용. 단일 commit 원칙 + auto-tag.
- `git push` 는 **agent 가 수행하지 않는다** — 완료 보고 후 사용자가 직접 push.
- 다른 dogfood 프로젝트 디렉토리 건드리지 마라.
- Core values (interview / phase-sprint / sub-agent checkpoint / Codex delegation) 절대
  손상 금지. 특히 `.vibe/harness/scripts/vibe-interview.mjs`, `.vibe/harness/scripts/vibe-sprint-complete.mjs`,
  `.vibe/harness/scripts/vibe-sprint-commit.mjs`, `.vibe/harness/scripts/run-codex.{sh,cmd}` 건드리지 마라.
- Charter/Extensions invariant: Charter 와 Extensions contradict 금지. Charter-only
  rule 허용.

## 완료 보고

모든 Sprint 완료 후 사용자에게 다음 7 항목을 명시:

1. 총 소요 시간 + Codex token 사용량 (`.vibe/agent/tokens.json` 참조)
2. Planner skip 회수 / Planner 소환 회수 비율
3. Evaluator 소환 발동 여부 (발동 시 verdict)
4. `harnessVersion` bump 발생 시 auto-tag 자동 생성 여부 (`git tag -l`). bump 없으면
   "N/A — no upward delta" 로 보고.
5. session-log 의 `[failure]` / `[drift-observed]` incident 총 카운트
6. `.vibe/audit/iter-*/rules-deleted.md` 파일 존재 시, 프로젝트 진행 중 각 rule 의
   "실제 필요 여부" 판단 (복원 후보 rule id list)
7. mode=agent 로 진행 시 사용자 개입이 실제 몇 회 발생했는지 (이상적 = 0)

## Escalation

- Sprint 2 회 연속 불합격 → 사용자 에스컬레이션 (스펙 축소 / 기술 스택 변경 / 수동 개입
  중 선택). agent 혼자 판단으로 스펙 변경 금지.
- Codex sandbox 밖 검증 실패 (tsc / test 지속 fail) → 3 회 재위임 후에도 해결 안 되면
  에스컬레이션.
- 기타 ambiguity → Final report Deviations 에 기록 + 사용자 에스컬레이션.
