# vibe-doctor 메타-프로젝트 Sprint Roadmap — v1.2.0 하네스 진화

<!-- BEGIN:VIBE:CURRENT-SPRINT -->
> **Current**: idle (not started, started 2026-04-16)
> **Completed**: sprint-M6-pattern-shards, sprint-M5-native-interview, sprint-M4-model-tier, sprint-M3-sprint-flow-automation, sprint-M2-platform-wrappers, sprint-M1-schema-foundation, v1.1.0-process-refactor, harness-sync, self-evolution-2
> **Pending**: —
<!-- END:VIBE:CURRENT-SPRINT -->

## 배경

dogfood6 (bumpy game) 5-Sprint 실사용 + 이후 리뷰 과정에서 도출된 **23개 개선안** 을
vibe-doctor 자체에 적용한다. 리뷰 원본: `docs/plans/dogfood6-improvements.md` 는
v1.1.0 반영 완료 (이미 commit). 본 로드맵은 그 이후 발견된 상위 층 개선을 다룬다.

**self-hosting 검증**: 이 메타-프로젝트 자체를 vibe-doctor 프로세스(Planner → Generator → re-verify)
로 수행하여 개선점을 dogfood. 완료 시 v1.2.0 릴리스.

**유지 철학**: 범프로젝트 템플릿 (웹/모바일/데이터/CLI/하드웨어 등 어느 도메인이든). 테스트·lint·번들 등 stack 특이 지시는 항상 **shard 파일로 분리**.

---

## 전체 범위 요약

- **총 Sprint**: 10
- **총 예상 LOC**: 3500~5000 (프로덕션 2500~3500 + 테스트 1000~1500)
- **예상 기간**: 연속 실행 시 하루 (dogfood 세션 기준)
- **릴리스 타깃**: v1.2.0 (minor bump — 새 기능 다수, breaking change 없음)

---

## Sprint M1 — Schema foundation (state files)

- **id**: `sprint-M1-schema-foundation`
- **목표**: `sprint-status.json` 스키마를 확장하고 machine-readable state 파일 2종 (project-map, sprint-api-contracts) 을 도입하여 이후 모든 Sprint 의 기반이 되는 state 레이어를 확립.
- **산출**:
  - `sprint-status.schema.json` 업데이트: `pendingRisks[]`, `lastSprintScope[]`, `lastSprintScopeGlob[]`, `sprintsSinceLastAudit: number`, `stateUpdatedAt`, `verifiedAt`
  - `.vibe/agent/project-map.json` 초기 파일 + AST scan-based 갱신 로직 (`src/lib/project-map.ts`)
  - `.vibe/agent/sprint-api-contracts.json` 초기 파일 + exports/imports 추출 로직
  - `scripts/vibe-sprint-complete.mjs` 가 3종 state 파일 자동 갱신
  - `scripts/vibe-preflight.mjs` 의 `handoff.stale` 판정 재작성 (Item 17 — INFO 강등 + 30s tolerance)
  - `migrations/1.1.0.mjs` — 기존 sprint-status.json 을 새 스키마로 마이그레이션
  - `src/lib/sprint-status.ts` 신규 (schema 검증 + CRUD helper)
  - Manifest 업데이트: 신규 파일 `harness` 목록 추가
  - 테스트: `test/sprint-status.test.ts`, `test/project-map.test.ts`
- **의존**: 없음 (first sprint)
- **예상 LOC**: ~500 (코드 ~330 + 테스트 ~170)
- **완료 기준**:
  - `npx tsc --noEmit` 0 errors
  - `npm test` 기존 + 신규 테스트 모두 pass
  - `node scripts/vibe-preflight.mjs --bootstrap` green
  - `migrations/1.1.0.mjs` 가 샘플 legacy sprint-status.json 을 올바르게 변환 (unit test)
  - Manifest 업데이트 검증: `vibe-sync --dry-run` 시 신규 파일 `new-file` action 로 인식

---

## Sprint M2 — Platform wrappers + sandbox exclusions + retry visibility

