# Sprint Roadmap

<!-- BEGIN:VIBE:CURRENT-SPRINT -->
> **Current**: sprint-vpb-03-manual-transport-skills
> **Completed**: sprint-vpb-01-contracts-discovery, sprint-vpb-02-composer-importer
> **Pending**: sprint-vpb-04-mcp-mailbox, sprint-vpb-05-web-origin-optional
<!-- END:VIBE:CURRENT-SPRINT -->

> Active file: current iteration only. Archived iteration roadmaps live under `docs/plans/archive/roadmaps/`.

## Iteration 1 — web-pro-bridge (upstream harness maintenance, user directive)

정본 설계: `docs/plans/web-pro-bridge/design.md` (Hybrid v2). 상세 스펙 참조: `vibe-pro-bridge-design/` 패키지.
모델 역할: Orchestrator=fable / Planner=fable / Generator=codex(gpt-5.6-sol, reasoning xhigh) / Evaluator=fable (user directive 2026-07-15).

### Sprint 목록

- **id**: `sprint-vpb-01-contracts-discovery` ✅ passed
  - **name**: 계약 스키마 + Goal Source Discovery
  - **목표**: zod 스키마 3종(GoalSourceManifest/ReviewRequest/ReviewResultManifest) + vibe-bundle v1 파서 + GoalSourceProvider 체인 4종(App Server stub 허용) + fixture 테스트
  - **의존**: 없음
  - **예상 LOC**: ~650

- **id**: `sprint-vpb-02-composer-importer`
  - **name**: Scope Resolver + Prompt Composer + Result Importer
  - **목표**: GitHub visibility gate + secret-safe patch + 리뷰 프롬프트 템플릿(A~I, 12차원, 커넥터 경고, 인젝션 방어) + 원자적 설치 importer(allowlist·해시 바인딩·충돌 규칙·provenance)
  - **의존**: sprint-vpb-01
  - **예상 LOC**: ~650

- **id**: `sprint-vpb-03-manual-transport-skills`
  - **name**: Manual Transport + 커맨드 + 스킬 (Phase 1 완성)
  - **목표**: VibeProBridgeTransport 인터페이스 + ManualDirectoryTransport(클립보드/브라우저) + `vibe-pro-bridge.mjs` 커맨드 + config proBridge 섹션 + 스킬 4종(.claude/.codex × goal-audit/pro-design) + sync-manifest/CLAUDE.md wiring + E2E mock + session-start stdin drain 회귀 hotfix
  - **의존**: sprint-vpb-02
  - **예상 LOC**: ~700

- **id**: `sprint-vpb-04-mcp-mailbox`
  - **name**: local-first MCP Mailbox (Phase 2)
  - **목표**: streamable-HTTP MCP 서버 11-tool(lifecycle·idempotency·chunking·해시 검증) + single-tenant 토큰 + 터널 helper + `vibe:pro-mcp` + Developer Mode 셋업 문서 + 통합 테스트
  - **의존**: sprint-vpb-03
  - **예상 LOC**: ~700

- **id**: `sprint-vpb-05-web-origin-optional`
  - **name**: Web-origin design + 옵션 어댑터 (Phase 3~4)
  - **목표**: web-origin request 생성 툴 + `sync --latest` 매칭 + WorkspaceAgentTransport + ResponsesApiTransport(비용 게이트) + `vibe:pro-apply` + provenance surface 구분
  - **의존**: sprint-vpb-04
  - **예상 LOC**: ~600

### 종료 조건

1. 전 Sprint 완료 후 Orchestrator가 design.md 대비 전체 workflow audit를 직접 수행하고, 불일치 발견 시 수정 Sprint(`sprint-vpb-06-audit-fix-N`)를 반복해 설계 부합까지 진행한다 (user /goal directive).
2. **업스트림 릴리즈 마무리** (user directive 2026-07-15): 프로젝트 소유 상태 문서(session-log/sprint-status/handoff/roadmap iteration 섹션)를 template-clean 상태로 복원, 신규 파일 전부 sync-manifest 등재 + `vibe:sync-audit` 통과, harnessVersion bump + release tag — downstream 프로젝트가 `vibe:sync`로 동일 기능을 받을 수 있어야 한다.
