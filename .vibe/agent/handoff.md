# Orchestrator Handoff

PROJECT NOT INITIALIZED.

This file is project-owned runtime state. Downstream projects must run `/vibe-init` before product work; init rewrites this placeholder with the current project's handoff.

## 1. Identity

- repo: `vibe-doctor`
- status: template placeholder
- harnessVersion: `1.8.1`

## 2. Status

The checked-in upstream template intentionally does not ship active project handoff state.

Maintenance checkpoint: release metadata is set for `v1.8.1`.

Latest maintenance work (v1.8.1): web-pro-bridge 실전화 — 실 웹 Pro 리뷰 remediation(iter-2: repository identity fail-closed, mailbox 직렬화/fencing + finalize journal 재시작 수렴, install/ack 멱등 복구, FINDINGS v1 시맨틱 계약, one-time code 토큰, revN, health/quarantine) + MCP write-path 개선(iter-3: `publish_review_package` 파사드·chunked fallback·완료 계약, 14툴 메타데이터+카탈로그 audit+`bridge_capabilities`+doctor, oauth 프로파일 scope enforcement, golden 데이터셋, persistentCode/tunnelUrl 연결 영속화). 정본: `docs/plans/web-pro-bridge/design.md` §12.1 + `vibe-doctor-mcp-write-improvement-v1.8.0/`. 검증: self-test 780 tests 0 fail, 독립 whole-workflow 감사 2회(P0/P1 0), 라이브 실측(code 교환·persistentCode 재시작 생존·14툴 카탈로그). 실 ChatGPT Developer Mode golden replay와 Journey B/C provenance는 사용자 참여 항목(pro-bridge-setup.md 절차 참조).

Previous maintenance work (v1.8.0): web-pro-bridge initial release — see docs/release/v1.8.0.md.

## 3. Next Action

Run `/vibe-init` in a new downstream project. Existing downstream projects can sync to `v1.8.1`; the pro-bridge is opt-in (`proBridge.enabled`) — see `docs/context/pro-bridge-setup.md` for ChatGPT Developer Mode setup, persistent connector registration, and the doctor/catalog-audit diagnostics.
