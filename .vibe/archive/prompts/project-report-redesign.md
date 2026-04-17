# project-report.html 전면 redesign — editorial + dashboard hybrid

## Design Philosophy

이 report 는 **editorial long-form document + minimal dashboard** 의 hybrid. 참고 기준:

- **Vercel docs** (typography rhythm, restraint)
- **Linear changelog** (dot/line timeline, muted palette)
- **Stripe press release** (large headline, clean metric cards)
- **FT.com / WSJ data feature** (tabular numbers, editorial long-form)

**Target feel**: 시니어 product designer 가 1인 프로젝트 report 로 만든 자료. Generic "admin template" 느낌 금지.

## AI slop 금지 리스트 (가장 중요)

다음 pattern 을 **절대 사용하지 마라**:

- ❌ Gradient background 또는 text gradient (purple/blue fade 등)
- ❌ Glassmorphism / neumorphism / backdrop-filter blur
- ❌ 과도한 box-shadow (card 에 다층 shadow 금지 — hairline border 중심)
- ❌ Heading 이나 section label 에 이모지 배치 ("🚀 Overview", "📊 Stats" 등)
- ❌ "Modern sleek dashboard" 계통 Bootstrap admin template
- ❌ Sidebar navigation (report 는 long-form document)
- ❌ Hover 시 scale transform (subtle translateY 1~2px 만 허용)
- ❌ Rounded card 모서리 과대 (`border-radius: 16px+` 금지, `4~8px` 만)
- ❌ Pastel 색 덮어쓰기 ("vibes" 보다 명도 대비)
- ❌ 의미 없는 decorative line / divider
- ❌ `<br>` 로 간격 조정 (margin 사용)
- ❌ 불필요 icon (Heroicons / Feather 의 장식용 icon 남발)

## 구체 Specification

### Typography

- **Font stack**:
  - Sans (body + heading): `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif`
  - Monospace (hash, path, timestamp): `"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace`
  - Google Fonts import OK (Inter + JetBrains Mono) — `<link rel="preconnect">` + `<link href="...display=swap">`.
- **Scale** (modular, consistent):
  - H1: 40px / line-height 1.15 / weight 700 / letter-spacing -0.02em
  - H2: 24px / 1.3 / 600 / -0.01em
  - H3: 17px / 1.4 / 600
  - Body: 15px / 1.65 / 400
  - Meta/small: 13px / 1.5 / 500
  - Micro (badge, label): 11px / 1 / 600 / uppercase / letter-spacing 0.06em
- **Numbers 강조**: big metric 숫자는 `font-variant-numeric: tabular-nums` + 28~40px / weight 600.

### Color Palette (strict)

- Background: `#ffffff`
- Surface (card): `#ffffff` — 구분은 border 로만
- Text primary: `#0a0a0a`
- Text secondary: `#52525b`
- Text muted: `#a1a1aa`
- Border hairline: `#e4e4e7`
- Border strong (divider): `#d4d4d8`
- Single accent (link/current): `#2563eb`
- Status tints (badge bg + text):
  - passed/complete: bg `#dcfce7` / text `#15803d`
  - in-progress: bg `#dbeafe` / text `#1d4ed8`
  - partial: bg `#fef3c7` / text `#92400e`
  - failed/open: bg `#fee2e2` / text `#b91c1c`
  - idle/muted: bg `#f4f4f5` / text `#52525b`

**1 accent color 원칙** — blue (`#2563eb`) 는 link / 현재 iteration marker / filter active state 에만. 나머지는 neutral.

### Spacing System

4/8 rhythm: `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 px`.

- Section gap: 64px (대형) / 48px (중간)
- Card padding: 24px
- Grid gap: 16px (tight) / 24px (relaxed)
- Inline gap: 8px

### Layout

- **Container**: centered, `max-width: 960px`, padding `48px 32px` (모바일 `32px 20px`).
- **Responsive breakpoints**: 640px / 1024px. Mobile first.
- **Sticky header**: project name + iteration progress tag (blue). Scroll 시 subtle blur 없이 solid `#ffffff` + bottom border.
- **Print** (`@media print`): 배경 white, accent 색 유지, interactive element 는 expanded default 로.

