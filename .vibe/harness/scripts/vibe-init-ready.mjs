#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const TEMPLATE_CONTEXT_PATTERN =
  /PROJECT NOT INITIALIZED|vibe-doctor template|^\s*#\s+vibe-doctor\b|\*\*vibe-doctor\*\*/im;
const ROADMAP_PLACEHOLDER_PATTERN =
  /아직 프로젝트 Sprint 로드맵이 작성되지 않았다|PROJECT NOT INITIALIZED|vibe-doctor template/im;

function parseArgs(argv) {
  const options = { root: process.cwd(), json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--root') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--root requires a path');
      }
      options.root = path.resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function readText(root, relativePath) {
  const filePath = path.join(root, relativePath);
  if (!existsSync(filePath)) {
    return null;
  }
  return readFileSync(filePath, 'utf8');
}

function readJson(root, relativePath) {
  const text = readText(root, relativePath);
  if (text === null) {
    return { exists: false, value: null, error: null };
  }
  try {
    return { exists: true, value: JSON.parse(text), error: null };
  } catch (error) {
    return { exists: true, value: null, error };
  }
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasSprintRole(value) {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  return isObject(value) && typeof value.provider === 'string' && value.provider.trim().length > 0;
}

function hasMeaningfulMarkdown(text, pattern = TEMPLATE_CONTEXT_PATTERN) {
  return typeof text === 'string' && text.trim().length > 20 && !pattern.test(text);
}

function hasInterviewLog(root) {
  const dir = path.join(root, '.vibe', 'interview-log');
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return false;
  }
  return readdirSync(dir).some((entry) => entry.endsWith('.json'));
}

function isGitRepo(root) {
  try {
    const output = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
    return output === 'true';
  } catch {
    return false;
  }
}

function add(records, id, ok, detail, level = 'error') {
  records.push({ id, ok, level, detail });
}

function audit(root) {
  const records = [];

  const configLocal = readJson(root, '.vibe/config.local.json');
  if (!configLocal.exists) {
    add(records, 'config.local', false, 'missing .vibe/config.local.json');
  } else if (configLocal.error) {
    add(records, 'config.local', false, `.vibe/config.local.json is invalid JSON: ${configLocal.error.message}`);
  } else {
    const roles = isObject(configLocal.value) && isObject(configLocal.value.sprintRoles)
      ? configLocal.value.sprintRoles
      : null;
    const missingRoles = ['planner', 'generator', 'evaluator'].filter((role) => !hasSprintRole(roles?.[role]));
    add(
      records,
      'config.local',
      missingRoles.length === 0,
      missingRoles.length === 0
        ? '.vibe/config.local.json has planner/generator/evaluator sprintRoles'
        : `.vibe/config.local.json missing sprintRoles: ${missingRoles.join(', ')}`,
    );
  }

  const status = readJson(root, '.vibe/agent/sprint-status.json');
  if (!status.exists) {
    add(records, 'sprint-status', false, 'missing .vibe/agent/sprint-status.json');
  } else if (status.error) {
    add(records, 'sprint-status', false, `.vibe/agent/sprint-status.json is invalid JSON: ${status.error.message}`);
  } else {
    const projectName = isObject(status.value) && isObject(status.value.project)
      ? String(status.value.project.name ?? '').trim()
      : '';
    add(
      records,
      'sprint-status',
      projectName.length > 0 && projectName.toLowerCase() !== 'vibe-doctor',
      projectName.length > 0 && projectName.toLowerCase() !== 'vibe-doctor'
        ? `.vibe/agent/sprint-status.json project.name=${projectName}`
        : '.vibe/agent/sprint-status.json project.name is missing or still vibe-doctor',
    );
  }

  const product = readText(root, 'docs/context/product.md');
  add(
    records,
    'context.product',
    hasMeaningfulMarkdown(product ?? '') && /BEGIN:PROJECT:review-signals/.test(product ?? ''),
    product === null
      ? 'missing docs/context/product.md'
      : hasMeaningfulMarkdown(product) && /BEGIN:PROJECT:review-signals/.test(product)
        ? 'docs/context/product.md is project-owned and has review signals'
        : 'docs/context/product.md is missing project-owned content or BEGIN:PROJECT:review-signals',
  );

  for (const [id, relativePath] of [
    ['context.architecture', 'docs/context/architecture.md'],
    ['context.conventions', 'docs/context/conventions.md'],
  ]) {
    const content = readText(root, relativePath);
    add(
      records,
      id,
      hasMeaningfulMarkdown(content ?? ''),
      content === null
        ? `missing ${relativePath}`
        : hasMeaningfulMarkdown(content)
          ? `${relativePath} is project-owned`
          : `${relativePath} is empty or still template-owned`,
    );
  }

  const roadmap = readText(root, 'docs/plans/sprint-roadmap.md');
  const hasRoadmapSprint = /(?:^|\n)##\s+Sprint\s+M\d\b|sprint-M\d/i.test(roadmap ?? '');
  add(
    records,
    'roadmap',
    hasMeaningfulMarkdown(roadmap ?? '', ROADMAP_PLACEHOLDER_PATTERN) && hasRoadmapSprint,
    roadmap === null
      ? 'missing docs/plans/sprint-roadmap.md'
      : hasMeaningfulMarkdown(roadmap, ROADMAP_PLACEHOLDER_PATTERN) && hasRoadmapSprint
        ? 'docs/plans/sprint-roadmap.md has at least one project sprint'
        : 'docs/plans/sprint-roadmap.md is placeholder or has no Sprint M* entry',
  );

  const sessionLog = readText(root, '.vibe/agent/session-log.md');
  add(
    records,
    'session-log.roadmap',
    /\[decision]\[sprint-roadmap-drafted]/.test(sessionLog ?? ''),
    sessionLog === null
      ? 'missing .vibe/agent/session-log.md'
      : /\[decision]\[sprint-roadmap-drafted]/.test(sessionLog)
        ? 'session-log recorded [decision][sprint-roadmap-drafted]'
        : 'session-log missing [decision][sprint-roadmap-drafted]',
  );

  add(
    records,
    'interview-log',
    hasInterviewLog(root),
    hasInterviewLog(root)
      ? '.vibe/interview-log contains at least one JSON transcript'
      : 'missing .vibe/interview-log/*.json from Phase 3',
  );

  add(
    records,
    'git.repository',
    isGitRepo(root),
    isGitRepo(root)
      ? 'git repository is initialized'
      : 'not inside a git worktree; run Phase 4 Step 4-0 before Sprint/MVP work',
  );

  return records;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const records = audit(options.root);
  const ok = records.every((record) => record.ok || record.level !== 'error');

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ok, records }, null, 2)}\n`);
  } else if (ok) {
    process.stdout.write('[vibe-init-ready] OK: initialization artifacts are ready for Sprint/MVP work\n');
  } else {
    process.stdout.write('[vibe-init-ready] FAIL: initialization is not ready for Sprint/MVP work\n');
    for (const record of records.filter((entry) => !entry.ok && entry.level === 'error')) {
      process.stdout.write(`- ${record.id}: ${record.detail}\n`);
    }
  }

  if (!ok) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
