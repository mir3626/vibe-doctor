# Sprint M4 — Model tier abstraction + registry

> Generator prompt. Addressed to Codex. Execute scope items in order. Do not expand scope.
> Read `.vibe/agent/_common-rules.md` first. Windows + Unix parity required.

---

## Prior

M1 established `sprint-status.json` schema (pendingRisks, lastSprintScope, sprintsSinceLastAudit, stateUpdatedAt, verifiedAt) + `src/lib/sprint-status.ts` helpers.
M2 added platform wrappers (`run-codex.{sh,cmd}`, `run-claude.*` templates) + `--health` subcommand + sandbox invariants in `_common-rules.md`.
M3 shipped `vibe-sprint-commit.mjs` (single-commit enforcer), `vibe-session-log-sync.mjs`, prompts archival, `.vibe/agent/project-decisions.jsonl` + `src/lib/decisions.ts`. 72 pass + 1 skip.

**Flagged risks carried into M4**:
- **M2 risk** — `scripts/vibe-preflight.mjs` lines 27–39 hardcode `name === 'codex'` for wrapper detection. Non-codex providers (e.g., gemini, future claude wrappers) that ship `scripts/run-<name>.{sh,cmd}` are ignored. **Resolve this sprint**.
- **M3 risk** — `scripts/vibe-sprint-commit.mjs` inline-replicates `extendLastSprintScope` scope-merge logic from `src/lib/sprint-status.ts`. Cannot import TS directly from .mjs without a build step. **Resolve this sprint via cross-ref comment + drift-detection test** (keep inline copy, mark explicit).

---

## Goal

Build a model-tier abstraction so downstream projects ride SOTA automatically:
1. **Central registry** (`.vibe/model-registry.json`) maps `{ provider, tier } → { family alias, apiId }`. Upstream-maintained, `vibe-sync` propagates.
2. **Config accepts both forms**: legacy string `"claude-opus"` AND new object `{ provider: "anthropic", tier: "flagship" }`. Strict backward compat — existing configs untouched.
3. **Resolver CLI + lib** translates config role → concrete model to pass into Agent calls.
4. **SessionStart hook** advises when upstream registry has newer `schemaVersion` or new tier entries (24h cache, non-blocking).
5. **Preflight generalized** — wrapper detection works for any `run-<providerName>.{sh,cmd}`, not just codex.

---

## Scope (produce exactly these files)

### 1. `.vibe/model-registry.json` (NEW, harness tier)

```json
{
  "$schema": "./model-registry.schema.json",
  "schemaVersion": 1,
  "updatedAt": "2026-04-15T00:00:00.000Z",
  "source": "vibe-doctor-upstream",
  "providers": {
    "anthropic": {
      "tiers": { "flagship": "opus", "performant": "sonnet", "efficient": "haiku" },
      "knownModels": {
        "opus":   { "apiId": "claude-opus-4-6",   "release": "2026-04" },
        "sonnet": { "apiId": "claude-sonnet-4-6", "release": "2026-04" },
        "haiku":  { "apiId": "claude-haiku-4-5",  "release": "2025-10" }
      }
    }
  }
}
```

### 2. `.vibe/model-registry.schema.json` (NEW, harness tier)

JSON Schema draft-07. Required: `schemaVersion` (const 1), `updatedAt` (date-time), `source` (string), `providers` (object). Each provider: `tiers` (object mapping `flagship|performant|efficient` → family alias string), `knownModels` (object mapping family alias → `{ apiId: string, release: string }`). Disallow additional tier keys at schema level; additional providers allowed.

### 3. `src/lib/model-registry.ts` (NEW)

