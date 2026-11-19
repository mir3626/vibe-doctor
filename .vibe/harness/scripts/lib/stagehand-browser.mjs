// Shared Stagehand (browser automation) helpers for harness scripts and UI tests.
//
// Stagehand v4 drives the Google Chrome that is already installed on the machine over CDP;
// there is no browser download step. Deterministic harness paths (browser smoke, UI tests)
// attach without a model, so no LLM API key or Browserbase account is required. The
// natural-language act/observe/extract primitives stay opt-in for product tests
// (see .claude/skills/test-patterns/typescript-stagehand.md).

import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

export const STAGEHAND_PACKAGE = '@browserbasehq/stagehand';

export function stagehandPackageJsonPath(rootDir = process.cwd()) {
  return path.join(rootDir, 'node_modules', '@browserbasehq', 'stagehand', 'package.json');
}

/**
 * The package exports only its "." entry, so `require.resolve('@browserbasehq/stagehand/package.json')`
 * throws ERR_PACKAGE_PATH_NOT_EXPORTED. Probe the installed package file from the project root instead.
 */
export function isStagehandInstalled(rootDir = process.cwd()) {
  return existsSync(stagehandPackageJsonPath(rootDir));
}

export function stagehandInstallGuidance(label, retryCommand) {
  return [
    `${label} ${STAGEHAND_PACKAGE} is not installed in this project.`,
    '',
    'Install the harness browser automation dependency:',
    `  npm install -D ${STAGEHAND_PACKAGE}`,
    '',
    'Stagehand launches the Google Chrome that is already installed on this machine (no browser download).',
    'Install Chrome/Chromium, or set CHROME_PATH to the executable when it is not auto-detected.',
    '',
    'Then retry:',
    `  ${retryCommand}`,
    '',
  ].join('\n');
}

const CHROME_ERROR_PATTERN = /Chrome (installation not found|executable )/;

/** Adds the local-Chrome hint to Stagehand launch failures; other errors pass through unchanged. */
export function describeBrowserError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (CHROME_ERROR_PATTERN.test(message)) {
    return `${message}\nStagehand needs a local Google Chrome/Chromium install. Install Chrome or set CHROME_PATH to the executable.`;
  }
  return message;
}

export async function loadStagehand() {
  return import(STAGEHAND_PACKAGE);
}

/**
 * Normalizes a Stagehand `page.on('console')` event. Stagehand hands over the raw CDP
 * `Runtime.consoleAPICalled` envelope: `{ method, params: { type, args: [{ value?, description? }] } }`.
 */
export function describeConsoleEvent(event) {
  const params =
    event && typeof event === 'object' && event.params && typeof event.params === 'object' ? event.params : {};
  const type = typeof params.type === 'string' ? params.type : '';
  const args = Array.isArray(params.args) ? params.args : [];
  const text = args
    .map((arg) => {
      if (arg && typeof arg === 'object') {
        if (arg.value !== undefined) {
          return typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value);
        }
        return typeof arg.description === 'string' ? arg.description : '';
      }
      return arg === undefined || arg === null ? '' : String(arg);
    })
    .join(' ')
    .trim();
  return { type, text };
}

export function isConsoleIssue(type) {
  return type === 'error' || type === 'warning' || type === 'warn';
}

const PROFILE_REMOVAL = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 };
const CHROME_EXIT_TIMEOUT_MS = 10_000;

/** Resolves true once nothing accepts connections on the DevTools endpoint, so Chrome has exited. */
async function devToolsEndpointClosed(cdpUrl, timeoutMs) {
  let endpoint;
  try {
    endpoint = new URL(cdpUrl);
  } catch {
    return false;
  }
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const accepting = await new Promise((resolve) => {
      const socket = net.connect({ host: endpoint.hostname, port: Number(endpoint.port) });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    if (!accepting) {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Closes a browser this module launched and removes its profile directory.
 *
 * On Windows, Stagehand (through 4.4.0) can reject `browser.close()` while Chrome is already
 * exiting: when `Browser.close` has not finished by its deadline it runs `taskkill`, which exits
 * 255 against a process tree that is ending, and it deletes the profile once while Chrome still
 * holds it (browserbase/stagehand#3166). So the profile directory is ours (Stagehand never deletes
 * a `userDataDir` it was given), a rejected close counts as closed once the DevTools endpoint
 * stops accepting connections, and the profile is removed with retries after that.
 */
export async function closeLaunchedBrowser(browser, userDataDir, options = {}) {
  const cdpUrl = browser.cdpUrl;
  let closeError = null;
  try {
    await browser.close();
  } catch (error) {
    closeError = error;
  }
  if (closeError !== null) {
    const exited = typeof cdpUrl === 'string'
      && (await devToolsEndpointClosed(cdpUrl, options.exitTimeoutMs ?? CHROME_EXIT_TIMEOUT_MS));
    if (!exited) {
      throw closeError;
    }
  }
  await rm(userDataDir, PROFILE_REMOVAL);
}

/**
 * Launches headless Chrome through Stagehand without a model and returns the first page.
 * `close()` tears down the Stagehand runtime first and the browser second.
 */
export async function openHeadlessPage(options = {}) {
  const { localBrowser, Stagehand } = await loadStagehand();
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'vibe-stagehand-'));
  const launchOptions = { headless: options.headless ?? true, userDataDir };
  if (options.viewport) {
    launchOptions.viewport = options.viewport;
  }
  if (options.executablePath) {
    launchOptions.executablePath = options.executablePath;
  }

  let browser;
  try {
    browser = await localBrowser.launch(launchOptions);
  } catch (error) {
    await rm(userDataDir, PROFILE_REMOVAL).catch(() => undefined);
    throw error;
  }
  let stagehand = null;
  try {
    // Stagehand.create attaches the browser context; without it `browser.context` is unavailable.
    stagehand = await Stagehand.create({ browser, logging: { level: 'off' } });
    const pages = await browser.context.pages();
    const page = pages[0] ?? (await browser.context.newPage());
    const close = async () => {
      try {
        await stagehand.close();
      } finally {
        await closeLaunchedBrowser(browser, userDataDir);
      }
    };
    return { browser, stagehand, page, close };
  } catch (error) {
    if (stagehand) {
      await stagehand.close().catch(() => undefined);
    }
    await closeLaunchedBrowser(browser, userDataDir).catch(() => undefined);
    throw error;
  }
}

/** Polls `check` until it returns a truthy value. Stagehand has no auto-waiting assertions. */
export async function waitForCondition(check, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const intervalMs = options.intervalMs ?? 100;
  const description = options.description ?? 'condition';
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  for (;;) {
    try {
      const value = await check();
      if (value) {
        return value;
      }
      lastError = null;
    } catch (error) {
      lastError = error;
    }

    if (Date.now() >= deadline) {
      const suffix = lastError ? `: ${lastError instanceof Error ? lastError.message : String(lastError)}` : '';
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${description}${suffix}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