- **id**: `sprint-M2-platform-wrappers`
- **목표**: `run-codex.{sh,cmd}` 를 provider-agnostic wrapper 로 일반화. `_common-rules.md` 에 sandbox exclusion 명문화. retry/시간/토큰 가시성 추가.
- **산출**:
  - `scripts/run-codex.sh` 에 `--health` / `--version` 서브커맨드 추가 (exit code 기반 health check)
  - `scripts/run-codex.cmd` 신규 (Windows 네이티브 셸 동등 계약)
  - `scripts/vibe-preflight.mjs` 의 `provider.codex` 헬스체크가 config command 직접 호출이 아닌 wrapper `--health` 로 변경
  - `.vibe/agent/_common-rules.md` 에 `§N Sandbox-bound Generator invariants` 섹션 추가 — 어떤 Generator provider 든 샌드박스 하 미수행 명령 목록 (package manager, integration test runner, build, browser smoke)
  - `scripts/run-codex.sh` retry 로깅: stderr 로 `[run-codex] attempt N/M retrying reason=...`, 최종 라인 `total attempts=X elapsed=Y tokens=Z`
  - 일반화 준비: `scripts/run-claude.{sh,cmd}` / `scripts/run-gemini.{sh,cmd}` 템플릿 — 실제 스크립트는 현재 claude-opus 가 Agent 도구로 호출되므로 wrapper 불필요하지만, 미래 비-Claude provider 용 템플릿만 두기
  - 테스트: `test/run-codex-wrapper.test.ts` — exit code / stderr 포맷 검증 (mock 기반)
  - Manifest 업데이트
- **의존**: 없음 (parallel OK with M1, sequential here)
- **예상 LOC**: ~350 (shell+tests)

---

## Sprint M3 — Sprint flow automation

- **id**: `sprint-M3-sprint-flow-automation`
- **목표**: 인간 실수 지점(commit 누락, session-log disorder, prompts clutter) 제거. 단일-커밋 원칙을 스크립트 레벨로 강제.
- **산출**:
  - `scripts/vibe-sprint-commit.mjs` 신규 — `<sprintId> <passed|failed> [--scope <glob>]` 호출 시:
    1. `vibe-sprint-complete` 위임 (state 파일 갱신 + `lastSprintScope` 기록)
    2. staged 파일 + state 파일 자동 stage
    3. 템플릿 commit message 생성 (LOC, 검증 결과, risks resolved 자동 삽입)
    4. `git commit` 실행 (gpg-sign 준수)
  - `scripts/vibe-session-log-sync.mjs` 신규 — entries 를 timestamp descending sort, 불완전 timestamp 를 ISO8601 full 로 정규화, duplicate 제거, file-locking 으로 race 방지. `vibe-sprint-complete` 마지막 단계에서 자동 실행.
  - `sprint-roadmap.md` Current pointer 마커 블록 자동 유지 (vibe-sprint-complete 가 `<!-- BEGIN:VIBE:CURRENT-SPRINT -->` 섹션 갱신)
  - Prompts 아카이브: sprint 완료 시 `docs/prompts/sprint-NN-*.md` → `.vibe/archive/prompts/sprint-NN-*.md` 이동
  - Dynamic scope: `vibe-sprint-complete` 가 git staged 파일 목록에서 메타 제외 후 `lastSprintScope` 에 기록 → LOC 계산 + preflight `git clean` 검증이 이를 활용
  - `.vibe/agent/project-decisions.jsonl` append-only ledger + `src/lib/decisions.ts` (scope-filter 검색 helper)
  - 테스트: 각 스크립트 단위 테스트
  - Manifest 업데이트
- **의존**: M1 (schema 확장)
- **예상 LOC**: ~450 (코드 ~300 + 테스트 ~150)

---

## Sprint M4 — Model tier abstraction + registry

- **id**: `sprint-M4-model-tier`
- **목표**: 모델 네이밍 변경 및 신규 SOTA tier 등장에 대응. 중앙 registry 로 downstream 프로젝트 전체가 자동 추종.
- **산출**:
  - `.vibe/model-registry.json` 신규 + schema (`.vibe/model-registry.schema.json`)
  - `scripts/vibe-model-registry-check.mjs` — SessionStart 훅. upstream registry 비교 + 변경 감지 + 업데이트 프롬프트. 24h 캐시.
  - `scripts/vibe-resolve-model.mjs` — config + registry 를 결합하여 현재 SOTA 모델 ID 해결. CLI + programmatic API.
  - `.vibe/config.json` 확장: `sprintRoles.planner.tier: 'flagship'` 형식 지원 (legacy string `"claude-opus"` 와 양립)
  - `.claude/settings.json` SessionStart hooks 에 registry-check 추가
  - `.claude/agents/planner.md` frontmatter: family alias 유지 (`model: opus`) + comment "registry 기반 tier 해석은 Orchestrator 측 wrapper 가 처리"
  - `migrations/1.2.0.mjs` — sprintRoles 스키마 마이그레이션 (optional; legacy 유지)
  - 테스트
  - Manifest 업데이트
