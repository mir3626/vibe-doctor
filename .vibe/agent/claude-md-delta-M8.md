# CLAUDE.md delta for Sprint M8

Orchestrator 가 `CLAUDE.md` 에 수동 병합할 블록이다.
병합 후 이 파일은 삭제한다.

## 1. HARNESS hook-enforcement block

`<!-- BEGIN:HARNESS:hook-enforcement -->` 표 아래, 기존 문장
`원칙: 스크립트가 FAIL...`
바로 다음 줄에 아래 문장을 추가한다.

```md
규칙을 추가할 때는 MD 문서뿐 아니라 script/hook 으로 기계 강제를 목표로 한다. 미해결 사각지대는 docs/context/harness-gaps.md 에 ledger 로 추적한다.
```

## 2. HARNESS trigger-matrix block

`<!-- BEGIN:HARNESS:trigger-matrix -->` 안의 `### Evaluator 소환` 아래에 다음 하위 섹션을 추가한다.

```md
### Periodic audit — 5 Sprints 마다

- `sprintsSinceLastAudit` 카운터는 passed Sprint 마다 자동 증가한다.
- threshold 에 도달하면 `pendingRisks` 에 audit-required 엔트리가 자동 주입된다.
- Orchestrator 는 `/vibe-review` 로 드래프트를 만든 뒤 `node scripts/vibe-audit-clear.mjs --resolve-risks --note "<text>"` 로 counter 를 reset 한다.
```

## 3. 필요할 때만 읽을 문서

`## 필요할 때만 읽을 문서` 목록 하단에 아래 한 줄을 추가한다.

```md
- 하네스 사각지대 ledger: docs/context/harness-gaps.md
```
