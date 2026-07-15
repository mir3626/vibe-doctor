# web-pro-bridge — 웹 GPT Pro 세션 ↔ CLI 연동 브릿지 (Hybrid v2)

> 상태: 하이브리드 설계 완료 (2026-07-15) · 구현 대기
> 계보: Claude v1 설계 + GPT Pro 세션 설계 패키지(`vibe-pro-bridge-design/`)를 비교·병합. 채택 근거는 `design.md` §2 매트릭스.
> 진입 경로: user directive (soft freeze 예외 — 구현 착수 시 session-log `[decision]` 기록 필수)

## 한 줄 요약

**프로토콜·수입기·goal 발견은 Pro 설계를, 무인프라 Phase 1과 local-first 서버 배치·하네스 통합은 v1을** 취했다. 결과: 서버 없이 오늘 시작할 수 있고(Phase 1), 같은 계약 그대로 공식 MCP write-back(Phase 2)과 Web-origin 설계(Phase 3)로 확장되며, 원격 호스팅 승격까지 CLI 무변경.

## 핵심 결정

| 결정 | 출처 |
|------|------|
| Mailbox 계약: 불변 request/result + 상태머신 + SHA-256 바인딩 + chunked upload + 원자적 설치 + 충돌 규칙 | Pro |
| 결과 패키지: `README/REVIEW|DESIGN/FINDINGS.json/source/design/specs/prompt/CLI_MAIN_SESSION_PROMPT.md/.bridge` | Pro |
| Goal 발견: Codex App Server(`thread/goal/get`) → vibe-goal-iterate state → handoff → git 재구성, confidence 라벨. recorder/훅 연결 없음 | Pro (v1 recorder 철회) |
| Phase 1 wire format: `vibe-bundle v1` 클립보드 계약 — Pro 패키지의 manual fallback 미정의 구멍을 메움 | v1 |
| 서버 배치: Pro의 11-tool 프로토콜을 **로컬 서버 + 터널 + single-tenant 토큰**으로 (원격 호스팅은 승격 옵션) | 하이브리드 |
| Web-origin 설계: 웹에서 먼저 설계 → CLI `sync --latest` | Pro |
| GitHub: visibility gate + secret-safe patch + 암묵 push 금지 + **커넥터 실측 제약(기본 브랜치 인덱스 등) 경고를 프롬프트에 명시** | Pro + v1 |
| 스킬 UX: default 상태 분기 + `send/status/sync/cancel/list` + `@Vibe Pro Bridge review <id>` | Pro |
| 하네스 통합: `src/pro-bridge/` + zod schemas + gen-schemas + 신규 스크립트 1개 + sync-manifest. hook·sprint gate 무결합, 미사용 시 오버헤드 0 | v1 + Pro 경량 원칙 |
| 브라우저 DOM 자동화 | 양쪽 모두 기각 (ToS·Turnstile·계정 정지) |

## 폴더 구성

```
docs/plans/web-pro-bridge/
├── README.md                       ← 이 파일
├── design.md                       ← 하이브리드 상세설계 v2 (채택 매트릭스 포함)
└── prompt/
    ├── 01-phase1-core-bridge.md    ← Phase 1: discovery + composer + importer + manual transport + 스킬
    ├── 02-phase2-mcp-writeback.md  ← Phase 2: local-first MCP mailbox + ChatGPT 앱
    └── 03-phase3-web-origin-and-optional.md ← Phase 3~4: web-origin + 옵션 자동화
```

원본 참조 패키지: `vibe-pro-bridge-design/` (Pro 세션 산출물 — 프로토콜·스키마·테스트 계획의 상세 정본. 구현 시 design.md §2 매트릭스의 채택 결정이 우선).

## 다음 행동

1. `prompt/01-phase1-core-bridge.md`를 `/goal` 또는 `/vibe-goal-iterate`에 투입.
2. 착수 시 session-log `[decision]` 기록 (soft freeze user-directive).
3. Phase 1 dogfood에서 실측 2건 확인: Codex App Server goal API 표면, Pro 모드 챗의 GitHub 커넥터 가용성 → design.md §12 추기.
