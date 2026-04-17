# Sprint: M-process-discipline — Planner agent rename + rule normalization

(공용 규칙은 `.vibe/agent/_common-rules.md` 준수 — 특히 §1 샌드박스 우회 금지, §2 의존성 설치 금지, §13 Sandbox-bound invariants, §14 Wiring Integration Checklist.)

## Previous sprint summary (3 lines)

- **M-audit**: Zod single-source schemas + preflight audit-overdue gate + lightweight per-sprint audit + migration 1.4.0 + harness v1.4.0 installed. Commit `bc8f90f`.
- 175 tests pass / 0 fail / 1 skip. Schema drift resolved via `scripts/vibe-gen-schemas.mjs --check`.
- `migrations/1.4.0.mjs` currently only patches state file schemas; this Sprint **extends** it (does not replace it).

---

## Context & why

본 Sprint 는 dogfood7 review 의 finding #3 (`review-planner-skip-without-justification`) 및 #4 (`review-planner-subagent-readonly-conflict`) 를 해소한다. 현재 `.claude/agents/planner.md` 는 Claude Code 내장 "Plan" agent 와 이름이 충돌하여 사용자가 실수로 read-only Plan agent 를 호출하면 `docs/prompts/*.md` 쓰기가 조용히 실패한다. 동시에 CLAUDE.md 의 "trivial" 정의(`<100 LOC + 단일 파일`) 는 LOC 기반이라 gameable — 실제 Planner skip 판단은 "패턴 재사용 여부 + 새 아키텍처 결정 유무" 라는 semantic 기준으로 현실화해야 한다. 본 Sprint 는 (1) 파일명 교체 + 전 참조 정리, (2) frontmatter `tools:` 명시로 read-only trap 제거, (3) trivial 정의 의미 기반 재작성, (4) preflight 에 planner.presence WARN 게이트 + skip-log CLI 를 추가해 "까먹고 skip" 을 "인지하 skip" 으로 강제 전환한다.

---

## Prerequisites (already installed / already landed)

- **Zod 런타임 deps** (M-audit 에서 `package.json dependencies.zod` 추가 완료).
- **§14 Wiring Integration Checklist** 가 live (`.vibe/agent/_common-rules.md §14`).
- **`migrations/1.4.0.mjs`** 파일 존재 — state 패치 로직만 포함. 본 Sprint 가 **동일 파일에 file-level migration 섹션을 append** 한다 (새 migration 파일을 만들지 않는다).
- **Preflight 확장 패턴** 은 `scripts/vibe-preflight.mjs` 에 `record(id, ok, detail, level)` 형태로 이미 정립되어 있음. 본 Sprint 의 신규 check 는 동일 패턴을 따른다.
- **테스트 scaffolding** 은 `test/preflight-audit-gate.test.ts` 의 `scaffoldRepo` helper 형태를 그대로 참고한다.

---

## Scope clarification (중요 — 오해 방지)

본 Sprint 의 rename 은 **agent 파일과 subagent_type 식별자** 에 한정된다. 다음은 **rename 대상이 아니다**:

- `.vibe/config.json` 의 `sprintRoles.planner` 키 — 이 "planner" 는 역할 슬롯(role-slot) 이름이며 provider 배정 키다. 역할 개념 자체("무엇을 만들지 스펙하는 단계")는 유지된다.
- `src/lib/config.ts` 의 `SprintRoleDefinition.planner` 필드.
- `test/config.test.ts`, `test/sync.test.ts`, `test/model-registry.test.ts` 의 `sprintRoles: { planner: ... }` — 역할 슬롯 참조라 손대지 않는다.
- `scripts/vibe-resolve-model.mjs` 의 `ROLE_NAMES = ['planner', 'generator', 'evaluator']` — 역할 목록이지 agent 파일 참조가 아니다.
- `scripts/vibe-interview.mjs` 의 `resolveRoleFromCli('planner', ...)` — 역할 resolver 호출.
- 모든 `Planner` (capitalized, 역할 명칭) 산문 언급.
- 사용자 대면 인터뷰 메시지의 "Planner (스펙 정의)" 등 역할 설명.

다음은 **rename 대상이다**:

- `.claude/agents/planner.md` 파일 자체 → `.claude/agents/sprint-planner.md` (물리 rename, 공존 금지).
- 해당 파일을 직접 참조하는 경로 문자열 (`.vibe/sync-manifest.json` files.harness[]).
- `subagent_type: 'planner'` (또는 `"planner"`) 식별자 — grep 결과 0 hit 이므로 "발견 시 교체" 방어적 처리만.
- CLAUDE.md, README.md, SKILL.md, orchestration.md 등의 **예시 호출 코드 블록** 에서 `subagent_type: 'planner'` 가 보이면 `'sprint-planner'` 로 치환.
- CLAUDE.md 의 `Agent({subagent_type: 'sprint-planner', model: 'opus'})` 명시적 호출 예시 신설.

---

## Deliverables (6)

