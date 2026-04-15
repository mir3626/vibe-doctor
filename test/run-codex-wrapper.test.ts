import assert from 'node:assert/strict';
import { execFile as execFileCallback, execFileSync, spawnSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, it } from 'node:test';

const execFile = promisify(execFileCallback);
const tempDirs: string[] = [];
const bashScriptPath = path.resolve('scripts', 'run-codex.sh');
const cmdScriptPath = path.resolve('scripts', 'run-codex.cmd');
const rulesPath = path.resolve('.vibe', 'agent', '_common-rules.md');
const shellPath = process.env.COMSPEC ?? 'cmd.exe';

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

function detectWorkingBash(): string | null {
  try {
    execFileSync('bash', ['--version'], { stdio: 'ignore' });
    return 'bash';
  } catch {
    return null;
  }
}

const bashCommand = detectWorkingBash();

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeExecutable(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
  if (!filePath.endsWith('.cmd')) {
    await chmod(filePath, 0o755);
  }
}

async function createShellStubBin(mode: 'ok' | 'auth' | 'timeout' | 'stdin' | 'fail'): Promise<string> {
  const binDir = await makeTempDir('run-codex-shell-bin-');
  const codexScript = `#!/usr/bin/env bash
if [[ "\${1:-}" == "--version" ]]; then
  case "${mode}" in
    ok)
      echo "codex 0.9.1"
      exit 0
      ;;
    auth)
      echo "not authenticated" >&2
      exit 1
      ;;
    timeout)
      sleep 30
      exit 0
      ;;
    *)
      echo "codex 0.9.1"
      exit 0
      ;;
  esac
fi

if [[ "\${1:-}" == "exec" ]]; then
  case "${mode}" in
    stdin|ok)
      cat
      exit 0
      ;;
    fail)
      echo "plain failure" >&2
      exit 1
      ;;
    *)
      cat
      exit 0
      ;;
  esac
fi

exit 0
`;
  const timeoutScript = `#!/usr/bin/env bash
if [[ "\${TIMEOUT_STUB_MODE:-pass}" == "timeout" ]]; then
  exit 124
fi
shift
"\$@"
`;
  const sleepScript = '#!/usr/bin/env bash\nexit 0\n';

  await writeExecutable(path.join(binDir, 'codex'), codexScript);
  await writeExecutable(path.join(binDir, 'timeout'), timeoutScript);
  await writeExecutable(path.join(binDir, 'sleep'), sleepScript);
  return binDir;
}

async function createCmdStubBin(mode: 'ok' | 'stdin'): Promise<string> {
  const binDir = await makeTempDir('run-codex-cmd-bin-');
  const codexCmd = `@echo off
setlocal EnableExtensions
if "%~1"=="--version" (
  echo codex 0.9.1
  endlocal & exit /b 0
)
if "%~1"=="exec" (
  ${mode === 'stdin' ? 'more' : 'echo exec ok'}
  endlocal & exit /b 0
)
endlocal & exit /b 0
`;
  await writeExecutable(path.join(binDir, 'codex.cmd'), codexCmd);
  return binDir;
}

function shellEnv(binDir: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const inheritedEntries = Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path');
  const extraEntries = Object.entries(extra).filter(([key]) => key.toLowerCase() !== 'path');
  const inheritedEnv = Object.fromEntries(inheritedEntries);
  const extraEnv = Object.fromEntries(extraEntries);
  const explicitPathEntry = Object.entries(extra).find(([key]) => key.toLowerCase() === 'path');
  const basePath =
    explicitPathEntry
      ? (explicitPathEntry[1] ?? '')
      : (process.env.PATH ?? process.env.Path ?? '');

  return {
    ...inheritedEnv,
    ...extraEnv,
    PATH: basePath ? `${binDir}${path.delimiter}${basePath}` : binDir,
  };
}

