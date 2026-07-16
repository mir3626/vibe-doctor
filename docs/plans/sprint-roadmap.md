# Sprint Roadmap

<!-- BEGIN:VIBE:CURRENT-SPRINT -->
> **Current**: sprint-vpb-11-metadata-diagnostics
> **Completed**: sprint-vpb-10-publish-facade
> **Pending**: sprint-vpb-12-auth-golden
<!-- END:VIBE:CURRENT-SPRINT -->

> Active file: current iteration only. Archived iteration roadmaps live under `docs/plans/archive/roadmaps/`.

## Iteration 3 — MCP write-path improvement (Pro 세션 설계 패키지, user directive)

정본: `vibe-doctor-mcp-write-improvement-v1.8.0/` (prompt/UPSTREAM_IMPLEMENTATION_PROMPT.md + specs/MCP-001~007). 대상 기준 v1.8.0이나 main은 iter-2(remediation, 16923cc..e63d9d3)로 전진 — 프롬프트 조항대로 전체 delta 검토 후 더 엄격한 신 동작 보존.
보존 불변: 기존 저수준 툴 유지, 기존 request/result 불변, hook·sprint·QA·GitHub write 정책 무변경, push/태그/배포는 명시 승인만.

### Sprint 목록

- **id**: `sprint-vpb-10-publish-facade`
  - **name**: publish_review_package 파사드 + fallback + 완료 계약 (MCP-001·002·003)
  - **목표**: 고수준 단일 호출 발행(공유 검증기 재사용·부분 result-ready 0·request/clientPublicationId/manifestHash 3중 멱등·지정 반환 필드) + 패키지 한도(기본 32파일/128KiB/단일 48KiB, 설정 가능)와 chunked-upload-required fallback 계약 + get_request 완료 계약 확장(publicationRequired/primaryFinalTool/chatOnlyOutputCompletesRequest=false) + 리뷰·설계 프롬프트 템플릿 갱신("result-ready 수신 전 미완료, chat 출력만으로 종료 금지")
  - **의존**: 없음
  - **예상 LOC**: ~700

- **id**: `sprint-vpb-11-metadata-diagnostics`
  - **name**: 도구 메타데이터 + 카탈로그 audit + 진단 (MCP-004·006)
  - **목표**: 전 도구 annotation(readOnly/destructive/openWorld/idempotent) + outputSchema + `_meta.ui.visibility`, "Use this when..." 서술 규격(금지 케이스 포함), 결정적 카탈로그 audit(누락 annotation·오분류·스키마 부재 FAIL), `bridge_capabilities` 읽기 도구, `$vibe-goal-audit doctor`(원시 tools/list 진단 — hook/QA 무결합)
  - **의존**: sprint-vpb-10
  - **예상 LOC**: ~600

- **id**: `sprint-vpb-12-auth-golden`
  - **name**: auth scope + golden 회귀 + 연결 영속화 (MCP-005·007 + 사용자 요청)
  - **목표**: noauth/OAuth 이중 프로파일 + per-tool scope 5종 + insufficient_scope 시 `_meta["mcp/www_authenticate"]` 표면 + golden prompt 데이터셋(자동화 가능분: 카탈로그 스냅샷·tool-selection 회귀) + **persistent connect code 옵트인·고정 터널 도메인 지원(ngrok --url)·code 회전 커맨드** — 앱 1회 등록 후 영구 재사용 (사용자 요청 2026-07-16)
  - **의존**: sprint-vpb-11
  - **예상 LOC**: ~700

### 종료 조건

1. 로컬 검증 완주(카탈로그 audit·tools/list·call 왕복·E2E import). 실 ChatGPT Developer Mode golden prompt·Refresh 절차·실 Goal audit 왕복은 사용자 참여 항목으로 분리 보고.
2. iter-2 remediation과 합산해 pristine 복원 + **v1.8.1** 릴리즈 (v1.8.0 태그 불이동, push는 기승인 directive).
