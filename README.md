# vibe-doctor — AI Sprint Orchestration Template

> 새 프로젝트마다 프롬프트와 규칙을 다시 깔지 않고, `git clone` 후 바로 같은 프로세스와 품질 기준으로 바이브 코딩을 시작할 수 있게 하는 베이스 템플릿.

기본 nominal 구성은 **Claude Code (Opus)** 를 메인 Orchestrator로, **Codex CLI** 를 Generator로 사용하는 **Phase 0 → Sprint → Report → Iterate** 사이클입니다. 동시에 Codex와 직접 대화하며 업스트림 하네스를 유지보수하는 **Codex Orchestrator maintenance mode**도 지원합니다. 네이티브 소크라테스식 인터뷰로 도메인 전문가 수준의 기획을 강제하고, Sprint 완료 시 HTML 보고서를 자동 생성/오픈하며, 누적 iteration 흐름을 한 눈에 따라갈 수 있게 합니다.

> ⚠️ **템플릿 주의**: `docs/context/product.md` 와 `docs/context/architecture.md` 는 의도적으로 플레이스홀더 상태입니다. **`git clone` 직후 `/vibe-init` 을 먼저 실행**해서 프로젝트 맥락을 채운 뒤 개발을 시작하세요. 플레이스홀더 상태로 Sprint 를 돌리면 Orchestrator/Planner 가 맥락 없이 작업하게 됩니다. v1.5.16부터 `/vibe-sync` 와 legacy sync bootstrap 도 init 전 실행을 중단하고, v1.5.17부터 statusline/dashboard/report 는 init 전 템플릿 sprint 상태를 숨깁니다.

---

## Latest Highlights

### v1.7.17 (2026-05-14) - Injection and sharding safety hardening

- Adds Codex wrapper Markdown injection diagnostics, including transitive shard injection checks for shared skill runbooks.
- Splits `/vibe-init`, `/vibe-interview`, `/vibe-iterate`, and `/vibe-review` runbooks into guarded shards with dedicated audit gates wired into preflight and CI.
- Adds sprint-mode and sync boundary audits, including a guard that prevents full harness ownership of root `README.md`.
- Splits dashboard/report HTML renderers into dedicated `.vibe/harness/scripts/lib/*` modules while preserving synchronous render flow.

### Previous: v1.7.16 (2026-05-11) - Sprint-mode statusline polish

- Hides the sprint-mode statusline segment when mode is `off` so inactive state does not add noise.
- Shows active sprint-mode states with an emoji segment, for example `🏃 sprint:extended`.

Release history is sharded under [docs/release/README.md](docs/release/README.md); detailed notes live in [docs/release/](docs/release/).

---

## 요구 사항

- **Node.js 24+** (Active LTS)
- **Claude Code CLI** (Orchestrator 호스트)
- **Codex CLI** (기본 Generator)

---

## 빠른 시작 (새 프로젝트)

### 1. 템플릿으로 새 레포 만들기

GitHub에서 **Use this template** 버튼을 누르거나:

```bash
git clone https://github.com/mir3626/vibe-doctor my-project
cd my-project
```

### 2. 의존성 설치

```bash
npm install
```

> 필수 1회 실행. 생략하면 Stop 훅(`vibe-stop-qa-gate`) 이 `[vibe-qa] skip: tsx not installed — run \`npm install\` first` 로 리포트하고, `npm run vibe:qa` / `vibe-validate-state` 등 tsx loader 를 쓰는 검증 커맨드가 모두 skip 된다. dev dependency (`tsx`, `typescript`, `@types/node`, `zod-to-json-schema`) 는 harness 스크립트가 런타임에 요구하므로 반드시 먼저 설치.

### 3. Claude Code 에서 초기화

```bash
claude                  # Claude Code 실행
```

Claude Code 안에서:

```text
/vibe-init
```

Claude 가 대화형으로 아래 과정을 순차 자동 진행합니다:

