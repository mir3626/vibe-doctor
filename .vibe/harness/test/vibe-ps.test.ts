import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, it } from 'node:test';
import {
  BOOTSTRAP_PATH,
  bootstrapEnv,
  parseArgs,
  resolveShell,
  USAGE_EXIT,
} from '../scripts/vibe-ps.mjs';

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];
const scriptPath = path.join(process.cwd(), '.vibe', 'harness', 'scripts', 'vibe-ps.mjs');

// Text that breaks inline PowerShell: typographic quotes and dashes, Korean, `$`, a backtick, double quotes.
const HARD_TEXT = '회장 “인용” — 대시 ‘작은’ – $x `b "q"';

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

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(args: string[], cwd: string): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, ...args], {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60_000,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof failed.code === 'number' ? failed.code : -1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
  }
}

function lines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.length > 0);
}

describe('vibe-ps command line', () => {
  it('stops reading options at the script and passes everything after it through', () => {
    const plan = parseArgs(['--param', 'Title=a=b', '--param', 'Loud', '--env', 'K=v', 'run.ps1', '--', '--param', 'x']);
    assert.equal(plan.file, 'run.ps1');
    assert.deepEqual(plan.params, { Title: 'a=b', Loud: true });
    assert.deepEqual(plan.env, { K: 'v' });
    assert.deepEqual(plan.args, ['--param', 'x']);

    const inline = parseArgs(['--check', '-c', 'param($a) $a', 'one', 'two']);
    assert.equal(inline.code, 'param($a) $a');
    assert.equal(inline.check, true);
    assert.deepEqual(inline.args, ['one', 'two']);
  });

  it('refuses a call it cannot read', () => {
    assert.throws(() => parseArgs([]), /script path or -c/);
    assert.throws(() => parseArgs(['--env', 'NOVALUE', 'x.ps1']), /<name>=<value>/);
    assert.throws(() => parseArgs(['--shell', 'cmd', 'x.ps1']), /auto, pwsh or powershell/);
    assert.throws(() => parseArgs(['--what', 'x.ps1']), /unknown option/);
  });

  it('sends the call as JSON data and keeps a caller\'s own VIBE_PS_ variables out', async () => {
    const dir = await makeTempDir('vibe-ps-env-');
    await writeFile(path.join(dir, 'note.txt'), `\uFEFF${HARD_TEXT}`, 'utf8');
    const plan = parseArgs(['--param', `Title=${HARD_TEXT}`, '--param-file', 'Note=note.txt', '--env', 'MY_DATA=1', 'a.ps1', HARD_TEXT]);
    const env = bootstrapEnv(plan, { PATH: 'p', VIBE_PS_CODE: 'stale', vibe_ps_check: '1' }, dir);
    assert.equal(env.VIBE_PS_FILE, path.join(dir, 'a.ps1'));
    assert.equal(env.VIBE_PS_CODE, undefined);
    assert.equal(env.vibe_ps_check, undefined);
    assert.equal(env.VIBE_PS_CHECK, undefined);
    assert.equal(env.MY_DATA, '1');
    assert.deepEqual(JSON.parse(env.VIBE_PS_ARGS ?? ''), [HARD_TEXT]);
    assert.deepEqual(JSON.parse(env.VIBE_PS_PARAMS ?? ''), { Title: HARD_TEXT, Note: HARD_TEXT });
  });

  it('prefers pwsh on PATH and falls back to nothing off Windows', async () => {
    const dir = await makeTempDir('vibe-ps-path-');
    await writeFile(path.join(dir, 'pwsh'), '', 'utf8');
    assert.equal(resolveShell('auto', { PATH: dir }, 'linux'), path.join(dir, 'pwsh'));
    assert.equal(resolveShell('auto', { PATH: path.join(dir, 'none') }, 'linux'), null);
    assert.equal(resolveShell('pwsh', { PATH: path.join(dir, 'none') }, 'linux'), null);
  });

  it('keeps the bootstrap ASCII-only, so no PowerShell can misread it', async () => {
    const text = await readFile(BOOTSTRAP_PATH, 'utf8');
    assert.deepEqual([...text].filter((char) => char.charCodeAt(0) > 127), []);
  });

  it('answers a usage error with its own exit code', async () => {
    const dir = await makeTempDir('vibe-ps-usage-');
    const result = await run(['--shell'], dir);
    assert.equal(result.code, USAGE_EXIT);
    assert.match(result.stderr, /--shell expects/);
  });
});

const shells = [
  { name: 'pwsh', path: resolveShell('pwsh') },
  ...(process.platform === 'win32' ? [{ name: 'powershell', path: resolveShell('powershell') }] : []),
];

