# vibe-doctor — Claude Code Vibe Coding Template

> 새 프로젝트마다 프롬프트와 규칙을 다시 깔지 않고, `git clone` 후 바로 같은 프로세스와 품질 기준으로 바이브 코딩을 시작할 수 있게 하는 베이스 템플릿.

**Claude Code (Opus)** 를 메인 오케스트레이터로, **Codex CLI** 를 기본 Generator 로 사용하는 **Phase 0 → Sprint → Report → Iterate** 사이클 기반 개발 템플릿입니다. 네이티브 소크라테스식 인터뷰로 도메인 전문가 수준의 기획을 강제하고, Sprint 완료 시 HTML 보고서를 자동 생성/오픈하며, 누적 iteration 흐름을 한 눈에 따라갈 수 있게 합니다.

> ⚠️ **템플릿 주의**: `docs/context/product.md` 와 `docs/context/architecture.md` 는 의도적으로 플레이스홀더 상태입니다. **`git clone` 직후 `/vibe-init` 을 먼저 실행**해서 프로젝트 맥락을 채운 뒤 개발을 시작하세요. 플레이스홀더 상태로 Sprint 를 돌리면 Orchestrator/Planner 가 맥락 없이 작업하게 됩니다.

---

## 최신 하이라이트 (v1.5.4)

### v1.5.4 (2026-04-23) - project-safe `.gitignore` sync

- Added `line-union` sync for line-oriented files.
- Moved `.gitignore` from full replacement to hybrid merge so downstream project entries are preserved.

### v1.5.3 (2026-04-23) - WSL-safe Codex wrapper stdin

- Prevented WSL `chcp.com` from consuming piped Codex prompts before wrapper stdin buffering.
- Replaced fixed `en_US.UTF-8` forcing with installed UTF-8 locale selection, preferring `C.UTF-8` on Linux/WSL.
- Hardened `run-codex.sh` tests with stdin-consuming `chcp.com` and deterministic locale stubs.

### v1.5.2 (2026-04-22) - Markdown encoding hardening

- Added workspace VS Code settings that force UTF-8 and disable encoding auto-guessing.
- Added EditorConfig extension recommendation so `.editorconfig` encoding rules are applied consistently.
- Added sync-manifest coverage so downstream projects receive the same Markdown-safe editor defaults.

### v1.5.1 (2026-04-22) - provider-neutral agent lifecycle

- Added `vibe-agent-session-start.mjs` as the shared SessionStart entrypoint for Claude, Codex, and other CLI providers.
- Wired Claude hooks, `run-codex.sh`, and `vibe:run-agent` through the shared session-start entrypoint.
- Added Section 16 in `_common-rules.md` for provider-neutral context persistence around compaction and handoff.

### 🆕 v1.4.3 (2026-04-19) — iter-6 harness-dogfood9-regression-fix

- **`src/lib/review.ts` pending restoration dedup** — iter-*/rules-deleted.md 의 "delete-confirmed" 섹션 내 rule slug 를 pending 에서 제외. review 반복 시 false-positive 0.
- **`vibe-sprint-complete` roadmap heading parser** — `## Sprint <name>` + inline `- **id**:` bullet 구조 인식. iter-1 스타일 heading 에서 id 추출 성공 → `warning=roadmap-id-missing` 0.
- **`run-codex.sh` token 추출 regex** — Codex CLI 신 포맷 `tokens used N` 인식 (기존 `tokens: N` 구 포맷 하위 호환). `tr -d '\r'` 추가로 Windows CRLF 호환. status-tick silent-skip regression 복원.

### v1.4.x 계보

