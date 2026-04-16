# Sprint M14-B — Dashboard integration (read-only heads-up + attention pipeline)

> Branch target: `dashboard-integration`
> Direction: **A confirmed** — dashboard is read-only UI + Web Notifications heads-up. No async approval flow. No Service Worker / Web Push / VAPID. localhost only.

## Prior

- Sprint M14-A added `.claude/statusline.{sh,ps1}` harness-version hint. Orchestrator gains a passive indicator inside the terminal but still **misses permission prompts** and urgent events when the terminal is not focused.
- Existing state files (`.vibe/agent/sprint-status.json`, `handoff.md`, `session-log.md`, `iteration-history.json`, `tokens.json`) already cover sprint lifecycle; none of them are watched live by an external surface.
- `scripts/vibe-project-report.mjs` is the closest reference for HTML rendering and cross-platform browser-open. Reuse its embedded `<style>` system + `openReport()` spawn helper pattern, but do NOT reuse its "read-once, write HTML, exit" shape — M14-B needs a long-running HTTP+SSE process.
- `scripts/vibe-sprint-complete.mjs`, `scripts/vibe-sprint-commit.mjs`, `scripts/vibe-interview.mjs`, `scripts/vibe-phase0-seal.mjs`, `scripts/vibe-audit-clear.mjs` are the append hook sites. Current behaviour already calls `logStep(...)` — a daily-log append is one additional line per event.
- `.claude/settings.json` hooks currently wire `SessionStart`, `PostToolUse`, `Stop`, `PreCompact`. The **`Notification` hook slot is unused** — this is where Claude Code's permission-request events land and what unlocks the core value of this Sprint.
- `src/lib/config.ts` `VibeConfig` already carries optional sections (`bundle`, `browserSmoke`) — extending with `dashboard?` follows the same pattern.

## Goal

Deliver a **separately-running, fully-detached localhost dashboard** that (a) never touches the Orchestrator's context window, (b) visualises roadmap pointer + per-date session history via file-watching, and (c) turns every Claude-Code permission prompt and every `severity=urgent` harness event into a Web Notification so the user never misses an out-of-focus attention request.

Architecture (confirmed with user):

```
Claude Code Session (Orchestrator)
  hooks.Notification -> scripts/vibe-attention-notify.mjs --source claude-code
  hooks.SessionStart -> scripts/vibe-session-started.mjs  (daily-log + optional --detach spawn)
  Sprint scripts     -> appendDailyEvent(...)  [1-line hook per script]
       |
       v  append-only writes
  .vibe/agent/
    daily/YYYY-MM-DD.jsonl          <- date-sharded events (append-only)
    attention.jsonl                 <- urgent events (append-only)
    sprint-status.json / handoff.md / iteration-history.json / tokens.json
    dashboard.pid                   <- running server PID (lease)

                             ^
                             |  fs.watch (chokidar-free, polling fallback)
                             |
  scripts/vibe-dashboard.mjs  (separate Node 24+ process, zero runtime deps)
    HTTP 127.0.0.1:5175 (auto +1..+10 on EADDRINUSE)
      GET /                 -> embedded SPA
      GET /api/state        -> consolidated snapshot JSON
      GET /api/daily-index  -> available date list (desc)
      GET /api/daily/<YYYY-MM-DD> -> parsed JSONL
      GET /api/attention?since=<ts> -> urgent events since
      GET /events           -> SSE stream
                             |
                             v HTTP + SSE
                          Browser SPA
```

Key contract: **Orchestrator NEVER reads dashboard data files**. The server is the sole reader; Orchestrator only appends. This is the token-efficiency strategy the user explicitly requested.

## Scope

### 1. `scripts/vibe-dashboard.mjs` (new, ~420 LOC)

HTTP + SSE server. Pure Node 24+ stdlib (`node:http`, `node:fs`, `node:fs/promises`, `node:path`, `node:url`, `node:child_process`, `node:crypto`). **No new runtime dep.**

CLI:

```
node scripts/vibe-dashboard.mjs [--port 5175] [--host 127.0.0.1] [--no-open] [--detach] [--stop]
```

