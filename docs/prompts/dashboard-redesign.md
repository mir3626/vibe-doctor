# Task — Dashboard 디자인 리팩토링 + Sprint badge 정리 + Real-time follow-up

## Goal

3가지를 한 번에 처리한다.

1. `scripts/vibe-dashboard.mjs` 의 **`renderShellHtml()`** 출력(HTML+CSS+JS inline)을
   `scripts/vibe-project-report.mjs` 의 `renderHtml()` 이 사용하는 디자인 시스템과
   **시각적으로 동일하게** 바꾼다. 색상, glass-morphism, 타이포그래피, nav pill,
   hero, section wrap, status-badge, sprint-card, metric-card 등 project-report
   에서 이미 쓰고 있는 클래스/스타일 토큰을 그대로 채용한다.
2. Sprint/Phase badge 앞에 literal 로 찍히던 "dot" / "check" / "x" 텍스트와
   그 옆 컬러 점(`<span class="dot">`)을 완전히 제거한다. 상태는 오직
   project-report 의 `status-badge` 색상(배경+테두리) 만으로 표현한다.
3. Sprint 종료 시 dashboard timeline 이 실시간으로 업데이트되도록
   `scripts/vibe-sprint-complete.mjs` 가 `sprint-completed` / `sprint-failed`
   daily event 를 emit 하게 만든다. (지금은 emit 이 없어서 sprint 완료 후
   timeline 에 이벤트가 표시되지 않는다.)

## 역할 제약

- `.mjs` 소스 편집 작업이다. Orchestrator 가 직접 못 하니 Codex 가 전부 처리한다.
- 변경 범위: `scripts/vibe-dashboard.mjs`, `scripts/vibe-sprint-complete.mjs` 만.
- 테스트 파일 (`test/dashboard-server.test.ts`, `test/vibe-sprint-complete.test.ts`)
  은 계약을 유지해야 하므로 건드리지 말고, 기존 export / 동작 / API shape 은
  그대로 유지한다. 실패하면 재조정.

---

## 1) `renderShellHtml()` 재디자인 상세

### 1-1. 반드시 **유지**할 동작 (기능 계약)

- `/api/state` 응답 shape — `roadmap.phases`, `roadmap.sprints`, `currentSprint`,
  `iteration`, `todayEvents`, `risks`, `tokens`, `latestTest`, `updatedAt`.
- `EventSource('/events')` 로 `state-updated`, `attention` 이벤트 수신.
- 최초 boot 시 `/api/state` + `/api/daily-index` + `/api/daily/<today>` 조회.
- Notification permission banner 표시/숨김, `requestPermission()` 흐름.
- Attention 이벤트 처리:
  - Notification granted → `new Notification(...)`
  - 아니면 toast push (최대 5개, 8초 후 자동 제거).
- Risk modal open/close 버튼(`#riskButton`, `#closeRisks`).
- 오늘 이벤트 상시 open, 과거 날짜는 toggle 에 따라 lazy load + cache.
- 재연결 backoff + `.conn` 상태 class (`connected` / `reconnecting` / `dead`).
- `escapeHtml()` 로 모든 사용자 입력 값 escape.

### 1-2. **시각적으로 project-report 와 동일**하게 맞출 것

project-report (`scripts/vibe-project-report.mjs` 의 `renderHtml()`) 에서 아래
블록들을 가져와 dashboard 에 그대로 재사용한다. 값/토큰은 원본에서 변경 금지.

1. **`:root` CSS 변수**: project-report 의 palette 그대로 복제
   (`--bg-0/1/2`, `--text`, `--secondary`, `--muted`, `--border`,
   `--border-strong`, `--accent`, `--accent-subtle`, `--glass-bg`,
   `--glass-highlight`, `--glass-depth`, `--complete-bg/text`,
   `--progress-bg/text`, `--partial-bg/text`, `--failed-bg/text`,
   `--idle-bg/text`, `--loc-*`). `--info-*` / `--ok-*` / `--warn-*` /
   `--bad-*` / `--neutral-*` 같은 dashboard 전용 토큰은 제거.
2. **Body background**: project-report 와 동일한 gradient + `background-attachment:fixed`.
3. **폰트 스택 + Inter/JetBrains Mono 로드** 그대로 유지.
4. **Site-nav (`.site-nav`)**: project-report 의 pill-shaped, fixed top, 3-col grid
   (brand / nav-anchors / nav-meta). Dashboard 용 anchor 목록은 아래 섹션 ID 와
   일치시킨다:
   - `#phases`, `#sprints`, `#timeline`, `#attention`
   - Anchor 클릭 시 smooth scroll (`prefers-reduced-motion` 존중) — project-report
     의 anchor-scroll 스크립트 동일 패턴.