1. **Phase 1 환경 점검** — node, npm, git, Claude/Codex CLI 설치 여부 검사.
2. **Phase 2 Provider 선택** — Planner/Generator/Evaluator 역할별 AI 배정 + 인증 안내.
3. **Phase 3 네이티브 소크라테스식 인터뷰** — `.vibe/harness/scripts/vibe-interview.mjs` 기반. 도메인 전문가 수준 probing 후 consensus check로 사람 의도와 에이전트 이해 일치 여부를 기록하고, `product.md` / `architecture.md` / `conventions.md` 자동 생성.
4. **Phase 4 Sprint 로드맵 작성 + Phase 0 seal** — Orchestrator 가 직접 분할한 Sprint 로드맵 저장 + `.vibe/harness/scripts/vibe-phase0-seal.mjs` 로 자동 커밋.

### 4. Sprint 사이클

각 Sprint 는 다음 5 단계:

1. `node .vibe/harness/scripts/vibe-preflight.mjs` (green 확인)
2. **Planner 소환** (Agent, fresh opus subagent) → `docs/prompts/sprint-NN-*.md` 생성
3. **Generator 위임**: `cat docs/prompts/sprint-NN-*.md | ./.vibe/harness/scripts/run-codex.sh -`
4. Orchestrator 샌드박스 밖 재검증 (`tsc --noEmit`, `npm test`, `npm run build` 등)
5. `node .vibe/harness/scripts/vibe-sprint-commit.mjs <sprintId> passed` — state 파일 + 산출을 단일 커밋

### 5. 자동 보고서 + 다음 Iteration

최초 로드맵의 마지막 Sprint 가 passed 로 마감되면:

- `.vibe/harness/scripts/vibe-project-report.mjs` 자동 호출
- `docs/reports/project-report.html` 생성
- 기본 브라우저에서 자동 오픈 (Windows `start` / macOS `open` / Linux `xdg-open`)

추가 개발은 `/vibe-iterate` 로:

```text
/vibe-iterate
```

→ 차등 인터뷰 (이전 결정 계승 + 미해결 항목 집중 + 신규 목표 수집) → 새 iteration Sprint 로드맵 append → 다시 Sprint 사이클.

---

## 기존 프로젝트 업그레이드

기존 프로젝트를 최신 harness로 올리는 상세 절차는 [docs/guides/upgrade.md](docs/guides/upgrade.md)를 따릅니다.

---

## 주요 명령어

### Claude Code 슬래시 커맨드

| 커맨드 | 역할 |
|---|---|
| `/vibe-init` | 초기 설정 + Phase 0 인터뷰 + 로드맵 생성 (1회) |
| `/vibe-interview` | 네이티브 소크라테스식 인터뷰만 단독 실행 (도메인 전문가 probing + consensus check) |
| `/vibe-iterate` | 기존 iteration 완료 후 차등 인터뷰로 다음 iteration 진입 🆕 |
| `/vibe-review` | 프로세스 건강성 리뷰 (4-tier rubric + regression 검증) 🆕 |
| `/vibe-sync` | 업스트림 하네스 변경을 프로젝트 커스터마이징 보존하며 반영 |
| `/vibe-sprint-mode` | Sprint agent-delegation 권한 프리셋 on/off |
| `/goal-to-plan` | 목표 → Sprint 분할 계획 생성 |
| `/self-qa` | self-QA 체크리스트 실행 |
| `/write-report` | 임의 시점 보고서 작성 |
| `/maintain-context` | 컨텍스트 문서 스냅샷 업데이트 |

### npm 스크립트

