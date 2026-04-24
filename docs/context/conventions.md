# Conventions

<!-- 이 파일을 프로젝트 언어/프레임워크에 맞게 수정하세요 -->

## 기본 규칙 (템플릿 기본값)

- TypeScript는 `strict` 기준으로 유지한다.
- 런타임 의존성은 최소화한다.
- 가능하면 Node 표준 라이브러리를 우선 사용한다.
- 변경은 최소 범위로 한다.
- 로그는 사람이 읽기 쉽게 남긴다.
- 스크립트는 실패 원인을 명확히 출력한다.
- 문서/보고서는 짧고 결정 사항 중심으로 유지한다.

## 프로젝트별 규칙

- **언어 / 런타임**: TypeScript (Node.js)
- **네이밍**: camelCase
- **테스트**: Vitest

## 인코딩

- 별도 요청이 없으면 항상 **UTF-8** 인코딩을 사용한다.
- 파일 I/O, 스트림, DB 연결, HTTP 응답 등 인코딩이 관여하는 코드에서 명시적으로 `utf-8`을 지정한다.
- CSV/JSON/텍스트 파일 생성 시 BOM 없는 UTF-8을 기본으로 사용한다.

## 크로스 플랫폼

- `child_process.spawn` 사용 시 `shell: process.platform === 'win32'` 옵션을 추가한다.
  - Windows에서 `npm` 등은 실제로 `.cmd` 파일이므로 shell 없이 spawn하면 ENOENT 발생.
- Windows에서 `.sh` provider wrapper를 실행해야 할 때는 bare `bash` 대신 Git Bash의 절대 경로를 사용한다.
  - `C:\Users\<user>\AppData\Local\Microsoft\WindowsApps\bash.exe` 는 WSL launcher이므로 Windows-native wrapper 실행 경로로 사용하지 않는다.
  - WSL에서는 Linux용 `node`/`codex`를 별도 설치한다. `/mnt/c/.../npm/codex` 같은 Windows npm shim을 Linux 도구로 간주하지 않는다.
- Claude Code hook 명령어는 플랫폼별 래퍼 없이 `npm run ...` 형태로만 작성한다.
  - Claude Code가 OS에 맞는 셸로 알아서 실행하므로 `cmd /c` 접두사는 Unix에서 깨지고 Windows에서는 이중 셸을 유발한다.
- 셸 스크립트(`.sh`)는 반드시 LF 줄 끝으로 커밋한다 (`.gitattributes`가 강제).

### 환경변수 주입 (실행 시)

`FOO=bar command` 형태의 인라인 변수 주입은 POSIX 셸(bash/zsh/Git Bash) 전용이며
Windows 네이티브 PowerShell/cmd에서는 동작하지 않는다. 문서/README에 실행 예시를 적을
때는 아래 3종을 모두 표기하거나 `.env.local`을 권장한다.

| 셸 | 예시 |
|---|---|
| bash / zsh / Git Bash | `APP_PASSWORD=xxx npm run dev` |
| PowerShell | `$env:APP_PASSWORD="xxx"; npm run dev` |
| cmd.exe | `set APP_PASSWORD=xxx && npm run dev` |
| 크로스플랫폼 (권장) | `.env.local`에 `APP_PASSWORD=xxx` 기록 후 `npm run dev` |

## Node 24 + TypeScript 실행 규약

vibe-doctor와 다운스트림 프로젝트는 **Node 24+** 를 가정한다. Node 24의 type-stripping
덕분에 별도 빌드 없이 `.ts` 파일을 `node` 명령으로 직접 실행할 수 있다.

### smoke / 검증 스크립트 패턴

- **스크립트 자체는 `.mjs`** 로 작성한다. 이유: Node가 `.ts`를 실행할 때 타입 주석만
  떼어내므로 top-level await, ESM import 등은 문제없지만, 스크립트 안에서 TS 문법
  (interface/as 캐스트)을 쓰면 혼란스럽다. `.mjs`는 순수 ESM JS로 유지한다.
- **repo/lib 코드는 `.ts`로 직접 import** 한다. 예:
  ```js
  // scripts/book-repo-smoke.mjs
  import { createBook, listBooks } from '../lib/repo/books.ts';
  ```
- 이 import가 `tsc --noEmit`에서 에러 없이 통과하려면 **tsconfig에 아래 옵션 필수**:
  ```json
  {
    "compilerOptions": {
      "allowImportingTsExtensions": true,
      "noEmit": true
    }
  }
  ```
- 각 smoke 스크립트는 **전용 SQLite DB 파일**(`data/*-smoke.db`)을 사용하고 실행 시작 시
  기존 파일을 지워 결정성을 확보한다.
- 성공 시 고유 토큰(`SMOKE OK`, `AUTH SMOKE OK` 등)을 stdout에 출력해서 Orchestrator가
  grep으로 검증할 수 있게 한다.

## 모델 표기 규칙

이 저장소는 Claude/Codex/기타 모델을 여러 맥락에서 언급한다. 혼란을 줄이려면 다음 구분을 지킨다.

| 맥락 | 표기 | 예시 |
|------|------|------|
| 사람이 읽는 문서 · 설명 | **표시명** (버전 포함) | "Claude Opus 4.6", "GPT-5 Codex" |
| 코드 · 설정 파일 (`.vibe/config*.json`, sprintRoles 등) | **설정 ID** (kebab-case, 버전 없음) | `claude-opus`, `codex`, `claude-sonnet` |
| Anthropic API 모델 ID | **공식 모델 ID** | `claude-opus-4-6`, `claude-haiku-4-5-20251001` |

- 표시명과 설정 ID를 같은 문장에서 혼용하지 않는다. 문서에서 설정을 언급할 땐 백틱을 씌워 코드로 표시한다.
- 신규 provider를 추가할 때 표시명/설정 ID/공식 모델 ID 3종을 한 번에 `docs/orchestration/providers.md`에 등록한다.
