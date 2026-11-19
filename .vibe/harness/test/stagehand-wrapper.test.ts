import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, it } from 'node:test';
import { closeLaunchedBrowser } from '../scripts/lib/stagehand-browser.mjs';

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];
const scriptPath = path.join(process.cwd(), '.vibe', 'harness', 'scripts', 'vibe-stagehand-test.mjs');

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('vibe Stagehand UI test wrapper', () => {
  it('prints install guidance when @browserbasehq/stagehand is unavailable from the project root', async () => {
    const root = await makeTempDir('vibe-stagehand-missing-');

    await assert.rejects(
      execFileAsync(process.execPath, [scriptPath], { cwd: root, windowsHide: true }),
      (error: unknown) => {
        const actual = error as { code?: number; stderr?: string };
        assert.equal(actual.code, 1);
        assert.match(actual.stderr ?? '', /@browserbasehq\/stagehand is not installed/);
        assert.match(actual.stderr ?? '', /npm install -D @browserbasehq\/stagehand/);
        assert.match(actual.stderr ?? '', /CHROME_PATH/);
        assert.match(actual.stderr ?? '', /npm run vibe:test-ui/);
        return true;
      },
    );
  });

  it('lists the harness UI test files without launching a browser', async () => {
    const result = await execFileAsync(process.execPath, [scriptPath, '--list'], {
      cwd: process.cwd(),
      windowsHide: true,
    });

    assert.match(result.stdout, /\.vibe\/harness\/test\/stagehand\/dashboard-report\.test\.ts/);
    assert.match(result.stdout, /Total: \d+ test files?/);
  });

  it('prints usage for --help', async () => {
    const result = await execFileAsync(process.execPath, [scriptPath, '--help'], {
      cwd: process.cwd(),
      windowsHide: true,
    });

    assert.match(result.stdout, /vibe-stagehand-test\.mjs/);
    assert.match(result.stdout, /--import tsx --test/);
    assert.match(result.stdout, /--list/);
  });
});

/** A stand-in for Chrome's DevTools endpoint: it accepts connections until it is closed. */
async function listenLocal(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = net.createServer((socket) => socket.destroy());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('closeLaunchedBrowser', () => {
  it('counts a rejected close as closed once the DevTools endpoint is gone, then removes the profile', async () => {
    const profile = await makeTempDir('vibe-stagehand-profile-');
    const endpoint = await listenLocal();
    const browser = {
      cdpUrl: endpoint.url,
      // What Stagehand does on Windows under load: Chrome exits, close() still rejects.
      close: async () => {
        await endpoint.close();
        throw new Error('taskkill exited with code 255');
      },
    };

    await closeLaunchedBrowser(browser, profile);

    assert.equal(existsSync(profile), false);
  });

  it('rethrows the close error while the DevTools endpoint still accepts connections', async () => {
    const profile = await makeTempDir('vibe-stagehand-profile-');
    const endpoint = await listenLocal();
    try {
      const browser = {
        cdpUrl: endpoint.url,
        close: async () => {
          throw new Error('taskkill exited with code 255');
        },
      };

      await assert.rejects(
        closeLaunchedBrowser(browser, profile, { exitTimeoutMs: 300 }),
        /taskkill exited with code 255/,
      );
      assert.equal(existsSync(profile), true);
    } finally {
      await endpoint.close();
    }
  });

  it('removes the profile after a clean close', async () => {
    const profile = await makeTempDir('vibe-stagehand-profile-');

    await closeLaunchedBrowser({ cdpUrl: 'http://127.0.0.1:9', close: async () => undefined }, profile);

    assert.equal(existsSync(profile), false);
  });
});