```bash
# 기본 검증
npm run typecheck              # harness TypeScript typecheck
npm run build                  # harness build
npm test                       # harness self-test
npm run test:ui                # Playwright UI/smoke tests
npm run vibe:typecheck         # internal alias for harness typecheck
npm run vibe:build             # internal alias for harness build
npm run vibe:self-test         # internal alias for harness self-test
npm run vibe:test-ui           # internal alias for Playwright wrapper

# 환경
npm run vibe:doctor             # 환경 점검 (node/git/CLI 설치)
npm run vibe:init -- --from-agent-skill --mode=human  # internal: /vibe-init human bootstrap only

# 인터뷰 / 개발
npm run vibe:interview          # 네이티브 인터뷰 단독 실행

# 품질 / 감사
npm run vibe:qa                 # test → typecheck → lint → build 자동 체인
npm run vibe:usage              # 토큰 사용량 요약
npm run vibe:config-audit       # 시크릿 누출 / 설정 위반 감사
npm run vibe:bundle-size        # 번들 gzip 크기 게이트 (opt-in)
npm run vibe:browser-smoke      # Playwright headless DOM/console 검증 (opt-in)
npm run vibe:gen-schemas        # Zod source 로부터 .schema.json regenerate/check
npm run vibe:audit-lightweight <sprintId>  # per-sprint 자동 감사 (non-blocking)
npm run vibe:rule-audit         # CLAUDE.md rule ↔ harness-gaps coverage 대조
npm run vibe:context-audit      # skill/runbook dependency scan (report-only)
npm run vibe:codex-wrapper-audit    # Codex wrapper ↔ shared skill shard injection 계약 검사
npm run vibe:init-shard-audit       # /vibe-init phase sharding safety gate
npm run vibe:interview-shard-audit  # /vibe-interview section sharding safety gate
npm run vibe:iterate-shard-audit    # /vibe-iterate phase sharding safety gate
npm run vibe:review-shard-audit     # /vibe-review section sharding safety gate
npm run vibe:sprint-mode-audit      # sprint-mode permission preset drift 검사
npm run vibe:sync-audit             # sync manifest/runtime ownership boundary 검사

# 리포트 / 실행
npm run vibe:report -- --title "..."   # 임의 시점 보고서
npm run vibe:run-agent                 # provider 직접 실행
npm run vibe:sidecar-run               # sealed sidecar runner
npm run vibe:dashboard                 # 웹 대시보드 opt-in (SSE, 127.0.0.1:5175)
npm run vibe:session-start             # provider-neutral session start checks
npm run vibe:checkpoint                # handoff/session-log checkpoint gate

# 싱크 / 업그레이드
npm run vibe:sync -- --dry-run         # 업스트림 plan 미리보기
npm run vibe:sync                      # 실제 적용 (interactive approval)
npm run vibe:sync -- --force           # 모든 conflict 자동 replace
```

### 독립 스크립트 (`.vibe/harness/scripts/*`)

Orchestrator 가 주로 호출합니다. 사용자가 직접 쓸 일은 드뭅니다.

