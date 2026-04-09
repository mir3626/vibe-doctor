#  Worktree layer purge — Sprints E1 + E2

**Date**: 2026-04-09
**Scope**: Remove the `.worktrees/*` layer that was documented as a
design principle but never actually wired up.
**Outcome**: 2 commits on `main`, CI green, grep confirms zero residue.

## Why

While filling `docs/context/product.md` and `architecture.md` after the
A→D purification sweep, a cross-reference grep surfaced a contradiction:

- `docs/orchestration/providers.md` documented "병렬 실행은 별도 git
  worktree에서 격리된다" as a **design principle**.
- `README.md` listed "병렬 실행 | 각 프롬프트를 별도 git worktree에서
  격리 실행" as a **core feature**.
- `src/commands/run-parallel.ts` — the command those docs point at —
  **did not exist** and never had.
- The only actual caller of `createWorktree` was
  `src/commands/escalate-on-test-failure.ts`, which still used
  pre-Sprint-model terminology (`challenger` / `reviewer`) and
  contradicted the canonical Sprint escalation flow in
  `docs/orchestration/escalation.md` (Evaluator 2회 불합격 → Planner
  재생성, no worktree).

In short: the worktree layer was **aspirational** — 10+ doc references,
one legacy caller, zero implementation. Classic dead scaffolding that
misleads new users ("which command do I run to get parallel
execution?") and contradicts the actually-canonical escalation path.

## What shipped

| Sprint | Commit | Focus | Files |
|---|---|---|---|
| E1 | `9df20f1` | Code layer purge | 5 |
| E2 | `86d85a2` | Doc layer purge | 6 |

### Sprint E1 — Code (9df20f1)
- **DEL** `src/commands/escalate-on-test-failure.ts` — only
  `createWorktree` caller; used legacy `challenger`/`reviewer`
  terminology that contradicted `docs/orchestration/escalation.md`.
- **DEL** `src/lib/worktree.ts` — no other callers after the above
  deletion (grep confirmed).
- `src/lib/paths.ts` — removed `worktreesDir` entry.
- `src/commands/init.ts` — removed `.worktrees/*` and "실패 시
  worktree 기반 분기" from the generated `architecture.md` template so
  downstream `/vibe-init` projects don't inherit the dead layer.
- `package.json` — removed `vibe:escalate` script.

Diff: −90 / +2.

### Sprint E2 — Docs (86d85a2)
- `.gitignore` — removed `.worktrees/`.
- `README.md` — removed the "병렬 실행" row from the 핵심 설계 table
  (the feature it advertised never existed).
- `docs/context/architecture.md` — removed `.worktrees/*` from the
  evidence layer bullet.
- `docs/orchestration/providers.md` — deleted the entire "병렬 실행
  (run-parallel)" section, including the fake `run-parallel.ts` code
  snippet.
- `.claude/skills/vibe-init/SKILL.md` — removed `.worktrees/*` from
  the architecture template the skill writes out.
- `GEMINI.md` — "독립 worktree 또는 격리된 컨텍스트" → "격리된
  컨텍스트(별도 sub-agent)".

Diff: −22 / +1.

## Verification

- `grep -i 'worktree|\.worktrees'` across the whole repo → **0 matches**
- `npm run typecheck` ✓
- `npm run build` ✓
- `npm test` — 20/20 passing (no regression from 2026-04-09 baseline)
- `npm run vibe:config-audit` ✓
- GitHub Actions CI on `86d85a2` → success (18s)

## Intentionally kept

- `test/args.test.ts` uses `--role=challenger` as a parser example
  string. It has no semantic tie to the deleted escalation flow — it's
  just demonstrating `parseArgs` handles `--key=value` syntax. Left
  alone.
- `docs/reports/2026-04-09-template-purification.md` mentions
  `challenger` / `reviewer` in the context of the three `@deprecated`
  `VibeConfig` fields that Sprint D1 removed. It's a historical record,
  not live guidance. Left alone.

## Risks / follow-ups

- If someone actually wants parallel Sprint execution later, they'll
  need to design it from scratch. The old design was never
  implemented, so nothing was lost — but the intent is no longer
  documented anywhere. If that capability is on the roadmap, it should
  be re-introduced as a real Planner → Generator × N → Evaluator
  pipeline, not as a git-worktree trick.
- Sprint escalation is now single-sourced at
  `docs/orchestration/escalation.md`. Any future escalation tooling
  should reference that file directly rather than reintroducing a
  separate `escalate-*` command.
