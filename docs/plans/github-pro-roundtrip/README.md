# GitHub Pro Roundtrip

Web ChatGPT Pro와 Codex CLI가 별도 MCP 없이 GitHub 커넥터와
`origin/vibe-pro-bridge` 브랜치를 통해 상세설계, 구현 보고서, 코드 리뷰,
피드백, remediation 결과를 교환하는 워크플로우의 상세설계 패키지다.

## Status

- 설계 상태: implemented locally, uncommitted/unpublished
- 공개 skill/command 이름: `$vibe-pro-go` / `npm run vibe:pro-go`
- `pro-roundtrip` schema와 local packet 경로는 기존 durable format 이름으로 유지
- 정본 설계: `DESIGN.md`
- protocol 공통 행위 규약:
  `docs/context/workflow-integrity.md`
- protocol Web Pro 실행 규약:
  `.claude/skills/vibe-pro-go/references/WEB-RUNBOOK.md`
- 생성되는 기계 계약: `.vibe/harness/schemas/pro-roundtrip-*.schema.json`
- 초기 설계 계약 snapshot: `schemas/*.schema.json`
- 최소 golden examples: `examples/*.json`
- 구현에 사용한 프롬프트: `prompt/CLI_MAIN_SESSION_PROMPT.md` (이전 이름을
  보존한 역사 문서)

## Core Decisions

- 실제 코드는 일반 feature branch에만 기록한다.
- 교환 문서는 `vibe-pro-bridge`에만 기록하고 해당 브랜치를 PR 또는 merge
  대상으로 사용하지 않는다.
- flow 경로는 `flows/YYYYMMDD/NNN-slug`로 단순화한다.
- `FLOW.json`과 완료 이벤트는 append-only다. 수정은 새 revision으로 표현한다.
- Web과 CLI는 같은 common harness를 사용하며 각 flow가 protocol version과
  protocol commit SHA를 고정한다.
- Sprint-local unit green과 전체 workflow complete를 구분한다.
- 모든 구현과 리뷰는 design event, Sprint, code HEAD에 함께 바인딩한다.
- MCP, local tunnel, DOM 자동화, 모델 자동 선택, 인증정보 전달을 사용하지 않는다.

## Delivery Boundary

repo-owned skill, deterministic harness runtime, package script, generated schema,
focused tests, downstream sync wiring은 구현됐다. 실제 Web Pro
private/non-default-branch M0 read, nested small/large UTF-8 create, sequential
convergence는 사용자 테스트 repo에서 통과했다. 실제 운영 repo의 protocol/flow
publish는 여전히 명시적 사용자 승인이 필요한 외부 write 경계다.
