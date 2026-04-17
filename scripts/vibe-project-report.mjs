#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn as defaultSpawn } from 'node:child_process';

const META_SPRINT_PATTERNS = [/^sprint-M\d+/, /^self-evolution-/, /^harness-/, /^v\d+\./];
const META_SESSION_TAGS = ['[harness-review]', '[meta-sprint-complete]', '[sprint-complete]'];
const META_COMMIT_PREFIXES = [
  'docs(process)',
  'chore(harness)',
  'refactor(process)',
  'docs(sprint):',
];

function parseArgs(argv) {
  const flags = {
    noOpen: false,
    output: path.join('docs', 'reports', 'project-report.html'),
    verbose: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--no-open') {
      flags.noOpen = true;
      continue;
    }
    if (token === '--verbose') {
      flags.verbose = true;
      continue;
    }
    if (token === '--output') {
      flags.output = argv[index + 1] ?? flags.output;
      index += 1;
    }
  }

  return flags;
}

async function readOptionalText(filePath) {
  if (!existsSync(filePath)) {
    return '';
  }
  return readFile(filePath, 'utf8');
}

async function readOptionalJson(filePath, fallback) {
  if (!existsSync(filePath)) {
    return fallback;
  }
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

function firstNonEmptyLine(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}

function parseProduct(productMd, statusProjectName) {
  const lines = productMd.split(/\r?\n/).map((line) => line.trim());
  const heading = lines.find((line) => line.startsWith('# '));
  const platformLine = lines.find((line) => /^platform\s*:/i.test(line));
  const oneLiner = lines.find((line) => line.length > 0 && !line.startsWith('#') && !/^platform\s*:/i.test(line));

  return {
    name: heading ? heading.replace(/^#\s+/, '') : statusProjectName || 'Project',
    oneLiner: oneLiner ?? 'No project one-liner recorded yet.',
    platform: platformLine ? platformLine.replace(/^platform\s*:\s*/i, '') : 'unspecified',
  };
}

export function isMetaProject(inputs) {
  const config = isRecord(inputs.config) ? inputs.config : {};
  const packageJson = isRecord(inputs.packageJson) ? inputs.packageJson : {};
  const roadmapFirstLine = firstNonEmptyLine(inputs.roadmapMd ?? '') ?? '';

  return (
    (isRecord(config.project) && config.project.kind === 'meta') ||
    packageJson.name === 'vibe-doctor' ||
    /^#\s+vibe-doctor\b/i.test(roadmapFirstLine)
  );
}

function parseRoadmapSprintIds(roadmapMd) {
  const lines = roadmapMd.split(/\r?\n/);
  const ids = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^##\s+Sprint\b/i.test(lines[index] ?? '')) {
      continue;
    }

    for (let offset = 1; offset <= 8; offset += 1) {
      const line = lines[index + offset];
      if (!line || line.startsWith('## ')) {
        break;
      }
      const match = line.match(/^\s*-\s+\*\*id\*\*:\s+`([^`]+)`/i);
      if (match?.[1]) {
        ids.push(match[1]);
        break;
      }
    }
  }

  return ids;
}

function parseRoadmapSprintDetails(roadmapMd) {
  const lines = roadmapMd.split(/\r?\n/);
  const details = new Map();

  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index]?.match(/^##\s+Sprint\s+(.+)$/i);
    if (!heading) {
      continue;
    }

    let id = '';
    let goal = '';
    for (let offset = 1; offset <= 12; offset += 1) {
      const line = lines[index + offset];
      if (!line || line.startsWith('## ')) {
        break;
      }
      const idMatch = line.match(/^\s*-\s+\*\*id\*\*:\s+`([^`]+)`/i);
      if (idMatch?.[1]) {
        id = idMatch[1];
      }
      const goalMatch = line.match(/^\s*-\s+\*\*[^*]*(?:goal|target|objective|[^*]*)\*\*:\s+(.+)$/i);
      if (goal === '' && goalMatch?.[1]) {
        goal = goalMatch[1].replace(/`/g, '').trim();
      }
    }
    if (id !== '') {
      details.set(id, {
        name: heading[1]?.trim() ?? id,
        goal: goal || 'No sprint goal recorded.',
      });
    }
  }

  return details;
}

function parseMilestones(markdown) {
  const lines = markdown.split(/\r?\n/);
  const milestones = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(
      /^-\s+\*\*([^*]+)\*\*\s+[-:]\s+target_iteration=`([^`]+)`,\s+progress_metric=`([^`]+)`/i,
    );
    if (!match?.[1] || !match[2] || !match[3]) {
      continue;
    }

    const definitionLine = lines[index + 1]?.trim().replace(/^-\s+/, '') ?? '';
    milestones.push({
      id: match[1].trim(),
      name: match[1].trim(),
      targetIteration: match[2].trim(),
      progressMetric: match[3].trim(),
      definition: definitionLine,
    });
  }

  return milestones;
}

function computeMilestoneProgressFallback(history, milestones) {
  const progress = {};
  for (const milestone of milestones) {
    if (milestone.progressMetric !== 'sprint_complete_ratio') {
      progress[milestone.id] = 0;
      continue;
    }
    const target = history.iterations.find((entry) => entry.id === milestone.targetIteration);
    progress[milestone.id] =
      target && target.plannedSprints.length > 0
        ? target.completedSprints.length / target.plannedSprints.length
        : 0;
  }
  return progress;
}

async function computeMilestoneProgress(root, history, milestones) {
  try {
    const modulePath = pathToFileURL(path.join(root, 'src', 'lib', 'iteration.ts')).href;
    const mod = await import(modulePath);
    if (typeof mod.computeMilestoneProgress === 'function') {
      return mod.computeMilestoneProgress(history, milestones);
    }
  } catch {
    // Plain node cannot load TypeScript; keep the report CLI build-free.
  }

  return computeMilestoneProgressFallback(history, milestones);
}

function normalizeIterationHistory(value) {
  if (!isRecord(value) || !Array.isArray(value.iterations)) {
    return { currentIteration: null, iterations: [] };
  }
  return {
    currentIteration: typeof value.currentIteration === 'string' ? value.currentIteration : null,
    iterations: value.iterations.filter(isRecord).map((entry) => ({
      id: String(entry.id ?? ''),
      label: String(entry.label ?? entry.id ?? ''),
      goal: String(entry.goal ?? ''),
      startedAt: String(entry.startedAt ?? ''),
      completedAt: typeof entry.completedAt === 'string' ? entry.completedAt : null,
      plannedSprints: Array.isArray(entry.plannedSprints) ? entry.plannedSprints.map(String) : [],
      completedSprints: Array.isArray(entry.completedSprints)
        ? entry.completedSprints.map(String)
        : [],
      milestoneProgress: isRecord(entry.milestoneProgress) ? entry.milestoneProgress : {},
      summary: String(entry.summary ?? ''),
    })),
  };
}

function isMetaSprintId(sprintId) {
  return META_SPRINT_PATTERNS.some((pattern) => pattern.test(sprintId));
}

function filterSessionDecisions(sessionLog, metaProject) {
  return sessionLog
    .split(/\r?\n/)
    .filter((line) => line.includes('[decision]'))
    .filter((line) => !metaProject || !META_SESSION_TAGS.some((tag) => line.includes(tag)))
    .slice(0, 12);
}

function readGitLog(root) {
  try {
    return execFileSync('git', ['log', '--oneline', '-200'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function filterCommits(commits, metaProject) {
  if (!metaProject) {
    return commits;
  }
  return commits.filter((line) => {
    const message = line.replace(/^[a-f0-9]+\s+/, '');
    return !META_COMMIT_PREFIXES.some((prefix) => message.startsWith(prefix));
  });
}

function statusLabel(status, iterationHistory) {
  if (iterationHistory.currentIteration) {
    return `${iterationHistory.currentIteration}-in-progress`;
  }
  return status?.handoff?.currentSprintId && status.handoff.currentSprintId !== 'idle'
    ? 'in-progress'
    : 'idle';
}

const DECISION_FILTERS = [
  'decision',
  'failure',
  'sprint-complete',
  'user-directive',
  'audit',
  'planner-skip',
  'drift-observed',
];

function formatDate(value) {
  if (!value) {
    return 'unknown';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toISOString().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) {
    return 'unknown';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function normalizeStatus(value) {
  const raw = String(value ?? 'idle').toLowerCase();
  if (raw === 'passed' || raw === 'complete' || raw === 'completed' || raw === 'resolved') {
    return 'complete';
  }
  if (raw === 'in-progress' || raw.endsWith('-in-progress') || raw === 'active' || raw === 'running') {
    return 'in-progress';
  }
  if (raw === 'partial' || raw === 'blocked') {
    return 'partial';
  }
  if (raw === 'failed' || raw === 'open' || raw === 'error') {
    return 'failed';
  }
  return 'idle';
}

function renderBadge(label, status = label) {
  return `<span class="status-badge" data-status="${escapeHtml(normalizeStatus(status))}">${escapeHtml(label)}</span>`;
}

function renderSectionHeading(title, context = '') {
  const contextHtml = context ? `<span>${escapeHtml(context)}</span>` : '';
  return `<div class="section-heading"><h2>${escapeHtml(title)}</h2>${contextHtml}</div>`;
}

function sumLoc(sprints) {
  return sprints.reduce(
    (total, entry) => {
      const loc = isRecord(entry.actualLoc) ? entry.actualLoc : {};
      return {
        added: total.added + Number(loc.added ?? 0),
        deleted: total.deleted + Number(loc.deleted ?? 0),
        net: total.net + Number(loc.net ?? 0),
      };
    },
    { added: 0, deleted: 0, net: 0 },
  );
}

function getVisibleSprints(status, history, metaProject) {
  const knownSprints = new Set(history.iterations.flatMap((entry) => entry.plannedSprints));
  const entries = Array.isArray(status?.sprints) ? status.sprints : [];
  return entries
    .filter((entry) => knownSprints.size === 0 || knownSprints.has(entry.id) || entry.status === 'passed')
    .filter((entry) => !metaProject || !isMetaSprintId(entry.id));
}

function renderMetricCards(model) {
  const sprints = Array.isArray(model.status?.sprints) ? model.status.sprints : [];
  const passed = sprints.filter((entry) => entry.status === 'passed' || entry.status === 'complete');
  const loc = sumLoc(sprints);
  const openRisks = Array.isArray(model.status?.pendingRisks)
    ? model.status.pendingRisks.filter((risk) => risk?.status !== 'resolved').length
    : 0;
  const current = model.iterationHistory.currentIteration ?? 'no active iteration';
  const cards = [
    ['TOTAL SPRINTS', String(passed.length), `${sprints.length} recorded`],
    ['TOTAL ITERATIONS', String(model.iterationHistory.iterations.length), current],
    ['TOTAL LOC', `${loc.net >= 0 ? '+' : ''}${loc.net}`, `${loc.added} added / ${loc.deleted} deleted`],
    ['OPEN RISKS', String(openRisks), `${model.status?.sprintsSinceLastAudit ?? 0} sprints since audit`],
  ];

  return `<section class="metric-grid" aria-label="Project metrics">${cards
    .map(
      ([label, value, context]) => `<article class="metric-card">
        <p>${escapeHtml(label)}</p>
        <strong>${escapeHtml(value)}</strong>
        <span>${escapeHtml(context)}</span>
      </article>`,
    )
    .join('')}</section>`;
}

function renderIterationTimeline(history) {
  if (history.iterations.length === 0) {
    return '<p class="empty-state">No iterations recorded yet.</p>';
  }

  return `<ol class="iteration-timeline" aria-label="Iteration timeline">${history.iterations
    .map((entry) => {
      const status = entry.id === history.currentIteration ? 'current' : entry.completedAt ? 'complete' : 'idle';
      const date = entry.completedAt ?? entry.startedAt;
      return `<li class="timeline-item" data-status="${escapeHtml(status)}">
        <button class="timeline-dot" type="button" aria-label="${escapeHtml(`${entry.label || entry.id}: ${entry.goal || 'No goal recorded.'}`)}" title="${escapeHtml(entry.goal || 'No goal recorded.')}"></button>
        <span class="timeline-label">${escapeHtml(entry.id)}</span>
        <span class="timeline-status">${escapeHtml(status === 'current' ? 'current' : status)}</span>
        <time datetime="${escapeHtml(date || '')}">${escapeHtml(formatDate(date))}</time>
      </li>`;
    })
    .join('')}</ol>`;
}

function renderSprintCards(status, roadmapDetails, history, metaProject) {
  const visible = getVisibleSprints(status, history, metaProject);
  if (visible.length === 0) {
    return '<p class="empty-state">No project sprint outputs to show yet.</p>';
  }

  return `<div class="sprint-grid">${visible
    .map((entry) => {
      const detail = roadmapDetails.get(entry.id) ?? { name: entry.name ?? entry.id, goal: 'No goal recorded.' };
      const loc = entry.actualLoc ? `${entry.actualLoc.added}/-${entry.actualLoc.deleted} net ${entry.actualLoc.net}` : 'n/a';
      const hash = typeof entry.commit === 'string' ? entry.commit : typeof entry.commitHash === 'string' ? entry.commitHash : 'n/a';
      return `<article class="sprint-card" data-sprint-id="${escapeHtml(entry.id)}">
        <div class="card-head">
          <h3>${escapeHtml(entry.id)}</h3>
          ${renderBadge(entry.status ?? 'unknown', entry.status)}
        </div>
        <p>${escapeHtml(detail.goal)}</p>
        <dl>
          <dt>LOC delta</dt><dd>${escapeHtml(loc)}</dd>
          <dt>Commit</dt><dd><code>${escapeHtml(hash)}</code></dd>
          <dt>Completed</dt><dd><time datetime="${escapeHtml(entry.completedAt ?? '')}">${escapeHtml(formatDate(entry.completedAt))}</time></dd>
        </dl>
      </article>`;
    })
    .join('')}</div>`;
}

function renderMilestones(milestones, progress) {
  if (milestones.length === 0) {
    return '';
  }

  return `<section id="milestones" data-section="milestones" class="report-section">
    ${renderSectionHeading('Milestone Progress')}
    <div class="milestone-list">${milestones
      .map((milestone) => {
        const ratio = Math.max(0, Math.min(1, Number(progress[milestone.id] ?? 0)));
        const percent = Math.round(ratio * 100);
        const completed = Math.round(ratio * 100);
        return `<article class="milestone-row">
          <div>
            <h3>${escapeHtml(milestone.name)}</h3>
            <p>${escapeHtml(milestone.definition || milestone.progressMetric)}</p>
          </div>
          <div class="progress-wrap" aria-label="${escapeHtml(`${milestone.name} ${percent}% complete`)}">
            <div class="progress-bar"><span style="width:${percent}%"></span></div>
            <span>${escapeHtml(`${completed}/100`)}</span>
          </div>
        </article>`;
      })
      .join('')}</div>
  </section>`;
}

function classifyLogTag(tags) {
  if (tags.includes('planner-skip')) {
    return 'planner-skip';
  }
  if (tags.includes('drift-observed')) {
    return 'drift-observed';
  }
  if (tags.includes('user-directive')) {
    return 'user-directive';
  }
  if (tags.includes('sprint-complete')) {
    return 'sprint-complete';
  }
  if (tags.includes('failure')) {
    return 'failure';
  }
  if (tags.some((tag) => tag === 'audit' || tag === 'audit-clear' || tag === 'harness-review')) {
    return 'audit';
  }
  if (tags.includes('decision')) {
    return 'decision';
  }
  return null;
}

function parseSessionEntry(line) {
  const match = line.match(/^\s*-\s+(\d{4}-\d{2}-\d{2})T([^ ]+)\s+((?:\[[^\]]+\])+)\s*(.*)$/);
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }
  const tags = [...match[3].matchAll(/\[([^\]]+)\]/g)].map((tagMatch) => tagMatch[1]).filter(Boolean);
  const tag = classifyLogTag(tags);
  if (!tag) {
    return null;
  }
  return {
    date: match[1],
    time: match[2].replace(/(?:\.\d{3})?Z$/, '').slice(0, 5),
    tag,
    content: match[4]?.trim() ?? '',
  };
}

function filterSessionEntries(sessionLog, metaProject) {
  return sessionLog
    .split(/\r?\n/)
    .filter((line) => !metaProject || !line.includes('[harness-review]'))
    .map(parseSessionEntry)
    .filter(Boolean)
    .slice(0, 80);
}

function renderDecisionContent(entry) {
  if (entry.content.length >= 150) {
    const summary = `${entry.content.slice(0, 100).trim()}...`;
    return `<details><summary>${escapeHtml(summary)}</summary><p>${escapeHtml(entry.content)}</p></details>`;
  }
  return `<p>${escapeHtml(entry.content)}</p>`;
}

function renderDecisions(productMd, entries, metaSummary) {
  const seed = productMd.includes('Dimension summary')
    ? productMd.slice(productMd.indexOf('Dimension summary')).split(/\r?\n/).slice(0, 8)
    : [];
  const seededEntries = seed
    .filter(Boolean)
    .map((content) => ({ date: 'Project', time: '--:--', tag: 'decision', content }));
  const metaEntries = metaSummary.map((content) => ({ date: 'Meta', time: '--:--', tag: 'decision', content }));
  const items = [...seededEntries, ...entries, ...metaEntries];
  if (items.length === 0) {
    return '<p class="empty-state">No key decisions recorded yet.</p>';
  }

  const groups = new Map();
  for (const item of items) {
    const existing = groups.get(item.date) ?? [];
    existing.push(item);
    groups.set(item.date, existing);
  }

  const chips = ['all', ...DECISION_FILTERS]
    .map((tag) => {
      return `<button class="filter-chip" type="button" data-filter="${escapeHtml(tag)}" aria-pressed="true">${escapeHtml(tag === 'all' ? 'All' : tag)}</button>`;
    })
    .join('');

  return `<div class="decision-tools" aria-label="Decision filters">
      <div class="filter-list" role="group" aria-label="Filter key decisions">${chips}</div>
      <div class="expand-actions">
        <button type="button" data-decision-action="expand">Expand all</button>
        <button type="button" data-decision-action="collapse">Collapse all</button>
      </div>
    </div>
    <div class="decision-groups" data-active-tags="${escapeHtml(DECISION_FILTERS.join(' '))}">${[...groups.entries()]
      .map(
        ([date, group]) => `<section class="decision-date-group" aria-label="${escapeHtml(`Decisions for ${date}`)}">
          <h3>${escapeHtml(date)}</h3>
          ${group
            .map(
              (entry) => `<article class="decision-entry" data-tag="${escapeHtml(entry.tag)}">
                <time>${escapeHtml(entry.time)}</time>
                ${renderBadge(entry.tag, entry.tag === 'failure' ? 'failed' : entry.tag === 'sprint-complete' ? 'complete' : entry.tag)}
                <div>${renderDecisionContent(entry)}</div>
              </article>`,
            )
            .join('')}
        </section>`,
      )
      .join('')}</div>`;
}

function renderScriptStatus(status, packageJson) {
  const scripts = isRecord(packageJson?.scripts) ? packageJson.scripts : {};
  const recorded = Array.isArray(status?.verificationCommands) ? status.verificationCommands : [];
  const rows = recorded
    .filter(isRecord)
    .map((entry) => ({
      name: String(entry.command ?? entry.name ?? 'verification'),
      status: String(entry.status ?? (entry.exit === 0 ? 'passed' : entry.exit) ?? 'recorded'),
      timestamp: String(entry.completedAt ?? entry.updatedAt ?? entry.timestamp ?? 'unknown'),
    }));

  for (const name of ['typecheck', 'test', 'build', 'lint']) {
    if (typeof scripts[name] === 'string' && !rows.some((row) => row.name === name)) {
      rows.push({ name, status: 'idle', timestamp: scripts[name] });
    }
  }

  if (rows.length === 0) {
    return '<p class="empty-state">No verification runs recorded</p>';
  }

  return `<div class="verification-list">${rows
    .map(
      (row) => `<article class="verification-row">
        <code>${escapeHtml(row.name)}</code>
        ${renderBadge(row.status, row.status)}
        <span>${escapeHtml(row.timestamp)}</span>
      </article>`,
    )
    .join('')}</div>`;
}

function renderNextSteps(status, roadmapIds, history) {
  const passed = new Set((Array.isArray(status?.sprints) ? status.sprints : []).filter((entry) => entry.status === 'passed').map((entry) => entry.id));
  const next = roadmapIds.find((id) => !passed.has(id));
  const openRisks = Array.isArray(status?.pendingRisks)
    ? status.pendingRisks.filter((risk) => risk?.status !== 'resolved').length
    : 0;
  const steps = [];
  if (history.currentIteration) {
    steps.push(`Continue ${history.currentIteration} with the next roadmap slot.`);
  }
  if (next) {
    steps.push(`Start ${next}.`);
  } else if (roadmapIds.length > 0) {
    steps.push('Plan the next iteration with /vibe-iterate.');
  }
  if (openRisks > 0) {
    steps.push(`Triage ${openRisks} open risk${openRisks === 1 ? '' : 's'}.`);
  }
  if (steps.length === 0) {
    steps.push('Run /vibe-init or /vibe-iterate to create a fresh plan.');
  }
  return `<ol class="next-steps">${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>`;
}

function renderHtml(model) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(model.product.name)} report</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
<style>
:root{color-scheme:dark;--bg-0:#0a0a0a;--bg-1:#141416;--bg-2:#1c1c1f;--text:#fafafa;--secondary:rgba(250,250,250,0.72);--muted:rgba(250,250,250,0.45);--border:rgba(255,255,255,0.08);--border-strong:rgba(255,255,255,0.16);--accent:#ffffff;--accent-subtle:rgba(255,255,255,0.1);--glass-bg:rgba(255,255,255,0.035);--glass-bg-strong:rgba(255,255,255,0.06);--glass-highlight:inset 0 1px 0 rgba(255,255,255,0.12);--glass-depth:0 20px 60px rgba(0,0,0,0.4),0 8px 24px rgba(0,0,0,0.2);--complete-bg:rgba(163,230,53,0.1);--complete-text:#bef264;--progress-bg:rgba(255,255,255,0.08);--progress-text:#e5e7eb;--partial-bg:rgba(251,191,36,0.08);--partial-text:#fde68a;--failed-bg:rgba(248,113,113,0.1);--failed-text:#fca5a5;--idle-bg:rgba(255,255,255,0.04);--idle-text:rgba(255,255,255,0.5)}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;min-height:100vh;background:radial-gradient(ellipse at top left,rgba(255,255,255,0.04),transparent 60%),radial-gradient(ellipse at bottom right,rgba(255,255,255,0.02),transparent 60%),linear-gradient(180deg,var(--bg-0) 0%,var(--bg-1) 60%,var(--bg-2) 100%);background-attachment:fixed;color:var(--text);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;font-size:15px;line-height:1.65;padding:16px}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline;text-underline-offset:3px}
button{font:inherit;color:inherit;background:transparent;border:0;padding:0;cursor:pointer}
button:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
code,time{font-family:"JetBrains Mono","SF Mono",Menlo,Consolas,monospace;font-size:13px;font-weight:500}
.skip-link{position:absolute;left:32px;top:24px;z-index:20;transform:translateY(-160%);background:var(--glass-bg);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:10px 16px;backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px)}
.skip-link:focus{transform:translateY(0)}
.outer-frame{border:1px solid var(--border);border-radius:24px;padding:24px;min-height:calc(100vh - 32px);background:linear-gradient(180deg,rgba(255,255,255,0.015),transparent);position:relative;overflow:hidden}
.ambient-glow{position:fixed;pointer-events:none;width:520px;height:520px;border-radius:50%;filter:blur(140px);opacity:0.3;z-index:-1}
.ambient-glow.one{top:-180px;left:-140px;background:radial-gradient(circle,rgba(255,255,255,0.14) 0%,transparent 70%)}
.ambient-glow.two{bottom:-180px;right:-140px;background:radial-gradient(circle,rgba(255,255,255,0.08) 0%,transparent 70%)}
.site-nav{position:sticky;top:16px;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:24px;padding:12px 20px;background:var(--glass-bg);border:1px solid var(--border);border-radius:999px;backdrop-filter:blur(32px) saturate(180%);-webkit-backdrop-filter:blur(32px) saturate(180%);box-shadow:var(--glass-highlight),var(--glass-depth);margin-bottom:64px}
.brand{display:flex;align-items:center;gap:12px;font-weight:600}
.brand-name{font-size:13px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:var(--text)}
.orb{width:32px;height:32px;position:relative;border-radius:50%;overflow:hidden;flex-shrink:0;box-shadow:0 0 12px rgba(255,255,255,0.15)}
.orb-core{position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 0deg at 50% 50%,#ff9d6c 0deg,#b26cff 72deg,#7aa2ff 144deg,#2de2e6 216deg,#b26cff 288deg,#ff9d6c 360deg);animation:orb-spin 8s linear infinite;filter:blur(1.5px) saturate(140%)}
.orb-glass{position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle at 30% 28%,rgba(255,255,255,0.85) 0%,rgba(255,255,255,0) 32%),radial-gradient(circle at 72% 72%,rgba(0,0,0,0.55) 0%,transparent 55%);mix-blend-mode:overlay}
.orb::after{content:"";position:absolute;inset:0;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.28),inset 0 -2px 6px rgba(0,0,0,0.4),inset 0 2px 4px rgba(255,255,255,0.3);pointer-events:none}
@keyframes orb-spin{to{transform:rotate(360deg)}}
.nav-anchors{display:flex;gap:2px;list-style:none;margin:0;padding:0}
.nav-anchors a{display:inline-block;padding:6px 14px;font-size:13px;color:var(--secondary);border-radius:999px;transition:background .2s ease,color .2s ease}
.nav-anchors a:hover{color:var(--text);background:var(--accent-subtle);text-decoration:none}
.nav-meta{display:flex;align-items:center;gap:12px;font-size:12px;color:var(--muted);font-family:"JetBrains Mono","SF Mono",Menlo,Consolas,monospace}
.container{max-width:1200px;margin:0 auto;padding:0 8px}
.hero{padding:48px 0 64px;max-width:860px}
.eyebrow{font-size:11px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:var(--muted);margin:0 0 16px}
h1{font-size:56px;line-height:1.05;font-weight:600;letter-spacing:-0.02em;margin:0 0 20px;color:var(--text)}
h2{font-size:28px;line-height:1.2;font-weight:600;letter-spacing:-0.01em;color:var(--text);margin:0}
h3{font-size:16px;line-height:1.4;font-weight:600;color:var(--text);margin:0}
.subtitle{font-size:17px;line-height:1.55;color:var(--secondary);margin:0 0 24px;max-width:720px}
.meta-row{display:flex;flex-wrap:wrap;gap:24px;font-size:13px;color:var(--muted);font-family:"JetBrains Mono","SF Mono",Menlo,Consolas,monospace}
main.container{padding-top:0;padding-bottom:0}
.report-section{margin-top:80px}
.section-heading{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:24px}
.section-heading span{color:var(--muted);font-size:13px;font-weight:500}
.metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px}
.metric-card,.sprint-card,.milestone-row,.verification-row,.decision-groups{background:var(--glass-bg);border:1px solid var(--border);border-radius:16px;backdrop-filter:blur(28px) saturate(180%);-webkit-backdrop-filter:blur(28px) saturate(180%);box-shadow:var(--glass-highlight),0 8px 24px rgba(0,0,0,0.25)}
.metric-card{padding:24px;transition:transform .2s ease,border-color .2s ease;position:relative;overflow:hidden}
.metric-card:hover{transform:translateY(-2px);border-color:var(--border-strong)}
.metric-card p{font-size:11px;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);margin:0 0 16px}
.metric-card strong{display:block;font-size:44px;line-height:1;font-weight:600;font-variant-numeric:tabular-nums;color:var(--text);margin-bottom:12px;letter-spacing:-0.02em}
.metric-card span{color:var(--secondary);font-size:13px;font-weight:500}
.iteration-timeline{position:relative;display:flex;gap:32px;list-style:none;margin:0;padding:24px 0 0;overflow-x:auto}
.iteration-timeline::before{content:"";position:absolute;left:0;right:0;top:31px;border-top:1px solid var(--border-strong)}
.timeline-item{position:relative;min-width:160px;padding-top:32px}
.timeline-dot{position:absolute;top:5px;left:0;width:16px;height:16px;border-radius:50%;border:2px solid var(--border-strong);background:var(--bg-1);box-shadow:0 0 0 4px var(--bg-1)}
.timeline-item[data-status="current"] .timeline-dot{background:var(--accent);border-color:var(--accent);box-shadow:0 0 0 4px var(--bg-1),0 0 14px rgba(255,255,255,0.5)}
.timeline-item[data-status="complete"] .timeline-dot{background:var(--text);border-color:var(--text)}
.timeline-label{display:block;font-weight:600;color:var(--text);line-height:1.35;margin-bottom:4px}
.timeline-status,.timeline-item time{display:block;color:var(--muted);font-size:13px;font-family:"JetBrains Mono","SF Mono",Menlo,Consolas,monospace}
.sprint-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}
.sprint-card{padding:24px;transition:transform .2s ease,border-color .2s ease}
.sprint-card:hover{transform:translateY(-2px);border-color:var(--border-strong)}
.card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px}
.card-head h3{font-family:"JetBrains Mono","SF Mono",Menlo,Consolas,monospace;font-size:12px;font-weight:500;letter-spacing:0;word-break:break-word;color:var(--text)}
.sprint-card>p{color:var(--secondary);margin:0 0 20px;font-size:14px}
dl{display:grid;grid-template-columns:100px minmax(0,1fr);gap:8px 12px;margin:0;padding-top:16px;border-top:1px solid var(--border)}
dt{color:var(--muted);font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.06em}
dd{margin:0;min-width:0;word-break:break-word;color:var(--secondary);font-size:13px;font-family:"JetBrains Mono","SF Mono",Menlo,Consolas,monospace}
.status-badge{display:inline-flex;align-items:center;border-radius:999px;padding:4px 10px;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;white-space:nowrap;border:1px solid transparent}
.status-badge[data-status="complete"]{background:var(--complete-bg);color:var(--complete-text);border-color:rgba(163,230,53,0.3)}
.status-badge[data-status="in-progress"]{background:var(--progress-bg);color:var(--progress-text);border-color:rgba(255,255,255,0.2)}
.status-badge[data-status="partial"]{background:var(--partial-bg);color:var(--partial-text);border-color:rgba(251,191,36,0.3)}
.status-badge[data-status="failed"]{background:var(--failed-bg);color:var(--failed-text);border-color:rgba(248,113,113,0.3)}
.status-badge[data-status="idle"]{background:var(--idle-bg);color:var(--idle-text);border-color:var(--border)}
.milestone-list{display:grid;gap:16px}
.milestone-row{display:grid;grid-template-columns:minmax(0,1fr) 240px;gap:24px;align-items:center;padding:20px 24px}
.milestone-row p{color:var(--secondary);margin:8px 0 0;font-size:14px}
.progress-wrap{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;color:var(--secondary);font-size:13px;font-family:"JetBrains Mono","SF Mono",Menlo,Consolas,monospace}
.progress-bar{height:6px;border-radius:3px;overflow:hidden;background:rgba(255,255,255,0.08);border:0}
.progress-bar span{display:block;height:100%;background:linear-gradient(90deg,rgba(255,255,255,0.9),rgba(255,255,255,0.5))}
.decision-tools{display:flex;justify-content:space-between;gap:16px;align-items:flex-end;margin-bottom:24px;flex-wrap:wrap}
.filter-list,.expand-actions{display:flex;gap:8px;flex-wrap:wrap}
.filter-chip{padding:6px 14px;border-radius:999px;color:var(--muted);font-size:12px;font-weight:500;background:transparent;border:1px solid var(--border);transition:all .2s ease}
.filter-chip[aria-pressed="true"]{color:var(--text);background:var(--accent-subtle);border-color:var(--border-strong)}
.filter-chip:hover{color:var(--text);border-color:var(--border-strong)}
.expand-actions button{color:var(--muted);font-size:12px;font-weight:500;padding:6px 12px;border-radius:6px;transition:color .2s ease}
.expand-actions button:hover{color:var(--text)}
.decision-groups{padding:24px 28px}
.decision-date-group{margin-top:32px}
.decision-date-group:first-child{margin-top:0}
.decision-date-group>h3{position:sticky;top:92px;background:rgba(20,20,22,0.75);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--border);color:var(--muted);font-size:12px;font-family:"JetBrains Mono","SF Mono",Menlo,Consolas,monospace;font-weight:500;padding:10px 0;margin-bottom:12px;letter-spacing:0.06em}
.decision-entry{display:none;grid-template-columns:56px auto minmax(0,1fr);gap:14px;align-items:start;padding:14px 0;border-bottom:1px solid var(--border)}
.decision-entry:last-child{border-bottom:0}
.decision-entry time{color:var(--muted);font-size:12px}
.decision-entry p{margin:0;color:var(--text);font-size:14px;line-height:1.6}
.decision-entry summary{cursor:pointer;color:var(--text)}
.decision-entry details p{margin-top:8px;color:var(--secondary)}
[data-active-tags~="decision"] .decision-entry[data-tag="decision"],[data-active-tags~="failure"] .decision-entry[data-tag="failure"],[data-active-tags~="sprint-complete"] .decision-entry[data-tag="sprint-complete"],[data-active-tags~="user-directive"] .decision-entry[data-tag="user-directive"],[data-active-tags~="audit"] .decision-entry[data-tag="audit"],[data-active-tags~="planner-skip"] .decision-entry[data-tag="planner-skip"],[data-active-tags~="drift-observed"] .decision-entry[data-tag="drift-observed"]{display:grid}
.verification-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}
.verification-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:18px 20px}
.verification-row span{grid-column:1/-1;color:var(--muted);font-size:12px;word-break:break-word;font-family:"JetBrains Mono","SF Mono",Menlo,Consolas,monospace}
.next-steps{margin:0;padding-left:24px;color:var(--text)}
.next-steps li{font-size:15px;line-height:1.6;margin-bottom:12px}
.next-steps li::marker{color:var(--text);font-weight:600}
.empty-state{color:var(--muted);margin:0;font-style:italic}
.site-footer{border-top:1px solid var(--border);color:var(--muted);font-size:12px;font-family:"JetBrains Mono","SF Mono",Menlo,Consolas,monospace;padding:32px 0 16px;margin-top:80px;text-align:center}
@media (max-width:1024px){h1{font-size:44px}.nav-anchors{display:none}}
@media (max-width:640px){body{padding:8px}.outer-frame{padding:12px;border-radius:16px}.site-nav{padding:10px 14px;border-radius:20px;flex-wrap:wrap;gap:12px;margin-bottom:48px}.nav-meta{display:none}h1{font-size:32px}.hero{padding:32px 0 48px}.report-section{margin-top:48px}.section-heading,.decision-tools{display:block}.filter-list,.expand-actions{margin-top:16px}.milestone-row{grid-template-columns:1fr}.decision-entry{grid-template-columns:1fr;gap:8px}.decision-date-group>h3{top:80px}.metric-card strong{font-size:36px}.subtitle{font-size:15px}}
@media print{body{background:#fff;color:#000;padding:0}.outer-frame{border:0;padding:0;background:none;backdrop-filter:none}.ambient-glow{display:none}.site-nav{position:static;margin-bottom:32px;border:1px solid #ccc;background:#fff;box-shadow:none;backdrop-filter:none;color:#000}.nav-anchors,.nav-meta,.skip-link,.decision-tools,.orb{display:none}.brand-name{color:#000}.metric-card,.sprint-card,.milestone-row,.verification-row,.decision-groups{background:#fff;border:1px solid #ccc;box-shadow:none;backdrop-filter:none;color:#000}.metric-card p,.metric-card span,.sprint-card>p,dt,dd,.eyebrow,.subtitle,.meta-row,.timeline-status,.timeline-item time,.next-steps li,.decision-entry p{color:#000}h1,h2,h3{color:#000}.report-section{break-inside:avoid;margin-top:32px}details:not([open])>summary{margin-bottom:8px}details:not([open])>:not(summary){display:block}.site-footer::after{content:" / " counter(page)}a::after{content:" (" attr(href) ")";color:#666;font-size:90%}}
</style>
</head>
<body>
<a class="skip-link" href="#content">Skip to content</a>
<div class="ambient-glow one" aria-hidden="true"></div>
<div class="ambient-glow two" aria-hidden="true"></div>
<div class="outer-frame">
<nav class="site-nav" aria-label="Report navigation">
  <div class="brand">
    <div class="orb" aria-hidden="true">
      <div class="orb-core"></div>
      <div class="orb-glass"></div>
    </div>
    <span class="brand-name">Vibe doctor</span>
  </div>
  <ul class="nav-anchors">
    <li><a href="#iterations">Iterations</a></li>
    <li><a href="#sprints">Sprints</a></li>
    <li><a href="#decisions">Decisions</a></li>
    <li><a href="#verification">Verification</a></li>
  </ul>
  <div class="nav-meta">
    <span>${escapeHtml(model.iterationHistory.currentIteration ?? 'idle')}</span>
    <span>·</span>
    <span>${escapeHtml(formatDate(model.generatedAt))}</span>
  </div>
</nav>
<main id="content" class="container">
<section class="hero">
  <p class="eyebrow">Project Report</p>
  <h1>${escapeHtml(model.product.name)}</h1>
  <p class="subtitle">${escapeHtml(model.product.oneLiner)}</p>
  <div class="meta-row" aria-label="Report metadata">
    <span>Generated ${escapeHtml(formatDateTime(model.generatedAt))}</span>
    <span>Platform: ${escapeHtml(model.product.platform)}</span>
    <span>Status: ${renderBadge(model.statusLabel, model.statusLabel)}</span>
  </div>
</section>
${renderMetricCards(model)}
<section id="iterations" data-section="iterations" class="report-section">${renderSectionHeading('Iteration Timeline')}${renderIterationTimeline(model.iterationHistory)}</section>
<section id="sprints" data-section="sprints" class="report-section">${renderSectionHeading('Sprint Outputs', `${getVisibleSprints(model.status, model.iterationHistory, model.metaProject).length} sprints across ${model.iterationHistory.iterations.length} iterations`)}${renderSprintCards(model.status, model.roadmapDetails, model.iterationHistory, model.metaProject)}</section>
${renderMilestones(model.milestones, model.milestoneProgress)}
<section id="decisions" data-section="decisions" class="report-section">${renderSectionHeading('Key Decisions', `${model.reportEntries.length} entries`)}${renderDecisions(model.productMd, model.reportEntries, model.metaSummary)}</section>
<section id="verification" data-section="verification" class="report-section">${renderSectionHeading('Verification Status')}${renderScriptStatus(model.status, model.packageJson)}</section>
<section id="next-steps" data-section="next-steps" class="report-section">${renderSectionHeading('Next Steps')}${renderNextSteps(model.status, model.roadmapIds, model.iterationHistory)}</section>
</main>
<footer class="site-footer">
  <div class="container">Generated by vibe-doctor ${escapeHtml(model.packageJson?.harnessVersion ?? model.packageJson?.version ?? 'unknown')} · ${escapeHtml(formatDateTime(model.generatedAt))}</div>
</footer>
</div>
<script>
(() => {
  const groups = document.querySelector('.decision-groups');
  if (!groups) return;
  const filters = Array.from(document.querySelectorAll('[data-filter]'));
  const tags = ${JSON.stringify(DECISION_FILTERS)};
  const sync = (active) => {
    const next = active.length === 0 ? tags : active;
    groups.dataset.activeTags = next.join(' ');
    for (const button of filters) {
      const filter = button.dataset.filter;
      button.setAttribute('aria-pressed', filter === 'all' ? String(next.length === tags.length) : String(next.includes(filter)));
    }
  };
  for (const button of filters) {
    button.addEventListener('click', () => {
      if (button.dataset.filter === 'all') {
        sync(tags);
        return;
      }
      const current = new Set((groups.dataset.activeTags || '').split(/\\s+/).filter(Boolean));
      if (current.has(button.dataset.filter)) current.delete(button.dataset.filter);
      else current.add(button.dataset.filter);
      sync(Array.from(current).filter((tag) => tags.includes(tag)));
    });
  }
  for (const button of document.querySelectorAll('[data-decision-action]')) {
    button.addEventListener('click', () => {
      const open = button.dataset.decisionAction === 'expand';
      document.querySelectorAll('#decisions details').forEach((node) => {
        node.open = open;
      });
    });
  }
})();
</script>
</body>
</html>
`;
}

async function buildModel(root) {
  const [
    productMd,
    roadmapMd,
    milestonesMd,
    status,
    sessionLog,
    handoff,
    iterationHistoryRaw,
    config,
    packageJson,
  ] = await Promise.all([
    readOptionalText(path.join(root, 'docs', 'context', 'product.md')),
    readOptionalText(path.join(root, 'docs', 'plans', 'sprint-roadmap.md')),
    readOptionalText(path.join(root, 'docs', 'plans', 'project-milestones.md')),
    readOptionalJson(path.join(root, '.vibe', 'agent', 'sprint-status.json'), {}),
    readOptionalText(path.join(root, '.vibe', 'agent', 'session-log.md')),
    readOptionalText(path.join(root, '.vibe', 'agent', 'handoff.md')),
    readOptionalJson(path.join(root, '.vibe', 'agent', 'iteration-history.json'), {
      currentIteration: null,
      iterations: [],
    }),
    readOptionalJson(path.join(root, '.vibe', 'config.json'), {}),
    readOptionalJson(path.join(root, 'package.json'), {}),
  ]);
  const iterationHistory = normalizeIterationHistory(iterationHistoryRaw);
  const milestones = parseMilestones(milestonesMd);
  const metaProject = isMetaProject({ config, packageJson, roadmapMd });
  const commits = filterCommits(readGitLog(root), metaProject);
  const excludedCommits = readGitLog(root).length - commits.length;
  const decisions = filterSessionDecisions(sessionLog, metaProject);
  const reportEntries = filterSessionEntries(sessionLog, metaProject);
  const metaSummary = metaProject
    ? (Array.isArray(status?.sprints) ? status.sprints : [])
        .filter((entry) => isMetaSprintId(entry.id))
        .slice(-6)
        .map((entry) => `Meta sprint ${entry.id}: ${entry.status}`)
    : [];

  return {
    productMd,
    product: parseProduct(productMd, status?.project?.name),
    status,
    sessionLog,
    handoff,
    iterationHistory,
    milestones,
    milestoneProgress: await computeMilestoneProgress(root, iterationHistory, milestones),
    roadmapIds: parseRoadmapSprintIds(roadmapMd),
    roadmapDetails: parseRoadmapSprintDetails(roadmapMd),
    packageJson,
    metaProject,
    decisions,
    reportEntries,
    metaSummary,
    commits,
    statusLabel: statusLabel(status, iterationHistory),
    generatedAt: new Date().toISOString(),
    updatedAt: String(status?.stateUpdatedAt ?? status?.handoff?.updatedAt ?? 'unknown'),
    filterStats: {
      excludedSprints: (Array.isArray(status?.sprints) ? status.sprints : []).filter((entry) => metaProject && isMetaSprintId(entry.id)).length,
      excludedCommits,
    },
  };
}

function openReport(outPath, spawnFn, platform) {
  const argsByPlatform =
    platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', outPath]]
      : platform === 'darwin'
        ? ['open', [outPath]]
        : ['xdg-open', [outPath]];
  const child = spawnFn(argsByPlatform[0], argsByPlatform[1], {
    detached: true,
    stdio: 'ignore',
  });
  if (typeof child?.unref === 'function') {
    child.unref();
  }
}

export async function runProjectReportCli(argv = process.argv.slice(2), options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const flags = parseArgs(argv);
  const outPath = path.resolve(root, flags.output);
  const model = await buildModel(root);
  const html = renderHtml(model);

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, html, 'utf8');

  if (flags.verbose) {
    const stderr = options.stderr ?? process.stderr;
    stderr.write(
      `meta-project=${model.metaProject ? 'true' : 'false'}, excluded sprints=${model.filterStats.excludedSprints}, excluded commits=${model.filterStats.excludedCommits}\n`,
    );
  }

  if (!flags.noOpen) {
    try {
      openReport(outPath, options.spawn ?? defaultSpawn, options.platform ?? process.platform);
    } catch (error) {
      const stderr = options.stderr ?? process.stderr;
      const message = error instanceof Error ? error.message : String(error);
      stderr.write(`Warning: could not open project report: ${message}\n`);
    }
  }

  const stdout = options.stdout ?? process.stdout;
  stdout.write(`${outPath}\n`);
  return { outPath, html, model };
}

const entryHref = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === entryHref) {
  runProjectReportCli().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