| 스크립트 | 용도 |
|---|---|
| `vibe-preflight.mjs` | Sprint 시작 전 환경 검증 (`--bootstrap` 모드 존재) |
| `vibe-sprint-commit.mjs` | Sprint 단일 커밋 래퍼 (state+산출+LOC+메시지 자동) 🆕 |
| `vibe-sprint-complete.mjs` | sprint-status.json + handoff + session-log 상태 갱신 |
| `vibe-session-log-sync.mjs` | session-log timestamp 정규화·sort·dedup 🆕 |
| `vibe-project-report.mjs` | HTML 보고서 생성 + 브라우저 자동 오픈 |
| `vibe-dashboard.mjs` | 웹 대시보드 SSE 서버 (opt-in, `npm run vibe:dashboard`) |
| `vibe-phase0-seal.mjs` | Phase 0 산출물 자동 커밋 🆕 |
| `vibe-interview.mjs` | 네이티브 인터뷰 엔진 (state machine + synthesizer + consensus gate) 🆕 |
| `vibe-resolve-model.mjs` | tier → SOTA 모델 ID 해석 🆕 |
| `vibe-model-registry-check.mjs` | SessionStart: upstream registry 변화 감지 🆕 |
| `vibe-agent-session-start.mjs` | Provider-neutral SessionStart entrypoint for Claude/Codex/other CLI providers |
| `vibe-audit-clear.mjs` | Evaluator 감사 후 counter + pendingRisks 마감 🆕 |
| `vibe-sprint-mode.mjs` | permission preset 토글 🆕 |
| `vibe-status-tick.mjs` | statusline 토큰/시간 누적 기록 🆕 |
| `vibe-browser-smoke.mjs` | Playwright smoke contract 검사 🆕 |
| `vibe-playwright-test.mjs` | Playwright 실행 wrapper |
| `vibe-gen-schemas.mjs` | Zod source 기반 `.schema.json` drift 검사 / 재생성 |
| `vibe-validate-state.ts` | state/schema validation helper |
| `vibe-audit-lightweight.mjs` | per-sprint diff/spec/test/tmp residue 감사 (non-blocking) |
| `vibe-sync-bootstrap.mjs` | 레거시 프로젝트 one-shot 업그레이드 |
| `vibe-version-check.mjs` | SessionStart: 업스트림 버전 비교 |
| `vibe-stop-qa-gate.mjs` | 턴 종료 시 코드 diff 감지 → QA 자동 실행 |
| `vibe-rule-audit.mjs` | CLAUDE.md 명령형 규칙 ↔ harness-gaps coverage 자동 대조 🆕 |
| `vibe-context-audit.mjs` | skill/runbook dependency strength + missing reference audit (report-only) |
| `vibe-codex-wrapper-audit.mjs` | Codex skill wrapper와 MD injection shard 계약 검사 |
| `vibe-init-shard-audit.mjs` / `vibe-interview-shard-audit.mjs` | init/interview shard 손실 방지 audit |
| `vibe-iterate-shard-audit.mjs` / `vibe-review-shard-audit.mjs` | iterate/review shard 손실 방지 audit |
| `vibe-sprint-mode-audit.mjs` | sprint-mode permission preset drift 검사 |
| `vibe-sync-audit.mjs` | sync manifest/runtime ownership boundary 검사 |
| `vibe-review-inputs.mjs` | `/vibe-review` 재현 가능한 입력 수집 helper |
| `vibe-sidecar-run.mjs` | sealed sidecar packet 실행 wrapper |
| `vibe-checkpoint.mjs` | handoff/session-log/sprint-status checkpoint gate |
| `vibe-audit-skip-set.mjs` | `.vibe/config.local.json.userDirectives.auditSkippedMode` 토글 🆕 |
| `vibe-planner-skip-log.mjs` | Planner trivial-skip 근거를 session-log `[decision][planner-skip]` 로 기록 🆕 |
| `vibe-daily-log.mjs` | 일일 이벤트 타임라인 JSONL (dashboard 백엔드) |
| `vibe-attention.mjs` / `vibe-attention-notify.mjs` | 사용자 개입 필요 이벤트 → dashboard toast / desktop notification |
| `vibe-session-started.mjs` | SessionStart 이벤트 기록 |
| `run-codex.sh` / `run-codex.cmd` | Codex CLI 래퍼 (UTF-8 + retry + `--health` + MD injection diagnostic + auto status-tick) |

Shared script helpers live under `.vibe/harness/scripts/lib/` and include browser-open handling, dashboard/report templates, interview-engine helpers, and shard-audit utilities.

---

## 핵심 설계