- `--port N` — override; default from `.vibe/config.json.dashboard.port` then `5175`.
- `--host` — refused if not `127.0.0.1` or `localhost` (hard deny 0.0.0.0 per user constraint).
- `--detach` — re-spawn self with `stdio:'ignore'`, write PID to `.vibe/agent/dashboard.pid`, exit parent 0.
- `--stop` — read PID file, `process.kill(pid, 'SIGTERM')`, delete PID, exit.
- `--no-open` — skip browser spawn (reuse `openReport()` helper pattern from `vibe-project-report.mjs:495`).
- Port auto-discover: try requested port first; on `EADDRINUSE`, try `+1` through `+10`, then fail loud.
- Graceful shutdown: `SIGINT`/`SIGTERM` → close SSE connections with `retry:0\n\n`, close HTTP server, unlink PID, exit 0.
- PID lease: on start, if PID file exists and `process.kill(pid, 0)` succeeds, exit with message "dashboard already running at http://127.0.0.1:<port>"; on stale PID (process gone), overwrite.

Endpoints (all JSON except `/` and `/events`):

| Path | Method | Behaviour |
|---|---|---|
| `/` | GET | Serve embedded SPA HTML (`renderShellHtml()` — analogous to `renderHtml()` in `vibe-project-report.mjs:390`). `Content-Type: text/html; charset=utf-8`. Inline `<style>` + `<script>`. Zero external fetches. |
| `/api/state` | GET | Read + parse `sprint-status.json`, `handoff.md`, `iteration-history.json`, `tokens.json`, today's `daily/YYYY-MM-DD.jsonl` (last 50 events), `sprint-roadmap.md` (for pointer). Return `{ roadmap, currentSprint, iteration, todayEvents, risks, tokens, updatedAt }`. |
| `/api/daily-index` | GET | `listAvailableDates()` descending. |
| `/api/daily/:date` | GET | Validate `date` matches `^\d{4}-\d{2}-\d{2}$`; return `{ date, events: [...] }`. 404 if missing. |
| `/api/attention` | GET | Query `?since=<isoTs>` → events with `ts >= since`; default last 24h. |
| `/events` | GET | SSE (`Content-Type: text/event-stream`). Heartbeat `: ping\n\n` every 20 s. Emits `event: state-updated\ndata: {"files":["sprint-status.json"]}\n\n` when watched files change; emits `event: attention\ndata: {...event}\n\n` per new `attention.jsonl` line. |

File watching strategy:

- `fs.watch` on: `.vibe/agent/sprint-status.json`, `handoff.md`, `iteration-history.json`, `tokens.json`, `attention.jsonl`, `daily/` dir, `docs/plans/sprint-roadmap.md`.
- Some filesystems (old network mounts, some Docker bind mounts) return `EPERM` or silently drop events. On `fs.watch` throw or missing events for >5 s, **fall back to 2000 ms `setInterval` polling** that `stat` + caches `mtimeMs`. Decision made at watch-setup time (no runtime flip-flopping).
- Debounce burst events: 150 ms coalesce per file before emitting SSE.

Security invariants (must be tested):

- Bind address: `127.0.0.1` only. Reject `0.0.0.0`, `::`, and external IPs on startup with exit 1.
- No write endpoints. Every non-GET responds 405.
- `/api/daily/:date` rejects path-traversal (regex anchor).
- Response size cap: `/api/daily/:date` truncates to last 500 events with `{ truncated: true }` marker.

### 2. Embedded SPA (inside `vibe-dashboard.mjs`, ~520 LOC combined HTML+CSS+JS)

Single-page, zero external assets. Layout:

- **Top strip** — Roadmap Pointer.
  - Phase strip: `Phase 0 → 1 → 2 → 3 → 4`, each node in one of three visual states (`complete`, `active`, `pending`). Status derived from `product.md` / `handoff.md` headings parsed server-side inside `/api/state`.
  - Sprint strip: horizontal chain from `sprint-roadmap.md` sprint IDs. For each sprint node: `passed` (check), `failed` (x), `in-progress` (pulsing dot), `pending` (outline). Current sprint = `sprint-status.json.handoff.currentSprintId` or roadmap `<!-- BEGIN:VIBE:CURRENT-SPRINT -->` marker block. Iteration label (`iter-1`, `iter-2`, ...) shown above the active sprint when `iteration-history.currentIteration` is set.
  - "Last activity" timestamp right-aligned.
