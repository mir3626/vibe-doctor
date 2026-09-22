# TypeScript + Stagehand

Use this shard for browser flows. Stagehand (`@browserbasehq/stagehand`, v4) drives the Google Chrome that is already installed on the machine over CDP, exposes Playwright-style `page` / `locator` methods, and adds natural-language `act` / `observe` / `extract` primitives for flows that must survive markup churn. Stagehand ships no test runner, fixtures, or `expect()`: pair it with `node:test` (or Vitest/Jest) and `node:assert`.

## Install and config

```bash
npm install -D @browserbasehq/stagehand
# Local runs use the installed Google Chrome / Chromium (no browser download step).
# Set CHROME_PATH=<executable> when it is not auto-detected.
# Typed extract() schemas use zod 4 (the harness ships zod@^4; `import { z } from 'zod'`).
```

```ts
// e2e/stagehand.config.ts
export const config = {
  baseURL: 'http://127.0.0.1:3000',
  headless: process.env.HEADLESS !== '0',
  timeoutMs: 15_000,
};
```

Run with `node --import tsx --test e2e/*.test.ts` (or your existing runner).

## Example

```ts
// e2e/login.test.ts
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { localBrowser, Stagehand } from '@browserbasehq/stagehand';
import { config } from './stagehand.config.js';

let browser: Awaited<ReturnType<typeof localBrowser.launch>>;
let stagehand: Awaited<ReturnType<typeof Stagehand.create>>;
let page: Awaited<ReturnType<typeof browser.context.pages>>[number];

before(async () => {
  browser = await localBrowser.launch({ headless: config.headless, viewport: { width: 1280, height: 720 } });
  // No `model`: the deterministic page/locator API needs no LLM key. Stagehand.create attaches the context.
  stagehand = await Stagehand.create({ browser, logging: { level: 'off' } });
  [page] = await browser.context.pages();
});

after(async () => {
  await stagehand?.close();
  await browser?.close();
});

async function waitFor(check: () => Promise<boolean>, label: string, timeoutMs = config.timeoutMs): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test('user can sign in', async () => {
  await page.goto(`${config.baseURL}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"]').fill('owner@example.com');
  await page.locator('input[name="password"]').fill('correct horse battery staple');
  await page.locator('button[type="submit"]').click();

  await page.waitForSelector('h1', { state: 'visible', timeout: config.timeoutMs });
  assert.equal(await page.locator('h1').innerText(), 'Dashboard');
  await waitFor(async () => /dashboard/.test(await page.url()), 'dashboard URL');
});
```

## Natural-language primitives (opt-in, needs a model)

```ts
import { z } from 'zod';

const stagehand = await Stagehand.create({
  browser,
  model: { modelName: 'openai/gpt-5.4-mini', apiKey: process.env.OPENAI_API_KEY }, // any provider/model from the Stagehand models guide
  logging: { level: 'off' },
});

// observe() returns real selectors, so credentials never reach the model.
const { data: fields } = await stagehand.observe('find the email input');
await page.locator(fields[0].selector).fill(process.env.APP_EMAIL!);
// Secrets go through `variables`; they are substituted locally.
await stagehand.act('type %password% into the password field', { variables: { password: process.env.APP_PASSWORD! } });
// act() self-heals when the markup changes underneath it.
await stagehand.act('click the sign in button');
// extract() returns schema-validated data.
const { data } = await stagehand.extract('extract the signed-in user name', z.object({ name: z.string() }));
assert.equal(data.name, 'Owner');
```

Every AI call returns `{ data, metadata }`. Keep instructions atomic ("click the sign in button", not "log in and open billing"). Stagehand never reads API keys from the environment for you; pass them explicitly.

## Common pitfalls

- There is no `getByRole` / `getByLabel` / `getByTestId`, `locator.filter()`, `locator.waitFor()`, or `expect()`. Use CSS, `xpath=`, or `text=` selectors (case-insensitive substring), `page.waitForSelector(selector, { state, timeout })`, and a polling helper for assertions.
- Locators do not auto-wait. Wait for the state explicitly before reading `innerText()` / `textContent()` or clicking.
- One browser context per launch (`browser.context`); open extra tabs with `browser.context.newPage()`.
- Only `page.on('console', event)` is exposed, as the raw CDP payload (`event.params.type`, `event.params.args[].value`). There are no request/response/dialog events; poll the DOM instead of waiting for network events.
- Avoid fixed sleeps. Wait on an assertion or a specific UI state.
- Keep one user-facing concern per test. Long multi-step scripts are harder to debug.

## Determinism notes

- Seed or stub backend data before the test starts; do not depend on shared mutable staging state.
- Freeze clocks where the page renders time-sensitive output.
- Prefer deterministic selectors for assertions; use `observe()` to discover selectors and `act()` for steps that keep changing, and record the model/provider with the evidence.
- `HEADLESS=0` to watch a run; `await page.screenshot({ path: 'evidence/login.png' })` for evidence.
- The harness browser smoke (`npm run vibe:browser-smoke`) and harness UI tests (`npm run vibe:test-ui`) use the same deterministic, model-free path.
