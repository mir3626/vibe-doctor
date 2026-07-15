# Orchestrator Handoff

PROJECT NOT INITIALIZED.

This file is project-owned runtime state. Downstream projects must run `/vibe-init` before product work; init rewrites this placeholder with the current project's handoff.

## 1. Identity

- repo: `vibe-doctor`
- status: template placeholder
- harnessVersion: `1.8.0`

## 2. Status

The checked-in upstream template intentionally does not ship active project handoff state.

Maintenance checkpoint: release metadata is set for `v1.8.0`.

Latest maintenance work (v1.8.0): web-pro-bridge — 웹 ChatGPT Pro 세션 ↔ CLI 왕복 브릿지. Goal-source discovery(provider 체인 4종), GitHub visibility gate + secret-safe patch, A~I 리뷰 프롬프트 composer, vibe-bundle v1 manual transport(클립보드/브라우저), 원자적 result importer(해시 바인딩·충돌 규칙·provenance), local-first MCP mailbox(12-tool streamable-HTTP, chunked upload, single-tenant 토큰, 터널 helper), web-origin design 왕복, 옵션 어댑터(workspace-agent/responses-api/codex-cloud apply). 스킬 `$vibe-goal-audit`/`$vibe-pro-design` + `vibe:pro-*` 커맨드. 정본 설계 `docs/plans/web-pro-bridge/design.md` (Hybrid v2, §12.1 실측 추기 포함). 부수 수정: vibe-agent-session-start의 비-hook stdin drain 회귀(파이프 프롬프트 소실) 수정, run-codex.sh `</dev/null` 이중 방어, MCP 기본 포트 18488(WinNAT excluded range 회피). 검증: typecheck/build/gen-schemas/self-test 627 tests 0 fail, 라이브 E2E 왕복 2종(manual/web-origin mailbox) 실측 완료. Pro 모드 챗의 GitHub 커넥터·MCP write tool 실측은 사용자 확인 대기(design.md §12.1).

Previous maintenance work (v1.7.30): SessionStart dedupe and hidden nested Stop QA — see docs/release/v1.7.30.md.

## 3. Next Action

Run `/vibe-init` in a new downstream project. Existing downstream projects can sync to `v1.8.0`; the pro-bridge is opt-in (`proBridge.enabled`) — see `docs/context/pro-bridge-setup.md` for ChatGPT Developer Mode setup. Agent-mode one-liner initialization should not begin MVP work until `npm run vibe:init-ready` passes.
