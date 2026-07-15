# Pro Bridge MCP Mailbox Setup

Phase 2의 MCP mailbox는 로컬 파일 저장소와 세션 한정 HTTP 서버를 사용해 ChatGPT 웹 세션과 결과를 왕복한다. GitHub 앱은 저장소를 읽고, Vibe Pro Bridge 커넥터는 `.vibe/pro-bridge/` mailbox namespace에만 요청·결과를 쓴다.

## 1. 사전조건

`.vibe/config.local.json` 또는 `.vibe/config.json`에서 Pro Bridge를 명시적으로 활성화하고 transport를 선택한다.

```json
{
  "proBridge": {
    "enabled": true,
    "transport": "mcp-mailbox",
    "mcp": {
      "port": 8848,
      "tunnel": "cloudflared"
    }
  }
}
```

`tunnel`은 `cloudflared`, `ngrok`, `none` 중 하나다. cloudflared quick tunnel은 보통 계정 없이 쓸 수 있다. ngrok은 로컬 설치와 계정 설정이 필요할 수 있다. `none`은 로컬 테스트용이며 웹 ChatGPT에서는 접근할 수 없다.

ChatGPT GitHub 앱도 연결하고 대상 repository를 승인한다. Private repository는 설정에서 명시적으로 승인해야 한다.

## 2. 세션 서버 기동

```text
npm run vibe:pro-mcp
```

커맨드는 로컬 URL, 가능한 경우 터널 공개 URL, 그리고 토큰이 포함된 connector URL을 출력한다. connector URL은 현재 서버 세션에서만 사용한다. 파일, 설정, 채팅 외부 메모, session-log에 저장하거나 공유하지 않는다. 서버를 재시작하면 토큰이 다시 발급된다.

## 3. ChatGPT Developer Mode 1회 등록

1. ChatGPT Settings → Connectors(Apps) → Advanced에서 Developer mode를 활성화한다.
2. 새 커넥터를 만들고 `vibe:pro-mcp`가 출력한 터널 connector URL 전체를 입력한다.
3. 인증은 `None`을 선택한다. 세션 토큰은 URL query로 전달된다.
4. GitHub 앱 연결과 repository 승인은 Phase 1과 동일하게 유지한다.

서버 재시작으로 URL 또는 토큰이 바뀌면 해당 세션의 connector URL을 갱신한다.

## 4. 리뷰 왕복

1. CLI에서 audit 또는 design 요청을 발행한다.
2. 웹 대화에서 GitHub와 Vibe Pro Bridge 커넥터를 활성화한다.
3. `@Vibe Pro Bridge review <request-id>` 취지의 invocation을 보낸다.
4. 웹 리뷰어가 request를 claim하고 결과 파일을 chunk upload한 뒤 finalize하도록 둔다.
5. 결과가 도착하면 로컬에서 `npm run vibe:pro-sync`를 실행한다. 클립보드 복사는 필요 없다.

Pro 모드 대화에서 connector write tool이 호출되지 않으면 Pro로 추론을 마친 뒤 같은 대화에서 모델을 전환해 제출 턴(`begin_result`, `put_result_file`, `finalize_result`)만 실행한다. 그래도 불가능하면 vibe-bundle을 출력하고 `npm run vibe:pro-sync -- --from <file>` Phase 1 경로로 돌아간다.

## 5. 보안·수명 경계

- 토큰과 터널 URL은 비영속이며 서버 재시작 시 폐기·재발급된다. 서버 로그는 query와 인증 값을 기록하지 않는다.
- 성공한 finalize는 불변이다. 동일 manifest replay만 idempotent하고, 수정 결과는 predecessor manifest SHA에 연결된 revision으로 올린다.
- 웹 write scope는 bridge mailbox namespace뿐이다. GitHub write, commit/push, 기존 result 변경, 임의 로컬 파일 접근 권한은 없다.
- 서버와 터널은 명시적으로 `vibe:pro-mcp`를 실행한 왕복 세션 동안만 존재하며 hook, Stop QA, PreCompact, Sprint gate와 연결되지 않는다.
- 서버 종료는 Ctrl+C를 사용한다.

