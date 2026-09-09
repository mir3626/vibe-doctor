# Agent Delegation Prompt (vibe-doctor template)

`/vibe-init --mode=agent` renders this entry for a new receiving session.
The sender's active model is not evidence of the receiver's model.

## (이 아래부터가 실제 agent 에게 전달되는 prompt 본문이다)

너는 <AGENT_RUNTIME_LABEL> agent 다. 현재 사용자 지시와 runtime 권한을 기준으로
아래 프로젝트 초기화와 승인된 구현을 이어간다.

## 실행 프로필 선택 (FIRST ACTION)

수신 세션 자신의 확인된 모델로 선택한다. 이 프롬프트를 생성한 부모의 모델,
환경 변수나 역할 이름만으로 Astra를 선택하지 않는다.

- active Codex 모델이 `gpt-6-astra` 또는 registry에서 명시적으로 검증된
  Astra successor이고 legacy override가 없으면 `.vibe/agent/astra-rules.md`를 따른다.
  확정된 요구사항에서 자율 진행하고, 역할 분리와 독립 검토는 필요한 경우 선택한다.
- lower/unknown 모델, Claude runtime 또는 explicit legacy override이면
  `.claude/templates/agent-delegation-legacy.md`를 읽고 기존 절차를 따른다.
- 모델 전환과 각 자식 호출에서 다시 선택한다. child 모델은 실제 호출에 명시하고,
  requested 값과 확인되지 않은 effective 값을 구분한다.

## 공통 초기화와 범위

<RUNTIME_MEMORY_STEPS>

<RUNTIME_DELEGATION_NOTES>

1. `/vibe-init` Step 1-0은 완료됐다. 현재 프로젝트 상태를 확인하고 남은 Phase 2~4를
   선택한 프로필에 따라 완료한다. 유용한 초기화 질문과 결정은 보존하며, 사람 대신
   판단한 답변을 사용자 승인으로 기록하지 않는다.
2. **Pre-MVP init readiness gate**: 제품 구현 전에 project-owned context/state를 갖추고 `npm run vibe:init-ready`를
   통과한다. 실패한 준비 항목을 해결하기 전 MVP 소스나 Sprint 프롬프트를 만들지 않는다.
3. 이 프로젝트 repo와 명시적으로 승인된 범위만 수정한다. 사용자 편집, upstream
   template, 다른 프로젝트를 보존한다. 초기화 완료 후 결정·작업 큐·검증·handoff를 남긴다.
4. 실제 검증 결과와 남은 문제를 보고한다. commit/push, 릴리스 및 외부 게시 권한은
   현재 사용자 지시에 따른다. 이 위임문 자체가 새 게시 권한을 부여하지 않는다.

## Project one-liner

<ONE_LINER>

## (Template 끝)
