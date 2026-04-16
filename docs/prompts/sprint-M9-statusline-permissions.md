# Sprint M9 -- Statusline + Permission Presets

> Sprint id: `sprint-M9-statusline-permissions`
> Depends on: M1 (sprint-status schema/types)
> Prior: M1-M8 passed (116 tests + 1 skip). All scripts use Node 24, ESM, `node:test`.
> Target LOC: ~400

---

## 1. Token/time tracker -- `scripts/vibe-status-tick.mjs`

New ESM script. Maintains `.vibe/agent/tokens.json` as a running accumulator.

### Schema (`tokens.json`)

```jsonc
{
  "updatedAt": "ISO-8601",
  "cumulativeTokens": 0,
  "elapsedSeconds": 0,
  "sprintTokens": {
    "sprint-M9-statusline-permissions": 12345
  }
}
```

### CLI

```
node scripts/vibe-status-tick.mjs --add-tokens <N> --sprint <id>
node scripts/vibe-status-tick.mjs --elapsed-start <ISO>
node scripts/vibe-status-tick.mjs --add-tokens <N> --sprint <id> --elapsed-start <ISO>
```

### Behavior

- If `tokens.json` does not exist, create it with zero values.
- `--add-tokens N --sprint ID`: increment `cumulativeTokens` by N, increment `sprintTokens[ID]` by N.
- `--elapsed-start ISO`: compute `Math.round((Date.now() - Date.parse(ISO)) / 1000)` and write to `elapsedSeconds`.
- Always set `updatedAt` to `new Date().toISOString()`.
- Atomic: read-modify-write with `writeFileSync`. No locking needed (single-caller model).
- Exit 0 on success, exit 1 with stderr message on bad args.

### Conventions

- Use `node:fs` (readFileSync/writeFileSync), `node:path`, same pattern as `vibe-sprint-complete.mjs`.
- File location: `.vibe/agent/tokens.json` relative to `process.cwd()`.

---

## 2. Statusline scripts

Two scripts that Claude Code's statusline hook calls. Each reads state files and prints a single line to stdout.

### 2a. `.claude/statusline.sh` (bash)

```bash
#!/usr/bin/env bash
# Reads sprint-status.json + tokens.json, prints one-line status.
```

- Parse `.vibe/agent/sprint-status.json` with lightweight approach:
  - `currentSprintId` from `handoff.currentSprintId` -- use `node -e` one-liner or `grep`/`sed` (prefer `node -e` for JSON safety).
  - `sprintsSinceLastAudit` from root field.
  - `pendingRisks` count: count entries where `"status":"open"`.
  - Total sprint count: count entries in `sprints` array.
- Parse `.vibe/agent/tokens.json`:
  - `cumulativeTokens` and `elapsedSeconds`.
- Format: one character per field for density.
  - If tokens.json missing, omit token/time fields.
  - If sprint-status.json missing, print nothing (exit 0 silently).

Output template (no trailing newline):
```
S {currentSprintId} ({passedCount}/{totalCount}) | {elapsed}m | {tokens/1000}K tok | {openRisks} risks
```

- Use `node -e` for JSON parsing (keeps it cross-platform on Git Bash). The entire script can be a thin wrapper around a `node -e '...'` call.
- Must exit 0 even on errors (statusline must never block).

### 2b. `.claude/statusline.ps1` (PowerShell)

Same output contract. Use `ConvertFrom-Json` for parsing. Same resilience: exit 0 on any error. Wrap in `try/catch` at top level.

---

## 3. Permission preset -- `.vibe/settings-presets/agent-delegation.json`

A standalone JSON file containing permission rules for agent-delegated Sprint execution. Structure:

