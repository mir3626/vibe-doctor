# Sprint Roadmap

<!-- BEGIN:VIBE:CURRENT-SPRINT -->
> **Current**: sprint-vpb-09-contract-polish
> **Completed**: sprint-vpb-07-authority-binding, sprint-vpb-08-lifecycle-durability
> **Pending**: -
<!-- END:VIBE:CURRENT-SPRINT -->

> Active file: current iteration only. Archived iteration roadmaps live under `docs/plans/archive/roadmaps/`.

## Iteration 2 — web-pro-bridge remediation (실 Pro 리뷰 기반, user directive)

정본: `docs/plans/2026-07-15-web-pro-bridge-goal-audit-pro-review/` (REVIEW.md + FINDINGS.json + prompt/CLI_MAIN_SESSION_PROMPT.md 13-phase — 충돌 시 remediation 프롬프트의 Immutable boundaries가 우선).
발견 매핑: P1×5(P1-001 동시성, P1-002 finalize crash, P1-003 install/ack 복구, P1-004 identity fail-open, P1-005 실증 증거) + P2×4 + P3×2 + Orchestrator 발견 seam 3건(sync 성공 오보, cross-transport requestId 바인딩, manual patch 바이트 미전달).

### Sprint 목록

- **id**: `sprint-vpb-07-authority-binding`
  - **name**: Fail-closed repository authority + 바인딩 seam (remediation Phase 2·7)
  - **목표**: P1-004(현재 repo 정체성 fail-closed — sync 전 경로·no-op·ack 적용, 고마찰 override + provenance 기록) + P2-002(web-origin unbound 명시 승인 게이트) + seam a(sync 성공 오보) + seam b(cross-transport requestId 바인딩) + identity/manual-trust 테스트 로스터
  - **의존**: 없음
  - **예상 LOC**: ~600

- **id**: `sprint-vpb-08-lifecycle-durability`
  - **name**: Mailbox 동시성 직렬화 + 재시작 안전 (remediation Phase 3·4·5, P3-001)
  - **목표**: P1-001(claim/begin/chunk/finalize/ack 원자성·fencing·stale owner 차단·PID 초과 유니크 tmp) + P1-002(finalize durable journal + 6-state 재시작 수렴) + P1-003(install→provenance 검증→멱등 ack 단일 워크플로우, --latest 점유 방지) + P3-001(health: empty/healthy/recovering/quarantined/migration — 손상 state 침묵 삭제 금지) + 동시성·crash-injection 테스트 로스터 전부
  - **의존**: sprint-vpb-07
  - **예상 LOC**: ~900

- **id**: `sprint-vpb-09-contract-polish`
  - **name**: 시맨틱 계약 + 토큰/리비전/App Server (remediation Phase 6·8a·9·10)
  - **목표**: P2-003(FINDINGS.json 버전드 스키마 + manifest 카운트 대조 + prompt 시맨틱 검증) + P2-004(one-time code → 단명 토큰 교환, 재사용 가능 capability URL 미출력) + P3-002(revN 일반화 + predecessor 해시 provenance) + P2-001(App Server 실측 후 구현 또는 unavailable 문서화 확정) + seam c(manual wire patch 전달)
  - **의존**: sprint-vpb-08
  - **예상 LOC**: ~600

### 종료 조건 (remediation 프롬프트 Phase 11~13)

1. 실 3-journey 수용 (사용자 참여 — Journey B는 GitHub 커넥터+MCP write 가용 챗 필요, 실측상 Pro 챗 미가용이면 stop-condition 보고로 대체)
2. 독립 whole-workflow audit (fresh context) P0/P1 0건
3. pristine 복원 + 전체 audit 통과 + v1.8.1 릴리즈 (기존 태그 불이동, push는 사용자 기승인 directive)
