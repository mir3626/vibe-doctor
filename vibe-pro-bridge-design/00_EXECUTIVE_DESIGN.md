# Executive Design

## 1. 최종 권고

```text
vibe-goal-audit skill
vibe-pro-design skill
        │
        ▼
shared VibeProBridge interface
        │
        ├─ mcp-mailbox transport        권장
        ├─ manual-package transport     fallback
        ├─ workspace-agent transport    optional
        └─ responses-api transport      optional
```

웹과 CLI가 직접 서로의 session state를 공유하게 만들지 않는다.

대신 양쪽이 동일한 **Review Request / Result Mailbox**를 사용한다.

```text
CLI producer
→ immutable request
→ Web Pro consumer/reviewer
→ immutable result package
→ CLI importer
```

이 방식의 장점:

- ChatGPT Web Pro의 GitHub connector를 그대로 활용한다.
- 긴 code scope를 prompt에 복사하지 않는다.
- repository write 권한을 Web ChatGPT에 줄 필요가 없다.
- 결과를 다운로드하고 수동으로 옮기지 않는다.
- 새로운 설계와 구현 리뷰에 동일 protocol을 사용한다.
- 향후 Workspace Agent/API가 개선되면 transport만 교체한다.

## 2. 사용자-facing 기능

### `$vibe-goal-audit`

```text
1. 최근 Codex /goal 또는 vibe-goal-iterate Goal 발견
2. 원본 Goal, 설계 문서, 구현 item, commit 범위, code scope 조사
3. GitHub에서 Web Pro가 볼 수 있는 범위 검증
4. review request를 Bridge에 등록
5. Web Pro invocation 한 줄 출력
6. review 완료 후 sync하여 docs/plans/<folder> 설치
```

### `$vibe-pro-design`

두 방향을 지원한다.

```text
CLI-origin:
  CLI에서 새 feature 요청
  → Web Pro 설계
  → CLI sync

Web-origin:
  Web Pro에서 GitHub를 보며 새 feature 설계
  → Bridge result 생성
  → CLI에서 latest design sync
```

## 3. 최소 수동 동작

개인 Pro 기준 권장 UX:

```text
CLI:
  $vibe-goal-audit

출력:
  Request AUD-20260715-abc123 ready.
  ChatGPT Web Pro에서:
  @Vibe Pro Bridge review AUD-20260715-abc123

Web:
  한 줄 실행 후 review 진행
  결과는 Bridge tool로 제출

CLI:
  $vibe-goal-audit sync --latest
```

Clipboard 복사와 browser open은 optional convenience다.
공식적으로 보장되지 않는 prefilled-chat URL이나 browser DOM automation에 의존하지 않는다.

## 4. 결과 위치

```text
docs/plans/<detail-folder>/
├── README.md
├── REVIEW.md
├── FINDINGS.json
├── source/
│   └── GOAL_SOURCE_MANIFEST.json
├── design/
│   └── *.md
├── specs/
│   └── *.md
├── prompt/
│   └── CLI_MAIN_SESSION_PROMPT.md
└── .bridge/
    ├── request-manifest.json
    ├── result-manifest.json
    └── provenance.json
```

## 5. Non-goals

- Web Pro가 source code를 직접 수정하거나 push하지 않는다.
- 자동으로 branch/commit을 생성하지 않는다.
- Pro model 선택을 우회하거나 강제하지 않는다.
- ChatGPT browser DOM을 비공식적으로 자동 조작하지 않는다.
- repository 전체를 Bridge storage에 복제하지 않는다.
- 결과를 자동 implementation하지 않는다.