```ts
export interface ModelEntry { apiId: string; release: string }
export interface ProviderRegistryEntry {
  tiers: Partial<Record<'flagship' | 'performant' | 'efficient', string>>;
  knownModels: Record<string, ModelEntry>;
}
export interface ModelRegistry {
  schemaVersion: number;
  updatedAt: string;
  source: string;
  providers: Record<string, ProviderRegistryEntry>;
}
export type TierRef = { provider: string; tier: 'flagship' | 'performant' | 'efficient' };
export type RoleRef = string | TierRef;
export interface ResolvedModel {
  provider: string;
  tier?: 'flagship' | 'performant' | 'efficient';
  familyAlias: string;    // e.g., "opus"
  apiId: string;          // e.g., "claude-opus-4-6"
  legacy: boolean;        // true if input was a raw string
}

export async function loadRegistry(root?: string): Promise<ModelRegistry>;
export function resolveModel(registry: ModelRegistry, providerId: string, tier: TierRef['tier']): ResolvedModel;
export function resolveRoleRef(registry: ModelRegistry | null, ref: RoleRef): ResolvedModel;
// If ref is string: returns { provider: ref, familyAlias: ref, apiId: ref, legacy: true }, registry optional.
// If ref is TierRef: registry required; throws on unknown provider/tier with message including available tiers.
export function resolveFromConfig(
  sprintRoles: Record<string, RoleRef>,
  roleName: string,
  registry: ModelRegistry | null,
): ResolvedModel;
```

Behavior:
- `loadRegistry` reads `.vibe/model-registry.json` via `src/lib/fs.ts` `readJson`. Throws if schemaVersion !== 1 with an explicit upgrade-path error.
- Missing tier under a known provider → `Error('registry: provider "X" has no tier "Y" (available: ...)')`.
- Legacy pass-through is **registry-independent**: `resolveRoleRef(null, "claude-opus")` must work so existing projects without registry still resolve (prints info, not error).

### 4. `src/lib/config.ts` extension

Add to the file (do NOT rename existing types):

```ts
export type SprintRoleDefinition = string | { provider: string; tier: 'flagship' | 'performant' | 'efficient' };

export interface SprintRoles {
  planner: SprintRoleDefinition;
  generator: SprintRoleDefinition;
  evaluator: SprintRoleDefinition;
}
```

`mergeConfig` continues to spread `sprintRoles` shallowly — object vs string swap is allowed. No runtime validation beyond type — validation lives in `resolveRoleRef`.

### 5. `scripts/vibe-resolve-model.mjs` (NEW, harness tier)

CLI:
- `node scripts/vibe-resolve-model.mjs <role>` → prints one line: `<familyAlias>\t<apiId>\t<provider>[\t<tier>]`
- `node scripts/vibe-resolve-model.mjs <role> --json` → prints `ResolvedModel` as JSON
- Unknown role → exit 2 + stderr `unknown role "<role>" (available: planner, generator, evaluator)`
- Unknown provider/tier → exit 3 + stderr message from `resolveRoleRef`

Implementation is pure `.mjs` (no tsx) — reads `.vibe/config.json` (+ `.vibe/config.local.json` overlay if present, same precedence as `loadConfig`), reads `.vibe/model-registry.json` if present (optional — legacy paths must still work), resolves via inline port of `resolveRoleRef` logic. Port the minimum necessary (legacy pass-through + registry tier lookup + error messages). Add a comment above the inline port:

```js
// CROSS-REF (src/lib/model-registry.ts:resolveRoleRef)
// Inline port because .mjs cannot import .ts without a build step.
// Drift-detection: test/model-registry.test.ts compares CLI output with lib output for a fixture.
```

Export a named function `resolveRoleFromCli(roleName, { root } = {})` for potential reuse. Script uses `import.meta.url === pathToFileURL(process.argv[1]).href` guard before running CLI main.

### 6. `scripts/vibe-model-registry-check.mjs` (NEW, harness tier)

SessionStart hook companion to `vibe-version-check.mjs`. Modeled on its structure:
- Read `.vibe/config.json.upstream` (exit 0 if missing).
- Cache path: `.vibe/model-registry-cache.json`. Skip if `lastCheckedAt < 24h` ago.
- Fetch upstream `.vibe/model-registry.json` contents via `git show <ref>:.vibe/model-registry.json` when upstream type is `git` with a ref, else `git ls-remote` + ephemeral clone fallback **only** if a local upstream remote is already configured. **Do not** add new remotes. If fetch fails, write cache + exit 0 (non-blocking).
- Compare local `schemaVersion` vs upstream. If upstream is higher OR any new tier keys exist for a known provider, stdout one advisory line:
  `[vibe-registry] model-registry update available (local=1, upstream=2). Run 'npm run vibe:sync' to refresh.`
