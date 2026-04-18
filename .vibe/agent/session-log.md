# Session Log — append-only 증분 저널

> Orchestrator가 **세션 중 발견한 비자명하고 압축 후에도 살려야 할 정보**를 즉시 append하는
> 버퍼. handoff.md가 "현재 상태 스냅샷"이라면 이건 "시간순 저널"이다. 기계적 compaction이
> 지우는 mid-session 결정·실패·관찰을 보존한다.

## 운영 규칙

- **Append only**. 기존 항목 수정·삭제 금지 (단, Sprint 종료 시 Orchestrator가 handoff에
  요약 흡수 후 `## Archived (<sprintId>)` 섹션으로 이동 → 물리 truncate).
- 각 항목은 한두 줄. 길어지면 파일/경로/링크만 남기고 본문은 해당 파일로.
- 형식: `- YYYY-MM-DDTHH:mm:ss.sssZ [tag] 내용`. full ISO8601 timestamp 권장 (`scripts/vibe-session-log-sync.mjs` 가 정규화).
- tag 예: `decision`, `failure`, `discovery`, `user-directive`, `drift-observed`, `sprint-complete`, `phase3-po-proxy`, `audit-clear`, `harness-review`.
- **언제 append하나**:
  - 사용자가 비자명한 선호·제약을 드러냈지만 memory로 승격하기엔 범위가 좁을 때
  - 실패·우회·임시 결정이 발생했고 그 이유가 코드/git에 남지 않을 때
  - Sprint 목표에서 의도적으로 벗어난 결정 (deviation)
  - context drift나 압축 이력을 스스로 감지했을 때
- **언제 append하지 않나**: git log/diff/코드에서 자명하게 복원 가능한 사실.

## Entries