- **Main — Date Accordion**.
  - One `<details>` element per date in `daily-index`, descending.
  - Today = `open` attribute by default.
  - When opened first time → `fetch('/api/daily/:date')` and render event timeline; cache in-memory per date.
  - Each event row: left column = time (`HH:mm:ss`), middle = type chip (coloured by type: `sprint-*`=green/red, `phase-*`=blue, `pending-risk-*`=amber, `attention-*`=red, `test-failed`=red, `session-started`=grey), right = one-line summary from payload.
  - SSE `state-updated` referencing today's daily file → re-fetch today only (not full rebuild).
- **Right sidebar — Live Status** (fixed, 260 px).
  - Current sprint id + status + elapsed.
  - Open `pendingRisks` count (click = modal listing risks).
  - Today tokens (from `tokens.json`).
  - Latest test result if present (from most recent `test-failed` or `sprint-completed` payload).
  - SSE connection indicator: green dot (connected) / amber (reconnecting) / red (disconnected after 3 retries).
- **Notification permission banner** (dismissible, only when `Notification.permission === 'default'`). Explicit button "Enable notifications". **Never auto-prompt** — browsers throttle auto-prompted permissions.
- **Attention toast area** — in-page fallback when permission is denied; shows last 5 urgent events with fade-out after 8 s.

JS logic:

```
boot()
  -> state = await fetch('/api/state')
  -> render(state)
  -> es = new EventSource('/events')
  -> es.addEventListener('state-updated', () => refresh())
  -> es.addEventListener('attention', ev => handleAttention(JSON.parse(ev.data)))
  -> es.addEventListener('error', () => reconnectWithBackoff())
  -> setInterval(heartbeatCheck, 30_000)  // if no ping in 40s -> mark disconnected

handleAttention(evt)
  if (Notification.permission === 'granted')
    new Notification(evt.title, {
      body: evt.detail,
      icon: '/icon.svg',  // served inline
      tag: evt.id,         // dedupe repeated events
      requireInteraction: evt.severity === 'urgent',
    })
  else
    pushInPageToast(evt)
```

CSS: single `<style>` block. Use CSS custom properties already demonstrated in `vibe-project-report.mjs:397-410`. Target "gameless, terminal-adjacent": monospace for timestamps, system sans for body, 3-color palette + status hues. No chart library. No gradients, no animations beyond the pulsing active-sprint dot and the toast fade.

### 3. `src/lib/daily-log.ts` (new, TypeScript strict, ~90 LOC)

Public surface:

```ts
export interface DailyEvent {
  ts: string;                // ISO8601
  type: DailyEventType;
  sessionId?: string;
  payload?: Record<string, unknown>;
}

export type DailyEventType =
  | 'session-started'
  | 'phase-started' | 'phase-completed'
  | 'sprint-started' | 'sprint-completed' | 'sprint-failed'
  | 'pending-risk-added' | 'pending-risk-resolved'
  | 'attention-needed'
  | 'test-failed'
  | 'iteration-started' | 'iteration-completed'
  | 'audit-cleared';

export async function appendDailyEvent(input: {
  type: DailyEventType;
  payload?: Record<string, unknown>;
  date?: string;           // override for tests; default = local YYYY-MM-DD
  sessionId?: string;
  rootDir?: string;        // test hook
}): Promise<void>;

export async function readDailyEvents(
  date: string,
  options?: { rootDir?: string; limit?: number },
): Promise<DailyEvent[]>;

export async function listAvailableDates(rootDir?: string): Promise<string[]>;
```

Implementation notes:

- Use `fs.promises.appendFile(path, line, { flag: 'a' })` — POSIX-atomic for writes <= `PIPE_BUF` (~4 KB); each JSONL line stays well under. Multiple Node processes appending concurrently is safe on Linux/macOS/Windows NTFS (documented edge: 32 KB race on slow network FS — not our case, localhost only).
- `appendDailyEvent` must auto-create `.vibe/agent/daily/` if missing. No lockfile (JSONL append race is the design, not a bug).
- Date handling: resolve local calendar date via `Intl.DateTimeFormat(undefined, { timeZone: 'UTC' }).format(...)` — uniformly UTC day boundaries. Document the choice.
- `readDailyEvents` parses line-by-line, skips malformed lines with a stderr warning (do not throw). Returns chronological order.
- `listAvailableDates` uses `readdir` + filter by `^\d{4}-\d{2}-\d{2}\.jsonl$`, returns descending.