- Never exit non-zero. Wrap entire body in try/catch → `process.exit(0)`.

### 7. `.claude/settings.json` update

Append a second SessionStart hook entry (keep existing version-check intact):

```json
{
  "type": "command",
  "command": "node scripts/vibe-model-registry-check.mjs 2>/dev/null || true"
}
```

Place inside the same `"matcher": ""` block's `hooks` array. Verify resulting JSON still parses and both hooks run.

### 8. `.claude/agents/planner.md` frontmatter

Replace the current frontmatter block with:

```yaml
---
name: planner
description: Propose Sprint division and implementation plans before non-trivial work. Use proactively when user gives a goal without a detailed method.
model: opus
---
```

Directly below the frontmatter, before the first body line, add one comment paragraph:

```markdown
<!--
  model: "opus" is the Claude Code family alias.
  Tier-based resolution (flagship/performant/efficient → family alias → apiId) is performed
  by the Orchestrator before Agent calls via `node scripts/vibe-resolve-model.mjs <role>`.
  Registry source of truth: .vibe/model-registry.json (upstream-maintained).
  This frontmatter is documentation-only; Claude Code itself does not read the registry.
-->
```

### 9. `scripts/vibe-preflight.mjs` generalization (M2 risk resolve)

Replace the `checkProviderHealth` body so wrapper detection is name-independent:

```js
function checkProviderHealth(name, provider) {
  const isWin = process.platform === 'win32';
  const ext = isWin ? 'cmd' : 'sh';
  const wrapperPath = resolve('scripts', `run-${name}.${ext}`);
  const candidateWrappers = [];

  if (existsSync(wrapperPath)) {
    if (isWin) {
      candidateWrappers.push({
        command: process.env.ComSpec ?? 'cmd.exe',
        args: ['/d', '/c', wrapperPath, '--health'],
      });
    } else {
      candidateWrappers.push({ command: wrapperPath, args: ['--health'] });
    }
  }

  // … existing rc===1 / rc===2 handling unchanged …

  // Fallback: direct `provider.command --version`. `level: 'warn'` emitted for
  // any provider that has a wrapper file present but fell back (parity with prior codex-specific note).
  try {
    const v = sh(`${provider.command} --version`);
    const hasWrapper = existsSync(wrapperPath);
    return {
      ok: true,
      detail: hasWrapper ? `${v.split('\n')[0]} (direct; wrapper not used)` : v.split('\n')[0],
      level: hasWrapper ? 'warn' : 'ok',
    };
  } catch {
    return { ok: false, detail: `${provider.command} CLI not found or not authenticated - check: ${provider.command} --version`, level: 'fail' };
  }
}
```

Keep `rc===1` / `rc===2` handling verbatim. Do not change call sites.

### 10. `migrations/1.2.0.mjs` (NEW, harness tier)

Idempotent, safe to re-run. Behavior:
- If `.vibe/model-registry.json` absent → copy from upstream template (use `path.join(__dirname, '..', '.vibe', 'model-registry.json')` as source when running from harness checkout; otherwise write the embedded default JSON constant).
- Do NOT mutate `.vibe/config.json.sprintRoles`. Users migrate to tier form voluntarily.
- Read `.vibe/config.json.harnessVersionInstalled`. If < "1.2.0", update to "1.2.0" and write. Never downgrade.
- Print summary line: `[migrate 1.2.0] registry=<created|exists> version=<n/a|updated to 1.2.0>`.
- Exit 0 on success, 1 on any write failure.

### 11. `.vibe/sync-manifest.json` update

Add to `files.harness` (preserve existing order, append at end):

```
".vibe/model-registry.json",
".vibe/model-registry.schema.json",
"src/lib/model-registry.ts",
"scripts/vibe-resolve-model.mjs",
"scripts/vibe-model-registry-check.mjs",
"migrations/1.2.0.mjs",
"test/model-registry.test.ts"
```

Add to `migrations`: `"1.2.0": "migrations/1.2.0.mjs"`.