5. **Brand**: project-report 의 `.orb` + `.brand-name` ("𝓿𝓲𝓫𝓮 𝓭𝓸𝓬𝓽𝓸𝓻" 유지) 그대로.
6. **Nav meta**: 현재 iteration ID + updated 시각. 기존 `#updated` 의 내용을
   여기로 이동. `.mono` 스타일 유지.
7. **Hero section**: project-report `.hero` 구조 채용.
   - eyebrow: "Live Dashboard"
   - h1: "Vibe Dashboard"
   - subtitle: 현재 sprint / iteration 요약 문구 (예: `sprint-M3 · iter-7 ·
     passed 4 / 6`). 상태 없을 때는 `"Idle — run /vibe-init to start a project."`.
   - meta-row: `Updated <time>`, `Iteration: <id or idle>`,
     `Status: <status-badge>`. (status-badge 는 project-report 의
     `renderBadge()` 와 동일한 마크업 / normalizeStatus 매핑.)
8. **Main container**: `main.container` + `.report-grid` 2-column (7fr / 6fr),
   project-report 와 동일. 모바일에서는 1-column stack.
9. **Col-main 섹션들** (project-report `.report-section.wrap` 스타일 적용):
   - **`#phases`** — "Phase Progress" 섹션. phase 별로 `status-badge` 를
     `[data-status="complete|in-progress|pending"]` 로 나열. 기존
     `renderNode()` 가 출력하던 dot/mark/node 마크업은 삭제.
     Badge 는 readable label (`Phase 0`, `Phase 1`, ...) 만.
   - **`#sprints`** — "Sprint Roadmap" 섹션. project-report 의 `.sprint-grid` +
     `.sprint-card` 마크업 채용. 단 dashboard 에서는 roadmap ID 기준 전부
     표시하되 `goal`/`loc`/`commit` 등 세부는 state 에 없으므로 생략. 카드 헤더:
     `<h3>` 에 sprint ID + `status-badge`. 카드 본문: status 설명 한 줄.
     (데이터 부족 시 카드 본문 생략하고 헤더만.)
   - **`#timeline`** — "Timeline" 섹션. 기존 day `<details>` 리스트를 그대로
     재사용하되 껍데기 스타일을 `.report-section.wrap` 으로 통일. 이벤트 row 는
     기존 grid(시간·chip·summary) 유지하되 chip 을 `status-badge` 로 변경
     (`chipClass()` 가 반환하던 `ok/bad/info/warn/neutral` 을 project-report
     `normalizeStatus()` 의 `complete/failed/in-progress/partial/idle` 로 매핑).
10. **Col-side 섹션들** (aside 카드들, project-report `.report-section.wrap` +
    glass card 스타일):
    - **`#attention` — "Attention"**: 기존 toast/modal 은 유지하되, 사이드에
      "최근 attention 이벤트 3건" 을 `.decision-entry` 유사 row 로 표시
      (시간 + status-badge + 제목). 비어있으면 `<p class="empty-state">No
      attention requests yet.</p>`.
    - **"Iteration"** card: project-report `metric-card` 스타일 컨테이너 안에
      iteration ID (eyebrow), label (h3), progress bar (project-report
      `.progress-bar` CSS 채용), `done / total sprints`, `pct %` 텍스트.
    - **"Current Sprint"** card: 같은 glass card 스타일. sprint ID 모노스페이스,
      `status-badge` 하나.
    - **"Metrics"** block: project-report `.metric-grid` 그대로, 4 cards 대신
      3 cards — `Open Risks` (button, modal trigger), `Tokens Today`,
      `Latest Test` (full-width, project-report 식으로 metric-card 를 쓰고
      `card-wide` 대응 grid-column 설정).
11. **Permission banner**: project-report 에 없는 요소이므로 Hero 하단에 옅은
    glass banner 로 삽입 (`.banner`). 버튼은 project-report `.filter-chip`
    계열 스타일로.
12. **Toasts**: 디자인은 project-report 톤에 맞춰 glass-morphism + `--border`
    + `--glass-depth` 로 조정. 위치는 우하단 유지.
13. **Risk modal**: backdrop blur, card 는 `.report-section.wrap` 과 동일한
    배경. 버튼은 project-report `.expand-actions button` 스타일.
14. **Connection status (`.conn`)**: site-nav 의 `nav-meta` 옆에 `status-badge`
    하나로 표시 (`connected` → `complete`, `reconnecting` → `partial`,
    `disconnected` → `failed`). 별도 glass card 아님.
15. **미디어 쿼리**: project-report 의 1024 / 640 breakpoint 동작과 동일한 방향
    으로 정리. 모바일에서 nav anchors 숨김 + grid 1-col.
16. **Skip link / aria**: project-report 의 `.skip-link`, `aria-label` 패턴 채용.

### 1-3. `renderNode()` 폐지

