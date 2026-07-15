# Goal: web-pro-bridge Phase 3~4 — Web-origin design + 옵션 자동화

> 선행 조건: Phase 2 머지 + mailbox dogfood 완료. 정본: `docs/plans/web-pro-bridge/design.md` §6.4~6.5. 상세: `vibe-pro-bridge-design/specs/VPB-007, VPB-008`, `02_END_TO_END_WORKFLOWS.md` §C~E.
> Phase 4는 **착수 전 사용자 명시 승인 필요** — 종량 과금(Responses API)과 외부 실행(codex cloud) 포함.

## Phase 3 — Web-origin design (VPB-007)

### 의도

CLI 요청 없이 웹 Pro에서 먼저 설계를 시작하고, CLI가 `sync --latest`로 가져온다. "웹 Pro 세션에서 설계하고 바로 CLI에서 구현 진행" 요구의 완성형.

### 구현 범위

1. mailbox에 web-origin request 생성 툴 추가 — 웹이 repository fullName·branch/head·goal을 지정해 request+result를 함께 생성 (`origin: "web"`, kind=feature_design).
2. CLI `$vibe-pro-design sync --latest` / `list` — 현재 repo fullName·unimported·result kind·생성 시간으로 매칭. **importer는 Phase 1 공용 그대로** (repo 정체성·SHA 바인딩 검증 포함 — 웹이 지정한 head가 로컬과 다르면 경고 후 사용자 판단).
3. 스킬 runbook: web-origin 세션 시작 전 `vibe:pro-mcp` 기동 안내 + 서버 없이 진행한 경우 vibe-bundle(`requestId: web-origin`) fallback 경로.

### 수용 기준

- [ ] `vibe:typecheck` / `vibe:self-test` 통과. web-origin 매칭 테스트(타 repo 결과 미매칭·기수입 제외·최신 우선).
- [ ] dogfood: 웹에서 설계 시작 → 결과 제출 → CLI `sync --latest` 설치 → `prompt/CLI_MAIN_SESSION_PROMPT.md` 사용 가능. 다운로드·복사·GitHub write 0.

## Phase 4 — 옵션 자동화 (VPB-008 + v1 apply 채널)

### 구현 범위

1. **WorkspaceAgentTransport** — published agent trigger(202-only)를 발사만 하고, **completion은 bridge status만 신뢰** (trigger 응답에서 결과 회수 시도 금지). 중복 trigger idempotency.
2. **ResponsesApiTransport** — 같은 request/result 스키마로 완전 자동 왕복. 명시 opt-in(config `proBridge.api.enabled`) + 실행 전 예상 비용 출력·확인 게이트 + 재시도 상한 1. reviewerDeclaration `surface: "responses-api"` 강제 — **Web Pro 리뷰로 사칭 금지.** API 키는 env만, model-registry에 openai provider 추가.
3. **codex cloud apply 채널** — `vibe:pro-apply <folder>`: 설치된 `prompt/CLI_MAIN_SESSION_PROMPT.md`를 `codex cloud exec --env <envId>`로 투입, `status/diff` 래핑까지만(자동 merge 금지). envId 미설정 시 설정 가이드 출력 후 정상 종료.

### 수용 기준

- [ ] transport 교체가 discovery·composer·importer 무변경으로 성립 (모듈화 최종 검증 — VPB-008 DoD)
- [ ] API mock 테스트: 툴 실패가 result-ready로 이어지지 않음 / 비용 게이트 동작 / declaration 기록
- [ ] Workspace Agent: 중복 trigger 멱등, bridge status가 유일 completion 소스
- [ ] provenance에 `web:pro-mode` vs `responses-api` vs `workspace-agent` 구분 기록 확인
