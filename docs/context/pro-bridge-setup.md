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
      "port": 18488,
      "tunnel": "cloudflared"
    }
  }
}
```

`tunnel`은 `cloudflared`, `ngrok`, `none` 중 하나다. cloudflared quick tunnel은 보통 계정 없이 쓸 수 있다. ngrok은 로컬 설치와 계정 설정이 필요할 수 있다. `none`은 로컬 테스트용이며 웹 ChatGPT에서는 접근할 수 없다.

ChatGPT GitHub 앱도 연결하고 대상 repository를 승인한다. Private repository는 설정에서 명시적으로 승인해야 한다.

## 2. 세션 서버 기동

기본 code는 서버 세션 한정이지만, `persistentCode`를 명시한 noauth-local 프로파일은 재시작 간 같은 code를 유지한다. 고정 `tunnelUrl`과 함께 쓰면 같은 connector URL을 재등록 없이 계속 사용할 수 있다.

```text
npm run vibe:pro-mcp
```

커맨드는 로컬 URL, 가능한 경우 터널 공개 URL, 그리고 one-time connect code가 포함된 connector URL을 한 번 출력한다. code는 첫 유효 연결에서 현재 서버 인스턴스의 메모리 세션에 바인딩되며, 같은 고정 URL로 이어지는 initialize와 tool 호출을 승인한다. connector URL은 현재 서버 세션에서만 사용하고 파일, 설정, 채팅 외부 메모, session-log에 저장하거나 공유하지 않는다. 서버를 재시작하면 기존 code와 세션 자격은 모두 무효가 된다.

## 3. ChatGPT Developer Mode 1회 등록

1. ChatGPT Settings → Connectors(Apps) → Advanced에서 Developer mode를 활성화한다.
2. 새 커넥터를 만들고 `vibe:pro-mcp`가 출력한 터널 connector URL 전체를 입력한다.
3. 인증은 `None`을 선택한다. URL의 값은 재사용 bearer가 아니라 현재 서버 인스턴스에 세션을 바인딩하는 교환용 one-time code다.
4. GitHub 앱 연결과 repository 승인은 Phase 1과 동일하게 유지한다.

서버 재시작으로 code가 바뀌면 해당 세션의 connector URL을 갱신한다.

## 4. 리뷰 왕복

현재 기대 도구 카탈로그 버전은 `2`다. 긴 리뷰를 시작하기 전에 가능하면 `vibe-pro-bridge.mjs doctor "<connector-url>"`로 실 서버 metadata와 `publish_review_package`를 먼저 진단한다.

1. CLI에서 audit 또는 design 요청을 발행한다.
2. 웹 대화에서 GitHub와 Vibe Pro Bridge 커넥터를 활성화한다.
3. `@Vibe Pro Bridge review <request-id>` 취지의 invocation을 보낸다.
4. 웹 리뷰어는 `get_request`로 요청과 완료 계약을 읽고, 정상 크기 패키지는 `publish_review_package` 한 번으로 발행한다. 정상 왕복은 `get_request → publish_review_package` 두 콜이다.
5. `publish_review_package`가 `chunked-upload-required`를 반환한 경우에만 열린 upload session에 `put_result_file`을 반복하고 `finalize_result`로 마친다. 기존 세션을 명시적으로 재개하는 경우에도 이 저수준 경로를 사용한다.
6. Bridge가 `status=result-ready`와 requestId/resultId/proposedFolder/resultManifestSha256 receipt를 반환해야 웹 리뷰가 완료된다. 결과가 도착하면 로컬에서 `npm run vibe:pro-sync`를 실행한다. 클립보드 복사는 필요 없다.

`finalize_result` 호출에서 manifest의 `requestPayloadSha256`와 `payloadSha256`는 생략할 수 있다. 서버가 저장된 request와 canonical manifest를 기준으로 두 값을 채우며, 리뷰어가 값을 제공한 경우에는 일치 여부를 검증한다. 따라서 웹 리뷰어가 채팅에서 canonical SHA-256을 직접 계산할 필요가 없다.

Pro 모드 대화에서 connector write tool이 호출되지 않으면 Pro로 추론을 마친 뒤 같은 대화에서 모델을 전환해 제출 턴(`publish_review_package`, 필요 시 반환된 fallback 계획의 `put_result_file`·`finalize_result`)만 실행한다. 그래도 불가능하면 vibe-bundle을 출력하고 `npm run vibe:pro-sync -- --from <file>` Phase 1 경로로 돌아간다.

CLI-origin 요청에 로컬 patch가 있으면 상한 내 patch는 manual과 mailbox 양쪽의 review prompt에 fenced diff로 포함된다. manual outbox에는 크기와 무관하게 `<requestDir>/patch.diff`도 생성된다. 인라인 상한을 넘으면 CLI가 해당 파일을 리뷰 대화에 직접 첨부하라고 안내한다. mailbox wire는 상한 초과 patch를 별도로 가져오는 도구가 아직 없으므로, 이 경우 manual artifact 첨부 경로를 사용한다.

## 5. 보안·수명 경계

- connect code, 내부 세션 자격, 터널 URL은 비영속이며 서버 인스턴스에만 존재한다. 첫 연결의 code 교환은 멱등 세션 바인딩이고, 교환 전 code와 바인딩된 세션에는 각각 만료 시간이 적용된다. Ctrl+C 또는 `close()`는 code와 세션 자격을 즉시 전량 revoke한다.
- connector URL 외의 출력과 서버 로그에는 재사용 가능한 capability 값이 나타나지 않는다. 서버 로그는 pathname만 기록하고 query와 Authorization 값을 기록하지 않는다. 다만 외부 터널 제공자·프록시의 URL 보존 정책은 로컬 서버가 통제할 수 없으므로 provider access log를 끄거나 세션 종료 직후 폐기되는지 확인한다.
- 성공한 finalize는 불변이다. 동일 manifest replay만 idempotent하고, 수정 결과는 predecessor manifest SHA에 연결된 revision으로 올린다.
- 웹 write scope는 bridge mailbox namespace뿐이다. GitHub write, commit/push, 기존 result 변경, 임의 로컬 파일 접근 권한은 없다.
- 서버와 터널은 명시적으로 `vibe:pro-mcp`를 실행한 왕복 세션 동안만 존재하며 hook, Stop QA, PreCompact, Sprint gate와 연결되지 않는다.
- 서버 종료는 Ctrl+C를 사용한다.

## 포트 트러블슈팅

`vibe:pro-mcp`가 `EACCES` 또는 `EADDRINUSE`로 listen에 실패하면 Windows WinNAT 제외 포트 대역과 다른 프로세스의 점유를 먼저 확인한다.

```text
netsh interface ipv4 show excludedportrange protocol=tcp
```

기본 포트 18488은 실측 제외 대역 예시인 8827–8926을 피한다. 환경에 따라 제외 대역은 달라질 수 있으므로 `npm run vibe:pro-mcp -- --port <n>` 또는 `.vibe/config.local.json`의 `proBridge.mcp.port`로 오버라이드한다.

## Web-origin 설계 (Phase 3)

웹에서 설계를 시작하기 전에 `npm run vibe:pro-mcp`를 기동하고 해당 세션의 connector URL이 유효한지 확인한다. 웹 세션은 `create_design_request`에 repository fullName, 실제 GitHub head SHA, 선택적 branch/base SHA, goal을 전달한다. 반환된 request id를 `get_request`로 읽고 정상 크기 결과는 `publish_review_package`로 발행한다. `chunked-upload-required`가 반환되면 facade가 이미 연 upload session에서 `put_result_file` 반복 → `finalize_result` 순서로 fallback을 완료한다.

로컬에서는 `npm run vibe:pro-sync -- --latest`가 현재 repository fullName, 아직 import되지 않은 result-ready 상태, 선택적 `--kind`, 최신 생성 시각을 기준으로 결과를 고른다. web-origin manifest의 reviewed HEAD가 로컬 HEAD와 다르면 설치가 중단되며, 검토 후 `--accept-head-mismatch`로 명시 승인할 수 있다.

서버나 터널을 사용할 수 없으면 웹 응답을 vibe-bundle로 출력하되 `requestId: web-origin`을 사용하고, `npm run vibe:pro-sync -- --from <file>` manual fallback으로 반입한다.

## Codex App Server goal source — unavailable (확정)

현재 지원 기준에서 Codex App Server goal source는 `unavailable`로 확정한다. 2026-07 Orchestrator 실측 환경의 Codex CLI는 v0.144.3이지만 `codex app-server`의 안정된 JSON-RPC 표면을 검증하지 못했으므로, 하네스는 `codex-app-server-api-unverified`를 반환하고 결정적 fallback(`vibe-goal-iterate` → handoff/history → git reconstruction)을 사용한다. fallback 결과는 `high` 또는 `reconstructed`로만 라벨하며 `exact`로 표시하지 않는다.

별도 Sprint에서 어댑터를 구현하기 전 다음 순서로 공개 API를 실측한다.

1. `codex --version`으로 대상 CLI 버전을 기록한다.
2. `codex app-server` 서브커맨드 존재 여부와 `codex app-server --help`의 공개 표면을 확인한다.
3. 문서화된 JSON-RPC handshake로 `initialize` → repository cwd/git metadata를 포함한 thread 목록 → 선택 thread의 명시적 goal 조회를 검증한다.
4. 성공 판정은 repository가 다른 thread를 배제하고, 활성·완료 goal을 결정적으로 순위화하며, 명시적 goal metadata만으로 동일 결과를 재현하는 것이다.
5. private model reasoning에는 접근하지 않는다. 허용 입력은 사용자 메시지, 명시적 goal metadata, tool 결과, committed artifact뿐이다.

위 handshake와 필드 의미가 안정적으로 검증된 뒤에만 실제 어댑터 구현 Sprint로 진입한다. 그 전에는 reconstruction 한계를 사용자에게 표시하고 fallback을 정상 지원 경로로 취급한다.

## 옵션 어댑터 (Phase 4, 명시 opt-in)

- `workspace-agent`: `proBridge.workspaceAgent.enabled`와 `triggerCommand`를 설정한다. trigger 성공은 접수 확인일 뿐이며 완료 판단은 bridge status만이 authoritative하다. ready 상태를 벗어난 요청은 중복 trigger하지 않는다.
- `responses-api`: `proBridge.api.enabled`, model, effort, token/가격 설정을 명시한다. `OPENAI_API_KEY`는 환경변수로만 전달하고 config에 저장하지 않는다. model은 config에 직접 지정하며 model-registry를 확장하지 않는다. 실행 전에 입력·출력 token과 비용을 추정하고 승인하며, retry는 최대 1회다. provenance surface는 `responses-api`로 강제 기록되어 Web Pro 리뷰와 구분된다.
- `vibe:pro-apply`: 설치된 `<folder>/prompt/CLI_MAIN_SESSION_PROMPT.md`를 codex cloud에 제출한다. `.vibe/config.local.json`의 `proBridge.apply.envId`가 필요하며, 이후 `codex cloud status`와 `codex cloud diff`로 확인한다. 자동 merge/apply는 수행하지 않는다.

## 도구 카탈로그 진단 (doctor / catalog-audit)

긴 웹 리뷰를 시작하기 전에 현재 connector URL을 대상으로 실 서버 진단을 실행한다.

```text
node .vibe/harness/scripts/vibe-pro-bridge.mjs doctor "<connector-url>"
```

doctor는 원시 `initialize → tools/list → tools/call(bridge_capabilities)` 왕복으로 서버 도달성, `publish_review_package` 존재 여부, 14개 도구의 annotations·outputSchema·visibility·scope 메타데이터, 카탈로그 버전을 확인한다. 현재 기대 카탈로그 버전은 `2`다. connector URL의 `?code=`를 사용한 진단은 현재 서버 세션에 연결을 바인딩하지만 같은 code는 session TTL 동안 멱등 재사용되므로 이후 ChatGPT 연결을 막지 않는다.

실 서버 없이 로컬 카탈로그와 커밋된 review snapshot만 대조하려면 다음을 실행한다.

```text
node .vibe/harness/scripts/vibe-pro-bridge.mjs catalog-audit
```

snapshot을 의도적으로 갱신할 때만 `catalog-audit --write-snapshot`을 사용하고, 생성된 diff를 반드시 검토한다. doctor와 catalog-audit는 모두 명시 호출 전용이며 hook, Stop QA, PreCompact, sprint-complete 또는 정기 QA에 연결되지 않는다.

## ChatGPT 메타데이터 Refresh

서버를 배포·재시작했어도 기존 ChatGPT 앱 대화에는 이전 도구 metadata snapshot이 남을 수 있다. 다음 순서로 갱신한다.

1. Bridge 서버를 배포하거나 재시작하고 새 connector URL이 응답하는지 확인한다.
2. ChatGPT Settings > Plugins에서 등록한 Vibe Pro Bridge 앱을 연다.
3. 앱 상세 화면에서 Refresh를 실행한다.
4. 도구 목록에 `publish_review_package`와 `bridge_capabilities`가 있고 카탈로그 버전이 `2`인지 확인한다.
5. 새 대화를 시작한다.
6. GitHub와 Vibe Pro Bridge 앱을 새 대화에 attach한다.
7. 승인된 golden prompt를 다시 실행해 tool selection과 write 왕복을 확인한다.

Published plugin은 새 metadata snapshot을 반영하려면 재심사가 필요할 수 있다. 권장 앱 권한은 처음에는 **Ask before making changes**이며, 신뢰가 쌓인 뒤 필요하면 **Ask only before important changes**로 완화한다.

## 인증 프로파일 (noauth-local / oauth)

기본 `noauth-local`은 connector URL의 code를 현재 서버 인스턴스 세션에 교환하는 기존 방식이다. `authMode: "oauth"`는 모든 `/mcp` POST에 Bearer 토큰을 요구하고, 도구별 scope를 검사한다. 로컬 검증용 정적 토큰은 반드시 git 미추적 `.vibe/config.local.json`에만 둔다.

```json
{
  "proBridge": {
    "mcp": {
      "authMode": "oauth",
      "oauthTokens": {
        "replace-with-a-local-secret": [
          "bridge.request.read",
          "bridge.result.write"
        ]
      }
    }
  }
}
```

| Scope | 허용 작업 |
|---|---|
| `bridge.request.read` | 요청 목록·요청 전문 읽기 |
| `bridge.request.write` | 요청 생성·claim·cancel |
| `bridge.result.read` | 결과 manifest·파일 읽기 |
| `bridge.result.write` | 결과 facade 발행·chunk 업로드·finalize |
| `bridge.import.ack` | CLI import receipt 확인 |

Web 리뷰 프로파일은 보통 `bridge.request.read + bridge.result.write`, CLI importer는 `bridge.result.read + bridge.import.ack`가 필요하다. scope가 부족하면 Bridge는 plain HTTP 403 대신 JSON-RPC `insufficient_scope`와 `_meta["mcp/www_authenticate"]` challenge를 반환한다. OAuth-aware 클라이언트는 이 challenge를 재인가 지점으로 사용한다. 현재 구현은 protected-resource metadata, 도구별 security scheme, runtime challenge까지 제공하지만 실제 OAuth Authorization Server와 ChatGPT linking UI 완주는 범위 밖이다.

개인 ChatGPT 앱 권한은 처음에 **Ask before making changes**를 권장하고, 충분히 신뢰한 뒤 필요하면 **Ask only before important changes**로 완화한다. write 확인 대화상자는 scope 재인가가 필요한 지점이다. 권한이나 auth 프로파일을 바꾼 뒤에는 위 **ChatGPT 메타데이터 Refresh** 절을 수행하고 새 대화를 시작한다.

## 연결 영속화 (persistentCode + 고정 도메인)

기본값은 서버마다 새 임의 code와 quick tunnel URL을 쓰는 세션 한정 방식이며 보안상 가장 보수적이다. `persistentCode`를 설정한 noauth-local 프로파일만 code를 서버 재시작 간 유지한다. 개인용 커넥터를 한 번만 등록하려면 다음 opt-in 절차를 사용한다.

1. ngrok 계정을 만들고 로컬 CLI에 authtoken을 등록한 뒤 무료 고정 도메인 하나를 발급한다.
2. git 미추적 `.vibe/config.local.json`에 `proBridge.mcp.tunnel: "ngrok"`과 `proBridge.mcp.tunnelUrl: "https://<고정-도메인>"`을 설정한다.
3. `node .vibe/harness/scripts/vibe-pro-bridge.mjs mcp --rotate-code`를 한 번 실행해 강한 `persistentCode`를 생성한다.
4. 출력된 connector URL을 ChatGPT에 한 번 등록한다. 이후 같은 고정 도메인과 code를 쓰는 서버 재시작은 재등록이 필요 없다.

`persistentCode`는 장수 자격이므로 개인용 opt-in으로만 사용한다. `git check-ignore .vibe/config.local.json`으로 로컬 설정이 무시되는지 확인하고, 유출이 의심되면 즉시 `mcp --rotate-code`를 실행한다. 공유 `.vibe/config.json`에 `persistentCode`나 `oauthTokens`가 있으면 서버와 rotate 명령은 기동을 거부한다. rotate 뒤에는 code가 바뀌므로 그 한 번은 ChatGPT connector URL을 갱신해야 한다. cloudflared named tunnel은 별도 도메인·계정 설정이 필요해 범위 밖이며 기존 quick tunnel을 유지한다.

## Golden prompt 회귀

커밋된 데이터셋과 수동 체크리스트는 `.vibe/harness/test/fixtures/golden-prompts/`에 있다. 자동 검증은 strict schema, 카탈로그/model visibility 정합, 범주별 도구 불변식, 완료 계약 문구까지만 다루며 실 LLM을 호출하지 않는다. ChatGPT Developer Mode replay와 direct recall 100% / negative false publication 0% / completion 100% / median write calls 1 / partial visibility 0 측정은 해당 README의 수동 절차를 따른다. 각 결과는 `GoldenSelectionRecordSchema` 형식의 작업 artifact로 기록하고 fixture에는 커밋하지 않는다.
