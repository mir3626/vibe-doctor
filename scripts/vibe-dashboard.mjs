#!/usr/bin/env node

import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, statSync, watch as fsWatch } from 'node:fs';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const DEFAULT_PORT = 5175;
const DEFAULT_HOST = '127.0.0.1';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAILY_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
const WATCH_DEBOUNCE_MS = 150;
const POLL_MS = 2_000;
const HEARTBEAT_MS = 20_000;

function rootDir() {
  return process.env.VIBE_ROOT ? path.resolve(process.env.VIBE_ROOT) : process.cwd();
}

function agentDir(root) {
  return path.join(root, '.vibe', 'agent');
}

function pidPath(root) {
  return path.join(agentDir(root), 'dashboard.pid');
}

function parseArgs(argv) {
  const flags = {
    port: null,
    host: null,
    noOpen: false,
    detach: false,
    stop: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--port') {
      flags.port = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--host') {
      flags.host = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === '--no-open') {
      flags.noOpen = true;
      continue;
    }
    if (token === '--detach') {
      flags.detach = true;
      continue;
    }
    if (token === '--stop') {
      flags.stop = true;
    }
  }
  return flags;
}

async function readOptionalText(filePath, fallback = '') {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return fallback;
  }
}

async function readOptionalJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function utcDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function isValidDateShard(date) {
  if (!DATE_RE.test(date)) {
    return false;
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function readPidText(text) {
  const pid = Number(text.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

async function readPid(root) {
  try {
    return readPidText(await readFile(pidPath(root), 'utf8'));
  } catch {
    return null;
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopDashboard(root) {
  const pid = await readPid(root);
  if (!pid) {
    process.stdout.write('dashboard not running\n');
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // stale pid is still cleaned below
  }
  await unlink(pidPath(root)).catch(() => {});
  process.stdout.write(`dashboard stopped pid=${pid}\n`);
}

function openBrowser(url, spawnFn = spawn, platform = process.platform) {
  const argsByPlatform =
    platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url]]
      : platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  const child = spawnFn(argsByPlatform[0], argsByPlatform[1], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

async function resolveConfig(root) {
  const config = await readOptionalJson(path.join(root, '.vibe', 'config.json'), {});
  return isRecord(config?.dashboard) ? config.dashboard : {};
}

async function resolveHostPort(root, flags) {
  const dashboard = await resolveConfig(root);
  const host = flags.host ?? (typeof dashboard.host === 'string' ? dashboard.host : DEFAULT_HOST);
  const configPort = Number(dashboard.port);
  const port = flags.port ?? (Number.isInteger(configPort) ? configPort : DEFAULT_PORT);
  return { host, port };
}

function parseRoadmapPointer(roadmapMd) {
  const marker = roadmapMd.match(
    /<!-- BEGIN:VIBE:CURRENT-SPRINT -->[\s\S]*?Current\*\*:\s*([^\s(]+)[\s\S]*?<!-- END:VIBE:CURRENT-SPRINT -->/,
  );
  return marker?.[1] ?? null;
}

function parseRoadmapSprintIds(roadmapMd) {
  const ids = [];
  const directMatches = roadmapMd.matchAll(/-\s+\*\*id\*\*:\s+`([^`]+)`/g);
  for (const match of directMatches) {
    if (match[1]) {
      ids.push(match[1]);
    }
  }
  if (ids.length > 0) {
    return [...new Set(ids)];
  }
  return [...roadmapMd.matchAll(/\b(sprint-[A-Za-z0-9_.-]+|M\d+[A-Za-z0-9_.-]*)\b/g)]
    .map((match) => match[1])
    .filter(Boolean);
}

function sprintState(sprintId, status, currentSprintId) {
  const entry = Array.isArray(status?.sprints)
    ? status.sprints.find((sprint) => sprint?.id === sprintId)
    : null;
  if (entry?.status === 'passed' || entry?.status === 'failed') {
    return entry.status;
  }
  if (entry?.status === 'in_progress' || sprintId === currentSprintId) {
    return 'in-progress';
  }
  return 'pending';
}

function parsePhases(productMd, handoffMd) {
  const haystack = `${productMd}\n${handoffMd}`.toLowerCase();
  return ['0', '1', '2', '3', '4'].map((phase) => {
    const complete = haystack.includes(`phase ${phase}`) && /complete|completed|sealed|done|idle/.test(haystack);
    const active = haystack.includes(`phase ${phase}`) && !complete;
    return {
      id: `Phase ${phase}`,
      state: complete ? 'complete' : active ? 'active' : 'pending',
    };
  });
}

async function listAvailableDates(root) {
  try {
    return (await readdir(path.join(agentDir(root), 'daily')))
      .map((entry) => entry.match(DAILY_FILE_RE)?.[1])
      .filter(Boolean)
      .sort((left, right) => right.localeCompare(left));
  } catch {
    return [];
  }
}

function parseJsonl(raw) {
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function readDaily(root, date, limit = 500) {
  const raw = await readFile(path.join(agentDir(root), 'daily', `${date}.jsonl`), 'utf8');
  const events = parseJsonl(raw);
  const truncated = events.length > limit;
  return { date, events: events.slice(-limit), truncated };
}

async function readAttention(root, sinceIso = null) {
  const raw = await readOptionalText(path.join(agentDir(root), 'attention.jsonl'), '');
  const since = sinceIso ? Date.parse(sinceIso) : Date.now() - 24 * 60 * 60 * 1_000;
  return parseJsonl(raw).filter((event) => {
    const ts = Date.parse(String(event?.ts ?? ''));
    return Number.isFinite(ts) && ts >= since;
  });
}

function latestTestResult(todayEvents) {
  const latest = [...todayEvents]
    .reverse()
    .find((event) => event?.type === 'test-failed' || event?.type === 'sprint-completed');
  if (!latest) {
    return null;
  }
  return {
    type: latest.type,
    ts: latest.ts,
    summary: summarizeEvent(latest),
  };
}

function summarizeEvent(event) {
  const payload = isRecord(event?.payload) ? event.payload : {};
  if (typeof payload.summary === 'string') {
    return payload.summary;
  }
  if (typeof payload.detail === 'string') {
    return payload.detail;
  }
  if (typeof payload.title === 'string') {
    return payload.title;
  }
  if (typeof payload.sprintId === 'string') {
    return `${payload.sprintId} ${payload.status ?? ''}`.trim();
  }
  if (typeof payload.phase === 'string') {
    return `${payload.phase} ${payload.ambiguity ?? ''}`.trim();
  }
  if (typeof event?.type === 'string') {
    return event.type;
  }
  return 'event';
}

async function buildState(root) {
  const [
    sprintStatus,
    handoffMd,
    iteration,
    tokens,
    roadmapMd,
    productMd,
    todayEventsResult,
  ] = await Promise.all([
    readOptionalJson(path.join(agentDir(root), 'sprint-status.json'), {}),
    readOptionalText(path.join(agentDir(root), 'handoff.md'), ''),
    readOptionalJson(path.join(agentDir(root), 'iteration-history.json'), {
      currentIteration: null,
      iterations: [],
    }),
    readOptionalJson(path.join(agentDir(root), 'tokens.json'), {}),
    readOptionalText(path.join(root, 'docs', 'plans', 'sprint-roadmap.md'), ''),
    readOptionalText(path.join(root, 'docs', 'context', 'product.md'), ''),
    readDaily(root, utcDate(), 50).catch(() => ({ date: utcDate(), events: [], truncated: false })),
  ]);
  const currentSprint =
    sprintStatus?.handoff?.currentSprintId ??
    parseRoadmapPointer(roadmapMd) ??
    'idle';
  const roadmapIds = parseRoadmapSprintIds(roadmapMd);
  const sprintIds =
    roadmapIds.length > 0
      ? roadmapIds
      : Array.isArray(sprintStatus?.sprints)
        ? sprintStatus.sprints.map((entry) => entry.id).filter(Boolean)
        : [];
  const sprintNodes = sprintIds.map((id) => ({
    id,
    state: sprintState(id, sprintStatus, currentSprint),
  }));
  const risks = Array.isArray(sprintStatus?.pendingRisks)
    ? sprintStatus.pendingRisks.filter((risk) => risk?.status === 'open')
    : [];
  return {
    roadmap: {
      current: currentSprint,
      phases: parsePhases(productMd, handoffMd),
      sprints: sprintNodes,
    },
    currentSprint: {
      id: currentSprint,
      status:
        Array.isArray(sprintStatus?.sprints)
          ? sprintStatus.sprints.find((entry) => entry?.id === currentSprint)?.status ?? 'idle'
          : 'idle',
      startedAt:
        Array.isArray(sprintStatus?.sprints)
          ? sprintStatus.sprints.find((entry) => entry?.id === currentSprint)?.startedAt ?? null
          : null,
    },
    iteration,
    todayEvents: todayEventsResult.events,
    risks,
    tokens,
    latestTest: latestTestResult(todayEventsResult.events),
    updatedAt: new Date().toISOString(),
  };
}

function jsonResponse(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

function textResponse(response, status, value, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
  });
  response.end(value);
}

function sseSend(response, event, data) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

class DashboardEvents {
  constructor(root) {
    this.root = root;
    this.clients = new Set();
    this.watchers = [];
    this.pollTimer = null;
    this.debounce = new Map();
    this.statCache = new Map();
    this.attentionOffset = 0;
  }

  async init() {
    const attentionPath = path.join(agentDir(this.root), 'attention.jsonl');
    if (existsSync(attentionPath)) {
      this.attentionOffset = statSync(attentionPath).size;
    }
    await mkdir(path.join(agentDir(this.root), 'daily'), { recursive: true }).catch(() => {});
    this.setupWatchers();
  }

  addClient(response) {
    this.clients.add(response);
    response.write(': ping\n\n');
    const timer = setInterval(() => {
      response.write(': ping\n\n');
    }, HEARTBEAT_MS);
    response.on('close', () => {
      clearInterval(timer);
      this.clients.delete(response);
    });
  }

  emitState(files) {
    for (const client of this.clients) {
      sseSend(client, 'state-updated', { files });
    }
  }

  emitAttention(event) {
    for (const client of this.clients) {
      sseSend(client, 'attention', event);
    }
  }

  schedule(file) {
    clearTimeout(this.debounce.get(file));
    const timer = setTimeout(() => {
      this.debounce.delete(file);
      this.emitState([file]);
      if (file.endsWith('attention.jsonl')) {
        this.emitNewAttention().catch((error) => {
          process.stderr.write(`dashboard attention watch failed: ${error.message}\n`);
        });
      }
    }, WATCH_DEBOUNCE_MS);
    this.debounce.set(file, timer);
  }

  setupWatchers() {
    const targets = [
      agentDir(this.root),
      path.join(agentDir(this.root), 'sprint-status.json'),
      path.join(agentDir(this.root), 'handoff.md'),
      path.join(agentDir(this.root), 'iteration-history.json'),
      path.join(agentDir(this.root), 'tokens.json'),
      path.join(agentDir(this.root), 'attention.jsonl'),
      path.join(agentDir(this.root), 'daily'),
      path.join(this.root, 'docs', 'plans', 'sprint-roadmap.md'),
    ];
    try {
      for (const target of targets) {
        if (!existsSync(target)) {
          continue;
        }
        const watcher = fsWatch(target, () => {
          if (target === agentDir(this.root)) {
            this.schedule('attention.jsonl');
            return;
          }
          this.schedule(path.relative(agentDir(this.root), target).replace(/\\/g, '/'));
        });
        watcher.on('error', () => this.setupPolling(targets));
        this.watchers.push(watcher);
      }
      if (this.watchers.length === 0) {
        this.setupPolling(targets);
      }
    } catch {
      this.setupPolling(targets);
    }
  }

  setupPolling(targets) {
    if (this.pollTimer) {
      return;
    }
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
    this.pollTimer = setInterval(async () => {
      for (const target of targets) {
        try {
          const current = await stat(target);
          const key = target;
          const previous = this.statCache.get(key);
          const label =
            target === agentDir(this.root)
              ? 'attention.jsonl'
              : path.relative(agentDir(this.root), target).replace(/\\/g, '/');
          if (previous !== undefined && previous !== current.mtimeMs) {
            this.schedule(label);
          } else if (
            previous === undefined &&
            target.endsWith('attention.jsonl') &&
            current.size > this.attentionOffset
          ) {
            this.schedule(label);
          }
          this.statCache.set(key, current.mtimeMs);
        } catch {
          // Missing files are normal before the first sprint event.
        }
      }
    }, POLL_MS);
  }

  async emitNewAttention() {
    const filePath = path.join(agentDir(this.root), 'attention.jsonl');
    const raw = await readOptionalText(filePath, '');
    const next = raw.slice(this.attentionOffset);
    this.attentionOffset = Buffer.byteLength(raw, 'utf8');
    for (const event of parseJsonl(next)) {
      this.emitAttention(event);
    }
  }

  close() {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
    for (const client of this.clients) {
      client.write('retry: 0\n\n');
      client.end();
    }
    this.clients.clear();
  }
}

async function handleRequest(root, events, request, response) {
  if (request.method !== 'GET') {
    textResponse(response, 405, 'method not allowed');
    return;
  }
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/') {
    textResponse(response, 200, renderShellHtml(), 'text/html; charset=utf-8');
    return;
  }
  if (url.pathname === '/icon.svg') {
    textResponse(response, 200, renderIconSvg(), 'image/svg+xml; charset=utf-8');
    return;
  }
  if (url.pathname === '/api/state') {
    jsonResponse(response, 200, await buildState(root));
    return;
  }
  if (url.pathname === '/api/daily-index') {
    jsonResponse(response, 200, { dates: await listAvailableDates(root) });
    return;
  }
  if (url.pathname.startsWith('/api/daily/')) {
    const date = decodeURIComponent(url.pathname.slice('/api/daily/'.length));
    if (!isValidDateShard(date)) {
      jsonResponse(response, 400, { error: 'invalid date' });
      return;
    }
    try {
      jsonResponse(response, 200, await readDaily(root, date, 500));
    } catch (error) {
      if (error?.code === 'ENOENT') {
        jsonResponse(response, 404, { error: 'daily log not found' });
        return;
      }
      throw error;
    }
    return;
  }
  if (url.pathname === '/api/attention') {
    jsonResponse(response, 200, { events: await readAttention(root, url.searchParams.get('since')) });
    return;
  }
  if (url.pathname === '/events') {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    events.addClient(response);
    return;
  }
  jsonResponse(response, 404, { error: 'not found' });
}

async function listenWithPortDiscovery(server, host, requestedPort) {
  for (let offset = 0; offset <= 10; offset += 1) {
    const port = requestedPort + offset;
    const result = await new Promise((resolve) => {
      const onError = (error) => {
        server.off('listening', onListening);
        resolve({ ok: false, error });
      };
      const onListening = () => {
        server.off('error', onError);
        resolve({ ok: true, port });
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
    if (result.ok) {
      return result.port;
    }
    if (result.error?.code !== 'EADDRINUSE') {
      throw result.error;
    }
  }
  throw new Error(`port unavailable: ${requestedPort}..${requestedPort + 10}`);
}

export async function runDashboard(argv = process.argv.slice(2), options = {}) {
  const root = path.resolve(options.root ?? rootDir());
  const flags = parseArgs(argv);
  const { host, port } = await resolveHostPort(root, flags);
  if (host !== '127.0.0.1' && host !== 'localhost') {
    process.stderr.write('localhost only: dashboard refuses non-localhost bind addresses\n');
    return 1;
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    process.stderr.write(`invalid port: ${port}\n`);
    return 1;
  }
  if (flags.stop) {
    await stopDashboard(root);
    return 0;
  }

  const existingPid = await readPid(root);
  if (existingPid && existingPid !== process.pid && processAlive(existingPid)) {
    process.stdout.write(`dashboard already running at http://127.0.0.1:${port}\n`);
    return 0;
  }
  if (existingPid && existingPid !== process.pid) {
    await unlink(pidPath(root)).catch(() => {});
  }

  if (flags.detach) {
    const childArgs = process.argv
      .slice(1)
      .filter((arg) => arg !== '--detach');
    const child = spawn(process.execPath, childArgs, {
      cwd: root,
      env: { ...process.env, VIBE_ROOT: root },
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    if (child.pid) {
      await mkdir(agentDir(root), { recursive: true });
      await writeFile(pidPath(root), `${child.pid}\n`, 'utf8');
    }
    process.stdout.write(`dashboard starting pid=${child.pid ?? 'unknown'}\n`);
    return 0;
  }

  const sse = new DashboardEvents(root);
  await sse.init();
  const server = http.createServer((request, response) => {
    handleRequest(root, sse, request, response).catch((error) => {
      jsonResponse(response, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });
  const actualPort = await listenWithPortDiscovery(server, host, port);
  await mkdir(agentDir(root), { recursive: true });
  await writeFile(pidPath(root), `${process.pid}\n`, 'utf8');

  const url = `http://127.0.0.1:${actualPort}`;
  process.stdout.write(`${url}\n`);
  if (!flags.noOpen) {
    try {
      openBrowser(url);
    } catch (error) {
      process.stderr.write(`Warning: could not open dashboard: ${error.message}\n`);
    }
  }

  const shutdown = () => {
    sse.close();
    server.close(() => {
      unlink(pidPath(root)).catch(() => {}).finally(() => process.exit(0));
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return 0;
}

function renderIconSvg() {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#111827"/><path d="M16 34h11l5-16 6 28 5-12h5" fill="none" stroke="#2dd4bf" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function renderShellHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vibe Dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
<style>
:root{color-scheme:light;--text:#1c1c1e;--secondary:rgba(60,60,67,0.82);--muted:rgba(60,60,67,0.58);--border:rgba(60,60,67,0.14);--border-strong:rgba(60,60,67,0.22);--accent:#007aff;--glass-bg:rgba(255,255,255,0.72);--glass-highlight:inset 0 1px 0 rgba(255,255,255,0.85),inset 0 -1px 0 rgba(0,0,0,0.03);--glass-depth:0 1px 2px rgba(60,60,67,0.06),0 4px 14px rgba(60,60,67,0.08),0 18px 40px rgba(60,60,67,0.06);--ok-bg:rgba(52,199,89,0.18);--ok-text:#1f7a36;--info-bg:rgba(0,122,255,0.16);--info-text:#0057b3;--warn-bg:rgba(255,149,0,0.2);--warn-text:#aa5c00;--bad-bg:rgba(255,59,48,0.18);--bad-text:#a9211b;--neutral-bg:rgba(120,120,128,0.16);--neutral-text:rgba(60,60,67,0.72)}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:linear-gradient(180deg,#edeae3 0%,#e6e2db 60%,#deded6 100%);background-attachment:fixed;color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display",Inter,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.55;font-variant-numeric:tabular-nums}
button{font:inherit;color:inherit;cursor:pointer}
button:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
.mono{font-family:"JetBrains Mono","SF Mono",Menlo,Consolas,monospace;font-size:12px;font-weight:500}
.muted{color:var(--muted)}
.top{position:fixed;top:16px;left:24px;right:calc(16px + 276px);z-index:3;padding:14px 22px;border:1px solid var(--border);border-radius:20px;backdrop-filter:blur(60px) saturate(100%);-webkit-backdrop-filter:blur(60px) saturate(100%);box-shadow:inset 0 1px 0 rgba(255,255,255,0.85),var(--glass-depth)}
.top-head{display:flex;justify-content:space-between;gap:18px;align-items:center}
.top h1{font-size:16px;font-weight:600;letter-spacing:0.04em;margin:0;background:linear-gradient(120deg,#f5f5f7 0%,#8e8e93 25%,#3a3a3c 50%,#8e8e93 75%,#f5f5f7 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
.strip{display:flex;gap:8px;align-items:center;overflow-x:auto;padding:10px 0 2px}
.node{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;border:1px solid var(--border);border-radius:999px;padding:5px 11px;background:rgba(255,255,255,0.55);font-size:12px;font-weight:500;color:var(--secondary);box-shadow:inset 0 1px 0 rgba(255,255,255,0.7)}
.node.complete{background:linear-gradient(135deg,rgba(52,199,89,0.28),rgba(52,199,89,0.14));border-color:rgba(52,199,89,0.42);color:var(--ok-text)}
.node.active,.node.in-progress{background:linear-gradient(135deg,rgba(0,122,255,0.26),rgba(0,122,255,0.12));border-color:rgba(0,122,255,0.38);color:var(--info-text)}
.node.failed{background:linear-gradient(135deg,rgba(255,59,48,0.28),rgba(255,59,48,0.14));border-color:rgba(255,59,48,0.42);color:var(--bad-text)}
.node.pending{color:var(--muted)}
.dot{width:8px;height:8px;border-radius:999px;background:currentColor;display:inline-block}
.pulse{animation:pulse 1.5s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
main{padding:140px calc(16px + 276px) 40px 24px;max-width:100vw}
.day{margin-bottom:16px;border:1px solid var(--border);background:var(--glass-bg);border-radius:18px;box-shadow:var(--glass-highlight),var(--glass-depth);overflow:hidden}
.day>summary{cursor:pointer;padding:14px 20px;font-weight:700;color:var(--text);list-style:none;font-family:"JetBrains Mono","SF Mono",Menlo,Consolas,monospace;font-size:13px;letter-spacing:0.06em}
.day>summary::-webkit-details-marker{display:none}
.day[open]>summary{border-bottom:1px solid var(--border)}
.timeline{padding:4px 0}
.event{display:grid;grid-template-columns:92px 150px minmax(0,1fr);gap:14px;padding:10px 20px;align-items:start}
.event+.event{border-top:1px solid var(--border)}
.event .mono{color:var(--muted)}
.event.muted{color:var(--muted);grid-template-columns:1fr;font-style:italic}
.chip{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:3px 10px;font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;border:1px solid transparent;box-shadow:inset 0 1px 0 rgba(255,255,255,0.55),0 1px 2px rgba(0,0,0,0.04);width:100%}
.chip.ok{background:linear-gradient(135deg,rgba(52,199,89,0.28),rgba(52,199,89,0.14));color:var(--ok-text);border-color:rgba(52,199,89,0.42)}
.chip.bad{background:linear-gradient(135deg,rgba(255,59,48,0.28),rgba(255,59,48,0.14));color:var(--bad-text);border-color:rgba(255,59,48,0.42)}
.chip.info{background:linear-gradient(135deg,rgba(0,122,255,0.26),rgba(0,122,255,0.12));color:var(--info-text);border-color:rgba(0,122,255,0.38)}
.chip.warn{background:linear-gradient(135deg,rgba(255,149,0,0.3),rgba(255,149,0,0.14));color:var(--warn-text);border-color:rgba(255,149,0,0.42)}
.chip.neutral{background:linear-gradient(135deg,rgba(120,120,128,0.22),rgba(120,120,128,0.1));color:var(--neutral-text);border-color:rgba(120,120,128,0.28)}
aside{position:fixed;right:16px;top:16px;width:260px;max-height:calc(100vh - 32px);padding:22px;border:1px solid var(--border);border-radius:20px;background:var(--glass-bg);backdrop-filter:blur(24px) saturate(160%);-webkit-backdrop-filter:blur(24px) saturate(160%);box-shadow:var(--glass-highlight),var(--glass-depth);overflow-y:auto}
.side-title{font-size:11px;text-transform:uppercase;letter-spacing:0.12em;color:var(--muted);margin:18px 0 10px;font-weight:600}
.side-title:first-of-type{margin-top:14px}
.metric{border-top:1px solid var(--border);padding:12px 0}
.metric strong{display:block;font-size:22px;font-weight:600;color:var(--text);letter-spacing:-0.01em}
.metric span{color:var(--secondary);font-size:13px}
.iter-card strong{font-size:15px;font-weight:600;letter-spacing:0}
.iter-card .iter-id{display:inline-block;font-family:"JetBrains Mono","SF Mono",Menlo,Consolas,monospace;font-size:11px;font-weight:600;color:var(--accent);letter-spacing:0.04em;margin-bottom:2px}
.iter-goal{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin-top:6px;font-size:12px;line-height:1.45;color:var(--secondary)}
.iter-progress{margin-top:10px;display:flex;flex-direction:column;gap:5px}
.iter-bar{height:5px;border-radius:999px;background:rgba(60,60,67,0.1);overflow:hidden}
.iter-bar-fill{height:100%;background:linear-gradient(90deg,#34c759 0%,#007aff 100%);border-radius:999px;transition:width .3s ease;box-shadow:0 0 8px rgba(0,122,255,0.24)}
.iter-progress-label{font-size:11px;color:var(--muted);display:flex;justify-content:space-between;font-family:"JetBrains Mono","SF Mono",Menlo,Consolas,monospace}
.risk-button{width:100%;text-align:left;background:rgba(255,255,255,0.55);border:1px solid var(--border);border-radius:12px;padding:11px 14px;box-shadow:inset 0 1px 0 rgba(255,255,255,0.7);transition:background .2s ease,border-color .2s ease}
.risk-button strong{font-size:18px;font-weight:600;color:var(--text)}
.risk-button:hover{background:rgba(255,255,255,0.8);border-color:var(--border-strong)}
.conn{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--secondary)}
.conn .dot{background:#34c759}
.conn.reconnecting .dot{background:#ff9500}
.conn.dead .dot{background:#ff3b30}
.banner{display:none;margin:12px 0;padding:12px 14px;border:1px solid rgba(0,122,255,0.28);background:linear-gradient(135deg,rgba(0,122,255,0.14),rgba(0,122,255,0.06));border-radius:12px;box-shadow:inset 0 1px 0 rgba(255,255,255,0.7)}
.banner.show{display:flex;justify-content:space-between;gap:12px;align-items:center}
.banner button,.modal button{border:1px solid var(--border);background:rgba(255,255,255,0.75);border-radius:999px;padding:7px 14px;font-size:12px;font-weight:500;box-shadow:inset 0 1px 0 rgba(255,255,255,0.8),0 1px 2px rgba(0,0,0,0.05);color:var(--text);transition:background .2s ease}
.banner button:hover,.modal button:hover{background:rgba(255,255,255,0.95)}
.toasts{position:fixed;right:300px;bottom:20px;display:grid;gap:10px;z-index:4}
.toast{width:300px;background:rgba(28,28,30,0.86);color:#fff;border:1px solid rgba(255,255,255,0.12);border-radius:14px;padding:12px 14px;box-shadow:0 10px 28px rgba(0,0,0,0.25);backdrop-filter:blur(20px);animation:fade 8s forwards;font-size:13px}
.toast strong{font-weight:600}
@keyframes fade{0%,85%{opacity:1}100%{opacity:0}}
.modal{position:fixed;inset:0;background:rgba(18,18,20,0.42);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:none;align-items:center;justify-content:center;padding:20px;z-index:5}
.modal.open{display:flex}
.modal-card{background:var(--glass-bg);border:1px solid var(--border);border-radius:18px;max-width:620px;width:100%;padding:24px;box-shadow:var(--glass-highlight),0 20px 56px rgba(0,0,0,0.18)}
.modal-card h2{font-size:18px;font-weight:600;margin:0 0 12px;color:var(--text)}
#riskList p{margin:8px 0;font-size:13px;color:var(--secondary)}
#riskList strong{color:var(--text);font-weight:600}
@media(max-width:980px){.top{left:16px;right:16px}aside{position:static;width:auto;max-height:none;margin:16px;margin-top:140px}main{padding:140px 24px 40px;margin-top:0}.toasts{right:16px;bottom:16px}}
@media(max-width:640px){.top{padding:12px 16px;border-radius:16px}.top h1{font-size:14px}main{padding:130px 16px 32px}.event{grid-template-columns:1fr;gap:6px}.event .chip{width:auto;align-self:start}}
</style>
</head>
<body>
<header class="top"><div class="top-head"><h1>Vibe Dashboard</h1><span class="muted">Last activity <span id="updated" class="mono">...</span></span></div><div id="phaseStrip" class="strip"></div><div id="sprintStrip" class="strip"></div><div id="permissionBanner" class="banner"><span>Enable desktop notifications for urgent attention requests.</span><button id="enableNotifications">Enable notifications</button></div></header>
<main><section id="days"></section></main>
<aside><div class="conn" id="conn"><span class="dot"></span><span>connected</span></div><div class="side-title">Iteration</div><div class="metric iter-card"><span id="iterId" class="iter-id"></span><strong id="iterLabel">No active iteration</strong><span id="iterGoal" class="iter-goal"></span><div class="iter-progress"><div class="iter-bar"><div class="iter-bar-fill" id="iterBarFill" style="width:0%"></div></div><div class="iter-progress-label"><span id="iterProgressText">—</span><span id="iterPercent">0%</span></div></div></div><div class="side-title">Current Sprint</div><div class="metric"><strong id="sprintId">idle</strong><span id="sprintStatus" class="muted">idle</span></div><div class="side-title">Open Risks</div><button class="risk-button" id="riskButton"><strong id="riskCount">0</strong><span class="muted"> pending</span></button><div class="side-title">Tokens Today</div><div class="metric"><strong id="tokens">n/a</strong></div><div class="side-title">Latest Test</div><div class="metric"><strong id="latestTest">n/a</strong><span id="latestTestDetail" class="muted"></span></div></aside>
<div class="toasts" id="toasts"></div><div class="modal" id="riskModal"><div class="modal-card"><h2>Open pending risks</h2><div id="riskList"></div><button id="closeRisks">Close</button></div></div>
<script>
const cache = new Map();
let state = null;
let retries = 0;
let lastPing = Date.now();
const today = new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const $ = (id) => document.getElementById(id);
function chipClass(type){if(type.startsWith('sprint-completed'))return'ok';if(type.startsWith('sprint-failed')||type==='test-failed'||type.startsWith('attention'))return'bad';if(type.startsWith('phase'))return'info';if(type.startsWith('pending-risk'))return'warn';return'neutral'}
function summary(evt){const p=evt.payload||{};return p.summary||p.detail||p.title||(p.sprintId?String(p.sprintId)+' '+(p.status||''):evt.type)}
function timePart(ts){const d=new Date(ts);return Number.isFinite(d.getTime())?d.toISOString().slice(11,19):''}
function renderNode(node){const active=node.state==='in-progress'||node.state==='active';const mark=node.state==='passed'||node.state==='complete'?'check':node.state==='failed'?'x':'dot';return '<span class="node '+node.state+'"><span class="dot '+(active?'pulse':'')+'"></span>'+escapeHtml(mark)+' '+escapeHtml(node.id)+'</span>'}
function escapeHtml(v){return String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;")}
async function fetchJson(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(url+' '+r.status);return r.json()}
function renderIteration(iter){const cur=iter?.currentIteration;const entry=cur&&Array.isArray(iter?.iterations)?iter.iterations.find((e)=>e&&e.id===cur):null;if(!entry){$('iterId').textContent='';$('iterLabel').textContent='No active iteration';$('iterGoal').textContent='';$('iterProgressText').textContent='—';$('iterPercent').textContent='0%';$('iterBarFill').style.width='0%';return}const done=Array.isArray(entry.completedSprints)?entry.completedSprints.length:0;const total=Array.isArray(entry.plannedSprints)?entry.plannedSprints.length:0;const pct=total?Math.round((done/total)*100):0;$('iterId').textContent=entry.id;$('iterLabel').textContent=entry.label||entry.id;$('iterGoal').textContent=entry.goal||'';$('iterProgressText').textContent=done+' / '+total+' sprints';$('iterPercent').textContent=pct+'%';$('iterBarFill').style.width=pct+'%'}
function renderState(next){state=next;$('updated').textContent=next.updatedAt;$('phaseStrip').innerHTML=next.roadmap.phases.map(renderNode).join('');$('sprintStrip').innerHTML=next.roadmap.sprints.map((node)=>{const iter=next.iteration?.currentIteration&&node.id===next.currentSprint.id?'<span class="mono">'+escapeHtml(next.iteration.currentIteration)+'</span> ':'';return iter+renderNode(node)}).join('');$('sprintId').textContent=next.currentSprint.id;$('sprintStatus').textContent=next.currentSprint.status;$('riskCount').textContent=String(next.risks.length);$('tokens').textContent=String(next.tokens?.todayTotal??next.tokens?.total??'n/a');$('latestTest').textContent=next.latestTest?.type??'n/a';$('latestTestDetail').textContent=next.latestTest?.summary??'';renderIteration(next.iteration);renderRisks(next.risks)}
function renderRisks(risks){$('riskList').innerHTML=risks.length===0?'<p class="muted">No open risks.</p>':risks.map((risk)=>'<p><strong>'+escapeHtml(risk.id)+'</strong><br>'+escapeHtml(risk.text||'')+'</p>').join('')}
async function renderDays(){const data=await fetchJson('/api/daily-index');const dates=data.dates.length?data.dates:[today];$('days').innerHTML=dates.map((date)=>'<details class="day" data-date="'+date+'" '+(date===today?'open':'')+'><summary>'+date+'</summary><div class="timeline" data-body="'+date+'"></div></details>').join('');for(const detail of document.querySelectorAll('details.day')){detail.addEventListener('toggle',()=>{if(detail.open)loadDate(detail.dataset.date)});if(detail.open)loadDate(detail.dataset.date)}}
async function loadDate(date){if(!date)return;const body=document.querySelector('[data-body="'+date+'"]');if(!body)return;if(cache.has(date)){body.innerHTML=cache.get(date);return}body.innerHTML='<div class="event muted">loading</div>';try{const data=await fetchJson('/api/daily/'+date);const html=data.events.map((evt)=>'<div class="event"><span class="mono">'+escapeHtml(timePart(evt.ts))+'</span><span><span class="chip '+chipClass(evt.type)+'">'+escapeHtml(evt.type)+'</span></span><span>'+escapeHtml(summary(evt))+'</span></div>').join('')||'<div class="event muted">No events.</div>';cache.set(date,html);body.innerHTML=html}catch{body.innerHTML='<div class="event muted">No events.</div>'}}
async function refresh(){const next=await fetchJson('/api/state');renderState(next);cache.delete(today);await loadDate(today)}
function pushToast(evt){const el=document.createElement('div');el.className='toast';el.innerHTML='<strong>'+escapeHtml(evt.title||'Attention')+'</strong><br>'+escapeHtml(evt.detail||'Attention requested');$('toasts').prepend(el);setTimeout(()=>el.remove(),8200);while($('toasts').children.length>5){$('toasts').lastElementChild.remove()}}
function handleAttention(evt){if(window.Notification&&Notification.permission==='granted'){const note=new Notification(evt.title||'User attention required',{body:evt.detail||'',icon:'/icon.svg',tag:evt.id,requireInteraction:evt.severity==='urgent'});note.onclick=()=>window.focus()}else{pushToast(evt)}}
function connect(){const es=new EventSource('/events');es.onopen=()=>{retries=0;lastPing=Date.now();$('conn').className='conn';$('conn').lastElementChild.textContent='connected'};es.addEventListener('state-updated',()=>{lastPing=Date.now();refresh().catch(console.error)});es.addEventListener('attention',(ev)=>{lastPing=Date.now();handleAttention(JSON.parse(ev.data))});es.onerror=()=>{es.close();retries+=1;$('conn').className='conn '+(retries>3?'dead':'reconnecting');$('conn').lastElementChild.textContent=retries>3?'disconnected':'reconnecting';setTimeout(connect,Math.min(10000,500*retries))};setInterval(()=>{if(es.readyState===1){lastPing=Date.now()}else if(Date.now()-lastPing>40000){$('conn').className='conn reconnecting'}},30000)}
async function boot(){if('Notification'in window&&Notification.permission==='default'){$('permissionBanner').classList.add('show')}$('enableNotifications').onclick=()=>window.Notification&&Notification.requestPermission().then(()=>$('permissionBanner').classList.remove('show'));$('riskButton').onclick=()=>$('riskModal').classList.add('open');$('closeRisks').onclick=()=>$('riskModal').classList.remove('open');await refresh();await renderDays();connect()}
boot().catch((error)=>{document.body.innerHTML='<pre>'+escapeHtml(error.message)+'</pre>'});
</script>
</body>
</html>`;
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) {
  runDashboard().then((code) => {
    if (code !== 0) {
      process.exit(code);
    }
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