for (const shell of shells) {
  describe(`vibe-ps running ${shell.name}`, { skip: shell.path === null ? `${shell.name} is not installed` : false }, () => {
    async function scriptDir(): Promise<string> {
      // A Korean folder name with a space: the path itself is data too.
      const dir = path.join(await makeTempDir('vibe-ps-run-'), '시험 폴더');
      await mkdir(dir);
      return dir;
    }

    it('passes text as data unchanged and reads a BOM-less UTF-8 script as UTF-8', async () => {
      const dir = await scriptDir();
      // BOM-less on purpose: Windows PowerShell 5.1 would read the Korean literal in the ANSI code page.
      await writeFile(
        path.join(dir, 'echo.ps1'),
        [
          'param([string]$First, [string]$Title, [string]$Note, [switch]$Loud)',
          '# 주석의 “따옴표”와 — 대시는 괜찮다',
          'Write-Output "first=$First"',
          'Write-Output "title=$Title"',
          'Write-Output "note=$Note"',
          'Write-Output "loud=$Loud"',
          'Write-Output ("env=" + $env:MY_DATA)',
          'Write-Output "root=$PSScriptRoot"',
          'Write-Output "한글 — 리터럴"',
        ].join('\n'),
        'utf8',
      );
      await writeFile(path.join(dir, 'note.txt'), HARD_TEXT, 'utf8');
      const result = await run(
        ['--shell', shell.name, '--param', `Title=${HARD_TEXT}`, '--param-file', 'Note=note.txt', '--param', 'Loud', '--env', `MY_DATA=${HARD_TEXT}`, 'echo.ps1', HARD_TEXT],
        dir,
      );
      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(lines(result.stdout), [
        `first=${HARD_TEXT}`,
        `title=${HARD_TEXT}`,
        `note=${HARD_TEXT}`,
        'loud=True',
        `env=${HARD_TEXT}`,
        `root=${dir}`,
        '한글 — 리터럴',
      ]);
    });

    it('ends with the script\'s exit code, and with 1 when an error stops it', async () => {
      const dir = await scriptDir();
      await writeFile(path.join(dir, 'end.ps1'), 'param($How)\nif ($How -eq "exit") { try { exit 3 } catch { "caught" } }\nif ($How -eq "throw") { throw "멈춤" }\nGet-Item -LiteralPath (Join-Path $PSScriptRoot "없는 파일")\n', 'utf8');
      const exited = await run(['--shell', shell.name, 'end.ps1', 'exit'], dir);
      assert.equal(exited.code, 3);
      assert.doesNotMatch(exited.stdout, /caught/);
      const thrown = await run(['--shell', shell.name, 'end.ps1', 'throw'], dir);
      assert.equal(thrown.code, 1);
      assert.match(thrown.stderr, /end\.ps1: 멈춤/);
      // $ErrorActionPreference is Stop: a missing file is not a warning that scrolls past.
      const missing = await run(['--shell', shell.name, 'end.ps1', 'go-on'], dir);
      assert.equal(missing.code, 1);
    });

    it('refuses typographic quotes and dashes in the code before running it, and only there', async () => {
      const dir = await scriptDir();
      await writeFile(
        path.join(dir, 'pasted.ps1'),
        [
          '# “주석”은 괜찮다 — 정말',
          'Write-Output “pasted”',
          'Get-ChildItem —Path .',
          '$fine = "문자열 안의 — 대시"',
          '$here = @"',
          '여기 “따옴표”',
          '"@',
        ].join('\n'),
        'utf8',
      );
      const refused = await run(['--shell', shell.name, 'pasted.ps1'], dir);
      assert.equal(refused.code, 65);
      assert.deepEqual(
        lines(refused.stderr).map((line) => line.replace(/^.*pasted\.ps1:/, '').split(' ').slice(0, 2).join(' ')),
        ['2:14: U+201C', '2:21: U+201D', '3:15: U+2014'],
      );
      assert.equal(refused.stdout, '');
      const allowed = await run(['--shell', shell.name, '--check', '--allow-typographic', 'pasted.ps1'], dir);
      assert.equal(allowed.code, 0, allowed.stderr);
    });

    it('checks inline code without running it, and reports a parse error with its place', async () => {
      const dir = await scriptDir();
      const checked = await run(['--shell', shell.name, '--check', '-c', 'Write-Output ran'], dir);
      assert.equal(checked.code, 0, checked.stderr);
      assert.deepEqual(lines(checked.stdout), ['<code>: ok']);
      const inline = await run(['--shell', shell.name, '-c', 'param($a) "got [$a]"', '--', HARD_TEXT], dir);
      assert.deepEqual(lines(inline.stdout), [`got [${HARD_TEXT}]`]);
      const broken = await run(['--shell', shell.name, '-c', 'if ( {'], dir);
      assert.equal(broken.code, 65);
      assert.match(broken.stderr, /^<code>:1:\d+: /m);
    });
  });
}
