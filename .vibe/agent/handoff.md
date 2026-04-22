# Orchestrator Handoff — fresh template state

> 이 파일은 Orchestrator 재인스턴스화의 **연료**다. 압축/세션 전환 후 새 Orchestrator 는
> `CLAUDE.md → MEMORY → sprint-status.json → session-log.md → 이 파일` 순으로 읽어 직전
> 상태를 복원한다.

## 1. Identity

- **repo**: (프로젝트 경로)
- **branch**: `main`
- **last release**: v1.5.4 (project-safe `.gitignore` sync)
- **current iteration**: post-iter-7 maintenance
- **harnessVersion**: `1.5.4`
- **language/tone**: (프로젝트별)

## 2. Status: IDLE - v1.5.4 `.gitignore` merge patch prepared

`/vibe-init` 실행 필요. Phase 1 (환경 점검) → Phase 2 (provider 선택) → Phase 3 (네이티브 소크라테스식 인터뷰) → Phase 4 (Sprint 로드맵 작성 + Phase 0 seal) 진행 후 첫 Sprint 진입.

Latest maintenance patch adds `scripts/vibe-agent-session-start.mjs`, wires Claude `SessionStart`, Codex `run-codex.sh`, and `vibe:run-agent` through it, and documents provider-neutral context persistence in `_common-rules.md` Section 16. Codex still has no true PreCompact hook; fallback is handoff/session-log update plus `node scripts/vibe-checkpoint.mjs`.

Follow-up v1.5.2 patch adds `.vscode/settings.json` and `.vscode/extensions.json` so editors pin Markdown/text files to UTF-8 instead of occasionally auto-detecting BOMless UTF-8 as a Windows legacy code page. Strict UTF-8 validation for all Markdown files passed.

Follow-up v1.5.3 patch makes `scripts/run-codex.sh` safe under WSL by redirecting `chcp.com` stdin from `/dev/null` before prompt buffering and resolving an installed UTF-8 locale instead of hardcoding `en_US.UTF-8`. `test/run-codex-wrapper.test.ts` now stubs stdin-consuming `chcp.com` and deterministic locale output so downstream wrapper behavior is validated without a real authenticated Codex install. Verified Windows `npm run typecheck`, `npm run build`, `npm test`; verified WSL temp copy `npm test`, `npm run typecheck`, `npm run build`.

Follow-up v1.5.4 patch adds a `line-union` sync strategy and moves `.gitignore` from full harness replacement to hybrid line merge. Future downstream syncs preserve project-specific ignore entries such as `runtime/` while appending new upstream harness ignore entries.

## 3. 핵심 가치 (절대 보존)

- `scripts/vibe-interview.mjs` + `.claude/skills/vibe-init` / `vibe-interview` (socratic core)
- sprint-planner agent + `vibe-sprint-complete` / `vibe-sprint-commit`
- `run-codex.{sh,cmd}` wrapper (Windows/UTF-8 + EPERM skip + token extraction)
- Codex Generator 위임 원칙
- Sub-agent context isolation

## 4. 다음 행동 (세션 시작 직후)

```
/vibe-init
```

→ Phase 1~4 자동 진행 → `docs/context/product.md` + `architecture.md` + `conventions.md` 생성 → `docs/plans/sprint-roadmap.md` 에 Sprint 분할 저장 → 첫 Sprint Planner 소환 대기.

## 5. pendingRisks

없음.

## 6. 링크

- 하네스 버전: `.vibe/config.json.harnessVersion`
- 릴리스 노트: `docs/release/v1.5.4.md` 및 이전 버전
- Charter: `CLAUDE.md` line 1-40 (BEGIN:CHARTER ~ END:CHARTER)
- Extensions: `docs/context/*.md`
