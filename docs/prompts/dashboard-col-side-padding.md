# Task — Dashboard col-side padding & spacing 정리

## Context

`scripts/vibe-dashboard.mjs` 의 `renderShellHtml()` 우측 aside (`.col-side`) 섹션들이
padding 없이 서로 딱 붙어 있고, wrap 사용이 불일치한다. 현재 구조:

```html
<aside class="col-side">
  <section id="attention" class="report-section wrap"> ... </section>
  <section class="report-section wrap" aria-label="Iteration summary">
    <article class="metric-card iteration-card"> ... </article>  <!-- 이중 padding -->
  </section>
  <section class="report-section wrap" aria-label="Current sprint summary">
    <article class="metric-card current-sprint-card" id="currentSprintCard"> ... </article>  <!-- 이중 padding -->
  </section>
  <section class="metric-grid dashboard-metrics report-section" aria-label="Dashboard metrics">
    <button class="metric-card" id="riskButton"> ... </button>
    <article class="metric-card"> ... </article>
    <article class="metric-card card-wide"> ... </article>
  </section>
</aside>
```

### 문제 3가지

1. `.col-side .report-section{margin-top:0}` 가 col-side 의 **모든** 자식 섹션에 적용되어
   4개 섹션이 세로 간격 0으로 붙어버린다. (project-report 는 col-side 에 section 1개라
   문제 없었음.)
2. Iteration / Current Sprint 섹션은 `.report-section.wrap` (padding:32px) 안에 또
   `.metric-card` (padding:24px) 를 중첩해 padding 이 2중. 시각적으로 카드가 너무
   안쪽으로 밀려 있다.
3. 하단 metric-grid 는 `.wrap` 없이 바로 그리드라 위 섹션들과 프레임 느낌이 달라
   혼자 맨몸으로 매달려 있다.

## 변경 요구사항

### A. col-side 섹션 간격 복원

- `.col-side .report-section{margin-top:0}` 규칙은 **첫 번째 섹션에만** 해당되도록
  바꾼다. 가장 간단한 방법:
  ```css
  .col-side{display:flex;flex-direction:column;gap:28px}
  .col-side .report-section{margin-top:0}
  ```
  `display:flex` + `gap` 으로 일괄 간격 부여. `margin-top:0` 은 유지 (flex gap 이
  간격을 담당).
- 1024px 이하 미디어 쿼리에서 `.col-side .report-section{margin-top:80px}` 이
  있다면, flex gap 때문에 불필요해지므로 `margin-top` 규칙 제거하고 gap 만 키운다:
  ```css
  @media (max-width:1024px){
    ...
    .col-side{gap:48px}
    /* .col-side .report-section{margin-top:80px} 규칙 삭제 */
  }
  ```
  (기존 코드에 해당 규칙이 실제로 있으면 제거, 없으면 추가할 필요 없음.)

### B. Iteration / Current Sprint 이중 padding 제거

**접근**: 바깥 `.report-section.wrap` 을 유지하되, 안쪽 `.metric-card` 컨테이너를
없애고 그 자식을 section 으로 바로 옮긴다. 최종 구조 예:

```html
<section class="report-section wrap iteration-card" aria-label="Iteration summary">
  <p class="eyebrow-sm" id="iterId">ITERATION</p>
  <h3 id="iterLabel">No active iteration</h3>
  <span id="iterGoal" class="muted"></span>
  <div class="progress-wrap" aria-label="Iteration sprint progress">
    <div class="progress-bar"><span id="iterBarFill" style="width:0%"></span></div>
    <span id="iterPercent">0%</span>
  </div>
  <span id="iterProgressText" class="muted">0 / 0 sprints</span>
</section>

<section class="report-section wrap current-sprint-card" id="currentSprintCard" aria-label="Current sprint summary">
  <p class="eyebrow-sm">Current Sprint</p>
  <div class="card-head">
    <h3><code id="sprintId">idle</code></h3>
    <span id="sprintStatus" class="status-badge" data-status="idle">idle</span>
  </div>
</section>
```

- 기존 `.iteration-card h3` / `.iteration-card .progress-wrap` / `.current-sprint-card .card-head`
  CSS 셀렉터는 그대로 살려두면 된다 (이제 section 에 클래스가 붙으므로 동일하게 매칭됨).
- `.iteration-card p` / `.current-sprint-card p` 에 eyebrow 스타일이 필요하면
  아래 새 CSS 로 처리.