- **의존**: M2 (wrapper 패턴)
- **예상 LOC**: ~400

---

## Sprint M5 — Native socratic interview (Ouroboros 대체)

- **id**: `sprint-M5-native-interview`
- **목표**: Ouroboros 의 Python/MCP 의존 제거. **도메인 전문가 수준 probing** 을 Orchestrator LLM 으로 달성. 설치 실패·MCP frozen 이슈 근원 해결.
- **산출**:
  - `scripts/vibe-interview.mjs` — state machine (~500 LOC):
    - Dimension rubric backbone: `.claude/skills/vibe-interview/dimensions.json` (generic 10 dimensions — goal / target_user / platform / data_model / primary_interaction / success_metric / non_goals / constraints / tech_stack / domain_specifics)
    - Coverage tracker: sub-field 충족 비율, 가중치 적용 ambiguity 공식
    - **Question synthesizer** — 핵심 기능. 각 dimension 별 **도메인 컨텍스트 흡수 프롬프트** 를 Orchestrator 에게 전달하여 현재 프로젝트 도메인에 특화된 깊은 probing 질문 생성. "도메인 비전문가가 생각 못할 질문" 을 LLM 이 SOTA 지식으로 유도.
    - Answer parser: 응답을 sub-field 로 매핑 (LLM 호출 또는 구조화된 입력)
    - Termination: ambiguity ≤ 0.2 OR max_rounds 30
  - `.claude/skills/vibe-interview/` 디렉토리:
    - `SKILL.md` — 사용법
    - `dimensions.json` — rubric backbone
    - `domain-probes/` — 선택적 도메인별 예시 probe bank (real-estate.md, data-pipeline.md, web-app.md 등). LLM 이 inspiration 으로만 사용, 제약 아님.
    - `prompts/synthesizer.md` — 질문 합성 시스템 프롬프트
  - `scripts/vibe-mcp-smoke.mjs` — Phase 1 선행 smoke. Ouroboros MCP 호출 성공 시에만 "고급 모드", 실패 시 native interview 로 자동 fallback (침묵 처리).
  - `.claude/skills/vibe-init/SKILL.md` 수정 — Phase 3 를 native interview 를 primary 로 변경. Ouroboros 는 optional enhancement.
  - `docs/context/tokens.md` 업데이트 — 인터뷰 비용 근사치 문서화
  - 테스트: dimension coverage, ambiguity 공식, question synthesis 호출 mock
  - Manifest 업데이트
- **의존**: M4 (model resolution 사용)
- **예상 LOC**: ~700 (코드 ~500 + 테스트 ~200 — 가장 큰 Sprint)
- **참고**: 사용자가 이전에 "부동산 재계약 행정사 매칭" 예시에서 받은 인터뷰처럼, 도메인 전문가 수준의 세부 질문을 생성하는 것이 본 Sprint 의 품질 기준. Planner 가 synthesizer 프롬프트 설계 시 "평범한 사람이 놓칠 전문가 관점 질문을 SOTA LLM 이 능동 제기" 를 핵심 계약으로 명시.

---

## Sprint M6 — Stack/framework pattern shards