`.vibe/model-registry.json` is **full-replace harness tier** (not hybrid) — users who need custom tiers should override via a future `.vibe/model-registry.local.json` overlay (out of scope for this sprint, **do not implement overlay**; note in file header comment that overlay is a future extension).

### 12. M3 risk resolve — `scripts/vibe-sprint-commit.mjs` annotation

Locate the inline scope-merge block (search for the merge logic around where `lastSprintScope` / `lastSprintScopeGlob` are computed). Add directly above it:

```js
// CROSS-REF (src/lib/sprint-status.ts:extendLastSprintScope)
// Inline replication intentional — .mjs cannot import compiled TS without a build step.
// Drift detection: test/sprint-commit.test.ts asserts both implementations produce identical
// output for a shared fixture. If this block changes, update the lib AND the test fixture.
```

Do not alter the logic.

---

## Tests

### 13. `test/model-registry.test.ts` (NEW)

Use node's built-in `node:test` + `tsx` (existing harness pattern — see `test/sprint-status.test.ts`). Cover:

- `loadRegistry` happy path on fixture JSON.
- `loadRegistry` rejects `schemaVersion !== 1` with explicit message.
- `resolveRoleRef(null, "claude-opus")` returns `{ legacy: true, familyAlias: "claude-opus", apiId: "claude-opus", provider: "claude-opus" }`.
- `resolveRoleRef(registry, { provider: "anthropic", tier: "flagship" })` returns `{ familyAlias: "opus", apiId: "claude-opus-4-6", provider: "anthropic", tier: "flagship", legacy: false }`.
- Unknown tier error includes available tiers.
- Unknown provider error includes available providers.
- **Drift-detection fixture**: import the fixture used by `scripts/vibe-resolve-model.mjs`, invoke the CLI via `node:child_process.execFileSync` on the script with a known role, parse JSON, compare to `resolveRoleRef` output from the lib. They must match byte-for-byte after JSON round-trip.

### 14. Extend `test/preflight-stale.test.ts` OR new `test/preflight-wrapper-generalized.test.ts`

Prefer a NEW file to keep the stale test focused. In a tmp-dir fixture:
- Create fake `scripts/run-gemini.sh` (or `.cmd` on win32) that exits 0 and prints `gemini 1.0` — ensure executable on Unix.
- Create minimal `.vibe/config.json` with `sprintRoles.planner = "gemini"` and `providers.gemini = { command: "gemini", args: [] }`.
- Run `node scripts/vibe-preflight.mjs --json` with CWD set to tmp dir.
- Parse JSON, assert `provider.gemini` entry exists, `ok: true`, `level: 'ok'`, and detail contains `gemini 1.0`.
- Second case: delete the wrapper, assert fallback `level: 'warn'` or `'ok'` with direct-version detail.

Use `process.env.PATH` injection via `execFileSync` env option to stub the `gemini` binary if needed, or mock `--version` by providing a tiny node-based shim.

### 15. Extend `test/sprint-commit.test.ts`

Add a test case: construct a fixture scope-merge input `{ existing: ["src/a.ts", "src/b.ts"], incoming: ["src/b.ts", "src/c.ts"] }`. Run the lib version (`extendLastSprintScope` against a tmp `.vibe/agent/sprint-status.json`) and the inline version (import the private merge function from `vibe-sprint-commit.mjs` — if not exported, export it for testability). Assert the two outputs are deep-equal. If they diverge, the test must fail with message `drift detected — update lib and commit script in lockstep`.

---

## Contract requirements

- **No new runtime deps**. Node 24 built-ins only (`node:fs`, `node:child_process`, `node:path`, `node:url`).
- **Strict backward compat**: a config with `sprintRoles: { planner: "claude-opus", generator: "codex", evaluator: "claude-opus" }` and no registry file must continue to work — `npm test` passes, `node scripts/vibe-preflight.mjs` green, `node scripts/vibe-resolve-model.mjs planner` returns `claude-opus\tclaude-opus\tclaude-opus` (legacy passthrough).
- **Idempotent migration**. Running `migrations/1.2.0.mjs` twice must produce no net changes the second time.
- **Non-blocking hooks**. Neither `vibe-model-registry-check.mjs` nor `vibe-version-check.mjs` may ever fail a SessionStart.
- **Windows parity**. All scripts must work under both Git Bash and `cmd.exe`. Use forward slashes in paths inside JS; use `path.join` + `path.resolve` consistently.

