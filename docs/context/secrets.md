# Secrets policy

## 기본 규칙
- `.env`, `.env.*`, `secrets/**`, `config/credentials.json`은 repo에 저장하지 않는다.
- 단순 base64 인코딩은 보안 대책이 아니다.
- 자격증명은 OS 키체인, provider CLI 로그인 캐시, gitignored local config를 우선 사용한다.
- 민감 파일 접근은 필요 시 최소 범위만 허용한다.

## 환경변수 관리

`npm run vibe:init` 실행 시 `.env.example`을 복사해 `.env`를 자동 생성한다.

| 파일 | git 커밋 | 용도 |
|------|----------|------|
| `.env.example` | O (커밋) | 변수 목록 및 설명 템플릿 |
| `.env` | X (gitignore) | 실제 키/토큰 값 |

## Provider 인증 우선순위

| Provider | 권장 방식 | 대체 방식 |
|----------|-----------|-----------|
| claude | `claude` CLI 로그인 | `ANTHROPIC_API_KEY` |
| codex | `codex login --device-auth` | `OPENAI_API_KEY` |
| gemini | `gemini` OAuth 브라우저 로그인 | `GEMINI_API_KEY` |

CLI 로그인 캐시(`~/.codex/auth.json`, `~/.gemini/`)는 프로젝트 외부에 저장되므로 git에 노출되지 않는다.
