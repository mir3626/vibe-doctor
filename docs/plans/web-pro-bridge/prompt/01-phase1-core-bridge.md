# Goal: web-pro-bridge Phase 1 — 코어 브릿지 (discovery + composer + importer + manual transport)

> 정본 문서: `docs/plans/web-pro-bridge/design.md` (Hybrid v2 — 충돌 시 본 프롬프트보다 우선).
> 상세 스펙 참조: `vibe-pro-bridge-design/` 패키지 — 특히 `04`(goal discovery), `05`(프로토콜 스키마), `07`(GitHub scope·프롬프트 템플릿), `08`(결과 패키지·importer), `09`(스킬 UX), `10`(보안), `11`(테스트). 단 design.md §2 매트릭스의 하이브리드 결정(local-first, vibe-bundle wire, 하네스 통합 방식)이 Pro 패키지 원문보다 우선한다.
> 착수 기록: session-log `[decision]` — soft freeze user-directive 진입.

## 의도

서버·터널 없이 오늘 동작하는 왕복을 만든다: 마지막 goal 발견 → bounded 리뷰 요청 생성 → 클립보드+브라우저 핸드오프 → 웹 Pro 리뷰(GitHub 커넥터) → vibe-bundle 클립보드 복귀 → 검증·원자적 설치. 수동 동작은 전송 클릭 1 + 결과 복사 1.

## 구현 범위 (VPB-001/002/005/006 + manual transport)

1. **스키마** `src/lib/schemas/pro-bridge.ts` — `GoalSourceManifest`(vibe-goal-source-v1), `ReviewRequest`(vibe-pro-review-request-v1), `ReviewResultManifest`(vibe-pro-review-result-v1)를 Pro `04`·`05` 정의대로 zod로. 기존 `schemas/index.ts` 패턴 합류, `vibe:gen-schemas --check` 통과.
2. **Goal Source Resolver** `src/pro-bridge/goal-source/` — provider 체인 4종 (design.md §4):
   - CodexAppServerGoalProvider: App Server JSON-RPC 실측 후 구현. **표면이 다르거나 불가하면 이 provider만 stub(명시적 unavailable)으로 두고 진행** — 체인 계약은 불변.
   - VibeGoalIterateProvider / HandoffHistoryProvider / GitReconstructionProvider: 실존 state 파일 경로는 design.md §4 목록. confidence(exact|high|reconstructed) + unresolved[] 필수. private reasoning 파싱 금지.
   - scope 분류: changed/code/test/migration/docs + diffScope vs reviewExpansionHints 이원화.
3. **GitScopeResolver + PromptComposer** `src/pro-bridge/{scope-resolver,prompt-composer}.ts`
   - visibility gate: base/head 원격 존재 확인, 케이스 분기(pushed-clean / 미푸시 / dirty). **암묵 push 금지** — 미푸시면 secret-safe patch 첨부 또는 push 승인 질의.
   - patch 규칙: unified diff, config 상한, 바이너리·secret 경로 제외, roster+SHA.
   - 프롬프트: Pro `07` §4 A~I 골격 + §5 리뷰 차원(goal-audit 12 / design 8) + v1 커넥터 경고 블록(design.md §7.2 인용문) + 프롬프트 인젝션 경계(Pro `10` §5) + 응답 계약(vibe-bundle v1 포맷 전문 + 필수 파일 로스터).