```json
{
  "presetName": "agent-delegation",
  "presetVersion": "1.0.0",
  "description": "Scope-bound permissions for autonomous Sprint execution. Opt-in only.",
  "rules": [
    "Bash(npm install:*)",
    "Bash(npm ci:*)",
    "Bash(npm run build:*)",
    "Bash(npm run dev:*)",
    "Bash(npm run test:*)",
    "Bash(npm run lint:*)",
    "Bash(npm run vibe:*)",
    "Bash(npx tsc:*)",
    "Bash(npx vitest:*)",
    "Bash(npx eslint:*)",
    "Bash(npx playwright:*)",
    "Bash(node --import tsx:*)",
    "Bash(node --check:*)",
    "Bash(node scripts/:*)",
    "Bash(cat * | ./scripts/run-codex.sh:*)",
    "Bash(git add:*)",
    "Bash(git commit:*)",
    "Bash(git status:*)",
    "Bash(git diff:*)",
    "Bash(git log:*)",
    "Bash(git show:*)",
    "Bash(git ls-files:*)",
    "Bash(git push:*)"
  ]
}
```

This is a static data file. Not auto-applied. Users opt in via sprint-mode toggle.

---

## 4. Sprint-mode toggle -- `scripts/vibe-sprint-mode.mjs`

### CLI

```
node scripts/vibe-sprint-mode.mjs on
node scripts/vibe-sprint-mode.mjs off
node scripts/vibe-sprint-mode.mjs status
```

### Behavior

**`on`**:
1. Read `.vibe/settings-presets/agent-delegation.json` -> extract `rules` array.
2. Read `.claude/settings.local.json`. If missing, create `{"permissions":{"allow":[]}}`.
3. Get current `permissions.allow` array (default `[]`).
4. Merge: `[...new Set([...existing, ...presetRules])]` -- deduplicate.
5. Write back `.claude/settings.local.json`.
6. Print to stdout: `[vibe-sprint-mode] ON -- {N} preset rules merged ({M} new). Total allow rules: {T}`.

**`off`**:
1. Read `.vibe/settings-presets/agent-delegation.json` -> extract `rules` array as a Set.
2. Read `.claude/settings.local.json`. If missing, exit 0 with "nothing to remove".
3. Filter: keep only entries NOT in the preset Set.
4. Write back.
5. Print: `[vibe-sprint-mode] OFF -- {N} preset rules removed. Remaining allow rules: {R}`.

**`status`**:
1. Read both files.
2. Count how many preset rules are currently in settings.local.json.
3. Print: `[vibe-sprint-mode] {ON|OFF} -- {N}/{total} preset rules active`.

### Safety invariants

- NEVER modify `.claude/settings.json` (project-level). Only `.claude/settings.local.json`.
- NEVER remove rules that are not in the preset. User's custom rules are preserved exactly.
- Preserve all other keys in settings.local.json (hooks, deny, etc.) -- only touch `permissions.allow`.
- If `permissions` or `allow` key doesn't exist, create it.

---

## 5. Skill doc -- `.claude/skills/vibe-sprint-mode/SKILL.md`

Minimal skill file for `/vibe-sprint-mode` slash command:

```markdown
---
name: vibe-sprint-mode
description: Toggle agent-delegation permission presets for autonomous Sprint execution.
---

# /vibe-sprint-mode

Usage: `/vibe-sprint-mode on|off|status`

## What it does

- **on**: Merges scope-bound permission rules from `.vibe/settings-presets/agent-delegation.json` into `.claude/settings.local.json`. Reduces permission prompts during autonomous Sprint execution.
- **off**: Removes only the preset rules. Your custom permission entries are untouched.
- **status**: Shows how many preset rules are currently active.

## Underlying command

```
node scripts/vibe-sprint-mode.mjs <on|off|status>
```

## Security

- Rules are scope-bound (npm/npx/node/git commands within project).
- `npm install` is included -- be aware of malicious postinstall scripts in untrusted deps. Use `--ignore-scripts` for unknown packages.
- The preset never grants shell access beyond the listed patterns.
- Only `.claude/settings.local.json` is modified. Project settings (`.claude/settings.json`) are never touched.
```

---

## 6. vibe-init Phase 4 opt-in

