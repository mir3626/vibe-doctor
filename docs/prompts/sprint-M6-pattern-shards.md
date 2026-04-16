# Sprint M6 — Stack/framework pattern shards

## Prior

M1–M5 완료 (94 pass / 1 skip). M5 에서 `vibe-interview.mjs` + 10-dimension rubric +
domain-aware synthesizer + answer-parser 구현. 하지만 `tech_stack` dimension 의
answer-parser 출력은 현재 free-form text 이며, 다운스트림(stack-specific shard 선택)
에서 사용할 **정규화된 slug** 가 없다. 또한 `sync-manifest.json` 의 `harness[]` 는
지금까지 **정확한 파일 경로** 만 지원하며, 본 Sprint 가 도입할 다수의 패턴 shard
디렉토리를 매번 수동 등록하는 것은 확장성을 해친다.

직전 Sprint 요약: M5 에서 vibe-interview CLI + 도메인 probe bank + synthesizer/parser
프롬프트 확정. MCP/Ouroboros 는 optional fallback 로 격하. tech_stack slug 정규화
만 미결로 남아 본 Sprint 에서 흡수한다.

## Goal

범프로젝트(폭넓은 도메인·언어) 적응성 확보. 테스트·lint 패턴을 stack 별 shard 로
분리하고, vibe-init Phase 3 가 interview 결과를 stack slug 로 정규화하여 해당 shard
만 `conventions.md` 에 링크로 주입. 동시에 `sync-manifest.json` 이 디렉토리 glob
을 지원하도록 확장하여 향후 shard 추가를 manifest 개별 등록 없이 자동 배포.

비-goal: auto-generation of full `conventions.md` from interview seed (M10 몫).
Playwright browser smoke 실행 (M7 몫). 본 Sprint 의 `typescript-playwright.md`
shard 는 **test pattern 문서** 일 뿐 실제 smoke runner 는 구현하지 않는다.

## Scope

1. **`.claude/skills/test-patterns/` 디렉토리 신설** (8 shard):
   - `_index.md` — stack slug → shard 매핑 (machine-parseable YAML front-matter)
   - `typescript-vitest.md`, `typescript-playwright.md`
   - `python-pytest.md`, `python-hypothesis.md`
   - `rust-cargo-test.md`, `go-testing.md`
   - `canvas-dom-isolation.md` (cross-cutting; DOM/canvas test isolation)
   - `shell-bats.md` (bonus; bash 스크립트 테스트)
2. **`.claude/skills/lint-patterns/` 디렉토리 신설** (5 shard):
   - `_index.md`
   - `typescript-debt.md`, `python-debt.md`, `rust-debt.md`, `go-debt.md`,
     `universal-debt.md` (TODO/FIXME/XXX 공통)
3. **`src/lib/sync.ts` glob 확장**:
   - `manifest.files.harness[]` 의 항목이 `**` / `*` 를 포함하면 디렉토리 재귀
     확장. 확장 결과를 기존 harness 파이프라인에 그대로 투입.
   - 정확한 파일 경로 항목은 기존 동작 유지 (backward compat).
4. **`.vibe/sync-manifest.json` 업데이트**:
   - `.claude/skills/test-patterns/**`, `.claude/skills/lint-patterns/**` 두 glob
     엔트리 추가.
   - 기존 개별 파일 엔트리는 그대로 유지.
5. **M5 answer-parser 보강**:
   - `.claude/skills/vibe-interview/prompts/answer-parser.md` 에
     "Normalized stack slugs" 섹션 추가. LLM 에게 허용 slug 목록을 명시.
   - `tech_stack` dimension 응답 시 `normalized_slugs: string[]` 필드를 출력
     스키마에 포함 (없으면 `[]`).
6. **vibe-init Phase 3 → conventions.md 링크 주입**:
   - `.claude/skills/vibe-init/SKILL.md` Phase 3 Step 3-2 에 후속 단계 추가:
     interview log 의 `tech_stack.normalized_slugs[]` 를 읽어 `_index.md` 매핑
     을 통해 해당 shard 경로를 `docs/context/conventions.md` 의 지정 섹션에 삽입.
7. **Planner 프롬프트 통합**:
   - `.vibe/agent/_common-rules.md` 에 "§ Stack-specific pattern shards (mandatory
     read when present)" 섹션 추가. Planner 소환 시 현재 프로젝트 `conventions.md`
     의 테스트/lint 링크를 반드시 사전 로드하도록 지시.