### 4. Hook-point wiring (append 1 line each to existing scripts)

Surgical, reversible edits. Each insertion sits inside existing success paths, guarded by try/catch so a log failure never blocks the host script.

| File | Insertion | Event |
|---|---|---|
| `scripts/vibe-sprint-commit.mjs` (after `execGit(['rev-parse','--show-toplevel'])` succeeds, before commit) | `appendDailyEvent({ type: 'sprint-started', payload: { sprintId, status } })` | sprint-started |
| `scripts/vibe-sprint-complete.mjs` (end of success path, before `runProjectReport()`) | `appendDailyEvent({ type: status === 'passed' ? 'sprint-completed' : 'sprint-failed', payload: { sprintId, status, loc: actualLoc } })` | sprint-completed / sprint-failed |
| `scripts/vibe-audit-clear.mjs` | `appendDailyEvent({ type: 'audit-cleared', payload: {...} })` | audit-cleared |
| `scripts/vibe-interview.mjs` (on ambiguity ≤ 0.2 terminal transition) | `appendDailyEvent({ type: 'phase-completed', payload: { phase: 'interview', ambiguity } })` | phase-completed |
| `scripts/vibe-phase0-seal.mjs` (after successful commit) | `appendDailyEvent({ type: 'phase-completed', payload: { phase: 'phase-0' } })` | phase-completed |
| `src/lib/sprint-status.ts` — `resolvePendingRisk` / `addPendingRisk` | `appendDailyEvent({ type: 'pending-risk-added' | 'pending-risk-resolved', payload: { id, text } })` | pending-risk-* |

Since daily-log is TS and several hook sites are `.mjs`, provide **both**:

- `src/lib/daily-log.ts` — TS-callable.
- `scripts/vibe-daily-log.mjs` — tiny CLI shim: `node scripts/vibe-daily-log.mjs <type> --payload '<json>'` that `.mjs` scripts can `spawnSync` (fire-and-forget, `stdio:'ignore'`). This keeps the `.mjs` scripts free of compiled-TS import gymnastics (same rationale as `inlineExtendLastSprintScope` CROSS-REF in `vibe-sprint-commit.mjs:140-143`).

### 5. Attention / notification pipeline (the core user value)

#### 5a. `scripts/vibe-attention-notify.mjs` (new, ~60 LOC)

Registered as `hooks.Notification` in `.claude/settings.json`. Claude Code pipes the notification payload to stdin (shape documented in Claude Code hooks reference — generally `{ session_id, hook_event_name, message }`). Script must:

- Read all of stdin (≤64 KB) with a 2-second timeout; if stdin is empty, still append a minimal event.
- `appendFile('.vibe/agent/attention.jsonl', line + '\n')` where line is:
  ```json
  {"ts":"<iso>","id":"<uuid>","type":"attention-needed","severity":"urgent","source":"claude-code-notification","title":"User attention required","detail":"<message or 'Permission prompt'>"}
  ```
- Also call `appendDailyEvent({ type: 'attention-needed', payload: {...} })`.
- Exit 0 unconditionally (non-blocking; failures go to stderr only). Crashes MUST NOT block Claude Code.

#### 5b. `scripts/vibe-attention.mjs` (new, ~50 LOC) — Orchestrator-invoked marker

Complements 5a for cases Claude Code's Notification hook does not fire (Evaluator reject, explicit pendingRisk escalation). CLI:

```
node scripts/vibe-attention.mjs --severity urgent --title "..." --detail "..." [--source orchestrator]
```

Same output shape as 5a. Deterministic id = `crypto.randomUUID()`.

#### 5c. Dashboard-side

- Watch `.vibe/agent/attention.jsonl`. On new line: parse, emit SSE `event: attention\n`.
- Browser: `new Notification(title, { body: detail, tag: id, requireInteraction: severity === 'urgent' })`. Clicking the notification focuses the dashboard tab.
- In-page fallback toast when permission denied.

#### 5d. CLAUDE.md addition (docs only, Orchestrator directly edits)

Add a short subsection under "훅 강제 메커니즘" documenting:

