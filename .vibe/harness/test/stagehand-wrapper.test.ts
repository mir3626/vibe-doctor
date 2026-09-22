import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, it } from 'node:test';

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