Append to `.claude/skills/vibe-init/SKILL.md` Phase 4 section, after Step 4-0 (phase0-seal) and before Step 4-1 (summary):

Add a new **Step 4-0b: Agent delegation permission preset**:

```markdown
### Step 4-0b: Agent delegation 권한 프리셋 (opt-in)

Orchestrator asks:

> Sprint 자율 실행 시 권한 프롬프트를 줄이는 agent-delegation 프리셋을 적용하시겠습니까?
> (npm install/build/test/git 등 scope 제한된 명령만 자동 허용)
> [Y/n]

- User answers Y (or PO-proxy auto-yes): run `node scripts/vibe-sprint-mode.mjs on`.
- User answers N: skip. Print "프리셋 미적용. 나중에 `/vibe-sprint-mode on`으로 활성화할 수 있습니다."
- If the script exits non-zero, print warning and continue.
```

---

## 7. Security doc update -- `docs/context/secrets.md`

Append a new section:

```markdown
## Sprint-mode 보안 가이드

`/vibe-sprint-mode on`은 `.claude/settings.local.json`에 scope 기반 permission 규칙을 추가한다.

### 범위 제한
- 허용 대상: `npm install/ci/run`, `npx tsc/vitest/eslint/playwright`, `node scripts/`, `git` 기본 명령.
- 허용되지 않는 것: 임의 shell 명령, `rm`, `curl`, 파일 시스템 직접 조작, 네트워크 요청 도구.

### 주의 사항
- **npm postinstall 공격**: `npm install`이 허용되므로 악성 패키지의 postinstall 스크립트가 실행될 수 있다. 신뢰하지 않는 의존성 추가 시 `--ignore-scripts` 사용.
- **git push**: preset에 `git push`가 포함됨. 자동 push를 원하지 않으면 해당 규칙만 수동 제거.
- **해제**: `/vibe-sprint-mode off`로 preset 규칙만 정확히 제거. 사용자 커스텀 규칙은 보존.
```

---

## 8. Manifest registration

Add to `sync-manifest.json` `files.harness` array:

```
"scripts/vibe-status-tick.mjs",
".claude/statusline.sh",
".claude/statusline.ps1",
".vibe/settings-presets/agent-delegation.json",
"scripts/vibe-sprint-mode.mjs",
".claude/skills/vibe-sprint-mode/SKILL.md",
"test/statusline.test.ts",
"test/sprint-mode.test.ts"
```

Add to `sync-manifest.json` `files.project` array:

```
".vibe/agent/tokens.json"
```

---

## 9. Tests

### 9a. `test/statusline.test.ts`

Use `node:test` + `node:assert/strict`. Pattern: create temp dir, write mock `sprint-status.json` and `tokens.json`, run `bash .claude/statusline.sh` via `execFile`, parse stdout.

Test cases:
1. **Normal output**: both files present -> output matches pattern `/S .+ \(\d+\/\d+\) \|.+m \|.+K tok \|.+risks/`.
2. **Missing tokens.json**: statusline still renders sprint info, omits token/time fields.
3. **Missing sprint-status.json**: outputs empty string, exit 0.
4. **Zero tokens**: renders `0K tok`.

For `statusline.ps1`, add one test that runs via `powershell -File .claude/statusline.ps1` if on Windows (skip on non-Windows via `process.platform !== 'win32'`).

### 9b. `test/sprint-mode.test.ts`

Pattern: temp dir, scaffold `.vibe/settings-presets/agent-delegation.json` + `.claude/settings.local.json`, run `node scripts/vibe-sprint-mode.mjs on|off|status`.

Test cases:
1. **on -- fresh**: no settings.local.json -> creates it with preset rules.
2. **on -- existing custom rules**: settings.local.json has `["Bash(custom:*)"]` -> after on, contains both custom + preset. Custom is preserved.
3. **on -- idempotent**: running on twice produces same result (no duplicates).
4. **off -- removes only preset**: after on+off, only custom rules remain.
5. **off -- no settings file**: exits 0 gracefully.
6. **status -- reports count**: after on, reports N/N active.

