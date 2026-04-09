# Architecture context

<!-- 이 파일을 프로젝트 실제 구조에 맞게 수정하세요 -->

## 레이어

1. **Memory layer** — AI가 읽는 컨텍스트
   - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
   - `.claude/skills/*`
   - `docs/context/*`

2. **Control plane** — 오케스트레이션 실행
   - `src/commands/*`
   - `src/providers/*`
   - `.vibe/config*.json`

3. **Execution / evidence layer** — 실행 기록
   - `.vibe/runs/*`
   - `docs/plans/*`
   - `docs/reports/*`

## 설계 원칙

- 얇은 루트 메모리 — 상세 규칙은 shard로 분리
- Sprint 기반 개발 — Planner/Generator/Evaluator sub-agent 생성·소멸
- 설정 가능 provider runner — `.vibe/config.json` 기본값 + `.vibe/config.local.json` 로컬 override
- Generator(codex)는 격리 실행 우선
- Sprint 실패 시 Evaluator 판정 기반 에스컬레이션
- JSONL evidence 축적

## vibe-doctor 디렉터리 구조

> ℹ️ 이 트리는 vibe-doctor 템플릿 자체의 구조입니다. `/vibe-init` 실행 시
> 다운스트림 프로젝트에서는 이 섹션이 사용자 프로젝트 트리로 교체됩니다.

```text
vibe-doctor/
├── CLAUDE.md                    # 루트 오케스트레이터 메모리 (얇게 유지)
├── AGENTS.md / GEMINI.md        # 다른 provider용 동등 메모리
├── README.md
├── .gitattributes               # 크로스플랫폼 줄끝 정규화
├── .github/workflows/ci.yml     # typecheck → build → test → audit
├── .claude/
│   ├── settings.json            # Claude Code 훅 + 권한
│   └── skills/*                 # /vibe-init, /goal-to-plan, /self-qa 등
├── .vibe/
│   ├── config.json              # provider + sprintRoles 기본값
│   ├── config.local.example.json
│   └── runs/*                   # JSONL evidence (git-ignored)
├── src/
│   ├── commands/                # 8개 vibe:* CLI (runMain 통일)
│   │   ├── doctor.ts
│   │   ├── init.ts
│   │   ├── audit-config.ts
│   │   ├── qa.ts
│   │   ├── run-agent.ts
│   │   ├── write-report.ts
│   │   ├── summarize-usage.ts
│   │   └── escalate-on-test-failure.ts
│   ├── lib/                     # cli/config/fs/logger/report/usage 등
│   └── providers/runner.ts      # provider-agnostic 실행 플랜
├── test/                        # node:test (20 cases)
├── scripts/run-codex.sh         # Windows 한국어 UTF-8 안전 래퍼
└── docs/
    ├── context/*                # product / architecture / conventions / qa / tokens / secrets
    ├── orchestration/*          # sprint / escalation / providers
    ├── plans/*                  # Sprint 계획서
    └── reports/*                # Sprint 종료 보고서
```
