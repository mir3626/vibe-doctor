import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';

const browserSmokePath = path.resolve('.vibe', 'harness', 'scripts', 'vibe-browser-smoke.mjs');
const stagehandShardPath = path.resolve('.claude', 'skills', 'test-patterns', 'typescript-stagehand.md');

interface SmokeResult {
  url: string;
  status: number | null;
  checkedSelectors: number;
  consoleIssues: string[];
}

interface FakeSession {
  page: unknown;
  close(): Promise<void>;
}

interface SmokeModule {
  DEFAULT_SMOKE_TIMEOUT_MS: number;
  checkContract: (smokeConfig: Record<string, unknown>, shardText: string) => string[];
  runBrowserSmoke: (
    smokeConfig: Record<string, unknown>,
    deps?: { openPage?: (options: Record<string, unknown>) => Promise<FakeSession> },
  ) => Promise<SmokeResult>;
}

async function loadSmokeModule(): Promise<SmokeModule> {
  return (await import(pathToFileURL(browserSmokePath).href)) as SmokeModule;
}

interface FakePageOptions {
  status?: number;
  consoleEvents?: unknown[];
  missingSelectors?: string[];
  gotoError?: Error;
  errorPage?: boolean;
}

interface FakeCalls {
  launch: Record<string, unknown> | null;
  goto: Array<{ url: string; options: Record<string, unknown> | undefined }>;
  waits: Array<{ selector: string }>;
  closed: number;
}

function createFakeLauncher(options: FakePageOptions = {}): {
  calls: FakeCalls;
  openPage: (launchOptions: Record<string, unknown>) => Promise<FakeSession>;
} {
  const calls: FakeCalls = { launch: null, goto: [], waits: [], closed: 0 };
  const listeners: Array<(event: unknown) => void> = [];
  let currentUrl = 'about:blank';
  const page = {
    async url() {
      return currentUrl;
    },
    on(event: string, listener: (event: unknown) => void) {
      if (event === 'console') {
        listeners.push(listener);
      }
    },
    async goto(url: string, gotoOptions?: Record<string, unknown>) {
      calls.goto.push({ url, options: gotoOptions });
      if (options.gotoError) {
        throw options.gotoError;
      }
      if (options.errorPage) {
        // A refused connection resolves goto with no response and lands on Chrome's error page.
        currentUrl = 'chrome-error://chromewebdata/';
        return null;
      }
      currentUrl = url;
      // Console output arrives while the page loads, exactly as the real CDP stream does.
      for (const event of options.consoleEvents ?? []) {
        for (const listener of listeners) {
          listener(event);
        }
      }
      return { status: () => options.status ?? 200 };
    },
    locator(selector: string) {
      calls.waits.push({ selector });
      const missing = (options.missingSelectors ?? []).includes(selector);
      const fakeLocator = {
        async count() {
          return missing ? 0 : 1;
        },
        first() {
          return fakeLocator;
        },
        async isVisible() {
          return !missing;
        },
      };
      return fakeLocator;
    },
  };
  const session: FakeSession = {
    page,
    close: async () => {
      calls.closed += 1;
    },
  };
  return {
    calls,
    openPage: async (launchOptions) => {
      calls.launch = launchOptions;
      return session;
    },
  };
}

function consoleEvent(type: string, ...args: unknown[]): unknown {
  return {
    method: 'Runtime.consoleAPICalled',
    params: {
      type,
      args: args.map((value) =>
        typeof value === 'string' ? { type: 'string', value } : { type: 'object', description: 'Object' },
      ),
    },
  };
}

describe('vibe-browser-smoke contract checks', () => {
  it('warns when fixed sleep keys are present', async () => {
    const [{ checkContract }, shardText] = await Promise.all([loadSmokeModule(), readFile(stagehandShardPath, 'utf8')]);

    const warnings = checkContract(
      {
        url: 'http://localhost:5173',
        expectDom: ['[data-testid="app"]'],
        sleep: 250,
      },
      shardText,
    );

    assert.equal(
      warnings.some((warning) => warning.includes('sleep/delayMs')),
      true,
    );
  });

  it('warns when expectDom relies only on ID/class selectors', async () => {
    const [{ checkContract }, shardText] = await Promise.all([loadSmokeModule(), readFile(stagehandShardPath, 'utf8')]);

    const warnings = checkContract(
      {
        url: 'http://localhost:5173',
        expectDom: ['#stage', '.card'],
      },
      shardText,
    );

    assert.equal(
      warnings.some((warning) => warning.includes('semantic or data-testid selectors')),
      true,
    );
  });

  it('warns when the smoke URL shape differs from the shard baseURL example', async () => {
    const [{ checkContract }, shardText] = await Promise.all([loadSmokeModule(), readFile(stagehandShardPath, 'utf8')]);

    const warnings = checkContract(
      {
        url: 'http://localhost:5173',
        expectDom: ['[data-testid="app"]'],
      },
      shardText,
    );

    assert.equal(
      warnings.some((warning) => warning.includes('differs from shard example')),
      true,
    );
  });
});