1. **Agent file rename** — `.claude/agents/planner.md` 삭제 + `.claude/agents/sprint-planner.md` 신규 생성. frontmatter `name` / `description` / `model` / **`tools`** 필드 명시. 본문은 기존 planner.md 산문을 이관하되, 첫 문단의 "This is NOT the Sprint Planner role" disclaimer 는 **제거** (역할 일치 됐으므로).
2. **References purge** — 워크스페이스의 live 참조(archive/report 제외) 모두 `sprint-planner.md` / `'sprint-planner'` 로 교체. `rg "planner\.md"` 결과가 allowlist (아래 §Acceptance 참조) 에만 남아야 한다. `rg "subagent_type.*['\"]planner['\"]"` 결과는 0.
3. **Migration extension** — 기존 `migrations/1.4.0.mjs` 에 file-level migration 섹션 append (idempotent). downstream `vibe:sync` 직후 `.claude/agents/planner.md` 가 orphan 으로 남지 않도록 안전 삭제.
4. **CLAUDE.md updates** — (a) 명시적 `Agent({subagent_type: 'sprint-planner', model: 'opus'})` 호출 예시 블록, (b) 내장 Plan agent 혼동 경고 블록, (c) trivial 예외 정의를 semantic 기준으로 재작성, (d) 훅 강제 메커니즘 테이블에 `vibe-planner-skip-log.mjs` 행 추가.
5. **Preflight `planner.presence` check** — `scripts/vibe-preflight.mjs` 에 신규 check 추가. 다음 pending Sprint ID 도출 + 해당 prompt 파일 존재/신선도 검증. 없으면 WARN (non-blocking) + skip-log CLI 안내.
6. **`scripts/vibe-planner-skip-log.mjs` 신규** — planner skip 시 session-log `[decision][planner-skip]` 엔트리 기록 CLI helper.

---

## File-level spec

### D1. `.claude/agents/sprint-planner.md` (new — content migrated from planner.md)

- **Path**: `.claude/agents/sprint-planner.md`
- **Type**: new file (companion: delete `.claude/agents/planner.md` in same commit)
- **Frontmatter contract** (YAML front-matter at top of file):

  ```yaml
  ---
  name: sprint-planner
  description: Sprint 단위 기술 사양 + 프롬프트 초안 + 완료 체크리스트를 fresh context 로 작성한다. 매 Sprint 시작 전 Orchestrator 가 Must 트리거로 소환.
  model: opus
  tools: Read, Glob, Grep, WebFetch, Write, Edit
  ---
  ```

  - `tools` 는 **명시 필수**. 누락 시 Claude Code 내장 Plan agent 의 read-only default 가 상속되어 `docs/prompts/*.md` 쓰기가 실패한다. 이게 본 Sprint 해결 대상 finding #4 의 근본 원인.
  - `tools` 값은 comma-space separated 문자열 (`.claude/agents/*.md` 의 기존 컨벤션 준수 — `.claude/agents/qa-guardian.md` 등 참고).
- **Body**: 기존 planner.md 본문을 그대로 복사하되:
  - 맨 앞 "This is NOT the Sprint Planner role" 블록은 **제거**. 이제 이 파일이 바로 Sprint Planner 다.
  - 기존 model-alias 주석 블록 (`<!-- model: "opus" is the Claude Code family alias. ... -->`) 은 유지.
  - Responsibilities 목록은 기존 Orchestrator helper 관점이 아니라 **Sprint Planner 관점** 으로 재작성:
    - Sprint 기술 사양(타입·API 시그니처·파일 구조) 도출
    - 완료 체크리스트 작성 (machine-checkable)
    - `docs/prompts/sprint-<id>-*.md` 생성
    - §14 Wiring Integration Checklist 준수
  - 마지막에 Orchestrator 가 메타 편집만 허용되는 경계 (이미 `_common-rules.md §10` 에 있음) 를 한 줄로 cross-reference.
- **Style**: Orchestrator's helper 지시문이 아니라 Sprint Planner 자신에 대한 지시문 (you = sprint-planner).

### D2. `.claude/agents/planner.md` (delete)

- 물리 삭제. git rm 단일 커밋 포함.
- **주의**: `.vibe/archive/` 하위의 역사적 참조는 touch 금지 (§non-goals 참조).

### D3. `.vibe/sync-manifest.json` (modified)

- `files.harness[]` 의 `".claude/agents/planner.md"` entry (현재 line 29) 를 `".claude/agents/sprint-planner.md"` 로 교체.
- 배열 순서 유지 (해당 위치에 inline 교체, 재정렬 금지).
- **추가 harness entry** — 신규 스크립트 등록:
  - `"scripts/vibe-planner-skip-log.mjs"` 를 harness[] 에 추가 (`scripts/vibe-audit-lightweight.mjs` 바로 뒤 근처가 자연스러움).
- `migrations` 맵은 변경 없음 (기존 `migrations/1.4.0.mjs` 재사용).
- **테스트 파일 등록** — `test/preflight-planner-presence.test.ts` + `test/vibe-planner-skip-log.test.ts` 를 harness[] 에 추가.

### D4. `migrations/1.4.0.mjs` (extended — append only)

- **Append** (prepend 나 기존 로직 교체 금지): 새 함수 `migrateAgentFiles(root)` 추가 + `main()` 의 actions 배열에 `agentFiles=<result>` 추가.
- **Signature**:
  ```ts
  function migrateAgentFiles(root: string): 'idempotent' | 'removed-orphan' | 'skipped-missing-replacement'
  ```
