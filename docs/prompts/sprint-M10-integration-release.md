# Sprint M10 — Integration + self-sync smoke + v1.2.0 release

## Context

vibe-doctor is a Claude Code vibe-coding template (TypeScript ESM, Node 24+).
Sprints M1-M9 are complete (131 pass, 1 skip). This final Sprint integrates
everything, updates public-facing docs, finalizes the migration, and adds an
integration smoke test. No new features — documentation, version bump, and
release validation only.

Current state:
- `harnessVersion` in `.vibe/config.json` is `"1.1.1"` — must become `"1.2.0"`.
- `package.json` has no `harnessVersion` field — version lives in `.vibe/config.json`.
- `migrations/1.2.0.mjs` exists and is functional (seeds model-registry, bumps harnessVersionInstalled).
- `sync-manifest.json` already has the `"1.2.0"` migration entry.
- `docs/release/` directory does not exist yet.
- `test/integration/` directory does not exist yet.
- 131 tests pass, 1 skipped (cmd wrapper health on non-Windows).

---

## Task 1 — CLAUDE.md update

File: `CLAUDE.md`

### 1a. Hook enforcement table (inside `<!-- BEGIN:HARNESS:hook-enforcement -->`)

Add rows for the v1.2.0 scripts that are not yet listed in the hook table.
Current table has 6 rows. Add these after the existing rows, before the
`**원칙**` paragraph:

| 시점 | 스크립트 | 역할 |
|------|---------|------|
| Sprint 커밋 시 | `node scripts/vibe-sprint-commit.mjs` | state 갱신 + auto-stage + 템플릿 커밋 메시지 |
| session-log 정리 | `node scripts/vibe-session-log-sync.mjs` | 타임스탬프 정규화 + 중복 제거 + 정렬 |
| 모델 해석 시 | `node scripts/vibe-resolve-model.mjs` | config + registry 결합 → 현재 SOTA 모델 ID |
| 세션 시작 시 | `node scripts/vibe-model-registry-check.mjs` | upstream registry 비교 + 변경 감지 (24h 캐시) |
| Phase 3 인터뷰 | `node scripts/vibe-interview.mjs` | 네이티브 소크라테스식 인터뷰 (Ouroboros fallback) |
| Phase 0 커밋 | `node scripts/vibe-phase0-seal.mjs` | Phase 0 산출물 자동 stage + commit |
| 브라우저 smoke | `node scripts/vibe-browser-smoke.mjs` | Playwright headless DOM/console 계약 검증 (opt-in) |
| audit 카운터 리셋 | `node scripts/vibe-audit-clear.mjs` | sprintsSinceLastAudit 리셋 + pendingRisks 정리 |
| 토큰/시간 기록 | `node scripts/vibe-status-tick.mjs` | Agent 호출 전후 tokens.json 갱신 |
| Sprint 모드 토글 | `node scripts/vibe-sprint-mode.mjs` | permission preset 병합/해제 (agent-delegation) |

### 1b. Sprint flow — 매 Sprint 반복 (inside `<!-- BEGIN:HARNESS:sprint-flow -->`)

In step 3 (Generator 위임) and step 4, add a note:

After step 3 (Generator 위임 line), append:
```
   3-1. `node scripts/vibe-status-tick.mjs` — Generator 호출 전후 토큰/시간 기록
```

### 1c. 관련 스킬 list

Current: `/vibe-init`, `/goal-to-plan`, `/self-qa`, `/write-report`, `/maintain-context`, `/vibe-sync`.

Replace with:
`/vibe-init`, `/vibe-interview`, `/vibe-sync`, `/vibe-sprint-mode`, `/vibe-review`, `/goal-to-plan`, `/self-qa`, `/write-report`, `/maintain-context`.

### 1d. Evaluator audit trigger reference

In the trigger-matrix section, after the Evaluator 소환 bullets, add (if not present):

> **정기 감사**: `sprintsSinceLastAudit >= audit.everyN` (기본 5) 도달 시 `pendingRisks`에 `audit-required` 자동 주입 → Evaluator Must 트리거 발동. `scripts/vibe-audit-clear.mjs`로 리셋.