8. **테스트**:
   - `test/patterns-index.test.ts` — `_index.md` 두 파일 YAML 파싱 + 매핑된 shard
     파일 존재 확인.
   - `test/sync-glob.test.ts` — glob 확장 단위 테스트 (`**`, `*`, 혼합 케이스).
   - `test/sync.test.ts` — glob 엔트리 + 정확 파일 혼합 시 backward-compat 검증
     (최소 1개 추가 케이스).

## Out of scope

- Interview seed → conventions.md 완전 자동 생성 (M10)
- Playwright/browser-smoke 실제 실행 (M7)
- `ruby-rspec`, `java-junit`, `csharp-xunit` 등 추가 언어 shard (후속 PR)
- lint rule 자체 (예: eslint config) — **debt 탐지 grep 패턴만** 수록

## Technical spec

### 1. `_index.md` 포맷 (machine-parseable)

두 `_index.md` 모두 YAML front-matter 로 매핑을 담고, 본문은 human-readable 요약:

```markdown
---
schemaVersion: 1
mapping:
  ts-vitest: typescript-vitest.md
  ts-playwright: typescript-playwright.md
  py-pytest: python-pytest.md
  py-hypothesis: python-hypothesis.md
  rust-cargo: rust-cargo-test.md
  go-testing: go-testing.md
  canvas-dom: canvas-dom-isolation.md
  shell-bats: shell-bats.md
---

# Test patterns index
| slug | shard | when to use |
| --- | --- | --- |
| ts-vitest | typescript-vitest.md | Node/TS unit + integration |
...
```

lint-patterns `_index.md` 동일 구조. `mapping` 은 **slug → 같은 디렉토리 내 상대
파일명**. 파서는 front-matter 만 읽으면 되며, `js-yaml` 등 추가 dep 은 금지
(manifest 규칙). 대신 **수작업 YAML 파싱** (행 분리 + `key: value` 매칭) 또는
이미 사용 중인 유틸을 재사용한다. front-matter 추출은 `/^---\n([\s\S]*?)\n---/`.

### 2. 정규화 slug 목록 (answer-parser 에 하드코딩)

허용 slug (`test-patterns/_index.md` 와 1:1):

```
ts-vitest, ts-playwright, py-pytest, py-hypothesis,
rust-cargo, go-testing, canvas-dom, shell-bats
```

lint-patterns 는 언어 축(ts, py, rust, go, universal) 로 자동 매핑되므로
answer-parser 가 별도 lint slug 를 emit 할 필요는 없다. vibe-init 로직이
test slug → 언어 prefix 추출 → 대응 lint shard 자동 링크.

**Multi-stack 응답**: "TypeScript + Rust core" 같은 답변은
`normalized_slugs: ["ts-vitest", "rust-cargo"]` 로 배열 emit.

**매칭되지 않는 스택**: unknown slug 금지. answer-parser 는 명시 허용 목록
외 값을 emit 하지 말고, 대신 `free_form` 원본만 유지 + `normalized_slugs: []`.

### 3. Glob 확장 (src/lib/sync.ts)

새 헬퍼 추가 (파일 상단 또는 `buildSyncPlan` 바로 위):

```ts
function isGlob(pattern: string): boolean {
  return pattern.includes('*');
}

// 지원: **, * (단일 레벨). 문자 class/? 등은 미지원 — 필요 시 향후 확장.
export async function expandHarnessGlob(
  upstreamRoot: string,
  pattern: string,
): Promise<string[]> { /* ... */ }
```

구현 요지:
- `**` 가 없으면 단일 디렉토리 `readdir` + `*` 매칭.
- `**` 는 `fs.readdir(..., { recursive: true })` (Node 20+ 지원, 이미 `engines`
  에서 허용됨) 로 재귀 파일 수집 후 glob 정규식 매칭.
