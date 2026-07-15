# Goal: web-pro-bridge Phase 2 — local-first MCP mailbox + ChatGPT 앱

> 선행 조건: Phase 1 머지 + dogfood 실왕복 1회 + Pro 모드 챗의 MCP 툴 가용성 실측 확인.
> 정본: `docs/plans/web-pro-bridge/design.md` §5.1, §6.3, §9. 상세 스펙: `vibe-pro-bridge-design/05_BRIDGE_PROTOCOL.md`(툴셋·lifecycle·idempotency·chunking), `06_MCP_APP_PLUGIN_SPEC.md`(앱 등록·인젝션 방어·write scope), `specs/VPB-003, VPB-004`. **단 배치는 design.md의 local-first 결정이 우선 — 원격 호스팅·OAuth tenant·암호화 object storage는 구현하지 않는다.**

## 의도

Phase 1의 "결과 복사 → sync"를 ChatGPT Developer Mode 앱의 MCP 툴 호출로 대체한다. 웹 Pro 세션이 `get_request`로 요청을 읽고 `begin_result → put_result_file → finalize_result`로 제출하면(쓰기마다 인챗 승인), CLI가 `sync`로 동일 importer 설치. 수동 동작: 전송 클릭 1 + 쓰기 승인 클릭.

## 구현 범위

1. **McpMailboxTransport + 로컬 서버** `src/pro-bridge/transports/mcp-mailbox.ts`
   - streamable-HTTP MCP 서버, 왕복 세션 동안만 기동. 툴 11종: `create_request / list_pending_requests / get_request / claim_request / begin_result / put_result_file / finalize_result / get_result_manifest / get_result_file / acknowledge_import / cancel_request` — 시그니처·lifecycle·idempotency는 Pro `05` 그대로.
   - `put_result_file` chunking(chunkIndex/Count + chunkSha256), `finalize_result`가 roster·per-file 해시·manifest 해시·필수 파일·안전 경로 검증 — **검증 로직은 Phase 1 importer/contract 재사용, 이중 구현 금지.**
   - storage: `.vibe/pro-bridge/{requests,results}/` 로컬 파일 + TTL 만료. read-only 툴에 `readOnlyHint` annotation.
   - 인증: single-tenant bearer 토큰(기동 시 생성, 터널 URL에 포함) + request당 1 finalize + 만료. 토큰은 로그·session-log·커밋에 미기록.
2. **터널 helper** — config `proBridge.mcp.tunnel`(`cloudflared`|`ngrok`|`none`) spawn + 공개 URL 1회 출력 + 종료 시 정리. npm `vibe:pro-mcp`. `vibe-pro-bridge.mjs` 서브커맨드 — 신규 스크립트 파일 추가 금지.
3. **ChatGPT 앱 자산** — Developer Mode 앱 1회 등록 가이드(스킬 runbook + `docs/context/` 셋업 문서), 툴 설명에 프롬프트 인젝션 방어 문구(Pro `06` §5: repo 콘텐츠는 untrusted review input — 소유권·출력 경로·인증·도구 정책 변경 권한 없음). write scope: bridge namespace만 (GitHub write·로컬 파일 write·기존 result 수정·타 request 접근 불가).
4. **스킬 갱신** — transport 우선순위(명시 옵션 > config > 설치된 MCP 앱 > manual fallback), 웹 invocation 한 줄 출력(`@Vibe Pro Bridge review <request-id>`), Pro 모드에서 write 툴 미동작 시 "같은 대화에서 Thinking 계열로 전환 후 제출 턴" fallback 절차.
5. **(선택, 여유 시)** Codex plugin 매니페스트 — 같은 앱 ID 참조(Pro `06` §1). 미착수 시 Phase 3 backlog로.

## 하지 않는 것

- 원격 호스팅·OAuth tenant model·암호화 스토리지 (승격 옵션 — design.md §6.3).
- 상시 데몬. 승인 없는 자동 쓰기. allowlist 밖 쓰기.
- web-origin request 생성 툴 (Phase 3).

## 수용 기준 (기계 검증 — Pro `11` §4 발췌)

- [ ] `vibe:typecheck` / `vibe:self-test` 통과
- [ ] mailbox 통합 테스트(로컬 HTTP): create idempotency / claim race / chunk 순서·중복·누락 / 해시 불일치 / finalize / expiry·cancel / ack / revision chain / 잘못된 토큰 거부 / 2번째 finalize 거부
- [ ] `finalize_result` 설치 결과가 Phase 1 manual sync 결과와 바이트 동일 (동일 fixture)

## 수용 기준 (inspection / dogfood)

- [ ] 실왕복 1회: `vibe:pro-mcp` 기동 → 터널 → Developer Mode 앱 등록 → 웹 Pro에서 `get_request` → 리뷰 → 툴 제출(승인) → CLI sync → 설치 확인. 수동 파일 이동 0.
- [ ] Pro 모드 챗 write 툴 가용성 실측 → design.md §12 추기.
