---
name: vibe-goal-audit
description: 마지막 goal의 구현을 웹 ChatGPT Pro 세션 리뷰로 보내고 결과 패키지를 설치할 때 사용한다.
---

# vibe-goal-audit

마지막 goal의 구현 범위와 리뷰 프롬프트를 Phase 1 manual transport로 내보내고,
ChatGPT Pro 응답의 vibe-bundle을 검증된 계획 패키지로 설치한다.

## 사전조건

- `.vibe/config.json` 또는 `.vibe/config.local.json`에서 `proBridge.enabled: true`로 명시적으로 켠다.
- ChatGPT의 GitHub 커넥터 앱을 설치하고 대상 repository를 승인한다. Private repository는 설정에서 명시적으로 승인해야 한다.
- 신규/private repository는 인덱싱에 약 5분이 걸릴 수 있다. 보이지 않으면 Pro 채팅에서 `repo:owner/name <키워드>`로 검색해 인덱싱을 트리거한다.
- Pro 모델은 자동 선택할 수 없다. chatgpt.com에서 사용자가 직접 선택한다.

## 왕복 절차

1. `npm run vibe:pro-audit`를 실행한다. 미종결 요청이 있으면 상태를 보여주고, 없으면 마지막 goal을 해석해 새 audit 요청을 만든다.
2. 비대화 환경에서 발행을 승인하려면 `npm run vibe:pro-audit -- --yes`를 사용한다.
3. 상태는 `npm run vibe:pro-status`로 확인한다.
4. 열린 chatgpt.com에서 클립보드의 리뷰 요청 프롬프트를 붙여넣고 사용자가 직접 Pro 모델을 선택해 전송한다.
5. 응답의 vibe-bundle 한 블록 전체를 복사하고 `npm run vibe:pro-sync`를 실행한다. 파일 입력은 `npm run vibe:pro-sync -- --from <file>`이다.
6. 취소/전체 목록은 각각 `node .vibe/harness/scripts/vibe-pro-bridge.mjs cancel <id>`와 `node .vibe/harness/scripts/vibe-pro-bridge.mjs list`를 사용한다.

## 실패 모드

- goal이 불명확하면 후보와 diagnostics를 확인한다. 발행 보류가 기본이며 goal을 명확히 한 뒤 재시도한다.
- origin이 없으면 GitHub remote를 먼저 설정한다.
- head가 GitHub에서 보이지 않으면 안전한 patch가 자동 첨부된다. patch 상한을 넘으면 사용자가 직접 review branch를 push한 뒤 재시도한다. 스킬과 커맨드는 push하지 않는다.
- 클립보드나 브라우저가 실패해도 outbox는 보존된다. `.vibe/pro-bridge/outbox/<id>/prompt.md`를 수동 복사한다.

## 외부 발행과 브라우저 경계

요청 메타데이터, 리뷰 프롬프트, 포함된 patch는 OpenAI로 전송된다. 커맨드는 outbox 생성 직전에 한 번 고지하며 사용자가 이를 승인해야 한다.

지원 범위는 chatgpt.com 열기, 클립보드 복사, 짧은 `?q=` 프리필이다. 프리필은 실패해도 무해한 편의 기능이다. DOM 자동화, 자동 제출, 모델 피커 자동화는 지원하지 않는다.

## 결과 반입

잘린 복사는 `VIBE:END` 부재로 거부된다. 설치 후 구현은 자동 시작하지 않는다. `docs/plans/<folder>/prompt/CLI_MAIN_SESSION_PROMPT.md`를 다음 goal로 사용할지는 사용자가 결정한다.

Dogfood 왕복에서는 Pro 채팅의 GitHub 커넥터 동작 여부와 관찰된 제약을 session-log에 `[decision]` 없이 짧게 남기고, 설치 결과의 `reviewerDeclaration`도 확인한다.

## MCP mailbox 경로 (Phase 2)

`proBridge.enabled: true`와 `transport: "mcp-mailbox"`를 설정하고 `npm run vibe:pro-mcp`로 세션 서버를 먼저 기동한다. ChatGPT Developer Mode의 1회 connector 등록과 터널·토큰 경계는 `docs/context/pro-bridge-setup.md`를 따른다.

발행 후 웹 대화에 `@Vibe Pro Bridge review <request-id>` invocation을 보내면 웹이 mailbox에서 요청 전문을 읽는다. 결과가 도착한 뒤 `npm run vibe:pro-sync`를 실행하면 클립보드 없이 설치된다. 서버나 터널을 사용할 수 없으면 위 Phase 1 manual 경로가 그대로 fallback이다.

## 진단 doctor

`$vibe-goal-audit doctor`는 다음 명령으로 현재 connector의 원시 MCP 카탈로그와 capability 핸드셰이크를 점검한다.

```text
node .vibe/harness/scripts/vibe-pro-bridge.mjs doctor "<connector-url>"
```

이 진단은 `initialize → tools/list → bridge_capabilities`를 순서대로 호출해 `publish_review_package` 존재 여부, 승인된 annotations·outputSchema·visibility·scope 메타데이터, 로컬 기대 카탈로그 버전과 서버 버전의 일치를 확인한다. `[FAIL] publish_review_package missing`이면 긴 리뷰를 시작하지 말고 `docs/context/pro-bridge-setup.md`의 ChatGPT 메타데이터 Refresh 절차를 따른다.

로컬 정적 카탈로그와 커밋된 snapshot만 검사하려면 `node .vibe/harness/scripts/vibe-pro-bridge.mjs catalog-audit`를 사용한다. 두 진단 모두 명시 호출 전용이며 hook이나 정기 QA에는 연결하지 않는다.