- **Contract**:
  - `const oldPath = path.join(root, '.claude', 'agents', 'planner.md')`
  - `const newPath = path.join(root, '.claude', 'agents', 'sprint-planner.md')`
  - If `!existsSync(oldPath)` → return `'idempotent'` (already migrated).
  - If `existsSync(oldPath) && existsSync(newPath)` → `rmSync(oldPath)` → return `'removed-orphan'`. (Safety guard: newPath 가 있을 때만 oldPath 삭제.)
  - If `existsSync(oldPath) && !existsSync(newPath)` → **do nothing** (log warn to stderr via existing pattern), return `'skipped-missing-replacement'`. This prevents data loss if downstream sync order is weird.
- **Idempotent**: 재실행 시 `'idempotent'` 반환.
- **No config bump**: harnessVersionInstalled 은 이미 `1.4.0` 이면 touch 안 함 (기존 `updateConfig` 함수 로직 유지).

### D5. `CLAUDE.md` (modified — section-level edits only)

**다음 세 영역을 수정**한다. 다른 HARNESS:* 영역은 touch 금지.

#### D5.a — 훅 강제 메커니즘 테이블 (`HARNESS:hook-enforcement` 영역)

현재 테이블에 아래 행 추가 (insertion point: `vibe-sprint-mode.mjs` 행 바로 뒤가 자연스러움):

```md
| Sprint 시작 전 (Planner skip) | `node scripts/vibe-planner-skip-log.mjs` | session-log `[decision][planner-skip]` 엔트리 기록 (trivial 예외 발동 시 필수) |
```

#### D5.b — 역할 및 호출 메커니즘 표 바로 아래에 호출 예시 블록 신설 (`HARNESS:role-constraints` 또는 `HARNESS:trigger-matrix` 중 적합한 쪽)

정확한 위치: 현재 "CRITICAL — provider별 호출 방법" 블록 뒤, "Sprint 흐름" 섹션 직전. 아래 블록 삽입:

```md
### Planner 소환 — subagent_type 지정 필수

```
✅ 올바른 Planner 호출 (fresh opus subagent, sprint-planner.md frontmatter 기반):
   Agent({ subagent_type: 'sprint-planner', model: 'opus', prompt: '...' })

⚠️  혼동 주의 — Claude Code 내장 "Plan" agent 는 read-only (Write/Edit 도구 없음).
   `docs/prompts/sprint-<id>-*.md` 생성이 조용히 실패한다. 반드시 subagent_type
   을 `sprint-planner` 로 명시할 것. subagent_type 생략 또는 `planner` 사용 금지.
```
```

#### D5.c — trivial 예외 정의 재작성 (line 43 부근)

기존:
```md
- 🟢 **예외 (프로토타입)**: 사용자가 "자율 + 간소화" 명시 + Sprint가 trivial(**<100 LOC + 단일 파일**) 일 때만 Planner 생략 가능. 생략 근거를 `session-log.md`에 `[decision]` 태그로 기록.
```

교체:
```md
- 🟢 **예외 (프로토타입)**: 사용자가 "자율 + 간소화" 명시 + 아래 **세 조건 전부 충족** 시에만 Planner 생략 가능. 생략 근거를 `node scripts/vibe-planner-skip-log.mjs <sprintId> <reason>` 으로 session-log 에 `[decision][planner-skip]` 태그로 **강제 기록** 한다 (수동 편집 금지).
  1. 직전 Sprint 패턴을 **그대로 계승** (새 파일 유형 / 새 모듈 경계 / 새 schema 없음).
  2. **아키텍처 결정 없음** — 기존 구조 내부의 정제/수정만.
  3. **스펙 변경 작음** — 체크리스트 항목 ≤3 개 + 완전 기계 검증 가능 (`tsc`, grep, test).
  LOC 수치는 예외 판정 기준에 포함하지 **않는다** (gameable). 세 조건 중 하나라도 불확실하면 Planner 소환이 기본값.
```

rationale: `_common-rules.md §10` 의 예외 조건 `<100 LOC + 단일 파일` 도 동일하게 교체 대상이지만 **본 Sprint 범위 밖** — 그 파일은 Planner 가 매 Sprint 참조하는 조각이므로 후속 Sprint (M-harness-gates 또는 별도) 에서 연쇄 업데이트. 본 Sprint 는 CLAUDE.md 쪽만 수정.

**다만**: `_common-rules.md §10` 에도 동일한 문장이 있으므로, 본 Sprint 에서 `_common-rules.md §10` 의 해당 라인을 **문구 일치** 목적으로 동시 업데이트한다 (CLAUDE.md 의 새 세 조건 + `vibe-planner-skip-log.mjs` 안내). 이 범위 한정은 허용 (inconsistency 방지).

### D6. `scripts/vibe-preflight.mjs` (modified — new check only)

- 기존 check 순서 맨 뒤(현재 `orchestration.doc` check 뒤)에 신규 check 추가.
- 기존 check 의 로직은 건드리지 않는다.
- **Contract** — 새 section:

  ```ts
  // 9. Planner presence check (non-blocking warn)
  //
  // Derives the next pending sprint from sprint-status.json + sprint-roadmap.md.
  // If the next sprint has no corresponding docs/prompts/sprint-<id>-*.md whose
  // mtime is newer than sprintStatus.stateUpdatedAt, emit WARN with guidance to
  // either summon the sprint-planner agent OR record a [decision][planner-skip]
  // entry via scripts/vibe-planner-skip-log.mjs.
  ```