- 제거된 `<article class="metric-card">` 래퍼의 기존 `.metric-card` 스타일 중
  일부 (padding, border, glass bg) 는 이제 `.report-section.wrap` 이 제공.

### C. 하단 Metric Grid 는 wrap 으로 감싸 통일

`.metric-grid.dashboard-metrics.report-section` 에 `.wrap` 을 추가한다:

```html
<section class="metric-grid dashboard-metrics report-section wrap" aria-label="Dashboard metrics">
```

이렇게 하면 metric-grid 도 다른 col-side 섹션과 동일한 frame (glass bg + padding:32px) 을
얻는다. 단 `.report-section.wrap` 이 `padding:32px` 을 갖고 있고, `.metric-grid` 가
`display:grid` 인데 둘이 충돌 없도록 `.metric-grid.wrap` 셀렉터가 필요하면 아래처럼
추가:

```css
.dashboard-metrics.wrap{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.dashboard-metrics.wrap .card-wide{grid-column:1 / -1}
```

이유: 기본 `.metric-grid{grid-template-columns:repeat(4,minmax(0,1fr))}` 는 사이드바에서는
너무 많은 컬럼이다. dashboard-metrics 는 3개 카드 (Open Risks / Tokens Today / Latest Test full-width) 이므로
`repeat(2, 1fr)` + `card-wide` 가 `grid-column:1/-1` 로 전체 폭을 차지하는 구성이 적절.
기존 `.dashboard-metrics .card-wide{grid-column:1/-1}` 규칙은 유지.

### D. eyebrow-sm 유틸 추가 (새 section 에 쓰일 경우)

기존 `.metric-card p` 스타일 (11px upper tracking label) 을 그대로 쓰려면 필요 없지만,
section 직계 `<p>` 가 eyebrow 처럼 보여야 한다면 다음 규칙 추가:

```css
.eyebrow-sm{font-size:11px;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);margin:0 0 12px}
```

또는 기존 `.metric-card p` 셀렉터를 재활용하도록 `.iteration-card p` / `.current-sprint-card p`
직계 타겟 규칙을 확장:

```css
.report-section.wrap.iteration-card>p,.report-section.wrap.current-sprint-card>p{font-size:11px;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);margin:0 0 16px}
.report-section.wrap.iteration-card>h3{font-size:20px;margin:0 0 10px}
.report-section.wrap.iteration-card .progress-wrap{margin-top:18px}
```

(원래 `.iteration-card h3` / `.iteration-card .progress-wrap` 규칙과 동일한 의도를
section 레벨로 이동. 단, 기존 규칙이 이미 셀렉터 매칭되면 그대로 두고 중복 선언 피한다.)

## 유지/금지

- `renderState()` / `renderIteration()` 등 JS 에서 `getElementById` 로 참조하는 ID
  (`iterId`, `iterLabel`, `iterGoal`, `iterPercent`, `iterBarFill`, `iterProgressText`,
  `sprintId`, `sprintStatus`, `currentSprintCard`, `riskCount`, `riskButton`, `tokens`,
  `latestTest`, `latestTestDetail`) 전부 유지. 제거되는 `<article>` 안에 있는 ID 들을
  그대로 새 section 안으로 옮길 것.
- 기존 `data-status` 동작, SSE 흐름, 테스트 동작 전부 유지.
- 기존 `.metric-card` CSS 블록 자체는 제거하지 않는다 — 하단 metric-grid 안에서
  여전히 3개 카드가 `.metric-card` 를 쓴다.
- `test/dashboard-server.test.ts` 는 HTML 구조를 직접 assert 하지 않고 `/api/state`
  shape + SSE 만 보는 것이므로 영향 없어야 한다.

## 검증 기대

- `node --test test/dashboard-server.test.ts` 통과
- 브라우저 (`http://127.0.0.1:<port>/`) 에서 우측 col-side 의 4개 섹션이 동일한 frame,
  동일한 padding, 일관된 수직 gap 으로 나열됨.
- Iteration / Current Sprint 섹션 padding 이 32px 단일 (이전 32+24=56px 에서 축소).

## 리포트

Codex 는 완료 후 stderr 로:
- 수정한 CSS/HTML 블록 라인 요약
- 테스트 통과 여부 (가능하면 `node --test test/dashboard-server.test.ts` 실행 결과 포함)
