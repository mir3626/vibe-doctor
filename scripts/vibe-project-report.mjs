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

function renderIterationTimeline(history) {
  if (history.iterations.length === 0) {
    return '<p class="muted">No iterations recorded yet.</p>';
  }

  return `<div class="timeline">${history.iterations
    .map(
      (entry) => `<details class="step"${entry.id === history.currentIteration ? ' open' : ''}>
        <summary><span>${escapeHtml(entry.label || entry.id)}</span><small>${escapeHtml(entry.completedAt ? 'complete' : 'active')}</small></summary>
        <p>${escapeHtml(entry.goal || 'No goal recorded.')}</p>
        <ul>${entry.plannedSprints.map((sprintId) => `<li>${escapeHtml(sprintId)}</li>`).join('')}</ul>
      </details>`,
    )
    .join('')}</div>`;
}

function renderMilestones(milestones, progress) {
  if (milestones.length === 0) {
    return '<p class="muted">No milestones file found yet.</p>';
  }

  return `<div class="milestones">${milestones
    .map((milestone) => {
      const ratio = Math.max(0, Math.min(1, Number(progress[milestone.id] ?? 0)));
      return `<article class="card">
        <h3>${escapeHtml(milestone.name)}</h3>
        <p>${escapeHtml(milestone.definition || milestone.progressMetric)}</p>
        <div class="bar"><span style="width:${Math.round(ratio * 100)}%"></span></div>
        <small>${Math.round(ratio * 100)}% target ${escapeHtml(milestone.targetIteration)}</small>
      </article>`;
    })
    .join('')}</div>`;
}

function renderSprintCards(status, roadmapDetails, history, metaProject) {
  const plannedCurrent = history.currentIteration
    ? history.iterations.find((entry) => entry.id === history.currentIteration)?.plannedSprints ?? []
    : [];
  const entries = Array.isArray(status?.sprints) ? status.sprints : [];
  const visible = entries
    .filter((entry) => (plannedCurrent.length > 0 ? plannedCurrent.includes(entry.id) : true))
    .filter((entry) => !metaProject || !isMetaSprintId(entry.id));

  if (visible.length === 0) {
    return '<p class="muted">No project sprint outputs to show yet.</p>';
  }

  return `<div class="cards">${visible
    .map((entry) => {
      const detail = roadmapDetails.get(entry.id) ?? { name: entry.name ?? entry.id, goal: 'No goal recorded.' };
      const loc = entry.actualLoc ? `${entry.actualLoc.added}/-${entry.actualLoc.deleted} net ${entry.actualLoc.net}` : 'n/a';
      return `<article class="card sprint-card" data-sprint-id="${escapeHtml(entry.id)}">
        <div class="card-head"><h3>${escapeHtml(entry.id)}</h3><span class="badge">${escapeHtml(entry.status ?? 'unknown')}</span></div>
        <p>${escapeHtml(detail.goal)}</p>
        <dl><dt>Name</dt><dd>${escapeHtml(detail.name)}</dd><dt>LOC</dt><dd>${escapeHtml(loc)}</dd><dt>Completed</dt><dd>${escapeHtml(entry.completedAt ?? 'not completed')}</dd></dl>
      </article>`;
    })
    .join('')}</div>`;
}