- `hooks.Notification` → `vibe-attention-notify.mjs` catches Claude Code's own permission/auth prompts automatically.
- Orchestrator may additionally call `Bash("node scripts/vibe-attention.mjs --severity urgent --title '...' --detail '...'")` when an LLM-level event (Evaluator fail, new urgent pendingRisk, 2× Generator failure) warrants a heads-up.

### 6. Config schema extension

`.vibe/config.json` — new optional section:

```json
{
  "dashboard": {
    "enabled": false,
    "port": 5175,
    "host": "127.0.0.1",
    "autoStart": false,
    "notificationLevel": "urgent",
    "retentionDays": 30
  }
}
```

`src/lib/config.ts` — add:

```ts
export interface DashboardConfig {
  enabled: boolean;
  port: number;
  host: '127.0.0.1' | 'localhost';
  autoStart: boolean;
  notificationLevel: 'urgent' | 'all';
  retentionDays: number;
}

export interface VibeConfig {
  // ... existing
  dashboard?: DashboardConfig;
}
```

Extend `mergeConfig` to merge `dashboard` symmetrically with `bundle` / `browserSmoke` (see existing `mergeOptionalObject` helper at `src/lib/config.ts:60-72`).

**Defaults** (when section absent): `enabled=false`, `autoStart=false`. Feature stays fully dormant unless opted in.

### 7. SessionStart auto-start hook

`scripts/vibe-session-started.mjs` (new, ~80 LOC):

1. Always `appendDailyEvent({ type: 'session-started', payload: { cwd } })`.
2. Load `.vibe/config.json`. If `dashboard.autoStart === true`:
   - Read `.vibe/agent/dashboard.pid` if present; `process.kill(pid, 0)` → alive? skip.
   - Else spawn `node scripts/vibe-dashboard.mjs --detach` with `stdio:'ignore'`, `detached:true`, `.unref()`.
3. Exit 0 unconditionally; any error → stderr warn only.

Register in `.claude/settings.json`:

```jsonc
"SessionStart": [{
  "matcher": "",
  "hooks": [
    { "type": "command", "command": "node scripts/vibe-version-check.mjs 2>/dev/null || true" },
    { "type": "command", "command": "node scripts/vibe-model-registry-check.mjs 2>/dev/null || true" },
    { "type": "command", "command": "node scripts/vibe-session-started.mjs 2>/dev/null || true" }
  ]
}]
```

Register `Notification` hook:

```jsonc
"Notification": [{
  "hooks": [
    { "type": "command", "command": "node scripts/vibe-attention-notify.mjs 2>/dev/null || true" }
  ]
}]
```

### 8. Package scripts + manifest + permissions

`package.json` additions:

```json
"vibe:dashboard": "node scripts/vibe-dashboard.mjs",
"vibe:dashboard:stop": "node scripts/vibe-dashboard.mjs --stop",
"vibe:attention": "node scripts/vibe-attention.mjs"
```

`.vibe/sync-manifest.json` → `harness[]`: add

```
scripts/vibe-dashboard.mjs
scripts/vibe-daily-log.mjs
scripts/vibe-attention-notify.mjs
scripts/vibe-attention.mjs
scripts/vibe-session-started.mjs
src/lib/daily-log.ts
test/dashboard-server.test.ts
test/daily-log.test.ts
test/attention-notify.test.ts
```

`.claude/settings.json` already covered above. No new entries in `permissions.allow` needed (Bash invocations match existing `Bash(node scripts/vibe-:*)` + `Bash(npm run vibe:*)` wildcards).

### 9. Tests (`node --import tsx --test`, ~240 LOC)

- `test/daily-log.test.ts`:
  - `appendDailyEvent` creates directory when missing.
  - Two concurrent `appendDailyEvent` calls produce two parseable lines (spawn two child processes, await both, count lines).
  - `readDailyEvents` skips malformed lines and warns.
  - `listAvailableDates` returns descending.
  - Date override param respected (tmp dir).
- `test/dashboard-server.test.ts`:
  - Server boots on a random high port, responds to `/api/state` with expected shape.
  - `/api/daily/:date` rejects `../etc` and `2024-99-99`.
  - Refuses bind `0.0.0.0` (exit non-zero).
  - Auto-port discovery: pre-occupy port `P`, start with `--port P`, expect `P+1`.
  - SSE: open connection, append a daily-log line, expect `state-updated` within 2 s.
  - PID lease: first instance holds PID; second instance with same port exits cleanly with message.