### Section 구성 (top-to-bottom)

#### 1. Header (sticky)

- Uppercase micro label: "PROJECT REPORT" (text-muted)
- H1: Project name
- Subtitle (body-muted): one-liner 또는 current iteration goal
- Meta row (flex between): "Generated 2026-04-18 09:00 KST" · "Platform: win32" · "Iter: iter-3" — 작은 font, 단순 텍스트
- Bottom hairline

#### 2. Dashboard metric row

4 카드 grid (auto-fit, minmax 200px). 각 카드:
- Micro uppercase label ("TOTAL SPRINTS")
- 큰 숫자 (40px, tabular-nums)
- 작은 delta / context (muted, 13px) — 예: "3 added this iter"

Metric candidates (script 에서 compute):
- Total Sprints (passed)
- Total Iterations
- Total LOC (add + delete 중 사용자 선호 기준 — net 또는 delta 집계)
- Open Risks

실제 data 기준으로 4 개 선택 (script 에서 결정).

#### 3. Iteration Timeline

- **Horizontal SVG** (또는 flexbox + pseudo-element line) — dots on a line
- 각 dot 아래 label (id · status · date)
- Current iteration dot: filled blue, label bold
- Past: filled neutral (dark gray), label 일반
- Line hairline stroke
- Hover dot → tooltip (iteration goal) — JS 로 simple

#### 4. Sprint Outputs

- Section H2 + count ("12 sprints across 3 iterations")
- 3-col card grid (`grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))`)
- 카드:
  - 상단: Sprint id (monospace) + status badge (right-aligned)
  - 라벨 (h3)
  - Body rows: LOC delta / commit hash (mono) / completed date (mono)
  - Hairline border, `border-radius: 6px`, padding 20px
  - Hover: `transform: translateY(-1px)`, border color 강조 `#d4d4d8`

#### 5. Milestone Progress

- **Milestone 없으면 section 자체 숨김** (JS conditional 또는 server-side — generator 에서 skip)
- 있으면:
  - 각 milestone 이름 + progress bar (hairline container + filled blue bar) + `{n}/{total}` 숫자

#### 6. Key Decisions (핵심 redesign)

- Section H2 + count badge ("53 entries")
- 우측 action row:
  - Filter chips: `All · decision · failure · sprint-complete · user-directive · audit · planner-skip · drift-observed`
    - 활성: underline 2px accent, color `#0a0a0a`
    - 비활성: `color: #52525b`
  - "Expand all" / "Collapse all" 버튼 (text button, 13px)
- Entries grouped by date (YYYY-MM-DD) — 각 group 상단에 sticky-within-section small date header
- 각 entry:
  - Time `HH:MM` (mono, muted 13px)
  - Tag badge (micro uppercase, tint bg)
  - Content (body)
  - 긴 content (≥150 chars) 는 `<details>` collapse, summary 에 첫 100 chars + "…"
- JS behavior:
  - Filter chip click → DOM attribute update (`data-active-tags`) → CSS rule 로 관련 entry 만 display
  - "All" chip → 모든 tag 활성
  - Expand/Collapse all → 모든 `<details>` toggle

#### 7. Verification Status

- Section H2
- Card grid (2-col) 또는 단일 list:
  - Script name (mono) + last run status badge + timestamp
- Data source: `.vibe/agent/sprint-status.json.verificationCommands` + package.json scripts
- 빈 경우 placeholder "No verification runs recorded" (muted, italic 아님)

#### 8. Next Steps

- Numbered list (H3 스타일 아닌 ordered list) 또는 checklist
- 각 item: actionable (동사 start)
- 예: "Continue iter-3 — 다음 roadmap slot" / "Trigger audit cadence — 5 sprints reached"

#### 9. Footer

- 얇은 top border
- 작은 meta: "Generated by vibe-doctor v1.4.1 · 2026-04-18 09:00 KST"
- Link: repo URL (있으면)

### Interactive behavior (vanilla JS)

- **Filter chips** (Key Decisions):
  - Click → toggle `aria-pressed` + dataset 갱신
  - CSS `[data-active-tags~="decision"] .entry[data-tag="decision"] { display: block; }` 식
  - "All" 클릭 → reset
