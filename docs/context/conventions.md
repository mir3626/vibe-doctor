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

## Windows 호환

- `child_process.spawn` 사용 시 `shell: process.platform === 'win32'` 옵션을 추가한다.
  - Windows에서 `npm` 등은 실제로 `.cmd` 파일이므로 shell 없이 spawn하면 ENOENT 발생.
- Claude Code hook 명령어는 `cmd /c ...` 형태로 작성한다.
