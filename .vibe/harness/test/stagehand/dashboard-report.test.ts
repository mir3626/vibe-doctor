// Harness browser UI tests on Stagehand-driven headless Chrome.
//
// This directory runs only through `npm run vibe:test-ui` (.vibe/harness/scripts/vibe-stagehand-test.mjs):
// it needs a local Chrome install, so it stays outside the standard verification groups and the
// harness typecheck, exactly like the former Playwright spec directory.

import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { describeBrowserError, openHeadlessPage, waitForCondition } from '../../scripts/lib/stagehand-browser.mjs';

interface UiLocator {
  click(): Promise<void>;
  count(): Promise<number>;
  innerText(): Promise<string>;
}

interface UiPage {
  goto(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'; timeout?: number }): Promise<unknown>;
  waitForSelector(
    selector: string,
    options?: { state?: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number },
  ): Promise<unknown>;
  locator(selector: string): UiLocator;
  evaluate<T>(fn: (arg: never) => T, arg?: unknown): Promise<T>;
  screenshot(options?: { type?: 'png' | 'jpeg'; path?: string; fullPage?: boolean }): Promise<Uint8Array>;
}

interface UiSession {
  page: UiPage;
  close(): Promise<void>;
}

const repoRoot = process.cwd();
const UI_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = 90_000;
// Optional evidence capture: VIBE_UI_SCREENSHOT_DIR=<dir> saves a PNG per scenario.
const screenshotDir = process.env.VIBE_UI_SCREENSHOT_DIR;

async function openSession(): Promise<UiSession> {
  try {
    return (await openHeadlessPage({ headless: true, viewport: { width: 1280, height: 720 } })) as UiSession;
  } catch (error) {
    throw new Error(describeBrowserError(error));
  }
}

async function makeTempRoot(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeText(filePath: string, value: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, 'utf8');
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === 'object' && address) {
          resolve(address.port);
          return;
        }
        reject(new Error('no free port'));
      });
    });
  });
}

async function textOf(page: UiPage, selector: string): Promise<string> {
  return page.evaluate(
    (sel: string) => document.querySelector(sel)?.textContent?.trim() ?? '',
    selector,
  );
}

async function attributeOf(page: UiPage, selector: string, name: string): Promise<string | null> {
  return page.evaluate(
    (input: { sel: string; name: string }) => document.querySelector(input.sel)?.getAttribute(input.name) ?? null,
    { sel: selector, name },
  );
}

async function isDisplayed(page: UiPage, selector: string): Promise<boolean> {
  return page.evaluate((sel: string) => {
    const element = document.querySelector(sel);
    if (!element) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return getComputedStyle(element).display !== 'none' && rect.width > 0 && rect.height > 0;
  }, selector);
}

async function waitForText(page: UiPage, selector: string, expected: string | RegExp): Promise<void> {
  await waitForCondition(
    async () => {
      const text = await textOf(page, selector);
      return typeof expected === 'string' ? text === expected : expected.test(text);
    },
    { timeoutMs: UI_TIMEOUT_MS, description: `${selector} text to match ${String(expected)}` },
  );
}

async function waitForAttribute(page: UiPage, selector: string, name: string, expected: string | RegExp): Promise<void> {
  await waitForCondition(
    async () => {
      const value = await attributeOf(page, selector, name);
      if (value === null) {
        return false;
      }
      return typeof expected === 'string' ? value === expected : expected.test(value);
    },
    { timeoutMs: UI_TIMEOUT_MS, description: `${selector}[${name}] to match ${String(expected)}` },
  );
}

async function waitForDisplayed(page: UiPage, selector: string): Promise<void> {
  await waitForCondition(() => isDisplayed(page, selector), {
    timeoutMs: UI_TIMEOUT_MS,
    description: `${selector} to be displayed`,
  });
}

async function captureEvidence(page: UiPage, fileName: string): Promise<void> {
  if (!screenshotDir) {
    return;
  }
  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ type: 'png', path: path.join(screenshotDir, fileName), fullPage: true });
}