- **v1.4.2 (2026-04-19)** — iter-4 `harness-stability-tune`. interview engine sub-field coverage 가중치 회계 버그 fix (high-watermark replace). `vibe-audit-skip-set` config.local.json skeleton bootstrap. `vibe-preflight` roadmap iteration 경계 파싱. `.vibe/config.json.bundle.path` / `browserSmoke.dist` configurable. `sprint-planner` component-integration 계약 (Toaster root mount / null-safe event / optimistic rollback). `vibe-sprint-commit` lockfile blacklist (package-lock / pnpm-lock / yarn.lock / bun.lockb).
- **v1.4.0 (2026-04-17)** — iter-2 harness hardening. Zod single-source schema. `vibe-audit-lightweight` + `audit.everyN` gate. `vibe-rule-audit` (28 MUST/반드시/금지 rule scanning). `harness-gaps.md` coverage ledger. sprint-commit auto-tag on harnessVersion bump. `audit-skipped-mode` user directive with expiry.
- **v1.4.1 (2026-04-17)** — iter-3 harness diet. 28 uncovered rules → S/A/B/C tier 분류 후 B/C delete. Progressive MD — `CLAUDE.md` §0 Charter (file top) + Extensions pointer 재구조화. Soft freeze posture (분기 1회 harness 변경 / net +150 LOC / 0 new scripts). `run-codex.sh` Windows sandbox verify skip header.

### v1.3.x 계보