describe('vibe-browser-smoke runner (Stagehand page contract)', () => {
  it('navigates with networkidle, waits for every selector, and reports console issues', async () => {
    const { runBrowserSmoke, DEFAULT_SMOKE_TIMEOUT_MS } = await loadSmokeModule();
    const fake = createFakeLauncher({
      consoleEvents: [consoleEvent('log', 'plain log'), consoleEvent('error', 'boom', {}), consoleEvent('warning', 'careful')],
    });

    const result = await runBrowserSmoke(
      {
        url: 'http://127.0.0.1:5177/',
        viewport: { width: 375, height: 812 },
        expectDom: ['[data-testid="app"]', 'text=Smoke ready'],
      },
      { openPage: fake.openPage },
    );

    assert.deepEqual(fake.calls.launch, { headless: true, viewport: { width: 375, height: 812 } });
    assert.deepEqual(fake.calls.goto, [
      { url: 'http://127.0.0.1:5177/', options: { waitUntil: 'networkidle', timeout: DEFAULT_SMOKE_TIMEOUT_MS } },
    ]);
    assert.deepEqual(
      fake.calls.waits.map((entry) => entry.selector),
      ['[data-testid="app"]', 'text=Smoke ready'],
    );
    assert.equal(result.status, 200);
    assert.equal(result.checkedSelectors, 2);
    assert.deepEqual(result.consoleIssues, ['error: boom Object', 'warning: careful']);
    assert.equal(fake.calls.closed, 1);
  });

  it('fails on console issues only when expectConsoleFree is set, and still closes the browser', async () => {
    const { runBrowserSmoke } = await loadSmokeModule();
    const fake = createFakeLauncher({ consoleEvents: [consoleEvent('error', 'boom')] });

    await assert.rejects(
      runBrowserSmoke({ url: 'http://127.0.0.1:5177/', expectConsoleFree: true }, { openPage: fake.openPage }),
      /console issues detected:\nerror: boom/,
    );
    assert.equal(fake.calls.closed, 1);
  });

  it('times out on a missing expectDom selector using the configured timeoutMs', async () => {
    const { runBrowserSmoke } = await loadSmokeModule();
    const fake = createFakeLauncher({ missingSelectors: ['#never-there'] });

    await assert.rejects(
      runBrowserSmoke({ url: 'http://127.0.0.1:5177/', expectDom: ['#never-there'], timeoutMs: 200 }, { openPage: fake.openPage }),
      /timed out after 200ms waiting for selector "#never-there" to be visible/,
    );
    assert.deepEqual(fake.calls.goto[0]?.options, { waitUntil: 'networkidle', timeout: 200 });
    assert.equal(fake.calls.closed, 1);
  });

  it('fails fast when Chrome lands on its error page instead of the target', async () => {
    const { runBrowserSmoke } = await loadSmokeModule();
    const fake = createFakeLauncher({ errorPage: true });

    await assert.rejects(
      runBrowserSmoke({ url: 'http://127.0.0.1:5199/', expectDom: ['#app'] }, { openPage: fake.openPage }),
      /navigation to http:\/\/127\.0\.0\.1:5199\/ failed: Chrome showed an error page/,
    );
    assert.equal(fake.calls.waits.length, 0);
    assert.equal(fake.calls.closed, 1);
  });

  it('wraps navigation failures with the target url', async () => {
    const { runBrowserSmoke } = await loadSmokeModule();
    const fake = createFakeLauncher({ gotoError: new Error('extension world not ready') });

    await assert.rejects(
      runBrowserSmoke({ url: 'http://127.0.0.1:5177/', expectDom: ['#app'] }, { openPage: fake.openPage }),
      /navigation to http:\/\/127\.0\.0\.1:5177\/ failed: extension world not ready/,
    );
    assert.equal(fake.calls.waits.length, 0);
    assert.equal(fake.calls.closed, 1);
  });

  it('fails when the main document responds with an HTTP error status', async () => {
    const { runBrowserSmoke } = await loadSmokeModule();
    const fake = createFakeLauncher({ status: 500 });

    await assert.rejects(
      runBrowserSmoke({ url: 'http://127.0.0.1:5177/broken', expectDom: [] }, { openPage: fake.openPage }),
      /returned HTTP 500/,
    );
    assert.equal(fake.calls.waits.length, 0);
    assert.equal(fake.calls.closed, 1);
  });

  it('rejects a config without a url before launching a browser', async () => {
    const { runBrowserSmoke } = await loadSmokeModule();
    const fake = createFakeLauncher();

    await assert.rejects(runBrowserSmoke({ expectDom: ['#app'] }, { openPage: fake.openPage }), /non-empty `url`/);
    assert.equal(fake.calls.launch, null);
    assert.equal(fake.calls.closed, 0);
  });
});