- `test/attention-notify.test.ts`:
  - stdin payload parsed; output line is valid JSON with required fields (`id`, `ts`, `severity`, `source`).
  - Empty stdin still produces a valid minimal event.
  - Exit is always 0 even on write failure (simulate by pointing `rootDir` at a file instead of dir).

All tests must use `tmp` directories (`fs.mkdtemp`) and pass `rootDir`/`VIBE_ROOT` overrides. No test writes inside the real `.vibe/agent/`.

### 10. Documentation

- `docs/release/v1.4.0.md` (new) — short release note draft: dashboard feature, attention pipeline, opt-in. Target: `harnessVersion` bump to `1.4.0` (the final bump happens in a later integration sprint).
- `README.md` — add "Dashboard (optional)" section under features; describe `npm run vibe:dashboard` + enabling autoStart.
- `CLAUDE.md` — append one subsection under "훅 강제 메커니즘" describing the Notification hook path, the daily-log append convention (scripts must fire-and-forget `vibe-daily-log.mjs`), and the new `vibe-attention.mjs` marker.
- **Do not create** a user manual or tutorial `.md`. The in-app banner + README snippet are sufficient.

## Technical spec highlights (Planner-determined, not Generator-guessable)

- **Orchestrator-dashboard isolation contract**: Orchestrator never performs `Read()` on `.vibe/agent/daily/*`, `attention.jsonl`, `dashboard.pid`. Enforced socially by CLAUDE.md note + by the simple rule "no harness script reads these files — they only append." Tested implicitly: preflight script and sprint-complete script must still exit 0 with or without the dashboard dir present.
- **Event schema stability**: `DailyEventType` is a discriminated string union. Adding a new type is a non-breaking change; renaming is breaking and forbidden without a migration.
- **UTC day boundaries**: all date shards use `YYYY-MM-DD` in UTC. Browser also computes UTC date for "today = open by default" to avoid off-by-one across timezones when user works past midnight local.
- **Port 5175**: chosen to sit above Vite's `5173-5174`, below common dev proxies.
- **Zero runtime deps** guaranteed by code review: every `import` in new files must be either (a) `node:*`, (b) a pre-existing project TS file, or (c) a type-only import from existing `src/lib/*`.

## Test strategy

Run order (all via `npm test`):

1. `npx tsc --noEmit` — 0 errors. Must catch any `DashboardConfig` mismerge.
2. `npm test` — full suite passes including new files.
3. Manual sanity:
   - `npm run vibe:dashboard` → open browser, observe populated roadmap pointer.
   - In another terminal: `node scripts/vibe-attention.mjs --severity urgent --title test --detail hello` → toast appears in-page within 2 s, Web Notification pops if permission granted.
   - `npm run vibe:dashboard:stop` → PID file removed, port freed.
   - Set `dashboard.autoStart=true` → restart Claude Code session → `dashboard.pid` appears; `netstat` shows bound only on 127.0.0.1.

## Completion checklist (all mechanically verifiable)

- [ ] `npx tsc --noEmit` — 0 errors.
- [ ] `npm test` — all suites green including `daily-log`, `dashboard-server`, `attention-notify`.
- [ ] `node scripts/vibe-dashboard.mjs --port 45175 --no-open &` then `curl -sf http://127.0.0.1:45175/api/state | node -e 'JSON.parse(require("fs").readFileSync(0))'` — valid JSON shape `{ roadmap, currentSprint, ... }`.
- [ ] `curl -sf http://127.0.0.1:45175/events -H 'Accept: text/event-stream' -m 3` — produces at least one `: ping` or event frame.
- [ ] `node scripts/vibe-dashboard.mjs --host 0.0.0.0` → exits non-zero with "localhost only" message.
- [ ] `node scripts/vibe-attention.mjs --severity urgent --title t --detail d` → a new line appended to `.vibe/agent/attention.jsonl` AND to today's daily shard.
- [ ] `grep '"type":"sprint-started"' .vibe/agent/daily/$(date -u +%F).jsonl` after a `vibe-sprint-commit` run — present.
- [ ] `node scripts/vibe-session-started.mjs` twice back-to-back with `autoStart=true` → only one `vibe-dashboard` process alive (pgrep count = 1 or `tasklist` count = 1 on Windows).
- [ ] `.vibe/config.json` absence of `dashboard` section → all new scripts exit 0 without side effects (feature fully dormant).
- [ ] `npm run vibe:sync --dry-run` (from a downstream project that pins this upstream) → all new files listed as `new-file`.
- [ ] Browser sanity: open `/`, click "Enable notifications", allow, trigger an attention event, see OS-level notification surface outside the browser.