### 1e. harness-gaps 참조

In "필요할 때만 읽을 문서" list, add:
```
- 하네스 사각지대: `docs/context/harness-gaps.md`
```

---

## Task 2 — README.md update

File: `README.md`

### 2a. v1.2.0 feature summary

After the first blockquote (the template warning), add a section:

```markdown
## v1.2.0 highlights

- **Native socratic interview** — Ouroboros MCP 의존 제거. LLM 기반 도메인 전문가 수준 probing 질문 자동 생성 (`/vibe-interview`)
- **Stack/framework pattern shards** — 테스트·린트 패턴을 stack별 shard로 분리 (TypeScript, Python, Rust, Go)
- **Model tier abstraction** — 중앙 registry (`.vibe/model-registry.json`) 로 SOTA 모델 자동 추종
- **Statusline** — Sprint 진행·토큰·시간을 Claude Code 상태바에 표시
- **Permission presets** — agent-delegation 모드로 권한 프롬프트 감소 (`/vibe-sprint-mode`)
- **Bundle-size gate** — gzip 기반 번들 크기 제한 (opt-in, web/frontend 전용)
- **Browser smoke** — Playwright headless DOM/console 계약 검증 (opt-in)
- **Sprint flow automation** — 단일 커밋, session-log 정리, Phase 0 seal 자동화
- **Periodic audit** — 5 Sprint 마다 Evaluator 감사 자동 트리거
```

### 2b. npm scripts — add missing v1.2.0 entries

In the npm 스크립트 section, add entries that exist in package.json but are
not yet documented in README:

```bash
npm run vibe:interview                # 네이티브 소크라테스식 인터뷰 실행
npm run vibe:bundle-size              # 번들 크기 검사 (opt-in)
npm run vibe:browser-smoke            # 브라우저 smoke 테스트 (opt-in, Playwright 필요)
```

### 2c. Requirements section update

The current README lists `Python 3.12+` and `ouroboros-ai` as requirements.
Since M5 made ouroboros optional (native interview is primary), update:
- Move `ouroboros-ai` from required to optional.
- Add note: "Native interview (`scripts/vibe-interview.mjs`) is the default.
  Ouroboros is an optional enhancement for advanced mode."

### 2d. Skills list update

In the Claude Code 슬래시 커맨드 section, add:
```text
/vibe-interview    # 네이티브 소크라테스식 인터뷰 (도메인 전문가 수준 probing)
/vibe-sprint-mode  # Sprint agent-delegation 권한 프리셋 토글
/vibe-review       # 프로세스 건강성 리뷰 (4-tier rubric)
```

---

## Task 3 — `.vibe/config.json` version bump

File: `.vibe/config.json`

Change `"harnessVersion": "1.1.1"` to `"harnessVersion": "1.2.0"`.

Keep all other fields unchanged.

---

## Task 4 — `migrations/1.2.0.mjs` finalization

File: `migrations/1.2.0.mjs`

The migration already handles:
- model-registry.json seeding (idempotent)
- harnessVersionInstalled bump

Verify and add if missing:
1. **sprintRoles tier format migration**: If `config.sprintRoles.planner` is a
   plain string like `"claude-opus"`, keep it as-is (backward compat). Only
   log an info message suggesting the new tier format. Do NOT force-convert.
2. **Ensure exit message includes all actions taken** for debuggability.
3. The migration must remain fully idempotent (re-run produces same result).

If the migration already satisfies these, leave it as-is and note in the
release doc that it was verified.

---

## Task 5 — `docs/context/harness-gaps.md` gap resolution

File: `docs/context/harness-gaps.md`

Update the following entries' status:

| id | new status | reason |
|----|-----------|--------|
| gap-review-reproducibility | covered | `/vibe-review` SKILL.md + `test/vibe-review-inputs.test.ts` exist |
| gap-opt-in-visibility | covered | `/vibe-review` detectOptInGaps + test coverage (M8) |
| gap-rule-only-in-md | partial | CLAUDE.md hook table expanded (M10), but not all rules are script-gated yet |
| gap-statusline-visibility | covered | `.claude/statusline.{sh,ps1}` + `vibe-status-tick.mjs` + tests (M9) |
| gap-permission-noise | covered | `vibe-sprint-mode.mjs` + settings-presets + tests (M9) |
| gap-integration-smoke | covered | `test/integration/meta-smoke.test.ts` (M10, this Sprint) |