function renderDecisions(productMd, decisions, metaSummary) {
  const seed = productMd.includes('Dimension summary')
    ? productMd.slice(productMd.indexOf('Dimension summary')).split(/\r?\n/).slice(0, 8)
    : [];
  const items = [...seed, ...decisions, ...metaSummary].filter(Boolean).slice(0, 16);
  if (items.length === 0) {
    return '<p class="muted">No key decisions recorded yet.</p>';
  }
  return `<ul class="decision-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function renderScriptStatus(packageJson) {
  const scripts = isRecord(packageJson?.scripts) ? packageJson.scripts : {};
  const names = ['test', 'build', 'lint'].filter((name) => typeof scripts[name] === 'string');
  if (names.length === 0) {
    return '<p class="muted">No test, build, or lint scripts are recorded in package.json.</p>';
  }
  return `<ul class="script-list">${names
    .map((name) => `<li><strong>${escapeHtml(name)}</strong><code>${escapeHtml(scripts[name])}</code></li>`)
    .join('')}</ul><p class="muted">Run the commands above for the latest local result.</p>`;
}

function renderNextSteps(status, roadmapIds, history) {
  const passed = new Set((Array.isArray(status?.sprints) ? status.sprints : []).filter((entry) => entry.status === 'passed').map((entry) => entry.id));
  const next = roadmapIds.find((id) => !passed.has(id));
  if (history.currentIteration) {
    return `<p>Continue current iteration: ${escapeHtml(history.currentIteration)}.</p>`;
  }
  if (!next && roadmapIds.length > 0) {
    return '<p>All planned sprints are complete. Use /vibe-iterate to plan the next iteration.</p>';
  }
  if (next) {
    return `<p>Next planned sprint: ${escapeHtml(next)}.</p>`;
  }
  return '<p>Run /vibe-init or /vibe-iterate to create a fresh plan.</p>';
}

function renderHtml(model) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(model.product.name)} report</title>
<style>
:root{color-scheme:light;--ink:#17202a;--muted:#687383;--line:#d9e1ea;--bg:#f6f8fb;--panel:#fff;--accent:#0f766e;--accent-2:#b45309}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.5}
main{max-width:1120px;margin:0 auto;padding:32px 20px 56px}header{padding:20px 0 12px}h1{font-size:40px;line-height:1.1;margin:0 0 8px}h2{font-size:22px;margin:0 0 16px}h3{font-size:16px;margin:0}
.subtitle{font-size:18px;color:var(--muted);max-width:760px}.badge{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:3px 10px;background:#eefaf7;color:var(--accent);font-size:12px;font-weight:700}
section{margin-top:22px;padding:22px 0;border-top:1px solid var(--line)}.meta{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;color:var(--muted);font-size:13px}
.cards,.milestones{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:16px;box-shadow:0 1px 2px rgba(20,30,40,.04)}
.card-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.card p{color:var(--muted)}dl{display:grid;grid-template-columns:92px 1fr;gap:4px;margin:12px 0 0}dt{color:var(--muted)}dd{margin:0}
.timeline{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.step{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px}.step summary{cursor:pointer;display:flex;justify-content:space-between;gap:8px;font-weight:700}.step small{color:var(--accent-2)}
.bar{height:10px;background:#e7edf3;border-radius:999px;overflow:hidden}.bar span{display:block;height:100%;background:var(--accent)}
.decision-list,.script-list{padding-left:20px}.script-list code{display:block;color:var(--muted);margin-top:4px;word-break:break-word}.muted{color:var(--muted)}
@media (max-width:640px){main{padding:22px 14px 40px}h1{font-size:30px}section{padding:18px 0}.cards,.milestones,.timeline{grid-template-columns:1fr}}
</style>
</head>
<body>
<main>
<header>
<h1>${escapeHtml(model.product.name)}</h1>
<p class="subtitle">${escapeHtml(model.product.oneLiner)}</p>
<div class="meta"><span class="badge">${escapeHtml(model.statusLabel)}</span><span>Generated ${escapeHtml(model.generatedAt)}</span><span>Updated ${escapeHtml(model.updatedAt)}</span><span>Platform ${escapeHtml(model.product.platform)}</span></div>
</header>
<section data-section="overview"><h2>Project Overview</h2><p>${escapeHtml(model.product.oneLiner)}</p></section>
<section data-section="iterations"><h2>Iteration Timeline</h2>${renderIterationTimeline(model.iterationHistory)}</section>
<section data-section="milestones"><h2>Milestone Progress</h2>${renderMilestones(model.milestones, model.milestoneProgress)}</section>
<section data-section="sprints"><h2>Sprint Outputs</h2>${renderSprintCards(model.status, model.roadmapDetails, model.iterationHistory, model.metaProject)}</section>
<section data-section="decisions"><h2>Key Decisions</h2>${renderDecisions(model.productMd, model.decisions, model.metaSummary)}</section>
<section data-section="verification"><h2>Test Build Deploy Status</h2>${renderScriptStatus(model.packageJson)}</section>
<section data-section="next-steps"><h2>Next Steps</h2>${renderNextSteps(model.status, model.roadmapIds, model.iterationHistory)}</section>
</main>
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