- **Expand/Collapse all**: 모든 `<details>` open attribute toggle
- **Timeline tooltip**: dot hover/focus 시 tooltip (title attribute + CSS `::before` 또는 floating div)
- **Smooth scroll**: `<a href="#section">` 내부 링크 부드럽게 (CSS `scroll-behavior: smooth`, JS 불필요)
- **Keyboard accessibility**:
  - Filter chip: button 태그 + Enter/Space
  - Details: 기본 HTML 처리
- **No library**: `document.querySelector` 등 vanilla 만

### Accessibility

- Semantic HTML: `<header>`, `<main>`, `<section>`, `<article>`, `<nav>` 적절히
- `aria-label`, `aria-pressed`, `role` 적절히
- Contrast ratio WCAG AA (`text primary / bg ≥ 7:1` 기본 black-on-white)
- Focus ring: `outline: 2px solid #2563eb; outline-offset: 2px` (모든 interactive)
- Skip link: top 에 "Skip to content" 숨김 (focus 시 visible)

### Print (`@media print`)

- 배경 white, border 유지
- 모든 `<details>` force open
- Filter chip 숨김 (interactive 무의미)
- Footer 에 page number / url 추가

## Implementation 지시

### Files

- **Rewrite**: `scripts/vibe-project-report.mjs` (전체 redesign 가능, 550 lines)
- **Update**: `test/project-report.test.ts` (기존 222 lines) — 새 DOM 구조에 맞게 assertion update
- **No new files** (0 new scripts 원칙 유지)

### Structure (script)

- HTML/CSS/JS 모두 template literal 에 inline
- Single file output — 외부 CSS/JS 의존 없음
- Google Fonts `<link>` 는 optional: 환경에서 네트워크 없으면 fallback 동작 OK

### 기존 data-flow 보존

- 기존 `parseArgs`, `parseProduct`, `parseRoadmapSprintIds`, `parseRoadmapSprintDetails`, `parseMilestones`, `normalizeIterationHistory`, `filterSessionDecisions`, `readGitLog`, `filterCommits`, `statusLabel` 등 helper 는 **기능 유지**. 필요하면 개선.
- `renderHtml(model)` 이 최종 HTML 을 return. 이 함수와 모든 `render*` helper 를 redesign.

## Acceptance criteria

1. `npx tsc --noEmit` 0 errors.
2. `npm test` 0 failures. `test/project-report.test.ts` 기존 테스트가 새 DOM 구조에 맞춰 업데이트되어 pass. 새 test 1~2 개 추가 (filter chip JS, details collapse 관련 assertion).
3. `node scripts/vibe-project-report.mjs` 실행 → `docs/reports/project-report.html` 생성.
4. 생성된 HTML 을 브라우저에서 열었을 때:
   - Google Fonts 로드 (네트워크 있으면)
   - Layout 이 container max-width 960px 내에서 정렬
   - Key Decisions section 이 default collapsed + filter chip 동작
   - Iteration Timeline 이 horizontal dot/line
   - Sprint Outputs 3-col grid (responsive)
   - Milestone Progress 섹션이 data 없으면 completely 숨김
5. HTML 구조 semantic (`<header>`, `<main>`, `<section>` 사용).
6. CSS 에 gradient, glassmorphism, 과도한 shadow **전혀 없음** (Codex 자체 검증).
7. 이모지 사용 없음 (status tint 는 color 로 표현, 이모지 아님).
8. @media print 섹션 포함.

## Non-goals

- Dark mode (사용자 defer 결정)
- Server-side rendering / React / Vue / svelte (vanilla JS만)
- Chart library (d3, chart.js 등) — 필요 시 pure SVG/CSS 로
- 다른 report format (PDF/markdown) 생성 — HTML only

## Final report contract

Codex Final report 에 포함:
- `Files changed` table (mjs / test)
- Generated HTML sample 의 **first 30 lines + Key Decisions 섹션 snippet** 인용
- CSS 가 "AI slop 금지 리스트" 전부 충족하는지 self-check bullet list
- Test 결과 (Codex sandbox 내부 tsc / test 는 Windows 에서 skip — 이미 auto-injected)
