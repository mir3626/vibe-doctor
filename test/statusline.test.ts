import assert from 'node:assert/strict';
import { execFile as execFileCallback, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const tempDirs: string[] = [];
const bashScriptPath = path.resolve('.claude', 'statusline.sh');
const powershellScriptPath = path.resolve('.claude', 'statusline.ps1');

function detectWorkingBash(): string | null {
  try {
    execFileSync('bash', ['--version'], { stdio: 'ignore' });
    return 'bash';
  } catch {
    return null;
  }
}

const bashCommand = detectWorkingBash();

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

async function writeJson(root: string, relativePath: string, value: unknown): Promise<void> {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeStatus(root: string): Promise<void> {
  await writeJson(root, path.join('.vibe', 'agent', 'sprint-status.json'), {
    handoff: {
      currentSprintId: 'sprint-M9-statusline-permissions',
    },
    sprintsSinceLastAudit: 8,
    sprints: [
      { id: 'sprint-a', status: 'passed' },
      { id: 'sprint-b', status: 'failed' },
      { id: 'sprint-c', status: 'passed' },
    ],
    pendingRisks: [
      { id: 'risk-a', status: 'open' },
      { id: 'risk-b', status: 'resolved' },
      { id: 'risk-c', status: 'open' },
    ],
  });
}

async function runBashStatusline(root: string) {
  return execFile(bashCommand ?? 'bash', [bashScriptPath], {
    cwd: root,
    env: process.env,
  });
}

async function runPowerShellStatusline(root: string) {
  return execFile('powershell', ['-File', powershellScriptPath], {
    cwd: root,
    env: process.env,
  });
}

describe('statusline.sh', { skip: bashCommand === null }, () => {
  it('renders the normal output when sprint and token state files are present', async () => {
    const root = await makeTempDir('statusline-normal-');
    await writeStatus(root);
    await writeJson(root, path.join('.vibe', 'agent', 'tokens.json'), {
      updatedAt: '2026-04-16T00:00:00.000Z',
      cumulativeTokens: 12_345,
      elapsedSeconds: 120,
      sprintTokens: {
        'sprint-M9-statusline-permissions': 12_345,
      },
    });

    const { stdout } = await runBashStatusline(root);

    assert.match(stdout, /^S .+ \(\d+\/\d+\) \|\s*\d+m \|\s*\d+K tok \|\s*\d+ risks$/);
  });

  it('renders sprint info and risks when tokens.json is missing', async () => {
    const root = await makeTempDir('statusline-no-tokens-');
    await writeStatus(root);

    const { stdout } = await runBashStatusline(root);

    assert.equal(stdout, 'S sprint-M9-statusline-permissions (2/3) | 2 risks');
    assert.doesNotMatch(stdout, /tok|m \|/);
  });

  it('prints nothing and exits successfully when sprint-status.json is missing', async () => {
    const root = await makeTempDir('statusline-no-status-');

    const { stdout, stderr } = await runBashStatusline(root);

    assert.equal(stdout, '');
    assert.equal(stderr, '');
  });

  it('renders zero tokens as 0K tok', async () => {
    const root = await makeTempDir('statusline-zero-tokens-');
    await writeStatus(root);
    await writeJson(root, path.join('.vibe', 'agent', 'tokens.json'), {
      updatedAt: '2026-04-16T00:00:00.000Z',
      cumulativeTokens: 0,
      elapsedSeconds: 0,
      sprintTokens: {},
    });

    const { stdout } = await runBashStatusline(root);

    assert.match(stdout, /\| 0K tok \|/);
  });
});

describe('statusline.ps1', { skip: process.platform !== 'win32' }, () => {
  it('matches the same one-line contract on Windows', async () => {
    const root = await makeTempDir('statusline-ps1-');
    await writeStatus(root);
    await writeJson(root, path.join('.vibe', 'agent', 'tokens.json'), {
      updatedAt: '2026-04-16T00:00:00.000Z',
      cumulativeTokens: 2_000,
      elapsedSeconds: 61,
      sprintTokens: {
        'sprint-M9-statusline-permissions': 2_000,
      },
    });

    const { stdout } = await runPowerShellStatusline(root);

    assert.equal(stdout, 'S sprint-M9-statusline-permissions (2/3) | 1m | 2K tok | 2 risks');
  });
});