| 항목 | 내용 |
|---|---|
| 개발 프로세스 | **Phase 0 → Sprint × N → Report → Iterate** 사이클. 기본은 Orchestrator 단독 + self-QA, context pressure·role 충돌·규모 트리거 시 Planner/Evaluator 소환, 소스코드는 **항상** Generator 위임 |
| 메인 Orchestrator | 기본 nominal mode: Claude Code (Opus family alias — registry 로 SOTA 자동 추종). Codex 직접 대화 세션은 upstream harness maintenance mode에서 Orchestrator 역할 가능 |
| 기본 Generator | Codex CLI (`/vibe-init` 에서 DeepSeek/Grok/기타 커스텀 연결 가능) |
| Context 전략 | 얇은 루트 메모리 (`CLAUDE.md`) + 샤딩된 MD (`docs/context/*`) + skills |
| 상태 전달 | `.vibe/agent/` 하위 구조화 state: `sprint-status.json`, `project-map.json`, `sprint-api-contracts.json`, `iteration-history.json`, `project-decisions.jsonl`, `tokens.json`, `handoff.md`, `session-log.md` |
| 에스컬레이션 정책 | self-QA 실패 → Evaluator (Tribunal) → 2회 연속 불합격 시 Planner 재소환 또는 사용자 에스컬레이션 |
| QA 기본값 | test → typecheck → lint → build 자동 감지 실행 |
| 보안 | `.env` / `secrets/` / credential 파일 git 제외 + 훅 기반 자동 감사 |
| 버전 관리 | `harnessVersion` semver + matching git tag (`v1.2.0`, `v1.3.0` 등). Downstream `vibe:sync` 가 tag 기반 clone. |

---

## 디렉터리 구조

```text
.
├── CLAUDE.md                      # Orchestrator 규칙 (Sprint 프로세스)
├── AGENTS.md / GEMINI.md          # 보조 에이전트 규칙
├── README.md                      # 이 파일
├── .env.example                   # 환경변수 템플릿 (커밋됨)
├── .claude/
│   ├── settings.json              # Claude Code 프로젝트 설정 + 훅
│   ├── statusline.{mjs,sh,ps1}    # 커스텀 상태바
│   ├── agents/                    # 서브에이전트 (planner, qa-guardian, context-curator)
│   └── skills/                    # 슬래시 커맨드 + shared runbook shards
├── .codex/agents/                 # Codex 에이전트 프로필
├── .codex/skills/                 # Codex skill wrappers
├── .vibe/
│   ├── config.json                # 프로젝트 기본 provider + harnessVersion (커밋됨)
│   ├── config.local.json          # 로컬 override (git-ignored)
│   ├── model-registry.json        # SOTA tier → model alias 매핑
│   ├── sync-manifest.json         # 하네스 파일 tier (harness/hybrid/project)
│   ├── settings-presets/          # agent-delegation 등 permission preset
│   ├── archive/prompts/           # 완료된 sprint 프롬프트 아카이브
│   ├── harness/
│   │   ├── src/commands/          # vibe:* TypeScript 커맨드
│   │   ├── src/lib/               # 유틸리티 (config, sync, review, iteration, schemas, ...)
│   │   ├── src/providers/         # provider-agnostic 실행 플랜
│   │   ├── scripts/               # 하네스 실행 스크립트
│   │   ├── scripts/lib/           # render/open/interview/shard-audit helpers
│   │   ├── sidecars/              # sidecar prompt specs
│   │   ├── migrations/            # 하네스 버전별 마이그레이션
│   │   └── test/                  # 유닛·통합 테스트 (node --test)
│   └── agent/                     # 템플릿 placeholder; /vibe-init 이 프로젝트 상태로 교체
│       ├── handoff.md
│       ├── session-log.md
│       ├── sprint-status.json
│       ├── project-map.json
│       ├── sprint-api-contracts.json
│       ├── iteration-history.json
│       ├── project-decisions.jsonl
│       ├── tokens.json
│       ├── _common-rules.md
│       └── re-incarnation.md
├── docs/
│   ├── context/                   # 샤딩된 컨텍스트
│   │   ├── product.md             # (플레이스홀더 — /vibe-init 로 교체)
│   │   ├── architecture.md        # (플레이스홀더)
│   │   ├── conventions.md
│   │   ├── harness-gaps.md        # 하네스 사각지대 ledger
│   │   └── ...
│   ├── orchestration/providers.md # Provider runner 세부
│   ├── guides/                    # 업그레이드 / 트러블슈팅 등 운영 가이드
│   ├── plans/                     # sprint-roadmap 등
│   ├── prompts/                   # 현재 진행 중 sprint 프롬프트
│   ├── reports/                   # project-report.html, review-*.md, 완료 보고서
│   └── release/                   # 릴리스 노트 index + version별 상세
└── scripts/                       # root compatibility bridge (`vibe-sync-bootstrap.mjs`)
```