- 2026-04-18T13:45:00.000Z [decision] [iter-4-kickoff] /vibe-iterate Phase 0~3 완료. review-6 (dogfood8 인계 기반, docs/reports/review-6-2026-04-18.md) 6 findings(#2~#7) + pending restoration 4건 carryover. Interview 자체가 review-6 `#2` coverage 누적 버그를 재현 → 14 rounds success_metric↔goal 무한 loop 후 `--abort` (O1 regression fixture 로 활용). iter-4 label=harness-stability-tune. Plan: O1 interview coverage fix (+80) → O2 script-wrapper triage #3/#4/#5 (+155) → O3 Planner 계약 + lockfile blacklist + pending restoration 판정 (+50). **Growth budget 1회 예외 승인 (+285 LOC)**: 사용자 명시 승인 (default +150 대비 iter-4 한정). 0 new scripts 유지. soft freeze posture 지속 (iter-5 부터 +150 복귀). Release 타깃 v1.4.2 (patch).
- 2026-04-18T13:30:00.000Z [user-directive] [growth-budget-exception-iter-4] 사용자 결정: iter-4 scope 3 slot 전부 수용 + growth budget 1회 예외 승인 (+285 LOC). 근거: review-6 findings 전부 처리 후 iter-5 부터 기존 +150 budget 로 복귀하는 것이 부분 처리 defer 누적보다 총 friction 작음. soft freeze 원칙(분기 1회) 위반 아님 — 같은 iter 내 예외 처리.
- 2026-04-18T10:00:00.000Z [user-directive] [timestamp-display-only] 사용자 결정 B: 모든 기록 timestamp 는 UTC ISO Z 유지. Display 만 KST (Asia/Seoul) 로 변환 — project-report.html 의 formatDate / formatDateTime 한정. 이유: (1) ISO Z 가 국제 표준, (2) cross-TZ 협업 / dogfood 프로젝트 호환 유지, (3) Zod schema datetime 검증 안정. 사용자 local 경험은 display layer 로 충분.
- 2026-04-18T06:30:00.000Z [user-directive] [orchestrator-direct-edit-css-perf] project-report.html 의 backdrop-filter / ambient-glow blur 150px / mix-blend-mode 가 compositor layer 폭증 유발하여 paint 무거움. 사용자가 "C 로 진행" = Orchestrator 직접 CSS 수정 허용 (두 번째 예외). 5 포인트 최적화: ambient-glow blur 축소, card 들의 backdrop-filter 제거 (sticky nav + sticky date header 만 유지), orb mix-blend 제거, orb animation scale 변형 제거, will-change 힌트 추가. 기대 효과: 초기 paint 수백ms → 수십ms. Core value 무관, single-file HTML 전략 유지 (Vite+React 마이그레이션 불필요).
- 2026-04-18T05:30:00.000Z [user-directive] [orchestrator-direct-edit-report-styling] report.html glassmorphism/luxury redesign 은 Orchestrator(Claude) 가 직접 수정하라고 명시. scripts/vibe-project-report.mjs 의 CSS/HTML shell 을 Codex 위임 없이 Edit 으로 재작성. 근거: (1) ref1/ref2/ref3 디자인 해석에 visual judgment 개입 필요, (2) 이전 Codex redesign 522s 의 속도-품질 trade-off 개선 시도. 이번 sprint 한정 예외 — 일반 소스코드 수정은 여전히 Codex 위임 원칙. 추가 directive: 주요 색상 grayscale (gray/white) 유지, iridescent orb 와 status badge tint 만 예외. iter-3 freeze posture 위반 아님 (downstream style patch, core value 무관).
- 2026-04-17T17:30:38.868Z [decision] [planner-skip] sprint=run-codex-windows-sandbox-skip reason=run-codex.sh Windows OS 감지 시 sandbox verify skip 헤더 prepend. 기존 _common-rules.md prepend 패턴 계승. 아키텍처 변동 없음. AC 3항목 기계 검증.
- 2026-04-17T17:08:21.319Z [decision] [planner-skip] sprint=statusline-format-tune reason=소모시간 두번째로 이동 + 에이전트 토큰 이모티콘 뒤에 이름 기입. 직전 iter-3.2 패턴 계승 + 아키텍처 변동 없음 + AC 3항목 기계 검증 가능.
- 2026-04-17T15:23:39.837Z [decision] [planner-skip] sprint=statusline-agent-emoji-patch reason=trivial exception 3조건 충족: patch-level statusline UX 개선 (agent-tracking + emoji). 아키텍처 변동 없음, 체크리스트 3항목 기계 검증 가능 (tsc/test/render smoke).
- 2026-04-17T08:55:07.338Z [sprint-complete] sprint-N3-freeze-mode-flag -> passed. Sprint sprint-N3-freeze-mode-flag completed with passed LOC +867/-22 (net +845)
- 2026-04-17T08:29:44.019Z [audit-clear] resolved=1 note=Evaluator (첫 소환, iter-3 milestone) audit completed: verdict=partial, blocking=0. 12/12 checks reviewed, 10 pass + 2 partial (dangling refs). Non-blocking findings resolved via Codex cleanup (README, product.md, qa.md, re-incarnation.md). N1 evidence-based rule audit + dogfood6~7 retrospective scan was the de-facto heavyweight audit for this cadence cycle.
- 2026-04-17T08:11:17.686Z [sprint-complete] sprint-N2-critical-bug-triage -> passed. Sprint sprint-N2-critical-bug-triage completed with passed LOC +840/-100 (net +740)
- 2026-04-17T07:47:15.809Z [sprint-complete] sprint-N1-rule-audit-diet -> passed. Sprint sprint-N1-rule-audit-diet completed with passed LOC +863/-52 (net +811)
- 2026-04-17T06:59:41.603Z [decision] [iter-3-kickoff] /vibe-iterate Phase 1~3 완료. Differential Interview 7 rounds (ambiguity terminate). 핵심 결정: (1) 28 rules 를 semantic cluster 단위로 재정의 + dogfood6~7 transcript retrospective 재스캔 기반 S/A/B/C tier 분류 + B/C delete + Should→Must 단일방향 격상. (2) Progressive MD — CLAUDE.md §0 Charter (file top) + §1+ Extensions pointer 재구조화. trigger matrix + wiring checklist + role 호출 표까지 Charter 포함 (agent self-containment). (3) Critical bug triage — sprint-commit archive staging + auto-tag production 검증 via artificial v1.4.1 bump + run-codex auto status-tick hook. (4) Soft freeze + mode flag human/agent 2-value define-only (분기 로직은 iter-4+ defer). Priority a>b>c>d. Growth budget: net +150 LOC / iter, 0 new scripts. Validation: Windows + macOS. Artifacts .vibe/audit/iter-3/ 격리. Core values 절대 보존. dogfood8 인계 프롬프트 작성 필수.
- 2026-04-17T03:50:07.756Z [decision] [iteration-2-closure] iteration-2 (v1.4.0) 3 sprints 완료: M-audit(bc8f90f) + M-process-discipline(20a612e) + M-harness-gates(4d9a002). harnessVersion 1.3.1→1.4.0 bump + iteration-history.json iter-2 entry append + v1.4.0 annotated tag 수동 생성. auto-tag 로직 production 검증은 다음 harness bump 시 자연 발생 예정. 27 uncovered rules(vibe-rule-audit) + gap-review-catch-wiring-drift는 iteration-3 candidate.
- 2026-04-17T03:26:24.039Z [sprint-complete] sprint-M-harness-gates -> passed. Sprint sprint-M-harness-gates completed with passed LOC +1147/-109 (net +1038)
- 2026-04-17T02:52:11.931Z [sprint-complete] sprint-M-process-discipline -> passed. Sprint sprint-M-process-discipline completed with passed LOC +2241/-796 (net +1445)
- 2026-04-17T00:14:16.000Z [decision] [m-audit-codex-fix] Codex 1차 위임 후 tsc 에러 4개 + 테스트 3개 실패. 원인: (1) 기존 테스트-Zod 타입 불일치, (2) Zod parse가 manual schemaVersion 체크보다 먼저 fail, (3) runLightweightAudit가 alreadyClosed에서도 실행. 2회 추가 Codex 위임으로 fix. total Codex tokens: 444K.
- 2026-04-17T00:14:05.802Z [sprint-complete] sprint-M-audit -> passed. Sprint sprint-M-audit completed with passed LOC +809/-22 (net +787)
- 2026-04-16T<iter-2-kickoff>Z [decision][iteration-2-seed] dogfood7 /vibe-review (review-10-2026-04-16.md) 흡수 후 iteration-2 roadmap 시드 (3 slot: M-audit / M-process-discipline / M-harness-gates). 사용자가 자율모드 아님 + 각 Sprint 시작 전 승인 + Zod v3 런타임 dep + planner.md → sprint-planner.md 교체 + §14 Wiring Checklist 전부 승인. dogfood7 review 의 M-spec-fix / M-arch-reconcile 은 project 이슈로 분리 — dogfood8 phase 0 seed 로 이월.
- 2026-04-16T<m-audit-planner>Z [decision][m-audit-planner-ready] M-audit Planner (opus) 소환 산출 = docs/prompts/sprint-M-audit.md (724 lines). Codex 위임 직전 사용자 세션 종료 요청. Codex 중간 산출 (schemas/ + audit-lightweight + migration 1.4.0 등) 은 zod 미설치 + implicit any 다수로 revert 완료. 재시작 시 sprint-M-audit.md 가 커밋된 상태에서 바로 `cat docs/prompts/sprint-M-audit.md | ./scripts/run-codex.sh -` 재위임 가능.
