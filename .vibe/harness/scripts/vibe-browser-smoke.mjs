#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  describeBrowserError,
  describeConsoleEvent,
  isConsoleIssue,
  isStagehandInstalled,
  openHeadlessPage,
  stagehandInstallGuidance,
  waitForCondition,
} from './lib/stagehand-browser.mjs';

const SHARD_PATH = path.resolve('.claude/skills/test-patterns/typescript-stagehand.md');
const SHARED_CONFIG_PATH = path.resolve('.vibe/config.json');
const LOCAL_CONFIG_PATH = path.resolve('.vibe/config.local.json');

export const DEFAULT_SMOKE_TIMEOUT_MS = 15_000;
export const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

function readJsonIfPresent(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function loadBrowserSmokeSettings() {
  const shared = readJsonIfPresent(SHARED_CONFIG_PATH);
  const local = readJsonIfPresent(LOCAL_CONFIG_PATH);

  return {
    enabled: local.browserSmoke?.enabled ?? shared.browserSmoke?.enabled ?? false,
    configPath: local.browserSmoke?.configPath ?? shared.browserSmoke?.configPath ?? '.vibe/smoke.config.js',
    dist: local.browserSmoke?.dist ?? shared.browserSmoke?.dist ?? 'dist',
  };
}

function normalizeHostShape(value) {
  try {
    const url = new URL(value);
    return `${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
  } catch {
    return null;
  }
}

export function checkContract(smokeConfig, shardText) {
  const warnings = [];

  if (smokeConfig && (smokeConfig.sleep != null || smokeConfig.delayMs != null)) {
    warnings.push('config has sleep/delayMs key; shard discourages fixed sleeps');
  }

  if (
    Array.isArray(smokeConfig?.expectDom) &&
    smokeConfig.expectDom.length > 0 &&
    smokeConfig.expectDom.every((selector) => typeof selector === 'string' && /^[#.]/.test(selector))
  ) {
    warnings.push('expectDom uses only ID/class selectors; shard prefers semantic or data-testid selectors');
  }

  const shardExample = shardText.match(/baseURL\s*[:=]\s*['"]([^'"]+)['"]/);
  const shardHostShape = shardExample?.[1] ? normalizeHostShape(shardExample[1]) : null;
  const smokeHostShape = typeof smokeConfig?.url === 'string' ? normalizeHostShape(smokeConfig.url) : null;
  if (shardHostShape && smokeHostShape && shardHostShape !== smokeHostShape) {
    warnings.push(`url host ${smokeHostShape} differs from shard example ${shardHostShape}`);
  }

  return warnings;
}

async function importSmokeConfig(configPath) {
  const configUrl = pathToFileURL(configPath);
  configUrl.searchParams.set('ts', `${Date.now()}`);
  const module = await import(configUrl.href);
  return module.default ?? module;
}

function resolveTimeout(smokeConfig) {
  const value = Number(smokeConfig?.timeoutMs);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_SMOKE_TIMEOUT_MS;
}

/**
 * Waits through the locator API so every Stagehand selector engine (CSS, `xpath=`, `text=`) works;
 * `page.waitForSelector` only understands CSS/XPath and Stagehand locators never auto-wait.
 */
async function waitForSelectorVisible(page, selector, timeoutMs) {
  const locator = page.locator(selector);
  await waitForCondition(async () => (await locator.count()) > 0 && (await locator.first().isVisible()), {
    timeoutMs,
    description: `selector "${selector}" to be visible`,
  });
}

/**
 * Runs the DOM/console smoke contract against a Stagehand-driven headless Chrome page.
 * `openPage` is injectable so the flow can be tested without a browser.
 */
export async function runBrowserSmoke(smokeConfig, { openPage = openHeadlessPage } = {}) {
  if (!smokeConfig || typeof smokeConfig.url !== 'string' || smokeConfig.url.trim() === '') {
    throw new Error('smoke config must export a non-empty `url` string');
  }

  const timeoutMs = resolveTimeout(smokeConfig);
  const expectDom = Array.isArray(smokeConfig.expectDom) ? smokeConfig.expectDom : [];
  const consoleIssues = [];
  const session = await openPage({ headless: true, viewport: smokeConfig.viewport ?? DEFAULT_VIEWPORT });

  try {
    const { page } = session;
    page.on('console', (event) => {
      const { type, text } = describeConsoleEvent(event);
      if (isConsoleIssue(type)) {
        consoleIssues.push(`${type}: ${text}`);
      }
    });

    let response;
    try {
      response = await page.goto(smokeConfig.url, { waitUntil: 'networkidle', timeout: timeoutMs });
    } catch (error) {
      throw new Error(`navigation to ${smokeConfig.url} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    // A refused connection does not reject goto: Chrome lands on chrome-error://chromewebdata/ with no response.
    const landedUrl = typeof page.url === 'function' ? await page.url() : '';
    if (typeof landedUrl === 'string' && landedUrl.startsWith('chrome-error://')) {
      throw new Error(`navigation to ${smokeConfig.url} failed: Chrome showed an error page (server unreachable or blocked)`);
    }
    const status = response && typeof response.status === 'function' ? response.status() : null;
    if (typeof status === 'number' && status >= 400) {
      throw new Error(`navigation to ${smokeConfig.url} returned HTTP ${status}`);
    }

    for (const selector of expectDom) {
      await waitForSelectorVisible(page, selector, timeoutMs);
    }

    if (smokeConfig.expectConsoleFree === true && consoleIssues.length > 0) {
      throw new Error(`console issues detected:\n${consoleIssues.join('\n')}`);
    }

    return { url: smokeConfig.url, status, checkedSelectors: expectDom.length, consoleIssues };
  } finally {
    await session.close();
  }
}

async function main() {
  const settings = loadBrowserSmokeSettings();
  if (!settings.enabled) {
    process.stdout.write('[vibe-browser-smoke] disabled\n');
    return;
  }

  const configPath = path.resolve(settings.configPath);
  const smokeConfig = await importSmokeConfig(configPath);
  const shardText = existsSync(SHARD_PATH) ? readFileSync(SHARD_PATH, 'utf8') : '';
  for (const warning of checkContract(smokeConfig, shardText)) {
    process.stderr.write(`[vibe-browser-smoke] WARN: ${warning}\n`);
  }

  if (!isStagehandInstalled()) {
    process.stderr.write(stagehandInstallGuidance('[vibe-browser-smoke]', 'npm run vibe:browser-smoke'));
    process.exit(2);
  }

  let result;
  try {
    result = await runBrowserSmoke(smokeConfig);
  } catch (error) {
    throw new Error(describeBrowserError(error));
  }

  for (const issue of result.consoleIssues) {
    process.stderr.write(`[vibe-browser-smoke] console ${issue}\n`);
  }
  process.stdout.write(
    `[vibe-browser-smoke] PASS url=${result.url} status=${result.status ?? 'n/a'} selectors=${result.checkedSelectors} consoleIssues=${result.consoleIssues.length}\n`,
  );
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