- 결과는 `upstreamRoot` 기준 POSIX-style relative path (윈도우 `\` → `/` 정규화)
  로 반환. `buildSyncPlan` 의 기존 loop 가 그대로 consume.
- 유닛 테스트가 주입 가능하도록 fs 호출은 `node:fs/promises` 표준만 사용.

`buildSyncPlan` 내 harness loop 수정:

```ts
const resolvedHarness: string[] = [];
for (const entry of manifest.files.harness) {
  if (isGlob(entry)) {
    resolvedHarness.push(...await expandHarnessGlob(upstreamRoot, entry));
  } else {
    resolvedHarness.push(entry);
  }
}
for (const relativePath of resolvedHarness) { /* 기존 로직 */ }
```

중복 제거: `Array.from(new Set(resolvedHarness))` 로 정리 (사용자가 glob + 정확
경로 를 중복 등록한 경우 대비).

### 4. Glob 매칭 정규식

```
segment → [^/]*   (*)
segment → .*      (**, 단 경계에서 슬래시 포함)
```

`.claude/skills/test-patterns/**` → 정규식 `^\.claude/skills/test-patterns/.+$`
( `**` 가 빈 문자열 매치 시 디렉토리 자체를 잡지 않도록 `.+` 사용).

### 5. conventions.md 자동 링크 주입 포맷

`docs/context/conventions.md` 의 아래 두 섹션을 Orchestrator 가 Phase 3 Step 3-2
직후 rewrite (없으면 append):

```markdown
## 테스트 전략
<!-- BEGIN:VIBE:TEST-PATTERNS -->
- TypeScript unit/integration: [.claude/skills/test-patterns/typescript-vitest.md](../../.claude/skills/test-patterns/typescript-vitest.md)
- E2E: [.claude/skills/test-patterns/typescript-playwright.md](...)
<!-- END:VIBE:TEST-PATTERNS -->

## Lint 규칙
<!-- BEGIN:VIBE:LINT-PATTERNS -->
- TypeScript debt grep: [.claude/skills/lint-patterns/typescript-debt.md](...)
- Universal TODO/FIXME: [.claude/skills/lint-patterns/universal-debt.md](...)
<!-- END:VIBE:LINT-PATTERNS -->
```

마커 블록 내부만 Orchestrator 가 rewrite. 사용자가 수동 추가한 외부 내용은 보존.
재실행 idempotent.

### 6. `_common-rules.md` 추가 섹션 (초안 문구)

```markdown
## § Stack-specific pattern shards (mandatory read)

Sprint Planner 는 소환 직후 `docs/context/conventions.md` 의
`VIBE:TEST-PATTERNS` / `VIBE:LINT-PATTERNS` 마커 블록을 파싱하여,
링크된 모든 shard 를 **읽고 Sprint 프롬프트의 "테스트 전략" /
"품질 게이트" 섹션 작성에 반영**한다. 링크가 없는 경우(신생 프로젝트)
생략 가능하며 session-log 에 `[decision][no-pattern-shards]` 로 1회 기록.
```

### 7. Shard 콘텐츠 작성 원칙

- **40–80 줄/개 (test-patterns), 30–50 줄/개 (lint-patterns)**.
- 구조: (1) 프레임워크 설치/설정 한 블록 → (2) 실제 테스트 예제 1–2개 (실행
  가능한 코드) → (3) 흔한 함정 bullet → (4) 결정성(determinism) 주의점.
- **이론 금지, 실행 가능한 코드 필수**. 사용자가 shard 만 복사해도 돌아가도록.
- lint shard 는 **real grep 커맨드** + 왜 debt 인지 rationale + exception 허용
  패턴 (예: 테스트 파일 내 `// @ts-expect-error` 는 허용).
- 예: `typescript-vitest.md` 는 `vitest.config.ts` 최소 예제, `describe/it`
  패턴, mock/fake timer, snapshot 결정성 노트 포함.

### 8. 테스트 세부

- `test/patterns-index.test.ts`:
  - 두 `_index.md` 를 읽고 front-matter 추출 → `mapping` 객체 모든 value 에
    대해 `fs.access` 성공 확인.
  - 매핑된 파일 수 == 디렉토리 내 `*.md` 파일 수(`_index.md` 제외) 인지 assert.
- `test/sync-glob.test.ts`:
  - tmp 디렉토리에 가짜 업스트림 트리 생성 → `expandHarnessGlob` 호출 →
    기대 파일 목록 정확히 반환.
  - `**` / `*` 혼합 / 정확 경로 세 케이스.
- `test/sync.test.ts` 기존 파일:
  - fixture manifest 에 glob 엔트리 1개 추가 → `buildSyncPlan` 의 actions 중
    `new-file` / `replace` 로 확장 파일이 포함되는지 assert.

## Test strategy

1. `npx tsc --noEmit` 0 errors (특히 `expandHarnessGlob` 의 타입 + fs 호출).
2. `npm test` 전체 pass — 신규 3개 스펙 포함.
3. `npm run vibe:sync -- --dry-run` (업스트림=self) 실행 시 새 shard 디렉토리가
   `new-file` 액션으로 인식되는지 스모크 (수동 1회).
4. `_index.md` 매핑 수정 후 테스트 재실행 → 존재하지 않는 파일 가리키면
   `patterns-index.test.ts` 가 실패해야 함 (negative test 로 1건 주석 케이스).

## Checklist (Generator 완료 판정)

- [ ] `.claude/skills/test-patterns/_index.md` 및 8개 shard 작성 (각 40–80 LOC,
      front-matter 포함)
- [ ] `.claude/skills/lint-patterns/_index.md` 및 5개 shard 작성 (각 30–50 LOC)
- [ ] `src/lib/sync.ts` 에 `expandHarnessGlob` export 추가 + `buildSyncPlan` 이
      glob 항목을 확장하여 처리
- [ ] glob 이 없는 기존 manifest 는 동작 변경 없음 (기존 `test/sync.test.ts`
      원 케이스 그대로 pass)
- [ ] `.vibe/sync-manifest.json` 에 두 glob 엔트리 추가
- [ ] `.claude/skills/vibe-interview/prompts/answer-parser.md` 에
      "Normalized stack slugs" 섹션 + 허용 slug 목록 하드코딩
- [ ] `.claude/skills/vibe-init/SKILL.md` Phase 3 Step 3-2 뒤에
      "Step 3-3: conventions.md 테스트/lint 링크 주입" 소절 추가 +
      `VIBE:TEST-PATTERNS` / `VIBE:LINT-PATTERNS` 마커 포맷 명시
- [ ] `.vibe/agent/_common-rules.md` 에 stack-specific shards mandatory-read
      섹션 추가
- [ ] `test/patterns-index.test.ts`, `test/sync-glob.test.ts` 신설
- [ ] `test/sync.test.ts` 에 glob 케이스 ≥1 추가
- [ ] `npx tsc --noEmit` 통과
- [ ] `npm test` 전 스펙 통과 (기존 94 + 신규)
- [ ] `_common-rules.md` 변경이 manifest `harness[]` 에 이미 포함되어 있음을
      확인 (추가 등록 불필요)
- [ ] 모든 신규 파일이 manifest glob 으로 자동 포함되는지 `vibe-sync --dry-run`
      으로 1회 확인 (수동, 로그 첨부)

## 구현 주의사항 (Generator 에게)

- shard 본문은 **stub 금지**. 실제 코드 스니펫이 컴파일/실행 가능한 최소 형태여야
  하며, 언어별 공식 문서 최신 규약을 따른다 (예: pytest `tmp_path` fixture,
  vitest `vi.useFakeTimers` 등).
- glob 매처는 라이브러리 없이 10여 줄 내외로 작성. `**` 는 임의 depth,
  `*` 는 path segment 내부만 (슬래시 미포함) — `minimatch` 와 유사하지만
  full spec 구현은 금지.
- `expandHarnessGlob` 결과 path separator 는 POSIX (`/`). Windows 에서
  `\\` 로 반환되면 `path.posix` 와 비교 시 false negative 가 난다.
- `answer-parser.md` 는 출력 스키마 변경 시 **기존 필드 제거 금지**.
  `normalized_slugs` 는 optional 필드로 추가 — 누락 시 `[]` 로 간주.
- conventions.md 마커 블록이 **없으면** append, **있으면** 블록 내부만 rewrite.
  idempotent 보장.

## Out of scope (재확인)

- conventions.md 전체 auto-gen (M10)
- browser-smoke 실행기 (M7)
- 추가 언어 shard (ruby/java/csharp)
- lint 자동 수정 도구 (grep 탐지까지만)
- M5 answer-parser 의 tech_stack 외 dimension 수정 (본 Sprint 는 tech_stack
  하나만 건드린다)

## Final report 형식 (Generator 완료 후 기록)

```
산출: <N> 파일, <X> LOC 추가 / <Y> 삭제
검증: tsc 0 err, test 97/0 fail (기존 94 + 신규 3 spec 묶음)
미해결 리스크:
  - 각 shard 콘텐츠 품질은 실제 downstream 프로젝트 dogfood 에서 재검증 필요
  - glob matcher 가 `?` / 문자 클래스를 미지원 — 향후 복잡 패턴 필요 시 확장
다음 Sprint 연결 (M7):
  - `typescript-playwright.md` shard 는 문서만 제공. 실제 browser-smoke runner
    는 M7 `scripts/vibe-browser-smoke.mjs` 에서 consume.
```

## LOC 목표

- test-patterns shard 8개 × 평균 55 LOC ≈ 440
- lint-patterns shard 5개 × 평균 40 LOC ≈ 200 (목표 범위 상단)
- `src/lib/sync.ts` glob 로직 추가 ≈ 60
- `.vibe/sync-manifest.json`, `_common-rules.md`, `answer-parser.md`,
  `SKILL.md` 수정 ≈ 40
- 테스트 3건 ≈ 120

**총계 ≈ 860 LOC** (로드맵 예상 550 보다 높음 — shard 콘텐츠 품질 기준 충족이
우선). Generator 는 scope 축소보다 shard 품질 유지를 우선하되, 80 LOC 상한을
넘는 shard 는 예외 승인 필요.
