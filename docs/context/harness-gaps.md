# Harness Gaps

## Purpose

이 ledger 는 dogfood 와 실제 Sprint 운영 중 드러난 하네스 사각지대를 추적한다.
각 항목은 symptom, 현재 script/hook 커버리지, 그리고 남은 상태를 한 곳에서 본다.
목표는 규칙을 문서에만 남기지 않고 가능한 한 script/hook 으로 강제하는 것이다.

## Entries

| id | symptom | covered_by | status |
|---|---|---|---|
| gap-mcp-frozen-pid | legacy MCP stale PID 로 Phase 3 인터뷰 기동 실패 (Windows) | `scripts/vibe-interview.mjs` native fallback (M5) | covered |
| gap-windows-cli-path | Windows 에서 `./scripts/run-codex.sh` 가 provider health check 에서 cmd.exe fallback 으로 실패 | `.claude/skills/vibe-init/SKILL.md` Step 2-3 OS 감지 + `run-codex.cmd` (M2) | covered |
| gap-loc-accounting | 커밋 범위 기반 LOC 집계 누락 -> sprint 크기 왜곡 | `vibe-sprint-complete.mjs` `actualLoc` 기록 + lastSprintScope (M1/M3) | covered |
| gap-cmd-wrapper-health | Codex wrapper 가 retry·버전·health subcommand 없어 진단 어려움 | `run-codex.sh --health` / `--version` (M2) | covered |
| gap-session-log-ordering | session-log 엔트리 타임스탬프 역순·중복·race 로 손상 | `vibe-session-log-sync.mjs` (M3) | covered |
| gap-audit-cadence | 프로세스 건강성 리뷰 주기 누락 -> 사각지대 누적 | `sprintsSinceLastAudit` + `vibe-audit-clear.mjs` + `/vibe-review` (M8) | covered |
| gap-review-reproducibility | 리뷰가 사람 주관 기반 -> 입력 재현 불가 | `/vibe-review` SKILL.md + `test/vibe-review-inputs.test.ts` exist (M8) | covered |
| gap-phase0-commit-forget | Phase 0 산출물 커밋 누락으로 첫 Sprint 가 dirty tree 위에서 시작 | `vibe-phase0-seal.mjs` (M7) | covered |
| gap-opt-in-visibility | bundle/browserSmoke opt-in 미인지로 frontend 프로젝트가 검증 없이 진행 | `/vibe-review` detectOptInGaps + test coverage (M8) | covered |
| gap-rule-only-in-md | 규칙이 MD 에만 존재 -> Orchestrator 가 잊음 | `CLAUDE.md` hook table expanded (M10), but not all rules are script-gated yet | partial |
| gap-statusline-visibility | Agent 위임 중 Orchestrator 상태 불투명 | `.claude/statusline.{sh,ps1}` + `vibe-status-tick.mjs` + tests (M9) | covered |
| gap-permission-noise | Agent 위임 시 권한 프롬프트 반복 | `vibe-sprint-mode.mjs` + settings-presets + tests (M9) | covered |
| gap-integration-smoke | end-to-end meta smoke 부재 | `test/integration/meta-smoke.test.ts` (M10, this Sprint) | covered |
| gap-external-interview-dependency-purge | v1.2.0 에서 외부 인터뷰 엔진 참조가 docs/scripts에 잔존 (optional enhancement 수준으로 보존) | Sprint M11 (v1.2.1) | covered |
| gap-release-tag-automation | `harnessVersion` bump 시 git tag (예: `v1.3.0`) 자동 생성·push 단계가 없어 downstream `vibe:sync` 가 `resolveUpstreamRef` 에서 존재하지 않는 tag 를 clone 시도 → sync 실패. v1.2.0/v1.2.1/v1.3.0 tag 가 retroactive 로만 푸시됨 | 수동 `git tag -a && git push --tags` (임시). `vibe-sprint-commit.mjs` 또는 전용 `vibe-release.mjs` 가 harnessVersion delta 감지 시 자동 tag 생성 필요 | open |
| gap-statusline-wiring | M9 에서 `.claude/statusline.{sh,ps1}` 스크립트는 만들었지만 `.claude/settings.json` 에 Claude Code 가 해당 스크립트를 호출하도록 `statusLine` 설정 항목을 추가 안 함. 사용자가 내장 activity indicator 만 보게 되어 custom statusline 이 dead code 상태 | `.claude/settings.json` 에 `statusLine: {type:"command", command:"bash .claude/statusline.sh"}` 추가 + `sync-manifest.json` 의 harnessKeys 에 `statusLine` 등록 (retroactive 수정, v1.3.1 예정). 향후 M9-style 신규 Claude Code integration feature 는 **스크립트 생성 + settings.json 등록 + manifest harnessKeys 업데이트** 3단 절차를 Planner 체크리스트에 강제할 것 | covered |

Update protocol:
1. 새 gap 발견 시 id `gap-<slug>` 로 표 끝에 append 한다.
2. 해결 Sprint 에서 `covered_by` 와 `status` 를 갱신한다.
3. `/vibe-review` 는 이 ledger 를 읽고 `open` 개수를 findings 근거에 반영한다.

## Process

새 gap 은 현상 중심으로 적고, 특정 사람의 실수로 서술하지 않는다.
`covered` 는 실사용 중인 script/hook 과 테스트가 둘 다 있는 경우에만 쓴다.
`partial` 과 `open` 은 다음 Sprint scope 후보를 만들 때 우선 확인한다.
