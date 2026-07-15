# Vibe Pro Bridge 설계 패키지

- Target upstream: `mir3626/vibe-doctor`
- Reviewed upstream HEAD: `f2f9512aeee62f0d13537e8b5fe99c8947a4bdd5`
- Reviewed harness version: `1.7.30`
- 설계일: 2026-07-15 KST

## 목적

두 환경 사이의 반복적인 수동 파일 이동을 제거한다.

```text
Codex CLI / vibe-doctor
  → 마지막 Goal 또는 새 설계 요청을 조사·패키징
  → ChatGPT Web Pro에 전달
  → GitHub 연결을 사용한 코드 리뷰·설계
  → 결과 패키지를 Bridge에 제출
  → CLI가 docs/plans/<folder>/ 로 안전하게 동기화
  → prompt/CLI_MAIN_SESSION_PROMPT.md 로 다음 Goal 실행
```

## 핵심 판단

### 공식 기능으로 활용할 수 있는 부분

- Codex App Server는 저장된 thread와 `/goal` 상태를 읽을 수 있다.
- ChatGPT Web의 Developer Mode는 Pro 계정에서 remote MCP의 read/write tool을 사용할 수 있다.
- ChatGPT GitHub 앱은 repository를 live read/search/cite할 수 있다.
- Codex plugin은 skill과 MCP-backed ChatGPT app을 함께 묶을 수 있다.
- 동일 ChatGPT developer-mode app ID를 Codex plugin에서 참조할 수 있다.
- Workspace Agents API는 선택적 자동 trigger 경로가 될 수 있다.
- Responses API의 최신 frontier model은 선택적 완전 자동 경로가 될 수 있다.

### 공식 기능만으로 바로 해결되지 않는 부분

현재 확인된 공식 인터페이스에는 개인용 ChatGPT Web Pro의 일반 대화를 CLI가 생성하고,
Pro mode를 강제로 선택하고, 완료 응답을 API로 직접 회수하는 안정적인 public API가 없다.

따라서 권장 MVP는 다음과 같다.

```text
자동:
  Goal 조사
  review request 생성
  Bridge 업로드
  GitHub scope 검증
  결과 다운로드
  docs/plans 원자적 설치

사용자 1회 동작:
  ChatGPT Web에서 Pro mode 대화를 열고
  @Vibe Pro Bridge 로 pending request를 선택
```

Workspace Agent 또는 API adapter가 사용 가능한 환경에서는 이 1회 동작도 제거할 수 있게
transport interface를 분리한다.

## 경량화 원칙

이 기능은 새로운 대형 assurance harness가 아니다.

- 새로운 hook 없음
- Sprint completion gate 변경 없음
- Stop QA 변경 없음
- 전체 workflow graph DSL 없음
- 기본 project test 추가 실행 없음
- 기존 `/vibe-review` 변경 최소화
- 두 개의 skill과 하나의 공용 bridge client 계약 중심
- remote bridge는 repository code를 저장하지 않음
- Web Pro는 GitHub connector로 code를 직접 읽음

## 패키지 구성

- `00_EXECUTIVE_DESIGN.md`
- `01_OFFICIAL_CAPABILITY_ASSESSMENT.md`
- `02_END_TO_END_WORKFLOWS.md`
- `03_TARGET_ARCHITECTURE.md`
- `04_GOAL_SOURCE_DISCOVERY.md`
- `05_BRIDGE_PROTOCOL.md`
- `06_MCP_APP_PLUGIN_SPEC.md`
- `07_GITHUB_SCOPE_AND_PROMPT_SPEC.md`
- `08_RESULT_PACKAGE_IMPORT_SPEC.md`
- `09_SKILL_AND_COMMAND_SPEC.md`
- `10_SECURITY_PRIVACY.md`
- `11_TEST_ACCEPTANCE.md`
- `12_ROLLOUT_AND_TRADEOFFS.md`
- `13_TRACEABILITY_MATRIX.md`
- `specs/VPB-001...VPB-008`
- `prompt/UPSTREAM_IMPLEMENTATION_PROMPT.md`