---

## Task 6 — `docs/release/v1.2.0.md` (NEW file)

Create directory `docs/release/` and file `v1.2.0.md`:

```markdown
# vibe-doctor v1.2.0 Release Notes

Released: 2026-04-16

## Summary

10-Sprint meta-project (M1-M10) delivering 23 harness improvements identified
during dogfood6 실사용 review. All changes are backward-compatible.

## Sprint deliverables

| Sprint | Name | Key deliverable |
|--------|------|----------------|
| M1 | Schema foundation | sprint-status.json schema v2, project-map, sprint-api-contracts |
| M2 | Platform wrappers | run-codex.cmd, wrapper --health/--version, sandbox exclusions |
| M3 | Sprint flow automation | vibe-sprint-commit, session-log-sync, prompts archive, decisions ledger |
| M4 | Model tier | model-registry.json, vibe-resolve-model, tier-based sprintRoles |
| M5 | Native interview | vibe-interview.mjs (Ouroboros MCP dependency removed) |
| M6 | Pattern shards | test-patterns + lint-patterns shard directories, sync glob support |
| M7 | Phase0 seal + utilities | vibe-phase0-seal, README skeleton, bundle-size, browser-smoke |
| M8 | Audit + review | Periodic Evaluator audit, /vibe-review skill, harness-gaps ledger |
| M9 | Statusline + permissions | statusline.sh/ps1, vibe-status-tick, vibe-sprint-mode, permission presets |
| M10 | Integration + release | Integration smoke test, docs update, v1.2.0 release |

## Breaking changes

None.

## Upgrade path

```bash
# From an existing downstream project:
cd my-project
npm run vibe:sync -- --from /path/to/vibe-doctor

# Or dry-run first:
npm run vibe:sync -- --from /path/to/vibe-doctor --dry-run
```

Migrations 1.1.0 and 1.2.0 run automatically during sync.

## Known issues

- `run-codex.cmd --health` test is skipped on non-Windows platforms (1 test skip).
- `/vibe-review` reproducibility is improved but still depends on LLM judgment
  for non-mechanical rubric items (gap-review-reproducibility → covered but inherently subjective).

## Test results

132+ tests, 131 pass, 0 fail, 1 skip.
```

---

## Task 7 — Integration test (`test/integration/meta-smoke.test.ts`)

Create directory `test/integration/` and file `meta-smoke.test.ts`.

This is a Node.js test (not a full clone). Use `node:test` + `node:assert/strict`.
Follow the existing test patterns (see `test/sprint-status.test.ts` for tmpdir pattern).

### Test cases:

