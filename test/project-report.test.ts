import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, it } from 'node:test';

const tempDirs: string[] = [];

interface ProjectReportModule {
  runProjectReportCli: (
    argv: string[],
    options: {
      root: string;
      spawn?: (...args: unknown[]) => { unref?: () => void };
      stdout?: { write: (value: string) => void };
      stderr?: { write: (value: string) => void };
      platform?: NodeJS.Platform;
    },
  ) => Promise<{ outPath: string; html: string }>;
  isMetaProject: (input: {
    config?: unknown;
    packageJson?: unknown;
    roadmapMd?: string;
  }) => boolean;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true }));
    }
  }
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeText(filePath: string, value: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, 'utf8');
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function loadReportModule(): Promise<ProjectReportModule> {
  return import(pathToFileURL(path.resolve('scripts', 'vibe-project-report.mjs')).href) as Promise<ProjectReportModule>;
}

async function scaffoldReportProject(
  root: string,
  options: { meta?: boolean; packageName?: string } = {},
): Promise<void> {
  await writeJson(path.join(root, 'package.json'), {
    name: options.packageName ?? 'downstream-app',
    scripts: {
      test: 'node --test',
      build: 'tsc -p tsconfig.json',
    },
  });
  await writeJson(path.join(root, '.vibe', 'config.json'), {
    ...(options.meta ? { project: { kind: 'meta' } } : {}),
  });
  await writeJson(path.join(root, '.vibe', 'agent', 'sprint-status.json'), {
    schemaVersion: '0.1',
    project: {
      name: 'Demo Project',
      createdAt: '2026-04-01T00:00:00.000Z',
    },
    sprints: [
      {
        id: 'sprint-M12-report',
        name: 'Meta report',
        status: 'passed',
        completedAt: '2026-04-16T00:00:00.000Z',
        actualLoc: { added: 10, deleted: 1, net: 9, filesChanged: 1 },
      },
      {
        id: 'project-01-engine',
        name: 'Engine',
        status: 'passed',
        completedAt: '2026-04-16T01:00:00.000Z',
        actualLoc: { added: 20, deleted: 0, net: 20, filesChanged: 2 },
      },
    ],
    verificationCommands: [],
    pendingRisks: [],
    lastSprintScope: [],
    lastSprintScopeGlob: [],
    sprintsSinceLastAudit: 0,
    stateUpdatedAt: '2026-04-16T01:00:00.000Z',
    handoff: {
      currentSprintId: 'idle',
      lastActionSummary: 'done',
      orchestratorContextBudget: 'low',
      preferencesActive: [],
    },
  });
  await writeJson(path.join(root, '.vibe', 'agent', 'iteration-history.json'), {
    currentIteration: null,
    iterations: [],
  });
  await writeText(
    path.join(root, 'docs', 'context', 'product.md'),
    ['# Demo Project', '', 'A compact planning harness.', '', 'Platform: CLI'].join('\n'),
  );
  await writeText(
    path.join(root, 'docs', 'plans', 'sprint-roadmap.md'),
    [
      '# Demo Roadmap',
      '',
      '## Sprint M12',
      '- **id**: `sprint-M12-report`',
      '- **Goal**: meta report goal',
      '',
      '## Sprint Project 01',
      '- **id**: `project-01-engine`',
      '- **Goal**: project engine goal',
    ].join('\n'),
  );
  await writeText(
    path.join(root, '.vibe', 'agent', 'session-log.md'),
    ['# Session Log', '', '## Entries', '- 2026-04-16T00:00:00.000Z [decision] keep reports local'].join('\n'),
  );
}

describe('project report', () => {
  it('renders placeholders and all expected sections with empty state files', async () => {
    const root = await makeTempDir('project-report-empty-');
    const { runProjectReportCli } = await loadReportModule();

    await writeJson(path.join(root, '.vibe', 'agent', 'sprint-status.json'), {
      schemaVersion: '0.1',
      project: { name: 'Empty Project', createdAt: '2026-04-01T00:00:00.000Z' },
      sprints: [],
      verificationCommands: [],
      pendingRisks: [],
      lastSprintScope: [],
      lastSprintScopeGlob: [],
      sprintsSinceLastAudit: 0,
      stateUpdatedAt: '2026-04-01T00:00:00.000Z',
    });

    const result = await runProjectReportCli(['--no-open'], {
      root,
      stdout: { write: () => undefined },
    });

    for (const section of ['overview', 'iterations', 'milestones', 'sprints', 'decisions', 'verification', 'next-steps']) {
      assert.match(result.html, new RegExp(`data-section="${section}"`));
    }
    assert.match(result.html, /No iterations recorded yet/);
  });

  it('excludes sprint-M cards for meta projects', async () => {
    const root = await makeTempDir('project-report-meta-');
    const { runProjectReportCli } = await loadReportModule();
    await scaffoldReportProject(root, { meta: true });

    const result = await runProjectReportCli(['--no-open'], {
      root,
      stdout: { write: () => undefined },
    });

    assert.equal(result.html.includes('data-sprint-id="sprint-M12-report"'), false);
    assert.equal(result.html.includes('data-sprint-id="project-01-engine"'), true);
  });

  it('shows all sprint cards for downstream projects', async () => {
    const root = await makeTempDir('project-report-downstream-');
    const { runProjectReportCli, isMetaProject } = await loadReportModule();
    await scaffoldReportProject(root, { packageName: 'arbitrary-product' });

    const result = await runProjectReportCli(['--no-open'], {
      root,
      stdout: { write: () => undefined },
    });

    assert.equal(isMetaProject({ packageJson: { name: 'arbitrary-product' }, roadmapMd: '# Demo' }), false);
    assert.equal(result.html.includes('data-sprint-id="sprint-M12-report"'), true);
    assert.equal(result.html.includes('data-sprint-id="project-01-engine"'), true);
  });

  it('--no-open skips browser spawn', async () => {
    const root = await makeTempDir('project-report-no-open-');
    const { runProjectReportCli } = await loadReportModule();
    let spawnCount = 0;
    await scaffoldReportProject(root);

    await runProjectReportCli(['--no-open'], {
      root,
      spawn: () => {
        spawnCount += 1;
        return {};
      },
      stdout: { write: () => undefined },
    });

    assert.equal(spawnCount, 0);
  });

  it('writes self-contained HTML without external assets', async () => {
    const root = await makeTempDir('project-report-self-contained-');
    const { runProjectReportCli } = await loadReportModule();
    await scaffoldReportProject(root);

    const { outPath } = await runProjectReportCli(['--no-open'], {
      root,
      stdout: { write: () => undefined },
    });
    const html = await readFile(outPath, 'utf8');

    assert.equal(/<link[^>]+href=["']http/i.test(html), false);
    assert.equal(/<script[^>]+src=["']http/i.test(html), false);
  });
});