- **Derivation algorithm**:
  1. If `BOOTSTRAP_MODE` → record `planner.presence` OK with detail `'bootstrap mode - planner presence check skipped'` and skip.
  2. If `sprintStatus` is null (no sprint-status.json yet) → record OK `'no sprint-status.json yet (planner presence skipped)'`.
  3. Read `docs/plans/sprint-roadmap.md` if it exists. Parse **Sprint IDs** by matching the regex `/^- \*\*id\*\*: `([^`]+)`/m` over the full file (all occurrences). The existing roadmap format uses markdown list entries `- **id**: \`sprint-xxx\``.
  4. If roadmap not found or no IDs parsed → record OK `'no roadmap IDs parseable (planner presence skipped)'` level `'info'`.
  5. Derive `completedIds = new Set(sprintStatus.sprints.filter(s => s.status === 'passed').map(s => s.id))`.
  6. `pendingId = roadmapIds.find(id => !completedIds.has(id))`.
  7. If no `pendingId` → record OK `'all roadmap sprints completed (planner presence skipped)'`.
  8. Glob `docs/prompts/sprint-<pendingId>-*.md` (use `node:fs.readdirSync` + filter by startsWith — do NOT add glob deps). Find the first match.
  9. If no match found → record WARN (`ok: true`, `level: 'warn'`) with detail:
     ```
     next sprint ${pendingId} has no prompt file at docs/prompts/sprint-${pendingId}-*.md. Either summon sprint-planner (Agent subagent_type: 'sprint-planner') OR record an explicit skip with: node scripts/vibe-planner-skip-log.mjs ${pendingId} "<reason>"
     ```
  10. If match found but `mtime <= new Date(sprintStatus.stateUpdatedAt).getTime()` → record WARN with detail explaining `prompt file is older than last state update (possibly stale from previous sprint — verify it's the intended prompt)`.
  11. If match found and mtime is newer → record OK `planner.presence` with detail `'found: docs/prompts/<matched-filename> (mtime newer than stateUpdatedAt)'`.

- **Non-blocking**: WARN is `ok: true` with `level: 'warn'`. The final `anyFail` reducer only flags records with `ok === false`, so this check never causes exit 1.
- **Also accept a recent planner-skip entry as satisfaction** (optional but recommended): if session-log.md contains a line matching `/\[decision\]\[planner-skip\].*sprint=${pendingId}/` with ISO timestamp newer than `stateUpdatedAt`, treat as OK with detail `planner intentionally skipped for ${pendingId} (recorded in session-log)`. This makes the skip-log CLI actually close the loop.
- **Error safety**: all filesystem reads in try/catch; on any unexpected error record OK with level `'info'` and message `planner presence check errored: <message> (non-blocking)`.

### D7. `scripts/vibe-planner-skip-log.mjs` (new)

- **Path**: `scripts/vibe-planner-skip-log.mjs`
- **Executable**: shebang `#!/usr/bin/env node`, ESM (`import` syntax), no tsc compile needed.
- **Usage**: `node scripts/vibe-planner-skip-log.mjs <sprintId> <reason>`
- **Contract**:
  - Arg count: exactly 2 positional args beyond `process.argv[0..1]`. Other counts → stderr: `usage: node scripts/vibe-planner-skip-log.mjs <sprintId> <reason>` → exit 1.
  - `sprintId` must match `/^[a-z0-9][a-z0-9-]*[a-z0-9]$/` (kebab-case, min 2 chars). Fail → stderr `invalid sprintId: must be kebab-case (regex: /^[a-z0-9][a-z0-9-]*[a-z0-9]$/)` → exit 1.
  - `reason` must be non-empty after trim, max length 500. Fail → stderr `reason must be non-empty (1-500 chars)` → exit 1.
  - Escaping: reject `reason` containing newline characters (`\n` or `\r`) with message `reason must be single-line` → exit 1. This keeps session-log one entry per line.
  - Session-log path: `resolve('.vibe/agent/session-log.md')`. If missing → stderr `session-log.md not found at <path>` → exit 1 (do NOT create — the file is project-owned).
  - Insertion: find `## Entries` heading (regex `/(^## Entries\s*$\n?)/m`). If missing → exit 1 with message `session-log.md lacks '## Entries' heading`.
  - Entry format (single line, appended immediately after `## Entries` heading):
    ```
    - <ISO-timestamp> [decision][planner-skip] sprint=<sprintId> reason=<reason>
    ```
    Where `<ISO-timestamp>` = `new Date().toISOString()`.
  - Idempotence: if an identical `[decision][planner-skip] sprint=<sprintId> reason=<reason>` line already exists in the file (same sprintId + reason), do not duplicate — emit to stdout `already recorded (idempotent)` → exit 0.
  - On success: write updated content (utf8), stdout `recorded planner-skip for <sprintId>` → exit 0.
- **Mirrors**: follows the same pattern as `appendAuditAck` in `scripts/vibe-preflight.mjs` (line ~113-132). Keep implementation style consistent.

### D8. `test/preflight-planner-presence.test.ts` (new)

- **Harness**: mirror `test/preflight-audit-gate.test.ts` scaffolding (mkdtemp + writeJson + git init).
- **Minimum cases** (each = separate `it(...)`):
  1. `emits WARN when next pending sprint has no prompt file` — scaffold with roadmap containing 2 sprint IDs, sprint-status with first completed, no prompt file → preflight JSON output contains `{id: 'planner.presence', ok: true, level: 'warn'}` with detail mentioning `vibe-planner-skip-log.mjs`.
  2. `emits OK when prompt file exists and is fresh` — scaffold + write `docs/prompts/sprint-<id>-foo.md` with mtime > stateUpdatedAt → `{id: 'planner.presence', ok: true}` without warn level.
  3. `emits OK when planner-skip decision is recorded` — no prompt file but session-log has `[decision][planner-skip] sprint=<pendingId>` entry newer than stateUpdatedAt → OK (not warn).
  4. `skips when all roadmap sprints completed` — scaffold with sprint-status.sprints containing all roadmap IDs as passed → `{level: 'ok'}` with detail mentioning `all roadmap sprints completed`.
  5. `skips gracefully when roadmap missing` — no `docs/plans/sprint-roadmap.md` → OK with level `info` or `ok`, never fail.
- **Invocation**: spawn `node scripts/vibe-preflight.mjs --json` with `cwd: repoRoot`, parse stdout as JSON array, find record by `id === 'planner.presence'`.
- **No network** — pure filesystem fixtures.

### D9. `test/vibe-planner-skip-log.test.ts` (new)

- **Minimum cases**:
  1. `rejects invalid sprintId` — spawn with `foo_bar` (underscore) → exit 1, stderr mentions `kebab-case`.
  2. `rejects empty reason` — spawn with `sprint-M1 ""` → exit 1.
  3. `rejects multi-line reason` — reason contains `\n` → exit 1 with `single-line`.
  4. `rejects when session-log missing` — scaffold without session-log.md → exit 1.
  5. `appends well-formed entry to ## Entries` — scaffold with valid session-log → exit 0, file contains `[decision][planner-skip] sprint=sprint-M1 reason=test reason` on a new line after `## Entries`.
  6. `idempotent on duplicate call` — call twice with identical args → second call exits 0 with stdout `already recorded (idempotent)`, file content unchanged between calls.
- **ISO timestamp check**: assert that the inserted line matches `/^- \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[decision\]\[planner-skip\] sprint=sprint-M1 reason=test reason$/`.
- Spawn via `spawnSync('node', [resolve('scripts/vibe-planner-skip-log.mjs'), 'sprint-M1', 'test reason'], { cwd: repoRoot, encoding: 'utf8' })`.

### D10. `docs/release/v1.4.0.md` (modified — append only)

현재 파일은 M-audit 항목만 있다. 아래 섹션 append:

```md
## M-process-discipline

- Renamed `.claude/agents/planner.md` → `.claude/agents/sprint-planner.md` to remove collision with Claude Code's built-in read-only Plan agent. New frontmatter explicitly declares `tools: Read, Glob, Grep, WebFetch, Write, Edit`.
- Extended `migrations/1.4.0.mjs` with file-level migration (`migrateAgentFiles`) — safely removes orphan `.claude/agents/planner.md` after downstream sync installs the new file.
- Added `scripts/vibe-planner-skip-log.mjs` CLI — enforces a recorded `[decision][planner-skip]` entry in session-log when the trivial exception is invoked (replacement for the previous informal skip).
- Added preflight `planner.presence` check — non-blocking WARN if the next pending sprint has no prompt file and no recorded skip decision.
- Revised CLAUDE.md "trivial" exception: LOC-based threshold replaced with a semantic three-condition test (pattern inheritance + no architecture change + ≤3 checklist items). Mirrored into `.vibe/agent/_common-rules.md §10`.
```

### D11. `.vibe/agent/_common-rules.md` §10 (modified — line-level)

현재 §10 (line ~116-120) 의 두 예외 bullet:
```md
- 🟢 Sprint가 trivial(<100 LOC + 단일 파일) 이고 사용자가 "간소화" 명시
- 🟡 Planner 소환이 2회 연속 실패(타임아웃 / 에러 반환) 후 사용자가 fallback 승인
```

첫 bullet 만 교체 (두 번째 bullet 은 유지):
```md
- 🟢 Sprint 가 trivial (패턴 직접 계승 + 새 아키텍처 결정 없음 + 체크리스트 ≤3 항목) 이고 사용자가 "간소화" 명시. **반드시** `node scripts/vibe-planner-skip-log.mjs <sprintId> <reason>` 으로 session-log 에 `[decision][planner-skip]` 태그 기록 (수동 편집 금지). LOC 기준은 제거됨 (gameable).
```

이 수정은 CLAUDE.md 의 trivial 정의와 문구 일치를 유지하기 위한 최소 편집.

---

## Do NOT modify (수정 금지)

- `.vibe/archive/**` 전체 — 역사적 아카이브. `planner.md` / `'planner'` 언급이 있어도 절대 touch 금지.
- `docs/reports/**` — 완료된 리포트. 역사적 정확성을 위해 보존.
- `docs/plans/sprint-roadmap.md` — Orchestrator 가 후속으로 "(renamed in v1.4.0)" annotation 을 추가할 예정. 본 Sprint 에서는 touch 하지 않는다.
- `.vibe/agent/session-log.md` — 기존 엔트리 수정 금지. 신규 엔트리는 `vibe-planner-skip-log.mjs` 또는 `vibe-sprint-complete.mjs` 로만 추가.
- `.vibe/agent/handoff.md` — Orchestrator 가 sprint-complete 단계에서 갱신한다. Codex 는 touch 금지.
- `.vibe/config.json` 의 `sprintRoles.planner` 필드 — 역할 슬롯 키. 본 Sprint rename 대상 아님.
- `src/lib/config.ts`, `test/config.test.ts`, `test/sync.test.ts`, `test/model-registry.test.ts` 의 role-slot 참조.
- `scripts/vibe-resolve-model.mjs` 의 `ROLE_NAMES`.
- `scripts/vibe-interview.mjs` 의 role resolver 호출.
- `package.json` — 본 Sprint 는 신규 `npm run vibe:*` 엔트리 없음 (scripts 디렉토리 직접 호출).

---

## Acceptance criteria (testable)

각 항목은 기계 검증 가능. Codex 는 Final report Verification 표에 exit code 를 기록한다.

| # | Criterion | 검증 명령 | 기대 |
|---|---|---|---|
| A1 | TypeScript 타입 통과 | `npx tsc --noEmit` | exit 0 |
| A2 | 전체 테스트 통과 + 신규 테스트 ≥6개 | `npm test` | 0 failed. 신규 test 파일 2개 (`preflight-planner-presence.test.ts` + `vibe-planner-skip-log.test.ts`) 에서 최소 6 `it(...)` 케이스 추가. 총 테스트 수 ≥ 181 (175 + 6). |
| A3 | `planner.md` 참조 allowlist 外 0 hit | `rg "planner\.md" --glob "!.vibe/archive/**" --glob "!docs/reports/**" --glob "!docs/prompts/sprint-M-*.md"` | 출력이 allowlist 내 파일만 (아래 §Allowlist 참조). live code/docs 에 잔존 금지. |
| A4 | `subagent_type: 'planner'` (old name) 0 hit | `rg "subagent_type.*['\"]planner['\"]"` | 0 matches (archive 포함 전역). |
| A5 | 새 파일 존재 + 구 파일 부재 | `test -f .claude/agents/sprint-planner.md && ! test -f .claude/agents/planner.md` | true (shell exit 0) |
| A6 | sprint-planner.md frontmatter tools 명시 | `rg "^tools: .*Write.*Edit" .claude/agents/sprint-planner.md` | 1 match (Write 와 Edit 모두 포함) |
| A7 | Migration idempotent | `node migrations/1.4.0.mjs <tempdir>` 2회 연속 실행 | 두 번째 실행 stdout 에 `agentFiles=idempotent` 포함. fixture: tempdir 에 `.claude/agents/sprint-planner.md` 만 존재 (`planner.md` 없음). |
| A8 | Migration safety guard | Fixture: `.claude/agents/planner.md` 존재 + `sprint-planner.md` 부재 → migration 실행 | stdout 에 `agentFiles=skipped-missing-replacement` 포함. `planner.md` 는 삭제되지 **않았어야** 한다 (`test -f .claude/agents/planner.md` true). |
| A9 | Preflight planner.presence WARN emission | 신규 테스트 `emits WARN when next pending sprint has no prompt file` | 통과 |
| A10 | Preflight 전체는 여전히 exit 0 (non-blocking) | M-audit 환경에서 `node scripts/vibe-preflight.mjs` 실행 | exit 0. `[WARN] planner.presence` 라인이 stdout 에 있을 수는 있으나 전체 exit 0. |
| A11 | vibe-planner-skip-log idempotent | 동일 sprintId+reason 2회 호출 | 두 번째는 stdout `already recorded (idempotent)` + exit 0, session-log 내 해당 엔트리가 단 1개만 존재. |
| A12 | vibe-planner-skip-log validation | invalid sprintId (`foo_bar`) 호출 | exit 1, stderr 에 `kebab-case`. |
| A13 | §14 Wiring Integration section in Final report | Codex final report 포함 | `## Wiring Integration` 표 + D1 grep 전후 카운트 + verified-callers 명시 |

### A3 Allowlist (예상 남는 `planner.md` 참조)

아래 경로는 **역사적 보존** 이유로 참조가 남아 있어도 허용된다:

- `.vibe/archive/prompts/**` (e.g., `sprint-M-audit.md`, `sprint-M4-model-tier.md`) — 아카이브.
- `docs/reports/**` — 완료된 리포트.
- `docs/prompts/sprint-M-*.md` — 본 Sprint 및 M-audit 프롬프트 자체 (역사적).

아래는 touch 후에도 **의도된 문자열** 이 남는 경로 (Orchestrator 가 후속 처리하거나 명시적 리뷰 기록):

- `.vibe/agent/session-log.md` — 기존 엔트리 안에 `planner.md → sprint-planner.md` 같은 역사 기록 남을 수 있음. 기존 엔트리 수정 금지이므로 touch 안 함.
- `.vibe/agent/handoff.md` — Orchestrator 가 sprint-complete 단계에서 "planner.md 교체 완료" 로 갱신. 본 Sprint 에서 touch 안 함.
- `docs/plans/sprint-roadmap.md` — Orchestrator 가 후속 annotation 추가 예정. 본 Sprint 에서 touch 안 함.

위 3개 project-owned 파일은 `rg "planner\.md"` 결과에 나타나도 A3 통과로 간주한다. 즉 **A3 의 실제 pass 조건**: Codex 가 touch 한 live harness 파일 중 `planner.md` 잔존 참조가 0.

**권장 검증 명령 (Codex 용)**:

```
rg "planner\.md" \
  --glob "!.vibe/archive/**" \
  --glob "!docs/reports/**" \
  --glob "!docs/prompts/sprint-M-*.md" \
  --glob "!.vibe/agent/session-log.md" \
  --glob "!.vibe/agent/handoff.md" \
  --glob "!docs/plans/sprint-roadmap.md"
```

이 명령의 출력이 **완전히 비어있어야** A3 통과.

---

## Wiring Integration Checklist (mandatory — §14)

Final report 의 `## Wiring Integration` 섹션에 아래 표를 **전부** 포함. 미포함 시 Sprint incomplete, Codex 재위임.

| Checkpoint | Status | Evidence |
|---|---|---|
| W1 CLAUDE.md 훅 테이블 | touched | `scripts/vibe-planner-skip-log.mjs` 행 추가 위치 (line 번호) |
| W2 CLAUDE.md 관련 스킬 | n/a | 신규 슬래시 커맨드/스킬 없음 |
| W3 CLAUDE.md 역할·호출 표 | touched | Planner 호출 예시 블록 신설 위치 + trivial 정의 재작성 위치 |
| W4 `.claude/settings.json` hooks | n/a | 이벤트 훅 미추가 |
| W5 `.claude/settings.json` statusLine | n/a | 상태바 변경 없음 |
| W6 sync-manifest harness[] | touched | `planner.md` → `sprint-planner.md` 교체 + `vibe-planner-skip-log.mjs` 추가 + 2개 test 파일 추가 (line 번호 명시) |
| W7 sync-manifest hybrid.harnessKeys | n/a | 기존 json-deep-merge 파일 확장 없음 |
| W8 README.md 사용자 섹션 | n/a | 사용자 대면 CLI 없음 (내부 helper) |
| W9 package.json scripts | n/a | `npm run vibe:*` 신규 엔트리 없음 |
| W10 release notes v1.4.0.md | touched | M-process-discipline 섹션 append |
| W11 migration 맵 | n/a | 기존 1.4.0.mjs 확장, 새 파일 없음 |
| W12 test 회귀 방지 | touched | `test/preflight-planner-presence.test.ts` (5 cases) + `test/vibe-planner-skip-log.test.ts` (6 cases) |
| W13 harness-gaps.md status | n/a | 본 Sprint 는 기존 gap 해소가 주 목적이 아님 (M-harness-gates 몫) |
| W14 .gitignore 런타임 artifact | n/a | 런타임 생성 파일 없음 |
| D1 `rg planner.md` 전후 | touched | **before**: Codex 가 Sprint 시작 시점에 실행한 `rg` count (예상 ~6-12 live hits). **after**: A3 allowlist 적용 `rg` 후 0. 두 숫자 모두 Final report 에 명시. |
| D2 각 참조처 개별 점검 | touched | sync-manifest / CLAUDE.md / `_common-rules.md` 각각 touched 근거 |
| D3 subagent_type 치환 | touched | `rg subagent_type.*planner` before/after (both 0 expected, 방어적 scan) |
| D4 package.json / settings hooks 참조 | n/a | 참조 없음 (이미 재확인) |
| D5 migration file removal 처리 | touched | `migrations/1.4.0.mjs` 의 `migrateAgentFiles` |
| D6 .gitignore cleanup | n/a | 관련 경로 없음 |

### verified-callers (§14.3 required)

```
.claude/agents/sprint-planner.md
  → CLAUDE.md (호출 예시 블록) - line 번호 명시
  → .vibe/sync-manifest.json harness[] - line 번호 명시
  → docs/context/orchestration.md (Planner 역할 설명) - line 번호 명시 (만약 본 Sprint 에서 touch 한 경우)

scripts/vibe-planner-skip-log.mjs
  → CLAUDE.md 훅 강제 메커니즘 테이블 - line 번호 명시
  → CLAUDE.md trivial 예외 정의 - line 번호 명시
  → .vibe/agent/_common-rules.md §10 - line 번호 명시
  → .vibe/sync-manifest.json harness[] - line 번호 명시
  → test/vibe-planner-skip-log.test.ts (6 cases)
  → scripts/vibe-preflight.mjs 의 planner.presence WARN detail (사용자 안내 문자열)
```

---

## Non-goals / out of scope

본 Sprint 에서 건드리지 **않는다**:

- Evaluator Must 트리거 자동화 (M-harness-gates 몫).
- `audit-skipped-mode` user directive 구현 (M-harness-gates).
- `docs/context/harness-gaps.md` rule ledger 재정비 (M-harness-gates).
- `docs/plans/sprint-roadmap.md` 의 "renamed in v1.4.0" annotation (Orchestrator 가 sprint-complete 후 별도 추가).
- `.vibe/agent/handoff.md` 갱신 (Orchestrator 책임).
- planner.md 본문의 대규모 리라이트 (frontmatter + 1문단 제거 + 책임 목록 재작성만. 전체 리라이트 금지).
- 다른 skill 파일 (`.claude/skills/*/SKILL.md`) 내용 변경 — **단, `"planner"` 문자열 grep 결과가 잘못된 참조를 가리키면 해당 라인만 수정**. 무관한 내용 리팩터 금지.
- Evaluator agent file (`.claude/agents/evaluator.md`) touch — 본 Sprint 범위 밖.
- harnessVersion bump — 이미 1.4.0 이므로 그대로 유지.
- 새 `npm run vibe:*` entry 추가.
- `.github/workflows/*.yml` CI 수정.
- 브라우저 smoke / Playwright / E2E 관련 수정.

---

## Estimated LOC

**~400 LOC total** (production ~250 + tests ~150).

Breakdown:

| Area | LOC (approx) |
|---|---|
| `.claude/agents/sprint-planner.md` (new, content migrated) | ~35 |
| `.claude/agents/planner.md` (deleted) | -30 (net removal) |
| `migrations/1.4.0.mjs` (append `migrateAgentFiles`) | +45 |
| `scripts/vibe-preflight.mjs` (planner.presence check) | +80 |
| `scripts/vibe-planner-skip-log.mjs` (new CLI) | +90 |
| `CLAUDE.md` (3 edits: hook row, Planner invocation block, trivial rule) | +30 |
| `.vibe/agent/_common-rules.md` (§10 single bullet rewrite) | +5 |
| `.vibe/sync-manifest.json` (4 lines touched) | +3 |
| `docs/release/v1.4.0.md` (append M-process-discipline section) | +10 |
| `test/preflight-planner-presence.test.ts` (new, 5 cases) | +85 |
| `test/vibe-planner-skip-log.test.ts` (new, 6 cases) | +65 |
| **Total** | **~418 net added, ~30 deleted** |

---

## Final report contract

Codex 는 Final report 를 `.vibe/agent/_common-rules.md §9` 형식으로 작성. 추가로 본 Sprint 는 아래 섹션을 **전부** 포함해야 한다 — 하나라도 누락 시 Sprint incomplete.

### 필수 섹션

1. **`## Files added`** — 각 새 파일 한 줄 설명 (최소: sprint-planner.md, vibe-planner-skip-log.mjs, 2 test files).
2. **`## Files modified`** — 각 수정 파일 한 줄 설명 (migration, preflight, CLAUDE.md, _common-rules.md, sync-manifest.json, release notes).
3. **`## Files deleted`** — `.claude/agents/planner.md` (단 1건).
4. **`## Verification`** — 위 Acceptance 표의 A1~A12 exit code 기록. 각 행은 실제 실행한 명령 + 실제 exit code.
5. **`## Sandbox-only failures`** — 있으면 나열, 없으면 `none`.
6. **`## D1 grep counts`** (신규 필수 섹션):
   ```md
   ## D1 grep counts

   Before Sprint (at kickoff):
   - `rg "planner\.md"` full workspace: N hits
   - `rg "planner\.md"` live only (allowlist applied): M hits
   - `rg "subagent_type.*['\"]planner['\"]"` full workspace: K hits

   After Sprint (at completion):
   - `rg "planner\.md"` full workspace: N' hits (archive + history entries only)
   - `rg "planner\.md"` live only (allowlist applied): **0 hits** ← must be zero
   - `rg "subagent_type.*['\"]planner['\"]"` full workspace: **0 hits** ← must be zero
   ```
7. **`## Wiring Integration`** — 위 §Wiring Integration Checklist 표 + verified-callers 블록.
8. **`## Deviations`** — 없으면 `none`.

### 요약 예시 (Codex 가 참고용)

```md
## Summary

Sprint M-process-discipline delivers 6 items: (1) .claude/agents/planner.md renamed to
sprint-planner.md with explicit tools frontmatter resolving the read-only Plan agent
trap; (2) all live references updated (sync-manifest + CLAUDE.md + _common-rules.md);
(3) migrations/1.4.0.mjs extended with migrateAgentFiles for safe downstream orphan
cleanup; (4) CLAUDE.md trivial exception rewritten as semantic three-condition test;
(5) preflight planner.presence non-blocking WARN check; (6) vibe-planner-skip-log.mjs
CLI enforces [decision][planner-skip] session-log entries.

Net LOC: +418 / -30. Tests: +11 cases (181 total pass).
D1 grep: planner.md live hits 8→0, subagent_type 'planner' hits 0→0.
```

---

## Reminders (Codex 실행 전 마지막 체크)

- **§1 샌드박스 우회 금지**: next.config / tsconfig / package.json build scripts 우회 금지.
- **§2 의존성 설치 금지**: `npm install` 실행 금지. 모든 필요 deps 는 이미 설치됨 (Zod 포함).
- **§13 Generator MUST NOT**: `npm run build`, `playwright test`, `next build`, production build, watch 모드 등 절대 금지. `tsc --noEmit` + `npm test` (단위 스모크 범위) 만 허용.
- **§14 Wiring**: Final report 에 `## Wiring Integration` 없으면 incomplete.
- **Archive 절대 touch 금지**: `.vibe/archive/**`, `docs/reports/**` — 역사적 기록.
- **role-slot vs agent-file 구별**: `sprintRoles.planner` 는 **건드리지 않는다**. 본 Sprint 는 agent 파일 rename 만.
- **Edit 도구 사용 전 반드시 Read** — 편집 무결성 원칙 (CLAUDE.md mechanical-overrides §9).
- **단일 커밋 원칙** (`_common-rules.md §12`): Codex 는 커밋하지 않는다 — Orchestrator 가 `vibe-sprint-commit.mjs` 로 Generator 산출물 + state 3종을 단일 커밋으로 묶는다.