```typescript
// 1. "migration chain runs sequentially and is idempotent"
//    - Create tmp dir with minimal .vibe/config.json (harnessVersion: "1.0.0")
//    - Create minimal .vibe/agent/sprint-status.json (old schema — no pendingRisks field)
//    - Run migrations/1.1.0.mjs via execFileSync('node', [migrationPath, tmpDir])
//    - Run migrations/1.2.0.mjs via execFileSync('node', [migrationPath, tmpDir])
//    - Assert: sprint-status.json now has pendingRisks array (from 1.1.0)
//    - Assert: .vibe/model-registry.json exists (from 1.2.0)
//    - Assert: config.json harnessVersionInstalled === "1.2.0"
//    - Re-run both migrations → same result (idempotent)

// 2. "sync-manifest covers all M1-M9 deliverables"
//    - Read .vibe/sync-manifest.json
//    - Assert: manifest.migrations has keys "1.0.0", "1.1.0", "1.2.0"
//    - Assert: harness array includes key files from each Sprint:
//      - M1: "src/lib/sprint-status.ts", "migrations/1.1.0.mjs"
//      - M2: "scripts/run-codex.cmd"
//      - M3: "scripts/vibe-sprint-commit.mjs", "scripts/vibe-session-log-sync.mjs"
//      - M4: ".vibe/model-registry.json", "scripts/vibe-resolve-model.mjs"
//      - M5: "scripts/vibe-interview.mjs", ".claude/skills/vibe-interview/SKILL.md"
//      - M6: ".claude/skills/test-patterns/**", ".claude/skills/lint-patterns/**"
//      - M7: "scripts/vibe-phase0-seal.mjs", "scripts/vibe-browser-smoke.mjs"
//      - M8: ".claude/skills/vibe-review/SKILL.md", "docs/context/harness-gaps.md"
//      - M9: ".claude/statusline.sh", "scripts/vibe-status-tick.mjs", "scripts/vibe-sprint-mode.mjs"
//    - Assert: harness array length >= 100 (sanity — we have ~130 entries)

// 3. "preflight --bootstrap passes in clean tree"
//    - Create tmp dir with minimal required files:
//      - package.json (name + scripts.test)
//      - .vibe/config.json (harnessVersion, sprintRoles, providers)
//      - docs/context/product.md (non-empty)
//      - .vibe/agent/sprint-status.json (valid)
//      - .vibe/agent/handoff.md (non-empty)
//      - .vibe/agent/session-log.md (non-empty)
//    - git init + git add + git commit in tmpDir
//    - Run: node scripts/vibe-preflight.mjs --bootstrap (cwd: tmpDir)
//    - Assert: exit code 0
//    NOTE: This test requires git to be available. If running in CI without git,
//    skip with `{ skip: !hasGit }`.

// 4. "harness-gaps ledger has no 'open' entries after M10"
//    - Read docs/context/harness-gaps.md
//    - Parse the table rows
//    - Assert: no row has status === "open"
//    - Assert: at most 1 row has status === "partial" (gap-rule-only-in-md is acceptable)
```

### Implementation notes:
- Use `execFileSync('node', [scriptPath, ...args], { cwd })` for migration runs.
- For preflight test, mock the provider health check by creating a minimal
  `.vibe/config.json` with `providers.codex.command` pointing to `echo` or `true`.
- Clean up tmp dirs in afterEach.
- Import only from `node:*` builtins — no project src imports needed.
- If a test needs to read/parse the harness-gaps.md table, use simple string
  split on `|` — no markdown parser needed.

---

## Task 8 — `sync-manifest.json` final verification

File: `.vibe/sync-manifest.json`

Verify that these M10 additions are registered:

1. In `harness` array: `"docs/context/harness-gaps.md"` — already present.
2. In `harness` array: `"test/integration/meta-smoke.test.ts"` — ADD if missing.
3. In `harness` array: `"docs/release/v1.2.0.md"` — ADD if missing.
4. Migrations map: `"1.2.0": "migrations/1.2.0.mjs"` — already present.

No other manifest changes needed.

---

## Verification checklist

After all changes:

1. `npx tsc --noEmit` — 0 errors
2. `node --import tsx --test test/*.test.ts test/integration/*.test.ts` — all pass
3. `.vibe/config.json` shows `harnessVersion: "1.2.0"`
4. `docs/context/harness-gaps.md` has zero `open` entries
5. `docs/release/v1.2.0.md` exists and lists all 10 Sprints
6. `CLAUDE.md` hook table has 16 rows (6 original + 10 new)
7. `README.md` mentions v1.2.0 features
8. `migrations/1.2.0.mjs` runs idempotently (verified by integration test)

---

## Files to create or modify

| File | Action |
|------|--------|
| `CLAUDE.md` | Modify (hook table, skills list, audit trigger, docs list) |
| `README.md` | Modify (v1.2.0 features, npm scripts, requirements, skills) |
| `.vibe/config.json` | Modify (harnessVersion bump) |
| `migrations/1.2.0.mjs` | Verify / minor tweak if needed |
| `docs/context/harness-gaps.md` | Modify (gap statuses) |
| `docs/release/v1.2.0.md` | Create |
| `test/integration/meta-smoke.test.ts` | Create |
| `.vibe/sync-manifest.json` | Modify (add integration test + release doc) |

Target: ~400 LOC (docs ~200, test ~150, config/manifest ~50).