## Out of scope (hard stops — any drift is a rejection)

- Service Worker, Web Push API, VAPID, push subscriptions — **all forbidden**.
- `0.0.0.0` binding or any LAN-exposure flag.
- Authentication / CSRF — localhost-only justifies none; do not add "just in case".
- Approve / deny buttons, form inputs, any POST/PUT/DELETE endpoint.
- Chart libraries, animation libraries, CSS frameworks, icon fonts, Google Fonts, CDN resources.
- Sprint-status write endpoints — state files are Orchestrator-only writes; dashboard is read-only.
- Modifying QA scripts, preflight, checkpoint, stop-qa-gate behaviour.
- Statusline changes (owned by M14-A).
- `harnessVersion` bump past `1.3.1` — release-note draft only.

## Risks

**Primary risk** — Claude Code's `Notification` hook payload schema is not fully documented across versions: the exact JSON shape of stdin may evolve, and on Windows `cmd`-invoked hooks have historically had stdin-piping quirks. Mitigation: `vibe-attention-notify.mjs` treats stdin as best-effort (2-s read, accept empty), stores whatever it receives verbatim under `payload.raw`, and always appends at minimum `{severity:'urgent', source:'claude-code-notification'}`. On stdin parse failure, still emit an event so the user sees "Claude is waiting for you" — the whole point of this Sprint is that a noisy heuristic beats a silent miss. Secondary mitigation: the Orchestrator-invoked `vibe-attention.mjs` path provides a deterministic fallback for LLM-level events independent of Claude Code's internals.

**Secondary risk** — `fs.watch` on Windows bind-mounted filesystems is known to drop events. The 2-s polling fallback is not perfect (it can miss a same-file write-within-2s), but for heads-up purposes it is acceptable. Documented in code.

## Target LOC

~1250 total (server 420, SPA 520, daily-log 90, attention scripts 110, session hook 80, config typedefs 20, manifest/settings/docs 10, tests 240 — production 1010, tests 240). Within Sprint budget.

## Final report format

`_common-rules.md §9` — sprint-report skeleton with: (a) files created/modified, (b) test matrix results, (c) manual sanity confirmations (screenshots not required; `curl` transcripts sufficient), (d) LOC summary `+A/-D (net N)`, (e) risks observed during implementation.

## Deliverable (Planner → user)

Four-sentence summary:

1. **Orchestrator-dashboard isolation**: the dashboard process is the sole reader of state files; Orchestrator scripts only append to `daily/*.jsonl` and `attention.jsonl` via a 1-line CLI shim, so no state ever enters the Opus context window and token cost of running the dashboard is zero.
2. **Attention pipeline end-to-end**: Claude Code's native `Notification` hook pipes to `vibe-attention-notify.mjs`, which writes `attention.jsonl`; the dashboard `fs.watch`es that file and SSE-pushes to the browser, which fires a Web Notification with `requireInteraction=true` and `tag=<uuid>` so repeated prompts dedupe and persist until the user acts.
3. **autoStart lifecycle**: `SessionStart` runs `vibe-session-started.mjs` which PID-leases `.vibe/agent/dashboard.pid` (stale PID auto-reclaimed via `kill(pid,0)`), spawns detached `vibe-dashboard.mjs` only when absent, and a matching `--stop` subcommand provides clean teardown — no zombie processes across session restarts.
4. **Daily accordion frontend-only render**: the browser lazily `fetch`es each date shard on first `<details>` expansion and caches the result in-memory; server returns raw parsed JSONL with a hard 500-event cap and a `truncated` flag, so months of history cost zero bandwidth until actively browsed and the Orchestrator never materialises this data at all.

Risk: Claude Code Notification hook stdin schema stability — see "Risks" section for mitigation.