async function scaffoldDashboardRoot(root: string): Promise<void> {
  await writeJson(path.join(root, '.vibe', 'agent', 'sprint-status.json'), {
    schemaVersion: '0.1',
    project: { name: 'Dashboard UI', createdAt: '2026-04-24T00:00:00.000Z' },
    sprints: [{ id: 'sprint-ui', name: 'Sprint UI', status: 'in_progress' }],
    verificationCommands: [],
    pendingRisks: [{ id: 'risk-ui', status: 'open', text: 'Review UI wiring' }],
    lastSprintScope: [],
    lastSprintScopeGlob: [],
    sprintsSinceLastAudit: 0,
    stateUpdatedAt: '2026-04-24T00:00:00.000Z',
    handoff: {
      currentSprintId: 'sprint-ui',
      lastActionSummary: 'dashboard smoke',
      orchestratorContextBudget: 'medium',
      preferencesActive: [],
    },
  });
  await writeJson(path.join(root, '.vibe', 'agent', 'iteration-history.json'), {
    currentIteration: 'iter-ui',
    iterations: [
      {
        id: 'iter-ui',
        label: 'Dashboard UI',
        goal: 'Render dashboard state',
        plannedSprints: ['sprint-ui'],
        completedSprints: [],
      },
    ],
  });
  await writeJson(path.join(root, '.vibe', 'agent', 'tokens.json'), { todayTotal: 123 });
  await writeText(path.join(root, '.vibe', 'agent', 'handoff.md'), '## 2. Status: ACTIVE\n');
  await writeText(path.join(root, 'docs', 'plans', 'sprint-roadmap.md'), '- **id**: `sprint-ui`\n');
  await writeText(path.join(root, 'docs', 'context', 'product.md'), '# Dashboard UI\n\nPlatform: browser\n');
}

async function startDashboard(root: string): Promise<{ child: ChildProcess; url: string }> {
  const port = await freePort();
  const child = spawn(process.execPath, ['.vibe/harness/scripts/vibe-dashboard.mjs', '--port', String(port), '--no-open'], {
    cwd: repoRoot,
    env: { ...process.env, VIBE_ROOT: root },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });

  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`dashboard did not start stdout=${stdout} stderr=${stderr}`));
    }, 5_000);
    child.on('exit', (code) => {
      if (!stdout.includes('http://')) {
        clearTimeout(timer);
        reject(new Error(`dashboard exited ${code ?? 1}: ${stderr}`));
      }
    });
    child.stdout?.on('data', () => {
      const match = stdout.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
  });

  return { child, url };
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) {
    return;
  }
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), 1_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function scaffoldReportRoot(root: string): Promise<void> {
  await writeJson(path.join(root, 'package.json'), {
    name: 'downstream-ui',
    scripts: { test: 'node --test' },
  });
  await writeJson(path.join(root, '.vibe', 'config.json'), {});
  await writeJson(path.join(root, '.vibe', 'agent', 'sprint-status.json'), {
    schemaVersion: '0.1',
    project: { name: 'Demo Project', createdAt: '2026-04-24T00:00:00.000Z' },
    sprints: [
      {
        id: 'project-ui',
        name: 'Project UI',
        status: 'passed',
        completedAt: '2026-04-24T01:00:00.000Z',
        actualLoc: { added: 20, deleted: 2, net: 18, filesChanged: 3 },
      },
    ],
    verificationCommands: [{ name: 'npm test', status: 'passed', timestamp: '2026-04-24T01:01:00.000Z' }],
    pendingRisks: [],
    lastSprintScope: [],
    lastSprintScopeGlob: [],
    sprintsSinceLastAudit: 0,
    stateUpdatedAt: '2026-04-24T01:00:00.000Z',
    handoff: {
      currentSprintId: 'idle',
      lastActionSummary: 'report smoke',
      orchestratorContextBudget: 'low',
      preferencesActive: [],
    },
  });
  await writeJson(path.join(root, '.vibe', 'agent', 'iteration-history.json'), {
    currentIteration: null,
    iterations: [],
  });
  await writeText(path.join(root, 'docs', 'context', 'product.md'), '# Demo Project\n\nPlatform: browser\n');
  await writeText(
    path.join(root, 'docs', 'plans', 'sprint-roadmap.md'),
    ['# Roadmap', '', '## Sprint Project UI', '- **id**: `project-ui`', '- **Goal**: Render the UI report'].join('\n'),
  );
  await writeText(
    path.join(root, '.vibe', 'agent', 'session-log.md'),
    [
      '# Session Log',
      '',
      '## Entries',
      '- 2026-04-24T01:00:00.000Z [decision] keep the report interactive',
      '- 2026-04-24T01:02:00.000Z [failure] long failure entry for browser expansion checks that should render collapsed at first and expand when the report control is clicked; this sentence intentionally stays above the report collapse threshold so the real browser test covers the details element behavior.',
    ].join('\n'),
  );
}