### 9c. `test/status-tick.test.ts`

1. **Creates tokens.json from scratch**: `--add-tokens 500 --sprint M9` -> file exists, cumulativeTokens=500, sprintTokens.M9=500.
2. **Increments existing**: run twice with 500 each -> cumulative=1000, sprint=1000.
3. **Elapsed computation**: `--elapsed-start <30 seconds ago>` -> elapsedSeconds roughly 30 (tolerance +/-5).
4. **Bad args**: no flags -> exit 1.

---

## 10. package.json

No new `scripts` entries needed (statusline is invoked by Claude Code hook, not npm; sprint-mode and status-tick are direct `node` calls).

---

## File manifest with estimated lines

| File | Est. lines | Type |
|------|-----------|------|
| `scripts/vibe-status-tick.mjs` | ~60 | new |
| `.claude/statusline.sh` | ~30 | new |
| `.claude/statusline.ps1` | ~30 | new |
| `.vibe/settings-presets/agent-delegation.json` | ~30 | new |
| `scripts/vibe-sprint-mode.mjs` | ~90 | new |
| `.claude/skills/vibe-sprint-mode/SKILL.md` | ~35 | new |
| `.claude/skills/vibe-init/SKILL.md` | ~15 | edit (append Step 4-0b) |
| `docs/context/secrets.md` | ~15 | edit (append section) |
| `.vibe/sync-manifest.json` | ~10 | edit (add entries) |
| `test/statusline.test.ts` | ~80 | new |
| `test/sprint-mode.test.ts` | ~110 | new |
| `test/status-tick.test.ts` | ~70 | new |
| **Total** | **~575** | |

---

## Completion checklist

- [ ] `npx tsc --noEmit` -- 0 errors
- [ ] `npm test` -- all existing 116+1 tests still pass, plus new tests pass
- [ ] `node scripts/vibe-status-tick.mjs --add-tokens 100 --sprint test` -- creates/updates tokens.json, exit 0
- [ ] `bash .claude/statusline.sh` in project root -- prints one-line or empty, exit 0
- [ ] `node scripts/vibe-sprint-mode.mjs on` -- merges rules into settings.local.json
- [ ] `node scripts/vibe-sprint-mode.mjs off` -- removes only preset rules
- [ ] `node scripts/vibe-sprint-mode.mjs status` -- reports active count
- [ ] `.vibe/sync-manifest.json` includes all new files
- [ ] `docs/context/secrets.md` has sprint-mode security section
- [ ] `.claude/skills/vibe-init/SKILL.md` has Step 4-0b

---

## Data flow summary

Statusline reads two JSON files: `sprint-status.json` (sprint progress, audit counter, open risks) and `tokens.json` (cumulative tokens, elapsed time). The `vibe-status-tick.mjs` script is called by the Orchestrator after each Agent/Generator call to increment the token counter -- it is a simple read-modify-write accumulator with no locking (single-writer guarantee from the Orchestrator's sequential execution model).

## Preset merge/remove safety

Sprint-mode toggle only touches `permissions.allow` in `settings.local.json` (never `settings.json`). The `on` operation is a set-union; the `off` operation is a set-difference using the preset as the subtrahend. Both operations treat the preset rules list as an exact-match identity -- a custom rule like `Bash(npm run build:*)` is the same string as the preset entry, so it will be removed by `off`. This is by design: if a user wants to keep a rule after sprint-mode off, they should add it to `settings.json` (project-level). This is documented in the SKILL.md.

## M10 risks

The main M10 risk is integration smoke testing the statusline in a real Claude Code session -- the statusline hook contract is shell-script-based and cannot be fully verified by unit tests alone. M10 should include a manual checklist item: "verify statusline renders in Claude Code UI during a real Sprint cycle." Token tracking accuracy depends on the Orchestrator remembering to call `vibe-status-tick.mjs` -- M10 should verify this is documented in the Sprint flow section of CLAUDE.md.