4. **ResultImporter** `src/pro-bridge/importer.ts` — Pro `08` 전체: allowed-path 정책, 해시·repo·SHA 바인딩 검증, UTF-8 검증, `.tmp-<id>` → rename 원자 설치, 동일 해시 no-op / 상이 해시 거부(승인 시 `-rev2`), `.bridge/provenance.json`, 설치 후 다음 행동 안내만 출력(자동 구현 시작 금지).
5. **ManualDirectoryTransport** `src/pro-bridge/transports/{types,manual}.ts` — `VibeProBridgeTransport` 인터페이스(design.md §6.1) + manual 구현: outbox 생성, 프롬프트 클립보드 복사(Windows `Set-Clipboard` + POSIX fallback), `chatgpt.com` 오픈(+선택 `?q=` 짧은 부트스트랩 — 실패 무해한 편의로만), vibe-bundle 파서(라인 앵커 separator, `files:` 교차검증, `VIBE:END` 센티널, requestId 바인딩)로 클립보드/`--from <file>` ingest → 공용 importer 위임.
6. **커맨드·스킬** — `src/commands/pro-bridge.ts` + 신규 스크립트 `.vibe/harness/scripts/vibe-pro-bridge.mjs` **1개만**. npm `vibe:pro-audit`, `vibe:pro-design`. 스킬 `.claude/skills/{vibe-goal-audit,vibe-pro-design}/SKILL.md`: Pro `09` UX(default 상태 분기, send/status/sync/cancel/list, 실패 모드 4종) + 1회성 셋업 체크리스트(GitHub 앱 설치·repo 승인·인덱싱 트리거) + 전송 전 외부 발행 고지. `.codex/skills/` wrapper + shard 블록 규약.
7. **config** — `proBridge` 섹션(transport/resultRoot/requestTtlHours/maxPatchBytes/openBrowser/copyInvocation/githubRequired, 기본 transport `manual`) + config zod 확장. state 디렉토리 `.vibe/pro-bridge/` gitignore 등록.

## 하지 않는 것

- MCP 서버·터널·ChatGPT 앱 (Phase 2) / web-origin (Phase 3) / Workspace Agent·Responses API·codex cloud (Phase 4).
- hook·Stop QA·PreCompact·sprint-complete·sprint-commit·vibe:qa 변경 일절 금지. 미사용 시 오버헤드 0.
- 브라우저 DOM 자동화·자동 제출·모델 피커 자동화 — 어떤 형태로도 금지.
- 자동 git push, GitHub write, repo 소스 미러링, 결과 자동 구현.

## 수용 기준 (기계 검증 — Pro `11` §1~3,5 발췌)

- [ ] `vibe:typecheck` / `vibe:self-test` / `vibe:gen-schemas --check` 통과
- [ ] goal discovery fixture: vibe-goal-iterate 완료 큐 / handoff 재구성 / dirty·미푸시 브랜치 / App Server 부재 → 올바른 objective·base/head·scope 분류·confidence
- [ ] composer: 정확한 repo/refs, GitHub 사용 지시, 원본 설계 포함, 12차원 존재, 출력 계약 존재, secret 미포함, bounded 크기
- [ ] importer 보안: 경로 탈출·절대경로·비UTF-8·repo 불일치·SHA 불일치·기존 폴더 충돌·동일 결과 no-op·rename 전 실패 원자성·필수 prompt 누락·FINDINGS 파싱 실패 → 전부 거부/올바른 처리
- [ ] vibe-bundle 파서: 정상 / `VIBE:END` 부재 / files 수 불일치 / requestId 불일치 / allowlist 밖 경로 → 거부
- [ ] E2E mock: discover → request → mock 번들 → sync → `docs/plans/<folder>/` 설치 + `prompt/CLI_MAIN_SESSION_PROMPT.md` 존재 + 해시 reconcile

## 수용 기준 (inspection / dogfood)

- [ ] 실왕복 1회: `$vibe-goal-audit` → 웹 Pro(GitHub 커넥터) → 번들 복사 → sync 성공. **실측 2건 기록**: Codex App Server goal API 표면, Pro 모드 챗의 커넥터 가용성 → design.md §12 추기
- [ ] Final report `## Wiring Integration` W1~W14/D1~D6 대조 (sync-manifest·CLAUDE.md·harness-gaps `gap-web-pro-bridge` 포함)

## 유의사항

- Windows 우선(PowerShell clipboard) + POSIX fallback. 패킷·번들 UTF-8 고정.
- transport 계약을 지켜라: Phase 2에서 mailbox로 갈아끼울 때 discovery·composer·importer가 무변경이어야 한다 — 이것이 모듈화 수용 기준.
