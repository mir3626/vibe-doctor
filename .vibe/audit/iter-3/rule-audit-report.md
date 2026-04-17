# iter-3 rule audit report

timestamp: 2026-04-17T07:31:21.492Z
tool version: scripts/vibe-rule-audit.mjs iter-3 N1
sources: C:\Users\Tony\Workspace\dogfood6, C:\Users\Tony\Workspace\dogfood7

| cluster_id | cluster_label | cluster_lines | evidence_count | evidence_examples | tier | recommended_action | should_to_must_candidate | tightening_suggestion |
|---|---|---|---|---|---|---|---|---|
| lines-25-26 | lines-25-26 | 25-26 | 0 |  | A | keep-md-only | false |  |
| lines-27-28 | lines-27-28 | 27-28 | 2 | - 2026-04-13T00:00 [decision] harness-sync: 하네스 싱크 메커니즘 설계 완료. 3-tier 전략: (1) section-merge(마커 있는 프로젝트), (2) sidecar full-replace(레거시), (3) json-deep-merge(s...<br>- 2026-04-13T00:00 [decision] CLAUDE.md에 7개 HARNESS 섹션 마커 + PROJECT:custom-rules 추가. 토큰 오버헤드 ~200 tokens (4-5%). | A | keep-md-only | false |  |
| lines-33-34 | lines-33-34 | 33-34 | 0 |  | A | keep-md-only | false |  |
| lines-41-42 | lines-41-42 | 41-42 | 13 | - 2026-04-15T08:45 [decision][phase3-po-proxy] Phase 3 완주 (self-conducted). Ouroboros MCP tool이 본 세션 deferred pool에서 unavailable (서버 connected이나 tool list fr...<br>- 2026-04-15T08:40 [decision] 프로젝트 피벗: dogfood6 = bumpy game (모바일 웹, HTML5 Canvas). vibe-doctor 템플릿의 상위 하네스(.vibe/, src/commands, scripts/)는 유지, 새 `game/` 서브...<br>- 2026-04-10T08:30 [decision] self-evolution-3: Planner 역할 확장 — 기술 사양(타입·API·파일구조) + Sprint 프롬프트 초안을 Planner가 출력하도록 CLAUDE.md 변경. Sprint 프롬프트 작성 원칙 섹션 추가. | S | keep-script | false |  |
| lines-49-50 | lines-49-50 | 49-50 | 3 | - 2026-04-15T08:45 [decision][phase3-po-proxy] Phase 3 완주 (self-conducted). Ouroboros MCP tool이 본 세션 deferred pool에서 unavailable (서버 connected이나 tool list fr...<br>- 2026-04-16T04:50:00.000Z [decision] [phase3-po-proxy] Phase 3 네이티브 인터뷰 7라운드 완료 (ambiguity 0.18). Orchestrator가 PO 관점에서 domain_specifics/data_model/target_u...<br>- 2026-04-16T04:48:30.000Z [decision] Phase 2 fast-path — 사용자 "자율" 요청 + config.local.json 기본값(claude-opus/codex/claude-opus)을 그대로 수용. Windows-native 경로(codex... | S | keep-script | false |  |
| lines-95-96 | lines-95-96 | 95-96 | 13 | - 2026-04-15T08:45 [decision][phase3-po-proxy] Phase 3 완주 (self-conducted). Ouroboros MCP tool이 본 세션 deferred pool에서 unavailable (서버 connected이나 tool list fr...<br>- 2026-04-15T08:40 [decision] 프로젝트 피벗: dogfood6 = bumpy game (모바일 웹, HTML5 Canvas). vibe-doctor 템플릿의 상위 하네스(.vibe/, src/commands, scripts/)는 유지, 새 `game/` 서브...<br>- 2026-04-10T08:30 [decision] self-evolution-3: Planner 역할 확장 — 기술 사양(타입·API·파일구조) + Sprint 프롬프트 초안을 Planner가 출력하도록 CLAUDE.md 변경. Sprint 프롬프트 작성 원칙 섹션 추가. | S | keep-script | false |  |
| lines-119-120 | lines-119-120 | 119-120 | 2 | - 2026-04-16T04:50:00.000Z [decision] [phase3-po-proxy] Phase 3 네이티브 인터뷰 7라운드 완료 (ambiguity 0.18). Orchestrator가 PO 관점에서 domain_specifics/data_model/target_u...<br>- 2026-04-16T04:48:30.000Z [decision] Phase 2 fast-path — 사용자 "자율" 요청 + config.local.json 기본값(claude-opus/codex/claude-opus)을 그대로 수용. Windows-native 경로(codex... | A | keep-md-only | false |  |
| lines-139-140 | lines-139-140 | 139-140 | 0 |  | A | keep-md-only | false |  |
| lines-145-146 | lines-145-146 | 145-146 | 4 | - 2026-04-10T08:30 [decision] self-evolution-3: Planner 역할 확장 — 기술 사양(타입·API·파일구조) + Sprint 프롬프트 초안을 Planner가 출력하도록 CLAUDE.md 변경. Sprint 프롬프트 작성 원칙 섹션 추가.<br>- 2026-04-13T00:00 [decision] harness-sync: 하네스 싱크 메커니즘 설계 완료. 3-tier 전략: (1) section-merge(마커 있는 프로젝트), (2) sidecar full-replace(레거시), (3) json-deep-merge(s...<br>- 2026-04-13T00:00 [decision] SessionStart 훅으로 자동 버전 체크. git ls-remote + 24h 캐시. 실패 시 조용히 무시. | S | keep-script | false |  |
| lines-147-148 | lines-147-148 | 147-148 | 0 |  | A | keep-md-only | false |  |
| lines-155-156 | lines-155-156 | 155-156 | 3 | - 2026-04-15T08:45 [decision][phase3-po-proxy] Phase 3 완주 (self-conducted). Ouroboros MCP tool이 본 세션 deferred pool에서 unavailable (서버 connected이나 tool list fr...<br>- 2026-04-09T00:00 [decision] self-evolution-1 착수. 사용자가 A1(기계적 오버라이드 글로벌 이전) 거부 — 템플릿 배포 대상이라 프로젝트 내 유지. 나머지 A2~A5 + B1~B6 전부 승인.<br>- 2026-04-16T04:50:00.000Z [decision] [phase3-po-proxy] Phase 3 네이티브 인터뷰 7라운드 완료 (ambiguity 0.18). Orchestrator가 PO 관점에서 domain_specifics/data_model/target_u... | S | keep-script | false |  |
| lines-157-158 | lines-157-158 | 157-158 | 3 | - 2026-04-15T08:45 [decision][phase3-po-proxy] Phase 3 완주 (self-conducted). Ouroboros MCP tool이 본 세션 deferred pool에서 unavailable (서버 connected이나 tool list fr...<br>- 2026-04-16T04:50:00.000Z [decision] [phase3-po-proxy] Phase 3 네이티브 인터뷰 7라운드 완료 (ambiguity 0.18). Orchestrator가 PO 관점에서 domain_specifics/data_model/target_u...<br>- 2026-04-16T04:48:30.000Z [decision] Phase 2 fast-path — 사용자 "자율" 요청 + config.local.json 기본값(claude-opus/codex/claude-opus)을 그대로 수용. Windows-native 경로(codex... | S | keep-script | false |  |
| lines-163-164 | lines-163-164 | 163-164 | 2 | - 2026-04-16T04:50:00.000Z [decision] [phase3-po-proxy] Phase 3 네이티브 인터뷰 7라운드 완료 (ambiguity 0.18). Orchestrator가 PO 관점에서 domain_specifics/data_model/target_u...<br>- 2026-04-16T04:48:30.000Z [decision] Phase 2 fast-path — 사용자 "자율" 요청 + config.local.json 기본값(claude-opus/codex/claude-opus)을 그대로 수용. Windows-native 경로(codex... | A | keep-md-only | false |  |
| lines-201-202 | lines-201-202 | 201-202 | 0 |  | A | keep-md-only | false |  |
| lines-205-206 | lines-205-206 | 205-206 | 0 |  | A | keep-md-only | false |  |
| lines-213-214 | lines-213-214 | 213-214 | 0 |  | A | keep-md-only | false |  |
| lines-223-224 | lines-223-224 | 223-224 | 0 |  | A | keep-md-only | false |  |
| lines-225-226 | lines-225-226 | 225-226 | 0 |  | A | keep-md-only | false |  |
| lines-227-228 | lines-227-228 | 227-228 | 0 |  | A | keep-md-only | false |  |
| lines-233-234 | lines-233-234 | 233-234 | 0 |  | A | keep-md-only | false |  |
| lines-235-236 | lines-235-236 | 235-236 | 0 |  | A | keep-md-only | false |  |
| lines-247-248 | lines-247-248 | 247-248 | 2 | - 2026-04-13T00:00 [decision] CLAUDE.md에 7개 HARNESS 섹션 마커 + PROJECT:custom-rules 추가. 토큰 오버헤드 ~200 tokens (4-5%).<br>- 2026-04-09T00:00 [decision] `project_self_evolution.md` memory shard 삭제 — handoff.md와 내용 이중 주입되던 startup 예산 낭비. | A | keep-md-only | false |  |

## Summary
total=22; byTier=S=6, A=16, B=0, C=0, unclassified=0; sourcesScanned=2; missingSources=0

## Sources scanned
- C:\Users\Tony\Workspace\dogfood6: present=true; failure=0; drift-observed=0; decision=10; audit-clear=0
- C:\Users\Tony\Workspace\dogfood7: present=true; failure=0; drift-observed=0; decision=3; audit-clear=0

## Restoration protocol
dogfood8 post-acceptance 시 본 report + `rules-deleted.md` 를 함께 리뷰한다. 복원 필요 cluster 는 CLAUDE.md 에 재삽입 후 `.vibe/audit/iter-3/` 를 `rm -rf` 한다.