Root `src/**`, `scripts/**`, `test/**`, `app/**`, `components/**`, and `lib/**` are project-owned in downstream repositories; harness runtime lives under `.vibe/harness/**`.

---

## 운영 원칙

1. **사용자는 목적과 승인** 에 집중. 세부 구현은 Orchestrator/Generator 에 위임.
2. **Orchestrator** 는 Sprint 관리, QA, 보고, 문맥 관리. 기본 nominal mode는 Claude Code이고, Codex 직접 대화 세션은 maintenance mode에서 Orchestrator 역할을 수행할 수 있음. 소스 코드를 직접 편집하지 않음.
3. **Planner** 는 "무엇을", **Generator** 는 "어떻게" 를 자유롭게 결정. 매 Sprint fresh context.
4. **승인 전에는 비단순 구현 금지**. 계획부터 먼저.
5. **self-QA 또는 Evaluator 합격 없이 완료 선언 금지**.
6. **루트 메모리는 얇게**. 상세 규칙은 skill / context shard 로.
7. **규칙은 가능하면 script hook 으로 강제** (MD 만으로는 Orchestrator 가 잊음). `docs/context/harness-gaps.md` ledger 로 사각지대 추적.

---

## 버전 / tag 정책

현재 릴리스는 `harnessVersion: 1.7.25` 입니다. 릴리스를 자를 때는 `package.json`, `.vibe/config.json`, release note, tag를 같은 버전으로 맞춥니다.

- `harnessVersion` 은 `.vibe/config.json` 과 `package.json` 에 semver로 기록합니다.
- 각 minor/patch 릴리스는 해당 커밋에 `vMAJOR.MINOR.PATCH` git tag를 붙인 뒤 origin에 push합니다.
- LTS 선언은 immutable alias tag (`vMAJOR.MINOR.PATCH-lts`) 로 남깁니다. moving `lts` tag는 downstream exact pin을 혼동시키므로 사용하지 않습니다.
- 릴리스 노트는 `docs/release/vMAJOR.MINOR.PATCH.md`에 두고, root README는 최신 하이라이트와 운영 절차만 유지합니다.
- 전체 릴리스 계보는 [docs/release/README.md](docs/release/README.md)를 참조합니다.

---

## 트러블슈팅

운영 중 자주 만나는 문제와 복구 절차는 [docs/guides/troubleshooting.md](docs/guides/troubleshooting.md)를 참조합니다.

---

## Claude Code 에서 시작하는 방법

저장소를 열고:

```text
/vibe-init
```

초기 설정 완료 후 목표를 제시:

```text
목표: [여기에 작업 목표 입력]
방법론은 먼저 제안하고, 승인 전에는 구현하지 말고 계획부터 보여줘.
```

최초 iteration 이 끝나면 `docs/reports/project-report.html` 이 자동으로 열립니다. 이후 추가 개발은:

```text
/vibe-iterate
```

---

## 기여 / 피드백

Issue·PR 은 [github.com/mir3626/vibe-doctor](https://github.com/mir3626/vibe-doctor) 으로.

하네스 개선 제안 시 다음 가중치 공식을 참고 (`/vibe-review` 가 자동 계산):

`priority_score = 10·agent_friendly + 5·token_efficient + 1·user_fyi` (max 80)

`recommended_approach` 는 `script-wrapper > md-rule > config-default > user-action` 순으로 선호. 규칙은 문서뿐 아니라 script hook 으로 기계 강제하는 것을 목표로 합니다.
