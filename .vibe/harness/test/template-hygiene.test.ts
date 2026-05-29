import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

// These assertions guard the UPSTREAM template (vibe-doctor) shipping in a pristine "PROJECT NOT
// INITIALIZED" state. In an initialized DOWNSTREAM project the docs/state are real content by design,
// so the suite would always (falsely) fail — skip it there. The pristine marker in handoff.md is the
// authoritative "this is the uninitialized template" signal (project.name stays 'vibe-doctor' even
// downstream, so it can't be used for this).
const isPristineTemplate = ((): boolean => {
  try {
    return readFileSync(path.join(process.cwd(), '.vibe', 'agent', 'handoff.md'), 'utf8').includes('PROJECT NOT INITIALIZED');
  } catch {
    return false;
  }
})();
// Only the pristine-state assertions are template-repo-only; the dashboard/report structure check is a
// generic harness-integrity test that stays valid (and useful) downstream.
const templateOnly = isPristineTemplate ? it : it.skip;

async function listFiles(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isFile()) {
      files.push(entry.name);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

describe('template project-owned hygiene', () => {
  templateOnly('does not ship stale project prompts, reports, plans, or archived sprint prompts', async () => {
    assert.deepEqual(await listFiles(path.join(process.cwd(), 'docs', 'prompts')), ['.gitkeep']);
    assert.deepEqual(await listFiles(path.join(process.cwd(), 'docs', 'reports')), ['.gitkeep']);
    assert.deepEqual(await listFiles(path.join(process.cwd(), '.vibe', 'archive', 'prompts')), ['.gitkeep']);
    assert.deepEqual(await listFiles(path.join(process.cwd(), 'docs', 'plans')), ['.gitkeep', 'sprint-roadmap.md']);
  });

  templateOnly('keeps project context shards in explicit not-initialized template form', async () => {
    const shards = await Promise.all(
      ['product.md', 'architecture.md', 'conventions.md', 'qa.md', 'secrets.md', 'tokens.md'].map((fileName) =>
        readFile(path.join(process.cwd(), 'docs', 'context', fileName), 'utf8'),
      ),
    );

    for (const content of shards) {
      assert.match(content, /PROJECT NOT INITIALIZED/);
      assert.doesNotMatch(content, /dogfood\d+/i);
      assert.doesNotMatch(content, /sprint-M\d/i);
    }

    const conventions = shards[2] ?? '';
    assert.doesNotMatch(conventions, /TypeScript \(Node\.js\)/);
    assert.doesNotMatch(conventions, /Vitest/);
  });

  templateOnly('keeps checked-in project runtime state empty and explicitly template-owned', async () => {
    const [handoff, sessionLog, sprintStatusRaw] = await Promise.all([
      readFile(path.join(process.cwd(), '.vibe', 'agent', 'handoff.md'), 'utf8'),
      readFile(path.join(process.cwd(), '.vibe', 'agent', 'session-log.md'), 'utf8'),
      readFile(path.join(process.cwd(), '.vibe', 'agent', 'sprint-status.json'), 'utf8'),
    ]);
    const sprintStatus = JSON.parse(sprintStatusRaw) as {
      project?: { name?: string };
      sprints?: unknown[];
      pendingRisks?: unknown[];
      lastSprintScope?: unknown[];
      lastSprintScopeGlob?: unknown[];
    };

    assert.match(handoff, /PROJECT NOT INITIALIZED/);
    assert.match(sessionLog, /PROJECT NOT INITIALIZED/);
    assert.equal(sprintStatus.project?.name, 'vibe-doctor');
    assert.deepEqual(sprintStatus.sprints, []);
    assert.deepEqual(sprintStatus.pendingRisks, []);
    assert.deepEqual(sprintStatus.lastSprintScope, []);
    assert.deepEqual(sprintStatus.lastSprintScopeGlob, []);
    assert.doesNotMatch(handoff, /sprint-M\d|dogfood\d+|iter-[789]/i);
    assert.doesNotMatch(sessionLog, /sprint-M\d|dogfood\d+|iter-[789]/i);
  });

  it('keeps dashboard and project report render templates split from CLIs', async () => {
    const [dashboardCli, dashboardTemplate, reportCli, reportTemplate, reportMeta] = await Promise.all([
      readFile(path.join(process.cwd(), '.vibe', 'harness', 'scripts', 'vibe-dashboard.mjs'), 'utf8'),
      readFile(path.join(process.cwd(), '.vibe', 'harness', 'scripts', 'lib', 'dashboard-template.mjs'), 'utf8'),
      readFile(path.join(process.cwd(), '.vibe', 'harness', 'scripts', 'vibe-project-report.mjs'), 'utf8'),
      readFile(path.join(process.cwd(), '.vibe', 'harness', 'scripts', 'lib', 'project-report-template.mjs'), 'utf8'),
      readFile(path.join(process.cwd(), '.vibe', 'harness', 'scripts', 'lib', 'project-report-meta.mjs'), 'utf8'),
    ]);

    assert.match(dashboardCli, /from '\.\/lib\/dashboard-template\.mjs'/);
    assert.doesNotMatch(dashboardCli, /function renderShellHtml\(/);
    assert.match(dashboardTemplate, /export function renderShellHtml\(/);
    assert.match(dashboardTemplate, /export function renderIconSvg\(/);

    assert.match(reportCli, /from '\.\/lib\/project-report-template\.mjs'/);
    assert.match(reportCli, /from '\.\/lib\/project-report-meta\.mjs'/);
    assert.doesNotMatch(reportCli, /function renderHtml\(/);
    assert.match(reportTemplate, /export function renderProjectReportHtml\(/);
    assert.match(reportMeta, /export function isMetaSprintId\(/);
  });
});