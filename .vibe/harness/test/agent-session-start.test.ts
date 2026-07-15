import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const tempDirs: string[] = [];
const scriptPath = path.resolve('.vibe', 'harness', 'scripts', 'vibe-agent-session-start.mjs');

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

function sessionStartEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    VIBE_SKIP_AGENT_SESSION_START: '0',
    ...extra,
  };
}

describe('vibe-agent-session-start', () => {
  it('records a session-started daily event without provider-specific hooks', async () => {
    const root = await makeTempDir('agent-session-start-');
    const strayCwd = await makeTempDir('agent-session-start-stray-');
    await mkdir(path.join(root, '.vibe'), { recursive: true });
    await writeFile(path.join(root, '.vibe', 'config.json'), '{}\n', 'utf8');

    const result = spawnSync(process.execPath, [scriptPath, '--hook'], {
      cwd: strayCwd,
      env: sessionStartEnv({ CLAUDE_PROJECT_DIR: root }),
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');

    const dailyDir = path.join(root, '.vibe', 'agent', 'daily');
    const [dailyFile] = await readdir(dailyDir);
    assert.match(dailyFile ?? '', /^\d{4}-\d{2}-\d{2}\.jsonl$/);

    const raw = await readFile(path.join(dailyDir, dailyFile ?? ''), 'utf8');
    const event = JSON.parse(raw.trim()) as {
      type?: string;
      payload?: { cwd?: string; invocation?: string };
    };
    assert.equal(event.type, 'session-started');
    assert.equal(event.payload?.cwd, root);
    assert.equal(event.payload?.invocation, 'hook');
  });

  it('auto-detects SessionStart from stdin and uses the input cwd', async () => {
    const root = await makeTempDir('agent-session-start-stdin-');
    const strayCwd = await makeTempDir('agent-session-start-stdin-stray-');
    await mkdir(path.join(root, '.vibe'), { recursive: true });
    await writeFile(path.join(root, '.vibe', 'config.json'), '{}\n', 'utf8');

    const env = sessionStartEnv({ CLAUDECODE: '1' });
    delete env.CLAUDE_PROJECT_DIR;
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: strayCwd,
      env,
      encoding: 'utf8',
      input: JSON.stringify({
        hook_event_name: 'SessionStart',
        cwd: root,
        session_id: 'session-stdin',
        source: 'startup',
      }),
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');

    const dailyDir = path.join(root, '.vibe', 'agent', 'daily');
    const [dailyFile] = await readdir(dailyDir);
    const raw = await readFile(path.join(dailyDir, dailyFile ?? ''), 'utf8');
    const event = JSON.parse(raw.trim()) as {
      payload?: { cwd?: string; sessionId?: string; source?: string; invocation?: string };
    };
    assert.equal(event.payload?.cwd, root);
    assert.equal(event.payload?.sessionId, 'session-stdin');
    assert.equal(event.payload?.source, 'startup');
    assert.equal(event.payload?.invocation, 'hook');
  });

  it('deduplicates repeated delivery of the same hook lifecycle but preserves source transitions', async () => {
    const root = await makeTempDir('agent-session-start-dedupe-');
    const strayCwd = await makeTempDir('agent-session-start-dedupe-stray-');
    await mkdir(path.join(root, '.vibe'), { recursive: true });
    await writeFile(path.join(root, '.vibe', 'config.json'), '{}\n', 'utf8');
    const env = sessionStartEnv({ CLAUDECODE: '1' });
    delete env.CLAUDE_PROJECT_DIR;

    const invoke = (source: string) => spawnSync(process.execPath, [scriptPath], {
      cwd: strayCwd,
      env,
      encoding: 'utf8',
      input: JSON.stringify({
        hook_event_name: 'SessionStart',
        cwd: root,
        session_id: 'same-session',
        source,
      }),
    });

    for (const source of ['startup', 'startup', 'resume']) {
      const result = invoke(source);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, '');
    }

    const dailyDir = path.join(root, '.vibe', 'agent', 'daily');
    const [dailyFile] = await readdir(dailyDir);
    const raw = await readFile(path.join(dailyDir, dailyFile ?? ''), 'utf8');
    const events = raw.trim().split(/\r?\n/).map((line) => JSON.parse(line) as {
      payload?: { sessionId?: string; source?: string };
    });
    assert.deepEqual(events.map((event) => event.payload?.source), ['startup', 'resume']);
    assert.ok(events.every((event) => event.payload?.sessionId === 'same-session'));
  });

  it('ignores piped stdin when invoked outside a hook context', async () => {
    const root = await makeTempDir('agent-session-start-non-hook-input-');
    const pipedRoot = await makeTempDir('agent-session-start-piped-root-');
    await mkdir(path.join(root, '.vibe'), { recursive: true });
    await mkdir(path.join(pipedRoot, '.vibe'), { recursive: true });
    await writeFile(path.join(root, '.vibe', 'config.json'), '{}\n', 'utf8');
    await writeFile(path.join(pipedRoot, '.vibe', 'config.json'), '{}\n', 'utf8');

    const env = sessionStartEnv();
    delete env.VIBE_ROOT;
    for (const key of Object.keys(env)) {
      if (key.startsWith('CLAUDE')) {
        delete env[key];
      }
    }
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: root,
      env,
      encoding: 'utf8',
      input: JSON.stringify({ hook_event_name: 'SessionStart', cwd: pipedRoot }),
    });

    assert.equal(result.status, 0, result.stderr);
    const dailyDir = path.join(root, '.vibe', 'agent', 'daily');
    const [dailyFile] = await readdir(dailyDir);
    const raw = await readFile(path.join(dailyDir, dailyFile ?? ''), 'utf8');
    const event = JSON.parse(raw.trim()) as {
      payload?: { cwd?: string; invocation?: string };
    };
    assert.equal(event.payload?.cwd, root);
    assert.equal(event.payload?.invocation, 'provider-wrapper');
    await assert.rejects(readdir(path.join(pipedRoot, '.vibe', 'agent', 'daily')), {
      code: 'ENOENT',
    });
  });

  it('keeps hook stdout empty when harness hooks are disabled', async () => {
    const root = await makeTempDir('agent-session-start-disabled-');
    const result = spawnSync(process.execPath, [scriptPath, '--hook'], {
      cwd: root,
      env: sessionStartEnv({ CLAUDE_PROJECT_DIR: root, VIBE_HARNESS_HOOKS: 'off' }),
      encoding: 'utf8',
    });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });

  it('can be skipped by env flag for nested provider invocations', async () => {
    const root = await makeTempDir('agent-session-start-skip-');
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: root,
      env: sessionStartEnv({ VIBE_ROOT: root, VIBE_SKIP_AGENT_SESSION_START: '1' }),
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);

    await assert.rejects(readdir(path.join(root, '.vibe', 'agent', 'daily')), {
      code: 'ENOENT',
    });
  });
});