describe('run-codex.sh wrapper', { skip: bashCommand === null }, () => {
  it('returns normalized version output for healthy codex', async () => {
    const binDir = await createShellStubBin('ok');
    const { stdout } = await execFile(bashCommand ?? 'bash', [bashScriptPath, '--health'], {
      env: shellEnv(binDir),
    });

    assert.equal(stdout.trim(), 'codex-cli 0.9.1');
  });

  it('returns rc=1 when codex is missing', async () => {
    const binDir = await makeTempDir('run-codex-empty-bin-');
    const bashExecutable =
      execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['bash'], {
        encoding: 'utf8',
      })
        .split(/\r?\n/)
        .find((entry) => entry.length > 0) ?? (bashCommand ?? 'bash');
    const minimalEnv = {
      PATH: binDir,
      HOME: process.env.HOME ?? process.env.USERPROFILE ?? '',
      USERPROFILE: process.env.USERPROFILE ?? '',
      SYSTEMROOT: process.env.SYSTEMROOT ?? '',
      TEMP: process.env.TEMP ?? '',
      TMP: process.env.TMP ?? '',
      TMPDIR: process.env.TMPDIR ?? '',
    };
    const child = spawnSync(bashExecutable, [bashScriptPath, '--health'], {
      env: minimalEnv,
      encoding: 'utf8',
    });

    assert.equal(child.status, 1);
    assert.match(child.stderr, /not found/i);
  });

  it('returns rc=2 when auth is missing', async () => {
    const binDir = await createShellStubBin('auth');

    await assert.rejects(
      execFile(bashCommand ?? 'bash', [bashScriptPath, '--health'], {
        env: shellEnv(binDir),
      }),
      (error: unknown) => {
        assert.equal(typeof error, 'object');
        assert.equal((error as { code?: number }).code, 2);
        assert.match((error as { stderr?: string }).stderr ?? '', /authentication missing|not authenticated/i);
        return true;
      },
    );
  });

  it('returns rc=2 on timeout-like health failures', async () => {
    const binDir = await createShellStubBin('timeout');

    await assert.rejects(
      execFile(bashCommand ?? 'bash', [bashScriptPath, '--health'], {
        env: shellEnv(binDir, { TIMEOUT_STUB_MODE: 'timeout' }),
      }),
      (error: unknown) => {
        assert.equal(typeof error, 'object');
        assert.equal((error as { code?: number }).code, 2);
        assert.match((error as { stderr?: string }).stderr ?? '', /hung|auth or config issue/i);
        return true;
      },
    );
  });

  it('emits retry logging and gives up after the configured attempts', async () => {
    const binDir = await createShellStubBin('fail');
    const child = spawnSync(bashCommand ?? 'bash', [bashScriptPath, 'prompt text'], {
      env: shellEnv(binDir, { CODEX_RETRY: '3', CODEX_RETRY_DELAY: '0' }),
      input: '',
      encoding: 'utf8',
    });

    assert.equal(child.status, 1);
    assert.match(child.stderr, /attempt 1\/3 starting/);
    assert.match(child.stderr, /attempt 1\/3 retrying reason=exit=1 delay=0s/);
    assert.match(child.stderr, /attempt 2\/3 retrying reason=exit=1 delay=0s/);
    assert.match(child.stderr, /giving up after 3 attempts/);
  });

  it('preserves stdin passthrough and common rules injection', async () => {
    const binDir = await createShellStubBin('stdin');
    const rules = await import('node:fs/promises').then(({ readFile }) => readFile(rulesPath, 'utf8'));
    const firstRuleLine = rules.split('\n')[0] ?? '';
    const child = spawnSync(bashCommand ?? 'bash', [bashScriptPath, '-'], {
      env: shellEnv(binDir),
      input: 'hello from stdin',
      encoding: 'utf8',
    });

    assert.equal(child.status, 0);
    assert.match(child.stdout, /hello from stdin/);
    assert.match(child.stdout, new RegExp(firstRuleLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});

describe('run-codex.cmd wrapper', { skip: process.platform !== 'win32' }, () => {
  // TODO(M10): cmd health output empty - investigate where/set /p behavior on Git Bash-spawned cmd.exe
  it.skip('returns normalized version output for healthy codex', async () => {
    const binDir = await createCmdStubBin('ok');
    const { stdout } = await execFile(shellPath, ['/d', '/c', cmdScriptPath, '--health'], {
      env: shellEnv(binDir),
    });

    assert.equal(stdout.trim(), 'codex-cli 0.9.1');
  });

  it('forwards stdin through the native cmd wrapper', async () => {
    const binDir = await createCmdStubBin('stdin');
    const child = spawnSync(shellPath, ['/d', '/c', cmdScriptPath, '-'], {
      env: shellEnv(binDir),
      input: 'hello from cmd stdin',
      encoding: 'utf8',
    });

    assert.equal(child.status, 0);
    assert.match(child.stdout, /hello from cmd stdin/);
  });
});