기존:
```js
function renderNode(node){const active=...;const mark=...;return '<span class="node "+...+"><span class="dot "+...+"></span>"+escapeHtml(mark)+" "+escapeHtml(node.id)+"</span>"}
```
→ `mark` 문자열과 `<span class="dot">` 을 전부 제거. `node` 클래스를 쓰던 곳도
project-report 의 `status-badge[data-status="..."]` 로 대체. state 매핑:

| node.state       | data-status  |
|------------------|--------------|
| complete/passed  | complete     |
| active/in-progress | in-progress |
| failed           | failed       |
| pending          | idle         |

label 은 **escape 된 node.id / phase id 그 자체만** 표시.

### 1-4. 클라이언트 스크립트 정리

- `connect()` 안쪽에서 매번 `setInterval(...)` 을 새로 걸고 있어 재연결마다
  interval 이 누적된다. 모듈 스코프에서 한 번만 설정하도록 리팩토링하고,
  현재 `es` 참조는 module-level 변수로 관리.
- `chipClass()` → `statusFromEvent()` 로 이름 변경, project-report
  `normalizeStatus()` 동일 매핑 반환 (`complete/in-progress/partial/failed/idle`).
- 모든 chip/badge 렌더링을 `<span class="status-badge" data-status="..."></span>`
  로 통일.
- `renderState()` 는 기존 로직(텍스트 값 주입) 유지하면서 strip 대신 section
  innerHTML 을 새 마크업으로 교체.
- Anchor 클릭 smooth-scroll 로직은 project-report 와 동일하게 포함.
- `$('updated')` 같은 기존 ID 는 필요 없으면 과감히 정리. 남겨도 되지만 아무
  요소도 가리키지 않으면 삭제해서 dead code 방지.

### 1-5. 코드 스타일

- HTML + CSS + JS 는 기존처럼 단일 template literal 안에 둔다. 단, **가독성**을
  위해 CSS 는 한 줄에 하나의 selector block 씩 줄바꿈 허용. 파일 전체가
  project-report 만큼 읽기 쉬우면 된다.
- `renderShellHtml()` 이외 다른 export/내부 함수 시그니처는 보존.
- `renderIconSvg()` 는 그대로 유지 (`/icon.svg` 계약).

---

## 2) `scripts/vibe-sprint-complete.mjs` — daily event emit

Sprint 완료 시 dashboard 가 즉시 timeline 을 갱신할 수 있도록 daily-log 에
이벤트를 기록한다.

### 변경 지점

파일 말미의 `runCli()` 안, `writeFileSync(statusPath, ...)` (현재 ~line 577)
직후, handoff/session-log 업데이트 이전 또는 이후 적절한 위치에 새 step 추가.

### 구현 지침

- helper 함수 하나 추가: `emitSprintCompletedDailyEvent(sprintId, status,
  summary, actualLoc, scriptDir)`. 내부에서 `spawnSync(process.execPath,
  [scripts/vibe-daily-log.mjs, eventType, '--payload', JSON.stringify(payload)],
  { cwd, env, stdio: 'ignore' })` 호출.
- `eventType`:
  - `status === 'passed'` → `'sprint-completed'`
  - `status === 'failed'` → `'sprint-failed'`
  - 그 외 → emit 하지 않음.
- `payload` 스펙:
  ```js
  {
    sprintId,
    status,                     // 'passed' | 'failed'
    summary,                    // finalSummary
    loc: actualLoc ?? undefined // { added, deleted, net, filesChanged } 또는 생략
  }
  ```
- `alreadyClosed === true` 인 경우 중복 emit 방지 — skip.
- `logStep('daily-log', 'ok' | 'skip' | 'warn', detail)` 로 기존 step 로깅 패턴
  따름.
- `vibe-attention.mjs` 의 spawnSync 패턴(`env: { ...process.env, VIBE_ROOT:
  root }`) 참고. 여기서는 root 가 `process.cwd()` 이므로 `cwd: process.cwd()`
  + `VIBE_ROOT` 설정.

### 테스트 / 계약

- `test/vibe-sprint-complete.test.ts` 는 `archiveSprintPrompts` 만 import 하므로
  새 helper 가 default path 외부에 있어도 무관.
- 기존 테스트 깨뜨리지 말 것.

---

## 3) 검증 (Orchestrator 가 후속 실행, Codex 는 여기까지만)

- `npx tsc --noEmit` — 수정 없음 (mjs). 하지만 전체 빌드 타입 체크 돌림.
- `node --test test/dashboard-server.test.ts` — 전 테스트 통과.
- `node --test test/vibe-sprint-complete.test.ts` — 전 테스트 통과.
- 수동 검증은 Orchestrator 담당.

---

## 마무리 리포트 포맷

Codex 는 완료 후 다음을 `stderr` 로 남긴다:
1. 수정한 파일과 대략 LOC 변화
2. 각 파일에서 바꾼 핵심 블록 요약 (renderShellHtml 재작성, daily-log emit 추가)
3. 남은 우려/불확실성 1-2줄 (없으면 "none")
