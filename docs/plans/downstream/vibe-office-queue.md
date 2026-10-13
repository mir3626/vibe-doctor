# Downstream queue — vibe-office harness changes

Source: vibe-office `docs/plans/harness-upstream-d2.md`, a full classification (2026-10-13) of every
harness-owned change vibe-office made after its v1.17.1 sync (`8a06562..d4185de`, 34 paths, about 20
commits). v1.18.0 ships group A. This file tracks the rest and the process change that keeps the
next batch small.

## A — shipped in v1.18.0

| # | Change | vibe-office commits |
|---|---|---|
| A1 | Claude Opus 5.5 is Astra-eligible through the registry (`claude-opus-5-5`, `[1m]` suffix is the same model); Claude 4.x and earlier, Sonnet and Haiku are known lower tiers | `9a44638` |
| A2 | `astra-rules.md` state contract, new-session suggestion, corrections recorded in the repository rulebook, precedence over CLAUDE.md mechanical overrides 1-2 | `23b60c0` |
| A3 | `re-incarnation.md`: PreCompact does not enforce the rule, Astra boot order, when to suggest a new session | `23b60c0` |
| A4 | PreCompact snapshot goes to git-ignored `.vibe/runs/precompact-snapshot.md`; tracked state is never touched; a stale narrative only warns | `23b60c0` |
| A5 | config-audit runs only after `git add` / `git commit` (hook `if`) | `23b60c0` |
| A6 | Statusline ⚠️ under Astra counts only the open audit findings preflight `audit.overdue` fails on (shared `classifyAstraAuditRisks`) | `ad63514` |
| A7 | `verification-runner.test.ts` checks the project-owned `scripts.test` only in the template | `ad63514` |
| A8 | vibe-init lite start and its three templates | `23b60c0` |
| A9 | Optional `iteration-history` `carryover` read by `vibe-iterate` phase 0 | `c521463`, `02c74de` |
| A10 | `harness-gaps.md` rows, reworded for the template | `23b60c0` |

## B — upstream after generalizing

| # | Change | Open points |
|---|---|---|
| B1 | `rm` guard: PreToolUse hook `vibe-rm-guard.mjs`, its test and verification-group entry, `codex-execution.md` §3.4 (vibe-office `d6cf3df`, `2b4ad94`, `ad63514`) | ① The allowed places are hard-coded: `.office-scratch/` is a vibe-office product folder. ② The sibling-clone default (`<repo>-*`) deletes without asking; downstream it already covers a live runner worktree. Move all places into a project-owned setting with an empty default. ③ The template settings and both `agent-delegation*.json` presets deny `Bash(rm *)` / `Bash(rmdir *)`; deny wins over the hook, so remove them when the guard ships. ④ Drop vibe-office decisions, drive letters and staff wording from §3.4. Register the test in `test/groups.json` and do not put `@ts-expect-error` on its `.mjs` import (`allowJs` makes the directive unused and fails the typecheck). |
| B2 | CLAUDE.md sharding: legacy ceremonies to `docs/context/legacy-sprint-flow.md`, hook table to `docs/context/hooks.md`, pointer edits in `_common-rules.md`, `orchestration.md`, `vibe-init/phases/phase-3-interview.md`, `re-incarnation.md` (vibe-office `0f5cdd5`) | ① Add both shards to the manifest harness list. ② Keep the nominal-mode sentence (Claude Opus Orchestrator + Codex Generator, Claude not forced as the only Orchestrator) that the downstream cut dropped. ③ Mirror the same principle in AGENTS.md. Size table: vibe-office `docs/plans/harness-upstream-d2.md` §3. |
| B3 | Claude-session `env` `PYTHONUTF8` / `PYTHONIOENCODING` (vibe-office `23b60c0`) | Harmless on other systems. `env` is in neither `harnessKeys` nor `projectKeys` of the settings merge; decide ownership, then add it as a template default. The UTF-8, `cygpath -w` and long-heredoc notes belong in a guide, not CLAUDE.md. Gap `gap-claude-session-windows-text`. |
| B4 | Sync silently replaces downstream edits in section-merge harness sections and json-deep-merge harness keys | Raise a conflict for those the way locally changed harness files already do. Gap `gap-sync-silent-hybrid-overwrite`. Second downstream case: osint-stock-screener carried A1 locally; a sync before A1's release would have reverted its CLAUDE.md wording while its code still judged Claude as Astra (`docs/reports/harness-upstream-handoff-claude-opus-astra-profile.md` there, §4). |

## Shipped in v1.19.0 (osint-stock-screener handoff)

The second downstream project's handoff (osint-stock-screener `docs/reports/harness-upstream-handoff-claude-opus-astra-profile.md`, 2026-10-13) asked for A1 (shipped in v1.18.0) and three upstream decisions:

| Question | Answer in v1.19.0 |
|---|---|
| Stale `VIBE_ACTIVE_MODEL` after `/model` | Harness commands cannot see the model Claude Code reports. The statusline now shows `⚠️ VIBE_ACTIVE_MODEL <declared> ≠ <reported>` while they disagree, and the profile guide states the limit. |
| Strong Claude models without a registry entry (`claude-fable-5-1`) | Not registered without a same-condition comparison; they stay legacy. CLAUDE.md's legacy-model override gate now says it is separate from the harness profile. |
| Converged files reported as conflicts | `buildSyncPlan` replaces a harness file whose local bytes already equal upstream (`local copy already matches upstream`), with or without sync history. |

Also: `vibe:sync --json` no longer prints the clone and backup log lines to stdout, so the plan parses as JSON.

## Shipped in v1.20.0 (vibe-office chairman request)

The chairman asked for PowerShell runs that do not break on quotes, variables, spaces and em dashes (2026-10-13). `vibe-ps.mjs` runs code from a `.ps1` file (or one `-c` string) with every piece of text passed as data, reads the code as UTF-8, and refuses typographic quotes/dashes outside comments before running. Gap `gap-powershell-inline-quoting`.

## C — stays downstream

- Settings `permissions` drive-root denies (vibe-office `d6cf3df`, `72ab9f8`): project-owned and machine-specific. The only portable lesson: in a rule, a backslash right before `)` escapes it, so the content `rm * C:\` needs the rule text `Bash(rm * C:\\)`, which is `"Bash(rm * C:\\\\)"` in JSON.
- vibe-office CLAUDE.md project sections (Astra-first profile, Windows notes with cv2 and rm-guard lines).

## Process

- Downstream harness work keeps project values in project-owned places (`.vibe/config.json` project keys, CLAUDE.md `PROJECT:*`, settings `permissions`) from the start, so a change ships upstream without a generalization pass.
- Each downstream harness window ends with an upstream release and a downstream sync. Drift check from the downstream root: `npm run vibe:sync -- --dry-run --json --from <vibe-doctor>`; done when it reports no conflicts. Until B4 lands, also diff CLAUDE.md and settings `hooks` by hand.
