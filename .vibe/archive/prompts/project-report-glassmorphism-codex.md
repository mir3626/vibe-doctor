# project-report glassmorphism redesign — Codex variant

## Context

`scripts/vibe-project-report.mjs` 의 현재 main branch (`d6b41c5`) 에는 **Orchestrator (Claude) 가 직접 작성한** glassmorphism + iridescent orb 버전이 이미 들어있다. 이 branch 에서는 **Codex 의 독립적 해석** 으로 같은 디자인 spec 을 재구현한다. 두 버전 비교용.

**중요**: main 의 Orchestrator 구현을 copy 하지 말고, 너의 해석으로 re-work. 동일한 class 이름 / render 함수 인터페이스는 유지 (기존 helper 호환).

## Design spec (Dribbble refs 해석)

### ref1 (Kinetic) — borderless glassmorphism nav
- 어두운 hero 배경 위에 **frosted glass pill nav bar** 가 sticky.
- 좌측 로고, 중앙 nav pill, 우측 CTA.
- 테두리는 hairline inner highlight 로만 보임 (sharp outer border 없음).

### ref2 (iridescent orb) — 움직이는 브랜드 아이콘
- 검은 배경 + 3D 비눗방울 sphere.
- 표면에 blue / purple / orange / cyan iridescent spectrum (기름막 느낌).
- 느리게 흐르는 color / 회전 / 변형 — 외부 라이브러리 금지이므로 SVG + CSS animation (conic-gradient, mix-blend-mode, inset shadow) 조합으로 근사.

### ref3 (CED) — fullscreen outer frame
- Viewport 전체 어두운 배경 + **얇은 inset border** 로 window-in-window 효과.
- 내부에 content 배치. border-radius 24px 정도.

## Required behaviors

1. **Dark theme** — `color-scheme: dark`, near-black background (`#0a0a0a` ~ `#1c1c1f` 계열 neutral gradient).
2. **주요 색상은 grayscale (gray/white)** — 사용자 명시. **예외 2가지**: iridescent orb (spectrum 유지) + status badge (complete/failed/partial tint 유지, 기능 구분). 나머지 accent / border / text 전부 neutral.
3. **Glassmorphism 물방울 느낌** — frosted glass 가 아닌 **입체적 water droplet**.
   - `backdrop-filter: blur(~28-32px) saturate(~180%)`
   - Inner highlight: `inset 0 1px 0 rgba(255,255,255,0.12~0.2)` (top edge light)
   - Outer depth: `0 20px 60px rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.25)`
   - Border hairline: `rgba(255,255,255,0.08)` ~ `0.16`
4. **Outer frame** — body 가 전체 viewport 를 차지하고, 내부에 `.outer-frame` 컨테이너가 16~24px 여백 후 rounded 24px border.
5. **Sticky nav pill** — top 16px, borderless glassmorphism, 좌측 brand (orb + "Vibe doctor"), 중앙 anchor nav (`Iterations / Sprints / Decisions / Verification`), 우측 meta (iteration id + date).
6. **Iridescent orb** — 32px, conic-gradient spectrum + `@keyframes orb-spin` (~8s linear infinite) + radial highlight overlay + inset bead shadow.
7. **Ambient glow** — viewport 모서리에 soft white radial blur 1~2 개 (low opacity).
8. **Typography** — Inter + JetBrains Mono (Google Fonts). H1 ~56px, H2 ~28px, tabular-nums, letter-spacing tight.
9. **Status badge** — pill (999px), subtle tint (기능 구분).
10. **기존 render 함수 호출 인터페이스 유지** — `renderMetricCards`, `renderIterationTimeline`, `renderSprintCards`, `renderMilestones`, `renderDecisions`, `renderScriptStatus`, `renderNextSteps` 의 반환 HTML 구조 (class 이름) 가 기존과 같거나 호환 되도록. 기존 JS filter chip / details toggle logic 유지.

## Acceptance criteria

1. `npx tsc --noEmit` 0 errors.
2. `npm test` 0 failures. `test/project-report.test.ts` 기존 assertion (`color-scheme:dark`, `backdrop-filter:blur`, `orb-core`, `@keyframes orb-spin`, `@media print`, `<nav class="site-nav"`, `<div class="outer-frame">`) 모두 pass. 필요 시 assertion 확장.
3. `node scripts/vibe-project-report.mjs --no-open` → `docs/reports/project-report.html` 생성.
4. 생성된 HTML 브라우저 open 시:
   - Dark theme + glassmorphism
   - Iridescent orb 가 실제로 회전 / spectrum
   - Outer frame 명시적으로 보임
   - Sticky nav 가 scroll 시 고정, blur 유지
   - Section 구조 (Metric / Timeline / Sprints / Decisions / Verification / Next Steps)
5. `@media print` 섹션 — background white / glass 효과 제거.
6. Accessibility: semantic HTML, `aria-label` / `aria-pressed`, WCAG AA contrast.

## Non-goals

- 외부 라이브러리 (d3, three.js, tailwind 등) 도입 금지.
- Dark mode toggle (user directive: dark only).
- PWA / service worker.
- 기존 render helper 함수의 parser/model logic 변경 (buildModel 등 — 유지).

## Files

- `scripts/vibe-project-report.mjs` (rewrite `renderHtml` + `<style>` + `<body>` shell + `<script>`)
- `test/project-report.test.ts` (기존 assertion 이미 새 spec 에 맞춰져 있음 — Codex 가 구현한 DOM 이 해당 regex 통과하면 OK. 필요 시 assertion 미세 조정)

## Final report contract

Codex Final report 에 포함:
- `Files changed` table
- `Acceptance check` (각 항목 pass/fail)
- Generated HTML 의 `<head>` snippet (CSS variable 블록, orb core, nav pill)
- 자기 평가: main 의 Orchestrator 버전과 비교해 **자신의 해석적 차별점** 1~2줄 (예: orb 회전 속도, ambient glow 배치, spacing 철학 등)