---

## Checklist (mechanical — must all pass)

- [ ] `npx tsc --noEmit` — 0 errors
- [ ] `npm test` — all existing + 1 new test file pass; sprint-commit test extended and green
- [ ] `node scripts/vibe-preflight.mjs` — exit 0 on repo HEAD
- [ ] `node scripts/vibe-resolve-model.mjs planner` — prints `claude-opus\tclaude-opus\tclaude-opus` (legacy form, current config)
- [ ] `node scripts/vibe-resolve-model.mjs generator --json` — valid JSON with `legacy: true`
- [ ] Mutate a tmp config to `{ provider: "anthropic", tier: "flagship" }` → resolver returns `familyAlias: "opus"`, `apiId: "claude-opus-4-6"`
- [ ] `node scripts/vibe-model-registry-check.mjs` — exit 0, no stdout on fresh cache (or advisory line on schema diff)
- [ ] `node migrations/1.2.0.mjs` — exit 0, idempotent on re-run
- [ ] `cat .claude/settings.json | node -e "JSON.parse(require('fs').readFileSync(0,'utf8'))"` — parses; SessionStart has 2 hook entries
- [ ] `.vibe/sync-manifest.json` parses + 7 new harness entries + `migrations[1.2.0]` present
- [ ] No new entries in `package.json.dependencies` or `devDependencies`

---

## Out of scope (defer — do NOT implement)

- `.vibe/model-registry.local.json` overlay/deep-merge (future).
- `vibe-sync` awareness of registry semver — current full-replace harness tier is sufficient.
- Automatic migration of `sprintRoles` from string to tier form.
- Claude Code's internal behavior when `model: opus` is passed (Anthropic's responsibility).
- /vibe-sprint-mode permission presets (Sprint M9).
- Native interview (Sprint M5) — M5 will consume the resolver.
- Multiple providers in `.vibe/model-registry.json` beyond `anthropic` (OpenAI, Google, etc. — future).
- Caching `loadRegistry` — single read per process is fine.

---

## Final report format (Generator responds with)

```
Sprint M4 — Model tier abstraction + registry — COMPLETE

Files created:
  .vibe/model-registry.json                            (~25 LOC)
  .vibe/model-registry.schema.json                     (~40 LOC)
  src/lib/model-registry.ts                            (~LLL LOC)
  scripts/vibe-resolve-model.mjs                       (~LLL LOC)
  scripts/vibe-model-registry-check.mjs                (~LLL LOC)
  migrations/1.2.0.mjs                                 (~LLL LOC)
  test/model-registry.test.ts                          (~LLL LOC)
  test/preflight-wrapper-generalized.test.ts           (~LLL LOC)

Files modified:
  src/lib/config.ts                                    (+LLL, -LLL)
  scripts/vibe-preflight.mjs                           (+LLL, -LLL)
  scripts/vibe-sprint-commit.mjs                       (+LLL, -LLL)   # CROSS-REF comment only
  .claude/settings.json                                (+LLL, -LLL)
  .claude/agents/planner.md                            (+LLL, -LLL)
  .vibe/sync-manifest.json                             (+LLL, -LLL)
  test/sprint-commit.test.ts                           (+LLL, -LLL)   # drift detection

Verification:
  npx tsc --noEmit:            0 errors
  npm test:                    N pass, 0 fail (prev: 72 pass + 1 skip → now: <N> pass + 1 skip)
  vibe-preflight:              exit 0
  vibe-resolve-model planner:  <output>
  migration idempotency:       confirmed (run twice, second run no-op)

Risks resolved:
  - M2: preflight wrapper detection now name-agnostic (scripts/run-<name>.{sh,cmd})
  - M3: sprint-commit scope-merge has CROSS-REF comment + drift-detection test

Risks flagged for next sprint:
  - <any surfaced during implementation>
```

Total net LOC (added − deleted) must match the sum above. Report exact numbers, no approximations.