- **id**: `sprint-M6-pattern-shards`
- **목표**: 범프로젝트 적응성 확보. 테스트/lint 패턴을 stack 별 shard 로 분리. vibe-init Phase 3 가 stack 검출 후 관련 shard 만 conventions.md 에 참조.
- **산출**:
  - `.claude/skills/test-patterns/` 디렉토리:
    - `_index.md` — stack → shard 매핑 매트릭스
    - `typescript-vitest.md`, `typescript-playwright.md`
    - `python-pytest.md`, `python-hypothesis.md`
    - `rust-cargo-test.md`
    - `go-testing.md`
    - `canvas-dom-isolation.md` (cross-cutting)
    - `shell-bats.md`
  - `.claude/skills/lint-patterns/` 디렉토리:
    - `_index.md`
    - `typescript-debt.md` (: any, as unknown as, // @ts-ignore)
    - `python-debt.md` (bare except, # type: ignore)
    - `rust-debt.md`, `go-debt.md`, `universal-debt.md` (TODO/FIXME)
  - `sync-manifest.json` 에 harness 디렉토리 **glob 지원** 추가 (`.claude/skills/test-patterns/**`, `.claude/skills/lint-patterns/**`). `src/lib/sync.ts` 확장.
  - vibe-init Phase 3 Orchestrator 로직: stack 검출 결과를 conventions.md 의 "테스트" / "lint" 섹션에 해당 shard 링크로 삽입
  - Planner 프롬프트 템플릿: stack 맞는 shard 를 mandatory read 로 포함
  - 테스트: manifest glob 해석, shard 파일 생성 및 조회
  - Manifest 업데이트
- **의존**: M5 (interview 가 stack 검출)
- **예상 LOC**: ~550 (shard 내용 ~400 + glob 로직 ~100 + 테스트 ~50)

---

## Sprint M7 — Phase 0 seal + Universal README + bundle-size + browser-smoke

- **id**: `sprint-M7-phase0-seal-and-utilities`
- **목표**: Phase 0 커밋 자동화, README 범용 skeleton, 번들 사이즈 게이트, 브라우저 smoke — 모두 opt-in 방식으로 dead weight 방지.
- **산출**:
  - `scripts/vibe-phase0-seal.mjs` 신규 — Phase 0 산출물(context shards + roadmap) 을 자동 stage + commit. vibe-init Phase 4 Step 4-0 직후 자동 호출.
  - `.claude/skills/vibe-init/templates/readme-skeleton.md` — project-name / one_liner / status placeholder. vibe-init 이 product.md seed 를 주입하여 렌더.
  - `src/commands/bundle-size.ts` — zero-dep (Node 24+ `node:zlib`) gzipSync 기반. `.vibe/config.json.bundle` 설정 참조. opt-out 기본값 (web/frontend 프로젝트만 enabled).
  - `scripts/vibe-browser-smoke.mjs` — Playwright headless. `.vibe/config.json.browserSmoke.contract` 에 프로젝트별 DOM/console 계약. **Playwright 는 peerDep 으로 안내**하고 vibe-doctor 자체는 설치하지 않음 (프로젝트 opt-in 시 설치 안내).
  - vibe-init Phase 3 인터뷰에 "번들 제약 여부" / "브라우저 UI 여부" 질문 추가 (dimension 확장)
  - `package.json scripts`: `vibe:bundle-size`, `vibe:browser-smoke` 추가
  - 테스트: bundle-size gzip 계산 단위 테스트 (Playwright 는 통합 테스트로 optional)
  - Manifest 업데이트
- **의존**: M5, M6 (인터뷰 dimension 확장 + stack shards)
- **예상 LOC**: ~500

---

## Sprint M8 — Periodic Evaluator audit + /vibe-review skill + harness-gaps ledger

- **id**: `sprint-M8-audit-review-gaps`
- **목표**: 프로세스 건강성 모니터링. 리뷰 재현성 확보. 하네스 사각지대를 스크립트로 커버하는 매뉴얼 정착.
- **산출**:
  - `sprint-status.json.sprintsSinceLastAudit` 카운터 활용: `vibe-sprint-complete` 가 증가 → threshold (`.vibe/config.json.audit.everyN`, default 5) 도달 시 `pendingRisks` 에 `audit-required` 엔트리 자동 주입
  - `.claude/skills/vibe-review/SKILL.md` 신규 — handoff + session-log + git log + pendingRisks 자동 로드, 4-tier rubric (🔴/🟡/🟢/🔵) 으로 리뷰 드래프트 생성, `docs/reports/review-<sprintCount>-<date>.md` 저장
  - `docs/context/harness-gaps.md` ledger — 알려진 사각지대 목록 + script wrapper coverage 추적
  - `CLAUDE.md` 업데이트: "규칙 추가 시 문서뿐 아니라 hook/script 로 기계 강제 목표" 선언 + harness-gaps 참조
  - 테스트
  - Manifest 업데이트
- **의존**: M1 (schema), M3 (flow)
- **예상 LOC**: ~300

---

## Sprint M9 — Statusline + permission presets

- **id**: `sprint-M9-statusline-permissions`
- **목표**: Agent 위임 중 사용자 가시성 확보 + 권한 프롬프트 감소 (agent-delegation 모드).
- **산출**:
  - `.claude/statusline.sh` + `.claude/statusline.ps1` — `sprint-status.json` + `.vibe/agent/tokens.json` 읽어 `⌘ Sprint N/M | ⏱ elapsed | 🪙 tok` 렌더
  - `scripts/vibe-status-tick.mjs` — Orchestrator 가 주기적으로 토큰/시간 상태를 `.vibe/agent/tokens.json` 에 기록 (Agent 호출 전후)
  - `.vibe/settings-presets/agent-delegation.json` — scope 기반 permission preset (예: `Bash(cd */<scope> && npm install)`, test/build/dev commands)
  - `scripts/vibe-sprint-mode.mjs` — `on|off` 토글 → `.claude/settings.local.json` 의 `permissions.allow` 에 preset 병합/해제
  - `.claude/skills/vibe-sprint-mode/SKILL.md` — /vibe-sprint-mode 슬래시 커맨드
  - vibe-init Phase 4 말미: "agent 위임 모드 권한 preset 을 적용하시겠습니까?" opt-in
  - 보안 가드: preset 은 각 scope 내로만 적용. malicious postinstall 방어로 `--ignore-scripts` 옵션 문서화.
  - 테스트
  - Manifest 업데이트
- **의존**: M1 (state 읽기)
- **예상 LOC**: ~400

---

## Sprint M10 — Integration + self-sync smoke + v1.2.0 release

- **id**: `sprint-M10-integration-release`
- **목표**: 전체 개선의 end-to-end smoke + downstream 프로젝트에서 `/vibe-sync` 로 업그레이드 재현 + v1.2.0 릴리스.
- **산출**:
  - `test/integration/meta-smoke.test.ts` — tmp 디렉토리에 vibe-doctor clone → vibe-init → ambiguous prompt ("X 매칭 사이트") → interview 결과 확인 → Sprint 1 cycle → assert state files 갱신 + Manifest 소비
  - 기존 downstream (dogfood6 등) 에서 `npm run vibe:sync` 로 업그레이드 → preflight green, 기존 sprint-status.json 마이그레이션 확인
  - `CLAUDE.md` 업데이트: 신규 스크립트·스킬 목록, 개선점 요약
  - `README.md` 업데이트: v1.2.0 기능 목록
  - `docs/context/harness-gaps.md` — 이번 메타-프로젝트로 해소된 gap 마킹
  - `package.json` harnessVersion "1.2.0" 태그
  - `migrations/1.2.0.mjs` (Sprint M4 에서 초안, 여기서 완결)
  - 릴리스 노트 `docs/release/v1.2.0.md`
  - Manifest 최종 검증
- **의존**: M1~M9 전부
- **예상 LOC**: ~400 (주로 테스트 + 문서)

---

## 의존 그래프

```
M1 (foundation) ─┬─> M3 (flow)
                 ├─> M8 (audit)
                 └─> M9 (statusline)
M2 (wrappers) ───┬─> M4 (model tier)
M4 ──────────────┬─> M5 (interview)
M5 ──────────────┬─> M6 (shards)
M6 ──────────────┴─> M7 (utilities)
M1..M9 ──────────────> M10 (release)
```

엄밀히는 M1/M2 는 병렬 가능. Orchestrator 순차 실행 편의로 M1 → M2.

---

## 성공 기준 (전체)

- 23개 개선안 전부 반영.
- `npm test` 기존 + 신규 모두 pass.
- `npm run vibe:sync --dry-run` 으로 메타 변경이 downstream 전파 가능함을 시각적 확인.
- Fresh 세션에서 `/vibe-init` 실행 → ambiguous prompt → 도메인 전문가 수준 probing 확인.
- Existing dogfood6 프로젝트에서 `/vibe-sync` 로 업그레이드 성공.
- 하네스 `v1.2.0` 태깅 + release note.

## 에스컬레이션

- Planner 품질 불만족 시 재소환 (각 Sprint 의 해당 slot 프롬프트 재작성)
- Codex 생성 실패 시 `run-codex.sh --retry` 자동 재시도 (M2 이후)
- 2회 연속 실패 → 사용자 개입 요청 (Sprint 축소 / 기술 선택 변경)
- 5개 Sprint 완료마다 Evaluator audit (M8 이후 자동)

## Sprint 간 상태 전달

`.vibe/agent/sprint-status.json` + `handoff.md` + `session-log.md` + 신규 `project-map.json` + `sprint-api-contracts.json` + `project-decisions.jsonl` (M1, M3 이후) 로 완전 기계화.