async function openReport(page: UiPage, root: string): Promise<void> {
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, '.vibe', 'harness', 'scripts', 'vibe-project-report.mjs'), '--no-open'],
    {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const outPath = result.stdout.trim().split(/\r?\n/).at(-1);
  if (!outPath) {
    throw new Error('project report did not print an output path');
  }
  await page.goto(pathToFileURL(outPath).href, { waitUntil: 'domcontentloaded', timeout: UI_TIMEOUT_MS });
}

describe('harness browser UI (Stagehand)', () => {
  it('dashboard renders live state and receives attention toasts', { timeout: TEST_TIMEOUT_MS }, async () => {
    const root = await makeTempRoot('vibe-dashboard-stagehand-');
    let child: ChildProcess | null = null;
    const session = await openSession();
    try {
      await scaffoldDashboardRoot(root);
      const dashboard = await startDashboard(root);
      child = dashboard.child;
      const { page } = session;

      await page.goto(dashboard.url, { waitUntil: 'domcontentloaded', timeout: UI_TIMEOUT_MS });

      await page.waitForSelector('h1', { state: 'visible', timeout: UI_TIMEOUT_MS });
      assert.equal(await textOf(page, 'h1'), 'Vibe Dashboard');
      await waitForText(page, '#sprintId', 'sprint-ui');
      await page.waitForSelector('[data-sprint-id="sprint-ui"]', { state: 'visible', timeout: UI_TIMEOUT_MS });
      await waitForText(page, '#riskCount', '1');

      const notify = spawnSync(
        process.execPath,
        [
          '.vibe/harness/scripts/vibe-attention.mjs',
          '--severity',
          'urgent',
          '--title',
          'Permission needed',
          '--detail',
          'Approve the pending tool call',
          '--source',
          'stagehand',
        ],
        { cwd: repoRoot, env: { ...process.env, VIBE_ROOT: root }, encoding: 'utf8', windowsHide: true },
      );
      assert.equal(notify.status, 0, notify.stderr);

      await waitForCondition(
        () =>
          page.evaluate(() =>
            Array.from(document.querySelectorAll('.toast')).some(
              (element) => (element.textContent ?? '').includes('Permission needed') && element.getClientRects().length > 0,
            ),
          ),
        { timeoutMs: UI_TIMEOUT_MS, description: 'attention toast "Permission needed"' },
      );
      await waitForText(page, '#attentionList', /Permission needed/);
      await captureEvidence(page, 'dashboard.png');
    } finally {
      await session.close();
      if (child) {
        await stopChild(child);
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it('project report renders and decision controls work in a real browser', { timeout: TEST_TIMEOUT_MS }, async () => {
    const root = await makeTempRoot('vibe-report-stagehand-');
    const session = await openSession();
    try {
      await scaffoldReportRoot(root);
      const { page } = session;
      await openReport(page, root);

      await page.waitForSelector('h1', { state: 'visible', timeout: UI_TIMEOUT_MS });
      assert.equal(await textOf(page, 'h1'), 'Demo Project');
      await waitForText(page, '[data-sprint-id="project-ui"]', /passed/);
      assert.equal(
        await page.evaluate(() =>
          Array.from(document.querySelectorAll('a[href="#decisions"]')).some(
            (element) => element.textContent?.trim() === 'Decisions' && element.getClientRects().length > 0,
          ),
        ),
        true,
        'Decisions navigation link is visible',
      );

      await waitForAttribute(page, '.decision-groups', 'data-active-tags', /decision/);

      await page.locator('button[data-filter="failure"]').click();
      await waitForAttribute(page, '.decision-groups', 'data-active-tags', 'failure');
      await waitForDisplayed(page, '.decision-entry[data-tag="failure"]');

      assert.equal(await attributeOf(page, '#decisions details', 'open'), null, 'long entry starts collapsed');
      await page.locator('button[data-decision-action="expand"]').click();
      await waitForAttribute(page, '#decisions details', 'open', '');
      await captureEvidence(page, 'project-report.png');
    } finally {
      await session.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
