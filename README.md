# vibe-doctor — Claude Code Vibe Coding Template

> 새 프로젝트마다 프롬프트와 규칙을 다시 깔지 않고, `git clone` 후 바로 같은 프로세스와 품질 기준으로 바이브 코딩을 시작할 수 있게 하는 베이스 템플릿

**Claude Code (Opus 4.6)** 를 메인 오케스트레이터로, **Codex CLI** 를 기본 Generator로 사용하는 Sprint 기반 개발 프로세스입니다.

> ⚠️ **템플릿 주의**: `docs/context/product.md` 와 `docs/context/architecture.md` 는 의도적으로 플레이스홀더 상태입니다. **`git clone` 직후 `/vibe-init` 을 먼저 실행**해서 프로젝트 맥락을 채운 뒤 개발을 시작하세요. 플레이스홀더 상태로 Sprint를 돌리면 Planner가 맥락 없이 작업하게 됩니다.

---

## 빠른 시작

### 1. 이 템플릿으로 새 레포 만들기

GitHub에서 **Use this template** 버튼을 누르거나:

```bash
git clone https://github.com/mir3626/vibe-doctor my-project
cd my-project
```

### 2. 초기 설정

#### Claude Code 사용자 (권장)

`npm install` 없이 바로 시작할 수 있습니다.

```bash
claude   # Claude Code 실행
```

Claude Code 안에서:

```text
/vibe-init
```

Claude가 대화형으로 아래 과정을 **한 번에** 자동 진행합니다:

1. 환경 점검 (node, npm, git, AI CLI 설치 여부)
2. AI Agent 연결 (Sprint 역할별 provider 선택 + 인증 안내)
3. 프로젝트 맞춤 설정 (product, architecture, conventions 문서 생성)

#### 일반 터미널 사용자

```bash
npm install
npm run vibe:doctor   # 환경 점검
npm run vibe:init     # 기본 파일 생성 (.env, provider 설정)
```

> 일반 터미널에서는 기본 파일만 생성됩니다. AI 연결 및 프로젝트 맞춤 설정은 Claude Code의 `/vibe-init`을 사용하세요.

---

## /vibe-init 상세 흐름

Claude Code에서 `/vibe-init`을 실행하면 다음 단계를 대화형으로 진행합니다:

### Phase 1 — 환경 점검

필수 도구(node, npm, git)와 AI Agent CLI(claude, codex 등) 설치 여부를 자동으로 확인합니다.

### Phase 2 — AI Agent 연결

Sprint 역할별로 어떤 AI를 사용할지 선택합니다:

| Sprint 역할 | 책임 | 기본값 | 선택지 |
|-------------|------|--------|--------|
| Planner (스펙 정의) | "무엇을" 만들지 정의 + 체크리스트 | claude-opus | claude-opus / codex / **기타** |
| Generator (코드 구현) | 체크리스트 기반 구현 | codex | codex / claude-opus / **기타** |
| Evaluator (판정) | 합격/불합격 판정 | claude-opus | claude-opus / codex / **기타** |

- **기타**를 선택하면 DeepSeek, Grok 등 커스텀 AI agent를 연결할 수 있습니다.
- 선택한 provider의 CLI가 미설치인 경우, 설치 및 인증 방법을 step-by-step으로 안내합니다.
- 선택 결과에 따라 `.vibe/config.local.json`, `AGENTS.md`, `docs/orchestration/roles.md` 등 관련 파일이 자동으로 업데이트됩니다.

### Phase 3 — 프로젝트 맞춤 설정

| Step | 질문 내용 | 생성 파일 |
|------|-----------|-----------|
| 1/3 | 프로젝트 이름, 설명, 성공 기준, 플랫폼 | `docs/context/product.md` |
| 2/3 | 기술 스택, 호스팅, 데이터 저장 | `docs/context/architecture.md` |
| 3/3 | 프로그래밍 언어, 코드 스타일, 테스트 도구, 추가 규칙 | `docs/context/conventions.md` |

- 코딩 지식이 없어도 예시를 보고 따라 입력할 수 있습니다.
- 모르는 항목은 비워두면 AI가 기술 스택에 맞게 자동 선택합니다.
- 나중에 다시 실행하거나 파일을 직접 편집해도 됩니다.

---

## 요구 사항

- Node.js 20+
- npm 10+
- git
- **Python 3.12+** (ouroboros 인터뷰 엔진에 필요)
- ouroboros-ai (`/vibe-init`의 Phase 3에서 사용 — 아래 설치 안내 참조)
- 선택: `claude`, `codex` CLI

### ouroboros 설치

