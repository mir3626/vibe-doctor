import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, it } from 'node:test';

const tempDirs: string[] = [];
const scriptPath = path.resolve('scripts', 'vibe-rule-audit.mjs');

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

async function writeText(filePath: string, value: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, 'utf8');
}

async function runRuleAudit(args: string[] = []): Promise<{ status: number; stdout: string; stderr: string }> {
  const originalArgv = process.argv;
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  let stdout = '';
  let stderr = '';

  process.argv = [process.execPath, scriptPath, ...args];
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;

  try {
    await import(`${pathToFileURL(scriptPath).href}?case=${Date.now()}-${Math.random()}`);
    return { status: 0, stdout, stderr };
  } finally {
    process.argv = originalArgv;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
}

describe('vibe-rule-audit', () => {
  it('emits JSON with covered and uncovered rule candidates', async () => {
    const root = await makeTempDir('rule-audit-json-');
    const claudePath = path.join(root, 'CLAUDE.md');
    const gapsPath = path.join(root, 'harness-gaps.md');
    await writeText(
      claudePath,
      [
        '# CLAUDE',
        'This line MUST mention gap-covered-rule.',
        'This line MUST NOT rely on undocumented process.',
        '```',
        'NEVER count this fenced line.',
        '```',
      ].join('\n'),
    );
    await writeText(
      gapsPath,
      [
        '| id | symptom | covered_by | status | script-gate | migration-deadline |',
        '|---|---|---|---|---|---|',
        '| gap-covered-rule | sample | `script` | covered | covered | — |',
      ].join('\n'),
    );

    const result = await runRuleAudit([
      '--format=json',
      `--claude-md=${claudePath}`,
      `--gaps=${gapsPath}`,
    ]);
    const parsed = JSON.parse(result.stdout) as {
      summary: { total: number; covered: number; uncovered: number };
      rules: Array<{ text: string; covered: boolean; coveredBy: string | null }>;
    };

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(parsed.summary, { total: 2, covered: 1, uncovered: 1 });
    assert.equal(parsed.rules[0]?.coveredBy, 'gap-covered-rule');
    assert.equal(parsed.rules[1]?.covered, false);
    assert.equal(parsed.rules.some((rule) => rule.text.includes('fenced')), false);
  });

  it('renders both text sections and explicit empty covered output', async () => {
    const root = await makeTempDir('rule-audit-text-');
    const claudePath = path.join(root, 'CLAUDE.md');
    const gapsPath = path.join(root, 'harness-gaps.md');
    await writeText(claudePath, 'Operators MUST record decisions.\n');
    await writeText(
      gapsPath,
      [
        '| id | symptom | covered_by | status | script-gate | migration-deadline |',
        '|---|---|---|---|---|---|',
        '| gap-open-rule | sample | `script` | open | pending | — |',
      ].join('\n'),
    );

    const result = await runRuleAudit([`--claude-md=${claudePath}`, `--gaps=${gapsPath}`]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /## Uncovered \(candidates for next Sprint\)/);
    assert.match(result.stdout, /## Covered/);
    assert.match(result.stdout, /## Covered\n\(none\)/);
  });
});
