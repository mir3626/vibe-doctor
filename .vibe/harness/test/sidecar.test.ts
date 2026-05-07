import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, it } from 'node:test';
import { SidecarArtifactSchema } from '../src/lib/schemas/index.js';

const execFileAsync = promisify(execFile);
const wrapperPath = path.join(process.cwd(), '.vibe', 'harness', 'scripts', 'vibe-sidecar-run.mjs');

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function makeProjectRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'vibe-sidecar-'));
  await mkdir(path.join(root, '.vibe', 'agent'), { recursive: true });
  await writeFile(path.join(root, '.vibe', 'agent', 'handoff.md'), '# handoff\n', 'utf8');
  await writeFile(
    path.join(root, '.vibe', 'agent', 'session-log.md'),
    '# session\n\n## Entries\n- seed\n',
    'utf8',
  );
  await writeJson(path.join(root, '.vibe', 'agent', 'sprint-status.json'), {
    schemaVersion: '0.1',
    project: { name: 'fixture' },
  });
  return root;
}

async function readDurableState(root: string): Promise<string[]> {
  return Promise.all([
    readFile(path.join(root, '.vibe', 'agent', 'handoff.md'), 'utf8'),
    readFile(path.join(root, '.vibe', 'agent', 'session-log.md'), 'utf8'),
    readFile(path.join(root, '.vibe', 'agent', 'sprint-status.json'), 'utf8'),
  ]);
}

async function runWrapper(root: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(process.execPath, [wrapperPath, 'diff-reviewer', '--sprint-id', 'sprint-sidecar', '--cwd', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
}

describe('vibe-sidecar-run', () => {
  it('writes a validated advisory artifact without touching durable state', async () => {
    const root = await makeProjectRoot();
    try {
      const before = await readDurableState(root);
      const mockOutput = path.join(root, 'mock-output.json');
      await writeJson(mockOutput, {
        schemaVersion: 1,
        sidecar: 'diff-reviewer',
        status: 'advisory',
        summary: 'One regression risk found.',
        findings: [
          {
            severity: 'medium',
            confidence: 'high',
            file: 'src/example.ts',
            line: 12,
            message: 'Changed branch no longer handles empty input.',
            recommendation: 'Restore the empty-input guard or add a regression test.',
          },
        ],
        limitations: ['Static diff review only.'],
        coverage: {
          inputFilesSeen: 1,
          diffBytesSeen: 120,
          truncated: false,
        },
      });

      const result = await runWrapper(root, ['--mock-output-file', mockOutput]);
      const artifactPath = result.stdout.trim();
      assert.equal(
        artifactPath.replaceAll('\\', '/').endsWith('.vibe/sidecars/artifacts/sprint-sidecar/diff-reviewer.json'),
        true,
      );

      const artifact = SidecarArtifactSchema.parse(JSON.parse(await readFile(artifactPath, 'utf8')));
      assert.equal(artifact.status, 'advisory');
      assert.equal(artifact.provider, 'mock');
      assert.equal(artifact.findings.length, 1);
      assert.match(artifact.inputHash, /^sha256:[a-f0-9]{64}$/);
      assert.deepEqual(await readDurableState(root), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('records malformed sidecar output as error instead of pass', async () => {
    const root = await makeProjectRoot();
    try {
      const mockOutput = path.join(root, 'bad-output.txt');
      await writeFile(mockOutput, 'not json', 'utf8');

      await runWrapper(root, ['--mock-output-file', mockOutput]);
      const artifactPath = path.join(root, '.vibe', 'sidecars', 'artifacts', 'sprint-sidecar', 'diff-reviewer.json');
      const artifact = SidecarArtifactSchema.parse(JSON.parse(await readFile(artifactPath, 'utf8')));
      assert.equal(artifact.status, 'error');
      assert.match(artifact.summary, /did not match/);
      assert.equal(artifact.findings.length, 0);
      assert.equal(artifact.rawPreview, 'not json');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('records timeout as unavailable', async () => {
    const root = await makeProjectRoot();
    try {
      const mockOutput = path.join(root, 'slow-output.json');
      await writeJson(mockOutput, {
        schemaVersion: 1,
        sidecar: 'diff-reviewer',
        status: 'pass',
        summary: 'No issues.',
        findings: [],
        limitations: [],
        coverage: { inputFilesSeen: 0, diffBytesSeen: 0, truncated: false },
      });

      await runWrapper(root, ['--mock-output-file', mockOutput, '--mock-delay-ms', '50', '--timeout-ms', '10']);
      const artifactPath = path.join(root, '.vibe', 'sidecars', 'artifacts', 'sprint-sidecar', 'diff-reviewer.json');
      const artifact = SidecarArtifactSchema.parse(JSON.parse(await readFile(artifactPath, 'utf8')));
      assert.equal(artifact.status, 'unavailable');
      assert.equal(artifact.error, 'timeout');
      assert.equal(artifact.findings.length, 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects path traversal sprint ids before artifact creation', async () => {
    const root = await makeProjectRoot();
    try {
      await assert.rejects(
        execFileAsync(
          process.execPath,
          [wrapperPath, 'diff-reviewer', '--sprint-id', '../bad', '--cwd', root, '--mock-output-file', 'missing'],
          { encoding: 'utf8' },
        ),
      );
      assert.equal(existsSync(path.join(root, '.vibe', 'sidecars')), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('ships sidecar runtime artifacts as ignored non-durable files', async () => {
    const gitignore = await readFile('.gitignore', 'utf8');
    assert.match(gitignore, /^\.vibe\/sidecars\/$/m);

    const manifest = JSON.parse(await readFile('.vibe/sync-manifest.json', 'utf8')) as {
      files: { harness: string[] };
    };
    assert.equal(manifest.files.harness.includes('.vibe/harness/sidecars/**'), true);
    assert.equal(manifest.files.harness.includes('.vibe/harness/schemas/**'), true);
    assert.equal(manifest.files.harness.includes('.codex/agents/**'), true);
    assert.equal(manifest.files.harness.includes('.claude/agents/**'), true);
  });
});
