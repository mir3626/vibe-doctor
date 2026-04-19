# Sprint Roadmap

<!-- BEGIN:VIBE:CURRENT-SPRINT -->
> **Current**: idle (no iteration active)
> **Completed**: —
> **Pending**: —
<!-- END:VIBE:CURRENT-SPRINT -->

## 배경

이 파일은 `/vibe-init` Phase 4 에서 Orchestrator 가 프로젝트별 Sprint 로드맵을 작성해 저장하는 공간이다. fresh template 상태에서는 비어있다.

## 사용법

1. `/vibe-init` 을 실행해 Phase 3 (네이티브 소크라테스식 인터뷰) 까지 완료.
2. Phase 4 에서 Orchestrator 가 본 파일에 `# Iteration 1` 섹션을 append 하고 각 Sprint 의 `## Sprint <id>` 블록을 작성.
3. 이후 Sprint 진행 시 `<!-- BEGIN:VIBE:CURRENT-SPRINT -->` 마커 블록이 `vibe-sprint-complete.mjs` 에 의해 자동 갱신.
4. iter-1 소진 후 `/vibe-iterate` 로 다음 iteration 섹션 append.

## 예상 구조

```md
# Iteration 1 — <label>

## 배경
...

## 범위 요약
- 총 Sprint: N
- Priority: ...
- Growth budget: net ≤ +150 LOC / 0 new scripts

## Sprint <id>

- **id**: `sprint-<id>`
- **목표**: ...
- **핵심 산출**: ...
- **예상 LOC**: ...
- **의존**: ...
```

각 Sprint 완료 시 `scripts/vibe-sprint-commit.mjs <sprintId> passed` 로 state + 산출을 단일 커밋한다.
