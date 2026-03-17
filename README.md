# vibe-base — Claude Code TypeScript Template

> 새 프로젝트마다 프롬프트와 규칙을 다시 깔지 않고, `git clone` 후 바로 같은 프로세스와 품질 기준으로 바이브 코딩을 시작할 수 있게 하는 베이스 템플릿

**Claude Code** 를 메인 오케스트레이터로, **Codex** 를 기본 coder로, **Gemini** 를 challenger로 사용하는 3-provider 경량 오케스트레이션 구조입니다.

---

## 빠른 시작

### 1. 이 템플릿으로 새 레포 만들기

GitHub에서 **Use this template** 버튼을 누르거나:

```bash
git clone https://github.com/mir3626/vibe-doctor my-project
cd my-project
```

### 2. 의존성 설치 및 초기화

```bash
npm install
npm run vibe:init     # .env, .vibe/config.local.json 자동 생성
npm run vibe:doctor   # 환경 점검
```

### 3. Provider 인증

| Provider | 인증 방법 |
|----------|-----------|
| claude | `claude` CLI 로그인 (Claude Code 기본 제공) |
| codex | `codex login --device-auth` |
| gemini | `gemini` 실행 후 브라우저 Google 로그인 |

### 4. 프로젝트에 맞게 커스터마이징

클론 후 아래 파일들을 프로젝트에 맞게 수정합니다:

| 파일 | 수정 내용 |
|------|-----------|
| `docs/context/product.md` | 프로젝트 목표, 성공 기준 |
| `docs/context/architecture.md` | 디렉터리 구조, 레이어 설명 |
| `docs/context/conventions.md` | 언어/프레임워크별 코드 규칙 |
| `.vibe/config.local.json` | 기본 provider 역할 조정 |

---

## 요구 사항

- Node.js 20+
- npm 10+
- git
- 선택: `claude`, `codex`, `gemini` CLI

---

## 주요 명령어

```bash
npm run vibe:doctor                   # 환경 점검
npm run vibe:init                     # 초기 설정 생성
npm run vibe:qa                       # QA 실행
npm run vibe:usage                    # 토큰 사용량 요약
npm run vibe:report -- --title "foo"  # 완료 보고서 작성
npm run vibe:escalate -- --task-file docs/plans/my-task.md  # 테스트 실패 에스컬레이션
npm run vibe:run-agent                # provider 직접 실행
npm run vibe:config-audit             # 설정 감사
```

---

## 핵심 설계

| 항목 | 내용 |
|------|------|
| 메인 오케스트레이터 | Claude Code |
| 기본 coder | Codex (`.vibe/config.local.json`에서 변경 가능) |
| Challenger | Gemini (`.vibe/config.local.json`에서 변경 가능) |
| 언어 | TypeScript (Node.js ESM) |
| 컨텍스트 전략 | 얇은 루트 메모리 + 샤딩된 MD + skills |
| 실패 에스컬레이션 | 테스트 2회 연속 실패 시 challenger / reviewer worktree 생성 |
| QA 기본값 | test → typecheck → lint → build 자동 감지 실행 |
| 보안 | `.env` / `secrets` / credential 파일 git 제외 |

---

## 디렉터리 구조

```text
.
├── CLAUDE.md                  # Claude 오케스트레이터 규칙
├── AGENTS.md                  # 범용 에이전트 규칙
├── GEMINI.md                  # Gemini 규칙
├── .env.example               # 환경변수 템플릿 (커밋됨)
├── .claude/
│   ├── settings.json          # Claude Code 프로젝트 설정
│   ├── agents/                # 서브에이전트 정의 (planner, qa-guardian, context-curator)
│   └── skills/                # Claude 전용 스킬
├── .agents/skills/            # 범용 스킬 (Codex / Gemini 공용)
├── .vibe/
│   ├── config.json            # 공유 provider 설정
│   └── config.local.json      # 로컬 override (gitignore)
├── docs/
│   ├── context/               # 샤딩된 컨텍스트 문서 (product, arch, conventions 등)
│   ├── orchestration/         # 역할, provider, 에스컬레이션 정책
│   ├── plans/                 # 작업 계획 보관
│   ├── prompts/               # 마스터 프롬프트
│   └── reports/               # 작업 완료 보고서
├── src/
│   ├── commands/              # vibe:* 실행 스크립트
│   ├── lib/                   # 유틸리티 (fs, config, shell 등)
│   └── providers/             # provider runner adapter
└── test/
```

---

## 운영 원칙

1. 사용자는 목적과 승인에 집중한다.
2. AI는 계획, 구현, QA, 보고, 문맥 관리에 집중한다.
3. 승인 전에는 비단순 구현을 하지 않는다.
4. 작업 완료 전에는 QA 없이 완료 선언하지 않는다.
5. 루트 메모리는 얇게 유지하고 상세 규칙은 skills / context shard로 분리한다.

---

## Claude Code에서 시작하는 방법

저장소를 열고 이렇게 시작합니다:

```text
목표: [여기에 작업 목표 입력]
방법론은 먼저 제안하고, 승인 전에는 구현하지 말고 계획부터 보여줘.
```
