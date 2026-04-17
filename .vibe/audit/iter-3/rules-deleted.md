# iter-3 rules-deleted ledger

> 복원 결정은 dogfood8 post-acceptance 시점 `/vibe-review` 훅이 자동 findings 에 append.

## two-tier-audit-convention — Two-tier audit convention

- original_section_title: "### Two-tier audit convention"
- original_lines_in_CLAUDE_md: 59-65
- tier: B
- reason: "incident_count=0, gap-rule-only-in-md coverage"
- restoration_decision: pending
- original_text: |
    ### Two-tier audit convention

    - Lightweight per-sprint: `node scripts/vibe-audit-lightweight.mjs <sprintId>` runs automatically after sprint completion. It is non-blocking and writes INFO pendingRisks only when it finds drift signals.
    - Heavyweight per-N: Evaluator audit remains required when `sprintsSinceLastAudit >= audit.everyN` or open `audit-*` pendingRisks exist. `node scripts/vibe-preflight.mjs` blocks until `vibe-audit-clear` resolves the audit or an explicit `--ack-audit-overdue=<sprintId>:<reason>` is recorded.
    - `audit-skipped-mode` is an allowed user directive only when the user explicitly authorizes audit skipping; the Orchestrator must permanently record the reason in `session-log.md` with a `[decision]` tag.
    - `audit-skipped-mode` MUST be set through `node scripts/vibe-audit-skip-set.mjs` so gap-rule-only-in-md remains script-auditable and the directive expires automatically at read time.

---

## 실패-에스컬레이션 — 실패 에스컬레이션

- original_section_title: "## 실패 에스컬레이션"
- original_lines_in_CLAUDE_md: 200-210
- tier: C
- reason: "incident_count=0, no gap-* coverage"
- restoration_decision: pending
- original_text: |
    ## 실패 에스컬레이션

    새 트리거 매트릭스에서 escalation의 시작점은 **Evaluator 소환 자체**다.

    - Orchestrator self-QA 실패 → Evaluator Must 트리거 발동 → Evaluator 소환 (Tribunal)
    - Evaluator 불합격 → 사유 분석:
      - **스펙 문제** → Planner 재소환하여 체크리스트 수정
      - **구현 문제** → Generator 재위임 (구체적 수정 지시)
    - 2회 연속 불합격 → 사용자 에스컬레이션 (스펙 축소 / 기술 스택 변경 / 수동 개입 중 선택)
    - 최종 결과와 에스컬레이션 사유를 `docs/reports/`에 기록.

---

## 항상-지킬-것 — 항상 지킬 것 (세션 시작 시 반드시 확인)

- original_section_title: "## 항상 지킬 것 (세션 시작 시 반드시 확인)"
- original_lines_in_CLAUDE_md: 211-219
- tier: C
- reason: "incident_count=0, duplicated by preserved role constraints and sprint flow"
- restoration_decision: pending
- original_text: |
    ## 항상 지킬 것 (세션 시작 시 반드시 확인)

    - **코드 구현은 반드시 `Bash("... | ./scripts/run-codex.sh -")` 로 위임.** Agent 도구(Claude)로 코딩 위임 금지.
    - 비단순 작업은 먼저 계획을 제안.
    - 승인 전 구현하지 않음.
    - 완료 전 최소 범위 테스트와 self-QA 실행.
    - 루트 메모리는 얇게, 상세는 필요한 shard만 읽기.
    - 작업 종료 시 `docs/reports/`에 짧은 보고서.

---

## 필요할-때만-읽을-문서 — 필요할 때만 읽을 문서

- original_section_title: "## 필요할 때만 읽을 문서"
- original_lines_in_CLAUDE_md: 220-231
- tier: C
- reason: "incident_count=0, no gap-* coverage"
- restoration_decision: pending
- original_text: |
    ## 필요할 때만 읽을 문서
    - **오케스트레이션 역할×Phase 매트릭스: `docs/context/orchestration.md`** — Orchestrator는 Phase 0 시작 전 반드시 숙지
    - 제품/목표: `docs/context/product.md`
    - 아키텍처/디렉터리: `docs/context/architecture.md`
    - 코드 규칙: `docs/context/conventions.md`
    - QA 정책: `docs/context/qa.md`
    - 토큰/비용 정책: `docs/context/tokens.md`
    - 보안 정책: `docs/context/secrets.md`
    - Provider runner 세부: `docs/orchestration/providers.md`
    - Codex CLI 실행 배경: `docs/context/codex-execution.md`
    - 하네스 사각지대: `docs/context/harness-gaps.md`

---
