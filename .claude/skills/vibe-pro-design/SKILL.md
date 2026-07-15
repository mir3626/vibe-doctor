---
name: vibe-pro-design
description: 신규 기능 목표를 웹 ChatGPT Pro 세션에 설계 요청으로 보내고 결과 패키지를 설치할 때 사용한다.
---

# vibe-pro-design

명시한 기능 목표를 Phase 1 manual transport로 ChatGPT Pro에 전달하고 설계 결과
vibe-bundle을 검증된 계획 패키지로 설치한다. Goal discovery는 하지 않으며 인자가 정본이다.

## 사전조건

- `.vibe/config.json` 또는 `.vibe/config.local.json`에서 `proBridge.enabled: true`로 켠다.
- ChatGPT GitHub 커넥터 앱을 설치하고 대상 repository를 승인한다. Private repository는 설정에서 명시 승인한다.
- 신규/private repository가 보이지 않으면 약 5분 뒤 `repo:owner/name <키워드>` 검색으로 인덱싱을 트리거한다.
- Pro 모델은 자동 선택할 수 없으므로 웹에서 사용자가 직접 선택한다.

## 왕복 절차

1. `npm run vibe:pro-design -- "<goal>"`을 실행한다. 비대화 발행 승인은 `npm run vibe:pro-design -- "<goal>" --yes`다.
2. `npm run vibe:pro-status`로 상태를 확인한다.
3. 열린 chatgpt.com에서 클립보드 프롬프트를 붙여넣고 사용자가 직접 Pro 모델을 골라 전송한다.
4. 응답의 vibe-bundle 한 블록 전체를 복사해 `npm run vibe:pro-sync`로 설치한다. 파일 대안은 `npm run vibe:pro-sync -- --from <file>`이다.
5. 취소/목록은 `node .vibe/harness/scripts/vibe-pro-bridge.mjs cancel <id>`와 `node .vibe/harness/scripts/vibe-pro-bridge.mjs list`다.

웹에서 먼저 시작하는 web-origin 설계는 Phase 3 예정이다. 현재는 클립보드 또는 `--from` 파일을 통한 manual sync만 지원한다.

## 실패 모드와 안전 경계

- origin이 없으면 GitHub remote를 설정한다.
- head가 GitHub에서 보이지 않으면 안전한 patch가 첨부된다. 상한 초과 시 사용자가 직접 branch를 push하고 재시도한다. 커맨드는 push하지 않는다.
- 클립보드/브라우저 실패 시 `.vibe/pro-bridge/outbox/<id>/prompt.md`를 수동 복사한다.
- 요청 메타데이터, 설계 프롬프트, 포함 patch가 OpenAI로 전송된다. 커맨드는 발행 직전에 한 번 고지한다.
- 브라우저 지원은 chatgpt.com 열기, 클립보드, 실패 무해한 짧은 `?q=` 프리필뿐이다. DOM 자동화, 자동 제출, 모델 선택 자동화는 하지 않는다.

잘린 응답은 `VIBE:END` 부재로 거부된다. 설치 후 구현은 자동 시작하지 않으며, 설치된 `CLI_MAIN_SESSION_PROMPT.md`를 사용할지는 사용자가 결정한다. Dogfood 시 GitHub 커넥터 관찰을 session-log의 비결정 노트로 남기고 `reviewerDeclaration`을 확인한다.