`/vibe-init`의 프로젝트 맞춤 설정(Phase 3)은 [ouroboros](https://github.com/Q00/ouroboros) 인터뷰 엔진을 사용합니다.
**패키지명은 `ouroboros-ai`** 이며 (`ouroboros` 아님), **Python 3.12 이상**을 요구합니다.

```bash
# 권장: pipx (격리 환경)
pipx install "ouroboros-ai[all]"

# 또는 pip
pip install --user "ouroboros-ai[all]"

# 또는 업스트림 원클릭 스크립트
curl -fsSL https://raw.githubusercontent.com/Q00/ouroboros/main/scripts/install.sh | bash
```

설치 확인:

```bash
python -m ouroboros --version
ouroboros setup   # 초기 설정
```

**자주 발생하는 오류**

- `ERROR: Could not find a version that satisfies the requirement ouroboros-ai`
  → Python이 3.12 미만입니다. `python --version`으로 확인하고 3.12+로 업그레이드하세요.
- `ouroboros`(하이픈 없음)로 설치 시도 → 잘못된 패키지명입니다. 반드시 `ouroboros-ai`.
- Windows에서 MCP 서버가 `✗ Failed to connect`로 뜨는 경우 → `docs/orchestration/providers.md`의 Troubleshooting 참조.

---

## 주요 명령어

### Claude Code 슬래시 커맨드

```text
/vibe-init         # 초기 설정 + 프로젝트 맞춤 설정 (대화형)
/goal-to-plan      # 목표 → Sprint 분할 계획 생성
/self-qa           # QA 검증
/write-report      # 완료 보고서 작성
/maintain-context  # 컨텍스트 문서 업데이트
```

### npm 스크립트

```bash
npm run vibe:doctor                   # 환경 점검
npm run vibe:init                     # 기본 파일 생성
npm run vibe:qa                       # QA 실행 (test → typecheck → lint → build)
npm run vibe:usage                    # 토큰 사용량 요약
npm run vibe:report -- --title "foo"  # 완료 보고서 작성
npm run vibe:escalate -- --task-file docs/plans/my-task.md  # 실패 에스컬레이션
npm run vibe:run-agent                # provider 직접 실행
npm run vibe:config-audit             # 설정 감사 (시크릿 누출 검사)
```

---

## 핵심 설계

| 항목 | 내용 |
|------|------|
| 개발 프로세스 | Sprint 기반 (Planner → Generator → Evaluator) |
| 메인 오케스트레이터 | Claude Code (Opus) |
| 기본 Generator | Codex (`/vibe-init`에서 변경 또는 커스텀 AI 연결 가능) |
| 언어 | TypeScript (Node.js ESM) |
| 컨텍스트 전략 | 얇은 루트 메모리 + 샤딩된 MD + skills |
| 실패 에스컬레이션 | Evaluator 2회 연속 불합격 시 Planner 재생성 또는 사용자 에스컬레이션 |
| QA 기본값 | test → typecheck → lint → build 자동 감지 실행 |
| 보안 | `.env` / `secrets` / credential 파일 git 제외 + 자동 감사 훅 |

---

## 디렉터리 구조

```text
.
├── CLAUDE.md                  # Orchestrator 규칙 (Sprint 프로세스)
├── AGENTS.md                  # Generator(Codex) 규칙
├── GEMINI.md                  # 보조 에이전트 규칙
├── .env.example               # 환경변수 템플릿 (커밋됨)
├── .claude/
│   ├── settings.json          # Claude Code 프로젝트 설정 + 보안 훅
│   ├── agents/                # 서브에이전트 (planner, qa-guardian, context-curator)
│   └── skills/                # Claude 전용 스킬 (vibe-init, goal-to-plan 등)
├── .codex/
│   └── agents/                # Codex 에이전트 프로필 (coder, explorer)
├── .vibe/
│   ├── config.json            # 프로젝트 기본 provider 설정 (커밋됨)
│   ├── config.local.json      # 로컬 override (gitignore)
│   └── config.local.example.json  # 로컬 설정 템플릿 (커밋됨)
├── docs/
│   ├── context/               # 샤딩된 컨텍스트 (product, architecture, conventions 등)
│   ├── orchestration/         # Sprint 역할, provider, 에스컬레이션 정책
│   ├── plans/                 # 작업 계획 보관
│   ├── prompts/               # 마스터 프롬프트
│   └── reports/               # 작업 완료 보고서
├── src/
│   ├── commands/              # vibe:* 실행 스크립트
│   ├── lib/                   # 유틸리티 (fs, config, shell 등)
│   └── providers/             # provider runner adapter
└── test/                      # 유닛 테스트 (args, config, usage)
```

---

## 운영 원칙

1. 사용자는 목적과 승인에 집중한다.
2. Orchestrator(Claude)는 Sprint 관리, QA, 보고, 문맥 관리에 집중한다.
3. Planner는 "무엇을"만, Generator는 "어떻게"를 자유롭게 결정한다.
4. 승인 전에는 비단순 구현을 하지 않는다.
5. 작업 완료 전에는 Evaluator 합격 없이 완료 선언하지 않는다.
6. 루트 메모리는 얇게 유지하고 상세 규칙은 skills / context shard로 분리한다.

---

## Claude Code에서 시작하는 방법

저장소를 열고 이렇게 시작합니다:

```text
/vibe-init
```

초기 설정이 완료되면 목표를 말하세요:

```text
목표: [여기에 작업 목표 입력]
방법론은 먼저 제안하고, 승인 전에는 구현하지 말고 계획부터 보여줘.
```
