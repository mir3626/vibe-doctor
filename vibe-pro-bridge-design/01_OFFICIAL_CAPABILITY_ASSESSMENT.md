# Official Capability Assessment

## 1. Codex Goal discovery

Codex App Server는 다음을 공식 제공한다.

```text
thread/list
thread/read
thread/resume
thread/goal/get
thread/goal/set
thread/goal/clear
```

따라서 최근 local Codex thread를 repository cwd/git metadata로 찾고,
활성 또는 마지막 persisted Goal을 읽는 adapter를 구현할 수 있다.

App Server를 사용할 수 없는 환경에서는 vibe-doctor state와 Git history로 fallback한다.

## 2. ChatGPT Web Pro custom integration

ChatGPT Developer Mode:

- Web의 Pro 계정에서 사용 가능
- remote MCP server 연결 가능
- read/write tool 모두 지원
- SSE 및 streamable HTTP 지원
- OAuth 또는 no-auth/mixed-auth 지원

따라서 Web Pro가 request를 읽고 result package를 Bridge에 쓰는 MCP app을 구현할 수 있다.

## 3. GitHub code access

ChatGPT GitHub app은:

- authorized repository의 code와 docs를 live read/search/cite
- Web ChatGPT의 연결된 app으로 사용
- repository write는 지원하지 않음

이 제약은 오히려 권장 architecture와 맞는다.

```text
Code read:
  ChatGPT GitHub app

Review result write:
  Vibe Pro Bridge MCP mailbox
```

## 4. ChatGPT / Codex plugin portability

공식 plugin은 다음을 함께 포함할 수 있다.

```text
skills
MCP-backed app
```

ChatGPT developer-mode app ID를 사용하는 Codex plugin을 만들 수 있으므로,
같은 remote bridge를 Web ChatGPT와 Codex CLI 양쪽에 노출할 수 있다.

## 5. Workspace Agents API

선택적으로 external system에서 published Workspace Agent를 trigger할 수 있다.

현재 제약:

- 202 Accepted
- public run ID 미반환
- agent response를 API로 직접 retrieve할 수 없음

그러나 agent가 실행 중 Bridge MCP의 `submit_result`를 호출하도록 구성하면,
Bridge request status를 completion channel로 사용할 수 있다.

Personal Pro의 기본 경로로 가정하지 않는다.

## 6. Responses API fallback

최신 frontier model을 Responses API로 호출하는 완전 자동 adapter도 가능하다.

차이:

```text
ChatGPT Web Pro adapter:
  Pro subscription UI
  user starts/reviews conversation
  connected GitHub app 사용

Responses API adapter:
  API billing
  model/tool configuration 직접 관리
  automation 가능
```

사용자가 Web Pro review 품질을 원하는 경우 기본 adapter가 아니다.

## 7. Import from another agent

ChatGPT desktop의 Import 기능은 setup, project, recent work를 가져오는 데 유용하다.
하지만 다음 요구에는 직접 대응하지 않는다.

```text
CLI가 정확한 Goal scope를 review request로 발행
Web Pro가 GitHub review
structured design package를 project docs/plans에 반환
```

따라서 보조 기능일 뿐 primary transport로 사용하지 않는다.

## 8. Off-the-shelf 결론

공식 primitive는 충분하지만, 다음 전체 workflow를 완성하는 단일 library/plugin은 확인되지 않았다.

```text
Codex Goal discovery
+ GitHub range manifest
+ Web Pro review mailbox
+ structured result package
+ local atomic importer
```

따라서 thin custom MCP bridge와 skill integration이 필요하다.
