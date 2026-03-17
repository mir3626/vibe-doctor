# Vibe Base for Claude Code · TypeScript Edition

목표는 간단합니다.

> 새 프로젝트를 만들 때마다 다시 프롬프트와 규칙을 깔지 않고, `git clone` 후 바로 같은 프로세스와 품질 기준으로 바이브 코딩을 시작할 수 있게 하는 것

이번 버전은 **TypeScript + Node.js** 기반으로 재설계된 실행 가능한 베이스 프로젝트입니다.
문서만 있는 템플릿이 아니라, Claude Code에서 바로 쓸 수 있는 최소 오케스트레이션 스크립트와 운영 파일을 포함합니다.

## 핵심 설계

- **메인 오케스트레이터**: Claude Code
- **기본 coder**: Codex (설정으로 변경 가능)
- **보조/challenger**: Gemini 또는 Claude
- **언어**: TypeScript (Node.js ESM)
- **컨텍스트 전략**: 얇은 루트 메모리 + 샤딩된 MD + skills
- **실패 에스컬레이션**: 테스트 2회 연속 실패 시 challenger / reviewer용 worktree 생성
- **QA 기본값**: 가능한 스크립트를 자동 감지하여 test → typecheck → lint → build 순으로 실행
- **보안 전략**: repo 내 비밀 저장 금지, `.env`/`secrets`/credential 파일 접근 deny

## 포함된 것

- `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
- `.claude/settings.json` 프로젝트 공용 설정
- `.claude/agents/*` Claude 전용 서브에이전트 정의
- `.claude/skills/*` Claude 전용 스킬
- `.agents/skills/*` Codex / Gemini 참고용 공용 스킬
- `docs/context/*` 샤딩된 운영 문서
- `src/commands/*` TypeScript 기반 실행 스크립트
- `src/providers/*` provider adapter
- `test/*` 최소 단위 테스트
- `.github/workflows/ci.yml` 기본 CI

## 요구 사항

- Node.js 20+
- npm 10+
- git
- 선택 사항: `claude`, `codex`, `gemini` CLI

## 빠른 시작

```bash
npm install
npm run vibe:doctor
npm run vibe:init
```

그다음 Claude Code에서 저장소를 열고 이렇게 시작하면 됩니다.

```text
목표: 관리자 대시보드에 사용자 세그먼트 필터를 추가해줘.
방법론은 네가 먼저 제안하고, 아직 구현하지 말고 계획부터 보여줘.
```

## 자주 쓰는 명령

```bash
npm run vibe:doctor
npm run vibe:init
npm run vibe:qa
npm run vibe:usage
npm run vibe:report -- --title "admin-filter" --summary "세그먼트 필터 구현 완료"
npm run vibe:escalate -- --task-file docs/plans/2026-03-17-admin-filter.md
```

## GitHub에 올리는 방법

이 채팅 환경에서는 사용자의 GitHub에 직접 push 하지는 못합니다.
대신 아래 세 가지를 같이 제공합니다.

- 로컬 커밋이 들어간 저장소
- ZIP 아카이브
- `git bundle` 파일

push만 하면 되는 상태라면 아래만 실행하면 됩니다.

```bash
git remote add origin <YOUR_GITHUB_REPO_URL>
git push -u origin main
```

## 기본 운영 원칙

1. 사용자는 목적과 승인에 집중한다.
2. AI는 계획, 구현, QA, 보고, 문맥 관리에 집중한다.
3. 승인 전에는 비단순 구현을 하지 않는다.
4. 작업 완료 전에는 QA 없이 완료 선언하지 않는다.
5. 루트 메모리는 얇게 유지하고 상세 규칙은 skills / context shard로 분리한다.

## 디렉터리 개요

```text
.
├─ CLAUDE.md
├─ AGENTS.md
├─ GEMINI.md
├─ .claude/
│  ├─ settings.json
│  ├─ agents/
│  └─ skills/
├─ .agents/skills/
├─ .vibe/
│  ├─ config.json
│  └─ config.local.example.json
├─ docs/
│  ├─ context/
│  ├─ orchestration/
│  ├─ plans/
│  ├─ prompts/
│  └─ reports/
├─ src/
│  ├─ commands/
│  ├─ lib/
│  └─ providers/
└─ test/
```

## 현재 템플릿의 성격

이 템플릿은 **LangGraph 같은 장기 상태 머신**이 아니라,
**Claude Code 중심의 경량 TypeScript control plane** 입니다.

즉,
- 시작이 빠르고
- 구조를 이해하기 쉽고
- 프로젝트 템플릿으로 쓰기 좋고
- Claude Code 앱에서 바로 다루기 쉬운 방향

으로 잡았습니다.

필요하면 다음 단계에서 TypeScript 유지한 채 Claude Agent SDK 기반으로 확장하거나, Python + LangGraph 런타임으로 갈아탈 수 있도록 문서 분리를 해두었습니다.