- **HTML 프로젝트 보고서** (`vibe-project-report.mjs`) + 브라우저 자동 실행.
- **`/vibe-iterate`** 차등 인터뷰 기반 다음 iteration 진입.
- **`/vibe-review`** 4-tier rubric + regression 3-signal 검증 + `priority_score = 10·agent + 5·token + 1·user`.
- **`/vibe-sprint-mode`** agent-delegation permission preset 토글.
- **Web dashboard** (`vibe-dashboard.mjs`) — opt-in SSE 기반 Sprint 진행 시각화 (`npm run vibe:dashboard` → http://127.0.0.1:5175).

### v1.2.x 계보

- **Native socratic interview** (외부 MCP 제거), **stack/framework pattern shards**, **model tier abstraction**, **platform wrappers**, **single-commit automation**, **statusline**, **bundle-size / browser-smoke opt-in gate**, **periodic audit**.

자세한 릴리스 내역은 `docs/release/v1.2.0.md` ~ `v1.5.4.md` 참조.

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
3. **Phase 3 네이티브 소크라테스식 인터뷰** — `scripts/vibe-interview.mjs` 기반. 도메인 전문가 수준 probing 으로 모호성 ≤ 0.2 까지 수렴. `product.md` / `architecture.md` / `conventions.md` 자동 생성.
4. **Phase 4 Sprint 로드맵 작성 + Phase 0 seal** — Orchestrator 가 직접 분할한 Sprint 로드맵 저장 + `scripts/vibe-phase0-seal.mjs` 로 자동 커밋.

### 4. Sprint 사이클

각 Sprint 는 다음 5 단계:

1. `node scripts/vibe-preflight.mjs` (green 확인)
2. **Planner 소환** (Agent, fresh opus subagent) → `docs/prompts/sprint-NN-*.md` 생성
3. **Generator 위임**: `cat docs/prompts/sprint-NN-*.md | ./scripts/run-codex.sh -`
4. Orchestrator 샌드박스 밖 재검증 (`tsc --noEmit`, `npm test`, `npm run build` 등)
5. `node scripts/vibe-sprint-commit.mjs <sprintId> passed` — state 파일 + 산출을 단일 커밋

### 5. 자동 보고서 + 다음 Iteration

최초 로드맵의 마지막 Sprint 가 passed 로 마감되면:

- `scripts/vibe-project-report.mjs` 자동 호출
- `docs/reports/project-report.html` 생성
- 기본 브라우저에서 자동 오픈 (Windows `start` / macOS `open` / Linux `xdg-open`)

추가 개발은 `/vibe-iterate` 로:

```text
/vibe-iterate
```

→ 차등 인터뷰 (이전 결정 계승 + 미해결 항목 집중 + 신규 목표 수집) → 새 iteration Sprint 로드맵 append → 다시 Sprint 사이클.

---

## 기존 프로젝트 업그레이드

### 경로 A — `/vibe-sync` 가 이미 설치된 프로젝트 (v1.x+)

가장 간단한 경로. 드라이런으로 변경 내역 먼저 확인:

```bash
npm run vibe:sync -- --from https://github.com/mir3626/vibe-doctor --dry-run
```

예시 출력:

```
Sync plan: v1.1.1 → v1.4.3

| action        | path                                | detail              |
|---------------|-------------------------------------|---------------------|
| replace       | scripts/vibe-preflight.mjs          | harness updated      |
| new-file      | scripts/vibe-interview.mjs          |                      |
| new-file      | scripts/vibe-project-report.mjs     |                      |
| new-file      | scripts/vibe-dashboard.mjs          |                      |
| new-file      | .claude/skills/vibe-iterate/SKILL.md|                      |
| conflict      | CLAUDE.md                           | locally modified     |
| section-merge | .claude/settings.json               | hooks                |
| skip          | docs/context/product.md             | project-owned        |

Files: 40+ replace, 3 section-merge, 2 json-merge, 15+ new-file, 1 conflict, 6 skip
Migrations: 1.1.0, 1.2.0, 1.2.1, 1.3.0, 1.4.0
```

승인 UX (v1.3.0):

- Conflict 가 없으면 `Proceed? [Y/n]` 1회 확인.
- Conflict 가 있으면 `[a]ccept all / [i]ndividual / [s]kip all / [c]ancel` 4 옵션.
- `--force` 는 기존처럼 모든 conflict 무조건 replace (프롬프트 없음).
- `--json` 은 기계 출력 (approval 프롬프트 없음).

실제 적용:

```bash
npm run vibe:sync -- --from https://github.com/mir3626/vibe-doctor
```

백업은 자동으로 `.vibe/sync-backup/<timestamp>/` 에 생성. 마이그레이션은 `migrations/1.1.0.mjs` → `1.2.0.mjs` → `1.2.1.mjs` → `1.3.0.mjs` 순서로 idempotent 실행.

### 경로 B — `/vibe-sync` 가 없는 레거시 프로젝트

v1.0 이전 템플릿이거나 `/vibe-sync` 메커니즘 없이 시작한 프로젝트는 **one-shot bootstrap 스크립트** 로 업그레이드합니다.

#### B-1. 원격에서 bootstrap 실행 (macOS / Linux / Git Bash)

```bash
curl -fsSL https://raw.githubusercontent.com/mir3626/vibe-doctor/main/scripts/vibe-sync-bootstrap.mjs \
  | node --input-type=module - --project-root . --ref main
```

#### B-1-Win. 원격에서 bootstrap 실행 (Windows — PowerShell / cmd.exe)

Windows 10+ 에는 `curl.exe` 가 기본 내장. 프로젝트 루트에서:

```powershell
curl -sL https://raw.githubusercontent.com/mir3626/vibe-doctor/main/scripts/vibe-sync-bootstrap.mjs | node --input-type=module -
```

> PowerShell 5.1 이하에서는 `curl` 이 `Invoke-WebRequest` alias 라 flag 호환성 문제가 생길 수 있음. 이 경우 `curl.exe` 로 명시하거나 아래 B-2 수동 다운로드 방식 사용.

#### B-2. 수동 다운로드 방식 (모든 플랫폼)

```bash
# 1. bootstrap 스크립트 다운로드
curl -fsSL https://raw.githubusercontent.com/mir3626/vibe-doctor/main/scripts/vibe-sync-bootstrap.mjs \
  -o vibe-sync-bootstrap.mjs

# 2. 프로젝트 루트에서 실행 (필수: --project-root)
node vibe-sync-bootstrap.mjs --project-root . --ref main

# 3. 완료 후 임시 파일 정리
rm vibe-sync-bootstrap.mjs
```

#### B-3. bootstrap 가 하는 일

1. 업스트림 (`mir3626/vibe-doctor`) 을 `--ref main` 또는 `--ref v1.3.0` 으로 shallow clone.
2. 핵심 파일 복사 + 기존 파일은 `.vibe/sync-backup/bootstrap-<timestamp>/` 로 백업:
   - `src/commands/sync.ts`, `src/lib/sync.ts` 및 관련 라이브러리
   - `scripts/vibe-*.mjs`, `scripts/run-*.{sh,cmd}`
   - `.claude/skills/*`, `.claude/agents/*`
   - `.vibe/sync-manifest.json`, `.vibe/sync-manifest.schema.json`
   - `migrations/*.mjs`
3. `package.json` / `.claude/settings.json` 은 **머지** (기존 scripts·permissions 보존, `vibe:*` 스크립트만 교체).
4. `.vibe/config.json` 에 `harnessVersion`, `upstream.url`, `upstream.ref` 기록.
5. 이후부터는 `npm run vibe:sync` 로 일반 싱크 가능.

> 💡 bootstrap 자체는 git clone 권한이 필요하지만 프로젝트 git 히스토리는 건드리지 않습니다. 커밋/푸시는 사용자 책임.

#### B-4. 검증

```bash
node scripts/vibe-preflight.mjs --bootstrap   # all OK 확인
npm test                                       # 기존 테스트 그대로 통과
cat .vibe/config.json | grep harnessVersion    # "1.4.3" 출력
```

### 경로 C — 완전 fresh restart (최후 수단)

기존 커스터마이즈가 거의 없고 그냥 최신 템플릿을 새로 받고 싶다면:

```bash
# 1. 기존 프로젝트의 product.md / architecture.md / conventions.md / src 백업
# 2. 새 폴더에 템플릿 clone
git clone https://github.com/mir3626/vibe-doctor my-project-v2
# 3. 백업한 project-owned 파일들을 my-project-v2 에 복사
# 4. git history 를 옮기고 싶으면 수동 rebase
```

---

## 주요 명령어

### Claude Code 슬래시 커맨드

| 커맨드 | 역할 |
|---|---|
| `/vibe-init` | 초기 설정 + Phase 0 인터뷰 + 로드맵 생성 (1회) |
| `/vibe-interview` | 네이티브 소크라테스식 인터뷰만 단독 실행 (도메인 전문가 probing) |
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
# 환경
npm run vibe:doctor             # 환경 점검 (node/git/CLI 설치)
npm run vibe:init               # 기본 파일 생성 (.env, provider 설정)

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

# 리포트 / 실행
npm run vibe:report -- --title "..."   # 임의 시점 보고서
npm run vibe:run-agent                 # provider 직접 실행
npm run vibe:dashboard                 # 웹 대시보드 opt-in (SSE, 127.0.0.1:5175)
npm run vibe:session-start             # provider-neutral session start checks
npm run vibe:checkpoint                # handoff/session-log checkpoint gate

# 싱크 / 업그레이드
npm run vibe:sync -- --dry-run         # 업스트림 plan 미리보기
npm run vibe:sync                      # 실제 적용 (interactive approval)
npm run vibe:sync -- --force           # 모든 conflict 자동 replace
```

### 독립 스크립트 (`scripts/*.mjs`)

Orchestrator 가 주로 호출합니다. 사용자가 직접 쓸 일은 드뭅니다.

| 스크립트 | 용도 |
|---|---|
| `vibe-preflight.mjs` | Sprint 시작 전 환경 검증 (`--bootstrap` 모드 존재) |
| `vibe-sprint-commit.mjs` | Sprint 단일 커밋 래퍼 (state+산출+LOC+메시지 자동) 🆕 |
| `vibe-sprint-complete.mjs` | sprint-status.json + handoff + session-log 상태 갱신 |
| `vibe-session-log-sync.mjs` | session-log timestamp 정규화·sort·dedup 🆕 |
| `vibe-project-report.mjs` | HTML 보고서 생성 + 브라우저 자동 오픈 🆕 |
| `vibe-phase0-seal.mjs` | Phase 0 산출물 자동 커밋 🆕 |
| `vibe-interview.mjs` | 네이티브 인터뷰 엔진 (state machine + synthesizer) 🆕 |
| `vibe-resolve-model.mjs` | tier → SOTA 모델 ID 해석 🆕 |
| `vibe-model-registry-check.mjs` | SessionStart: upstream registry 변화 감지 🆕 |
| `vibe-agent-session-start.mjs` | Provider-neutral SessionStart entrypoint for Claude/Codex/other CLI providers |
| `vibe-audit-clear.mjs` | Evaluator 감사 후 counter + pendingRisks 마감 🆕 |
| `vibe-sprint-mode.mjs` | permission preset 토글 🆕 |
| `vibe-status-tick.mjs` | statusline 토큰/시간 누적 기록 🆕 |
| `vibe-browser-smoke.mjs` | Playwright smoke contract 검사 🆕 |
| `vibe-gen-schemas.mjs` | Zod source 기반 `.schema.json` drift 검사 / 재생성 |
| `vibe-audit-lightweight.mjs` | per-sprint diff/spec/test/tmp residue 감사 (non-blocking) |
| `vibe-sync-bootstrap.mjs` | 레거시 프로젝트 one-shot 업그레이드 |
| `vibe-version-check.mjs` | SessionStart: 업스트림 버전 비교 |
| `vibe-stop-qa-gate.mjs` | 턴 종료 시 코드 diff 감지 → QA 자동 실행 |
| `vibe-rule-audit.mjs` | CLAUDE.md 명령형 규칙 ↔ harness-gaps coverage 자동 대조 🆕 |
| `vibe-audit-skip-set.mjs` | `.vibe/config.local.json.userDirectives.auditSkippedMode` 토글 🆕 |
| `vibe-planner-skip-log.mjs` | Planner trivial-skip 근거를 session-log `[decision][planner-skip]` 로 기록 🆕 |
| `vibe-dashboard.mjs` | 웹 대시보드 SSE 서버 (opt-in, `npm run vibe:dashboard`) 🆕 |
| `vibe-daily-log.mjs` | 일일 이벤트 타임라인 JSONL (dashboard 백엔드) |
| `vibe-attention.mjs` / `vibe-attention-notify.mjs` | 사용자 개입 필요 이벤트 → dashboard toast / desktop notification |
| `vibe-session-started.mjs` | SessionStart 이벤트 기록 |
| `run-codex.{sh,cmd}` | Codex CLI 래퍼 (UTF-8 + retry + `--health` + auto status-tick) |

---

## 핵심 설계

| 항목 | 내용 |
|---|---|
| 개발 프로세스 | **Phase 0 → Sprint × N → Report → Iterate** 사이클. 기본은 Orchestrator 단독 + self-QA, context pressure·role 충돌·규모 트리거 시 Planner/Evaluator 소환, 소스코드는 **항상** Generator 위임 |
| 메인 Orchestrator | Claude Code (Opus family alias — registry 로 SOTA 자동 추종) |
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
│   ├── statusline.{sh,ps1}        # 커스텀 상태바
│   ├── agents/                    # 서브에이전트 (planner, qa-guardian, context-curator)
│   └── skills/                    # 슬래시 커맨드 (vibe-init, vibe-iterate, vibe-review, ...)
├── .codex/agents/                 # Codex 에이전트 프로필
├── .vibe/
│   ├── config.json                # 프로젝트 기본 provider + harnessVersion (커밋됨)
│   ├── config.local.json          # 로컬 override (git-ignored)
│   ├── model-registry.json        # SOTA tier → model alias 매핑
│   ├── sync-manifest.json         # 하네스 파일 tier (harness/hybrid/project)
│   ├── settings-presets/          # agent-delegation 등 permission preset
│   ├── archive/prompts/           # 완료된 sprint 프롬프트 아카이브
│   └── agent/                     # Orchestrator 상태 (초기화된 상태로 배포)
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
│   ├── plans/                     # sprint-roadmap 등
│   ├── prompts/                   # 현재 진행 중 sprint 프롬프트
│   ├── reports/                   # project-report.html, review-*.md, 완료 보고서
│   └── release/                   # 릴리스 노트 (v1.2.0, v1.2.1, v1.3.0, ...)
├── migrations/                    # 하네스 버전별 마이그레이션
│   ├── 1.0.0.mjs
│   ├── 1.1.0.mjs
│   ├── 1.2.0.mjs
│   ├── 1.2.1.mjs
│   ├── 1.3.0.mjs
│   └── 1.4.0.mjs
├── scripts/                       # 하네스 실행 스크립트 (독립 목록 위 참조)
├── src/
│   ├── commands/                  # vibe:* TypeScript 커맨드
│   ├── lib/                       # 유틸리티 (fs, config, shell, sync, review, iteration, ...)
│   └── providers/runner.ts        # provider-agnostic 실행 플랜
└── test/                          # 유닛·통합 테스트 (node --test)
```

---

## 운영 원칙

1. **사용자는 목적과 승인** 에 집중. 세부 구현은 Orchestrator/Generator 에 위임.
2. **Orchestrator(Claude Code)** 는 Sprint 관리, QA, 보고, 문맥 관리. 소스 코드를 직접 편집하지 않음.
3. **Planner** 는 "무엇을", **Generator** 는 "어떻게" 를 자유롭게 결정. 매 Sprint fresh context.
4. **승인 전에는 비단순 구현 금지**. 계획부터 먼저.
5. **self-QA 또는 Evaluator 합격 없이 완료 선언 금지**.
6. **루트 메모리는 얇게**. 상세 규칙은 skill / context shard 로.
7. **규칙은 가능하면 script hook 으로 강제** (MD 만으로는 Orchestrator 가 잊음). `docs/context/harness-gaps.md` ledger 로 사각지대 추적.

---

## 버전 / tag 정책

- `harnessVersion` 은 `.vibe/config.json` 에 semver (`1.3.0`). downstream `vibe:sync` 가 이 값을 `v${version}` git tag 로 해석.
- 각 minor/patch 릴리스는 해당 커밋에 `vMAJOR.MINOR.PATCH` git tag 부착 후 origin push.
- 릴리스 노트는 `docs/release/vMAJOR.MINOR.PATCH.md`.
- `/vibe-sync -- --ref <tag>` 로 특정 버전 강제 동기화 가능. 기본값: config 의 `harnessVersion` 기준 `v` prefix.

현재 태그:
- `v1.0.0` ~ `v1.0.3` — 초기 하네스
- `v1.1.0` / `v1.1.1` — 프로세스 정제 (Planner 매 Sprint, 단일 커밋)
- `v1.2.0` — 10 Sprint 메타-프로젝트 (M1~M10): 스키마 foundation, native interview, stack shards, model tier, statusline 등
- `v1.2.1` — Ouroboros 완전 제거 패치
- `v1.3.0` — HTML 보고서 + `/vibe-iterate` + `/vibe-review` regression + `.vibe/agent` init 리셋
- `v1.3.1` — statusline agent-tracking + env-var gate (Windows test hang 해결)
- `v1.4.0` — Zod single-source schema + audit gates + rule-audit + harness-gaps ledger
- `v1.4.1` — Harness diet (B/C rule delete, Progressive MD Charter + Soft freeze posture)
- `v1.4.2` — Interview coverage 회계 fix + script-wrapper triage + Planner component-integration 계약
- `v1.4.3` — Review parser false-positive dedup + roadmap heading parser + run-codex token regex Windows 호환 🆕

---

## 트러블슈팅

### `vibe:sync` 가 `pathspec 'v1.x.y' did not match` 로 실패

업스트림에 해당 버전 tag 가 없을 때 발생. 해결책:
- `.vibe/config.json` 의 `harnessVersion` 이 실제 존재하는 tag 인지 확인 (`git ls-remote --tags origin`).
- 없으면 `harnessVersion` 을 최신 존재 tag 로 낮추거나, `--ref main` 옵션으로 main branch 강제.

### `run-codex.sh --health` 가 Windows 에서 실패

- Git Bash 사용 권장. 네이티브 PowerShell/cmd 에서는 `scripts/run-codex.cmd --health` 사용.
- auth 누락 시 `codex auth login` 재실행.

### Preflight 가 handoff stale WARN 표시

- 24시간 이상 `.vibe/agent/sprint-status.json` 이 갱신 안 된 경우. 새 Sprint 시작 전 `/vibe-init` 또는 `/vibe-iterate` 로 상태 refresh.

### `/vibe-iterate` 를 실행했는데 iteration-history.json 이 없다고 함

- 최초 iteration(=iter-1) 은 `/vibe-init` 의 Phase 0 에서 초기화됨. 레거시 프로젝트라 해당 파일이 없다면 `migrations/1.3.0.mjs` 를 수동 실행:
  ```bash
  node migrations/1.3.0.mjs "$(pwd)"
  ```

### HTML 보고서가 브라우저에서 자동으로 안 열림

- `xdg-open`/`open`/`start` 가 없는 최소 환경일 수 있음. 출력된 파일 경로를 수동으로 열거나 `--no-open` 플래그 활용.

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
