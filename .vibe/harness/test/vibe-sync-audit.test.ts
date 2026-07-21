import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const tempDirs: string[] = [];
const scriptPath = path.resolve('.vibe', 'harness', 'scripts', 'vibe-sync-audit.mjs');

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

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function readCurrentJson<T>(relativePath: string): Promise<T> {
  return JSON.parse(await readFile(path.resolve(relativePath), 'utf8')) as T;
}

async function scaffoldAuditRoot(root: string): Promise<{
  manifest: {
    files: {
      harness: string[];
      hybrid: Record<string, { harnessKeys?: string[]; projectKeys?: string[]; strategy?: string }>;
      project: string[];
    };
    migrations: Record<string, string | null>;
  };
}> {
  const [skill, runtime, manifest] = await Promise.all([
    readFile(path.resolve('.claude', 'skills', 'vibe-sync', 'SKILL.md'), 'utf8'),
    readFile(path.resolve('.vibe', 'harness', 'src', 'commands', 'sync.ts'), 'utf8'),
    readCurrentJson<{
      files: {
        harness: string[];
        hybrid: Record<string, { harnessKeys?: string[]; projectKeys?: string[]; strategy?: string }>;
        project: string[];
      };
      migrations: Record<string, string | null>;
    }>('.vibe/sync-manifest.json'),
  ]);

  await writeText(path.join(root, '.claude', 'skills', 'vibe-sync', 'SKILL.md'), skill);
  await writeText(path.join(root, '.vibe', 'harness', 'src', 'commands', 'sync.ts'), runtime);
  await writeJson(path.join(root, '.vibe', 'sync-manifest.json'), manifest);
  return { manifest };
}

function runAudit(root: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [scriptPath, '--root', root, '--format', 'json'], {
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('vibe-sync-audit', () => {
  it('passes the current checkout', () => {
    const result = runAudit(process.cwd());
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean;
      harnessCount: number;
      hybridCount: number;
      projectCount: number;
      skillSignals: string[];
      runtimeSignals: string[];
    };

    assert.equal(result.status, 0, result.stderr);
    assert.equal(parsed.ok, true);
    assert.ok(parsed.harnessCount > 0);
    assert.ok(parsed.hybridCount > 0);
    assert.ok(parsed.projectCount > 0);
    assert.equal(parsed.skillSignals.includes('dry-run-first'), true);
    assert.equal(parsed.runtimeSignals.includes('harness-typecheck-selection'), true);
  });

  it('fails when the harness manifest claims root source ownership', async () => {
    const root = await makeTempDir('vibe-sync-audit-src-owned-');
    const { manifest } = await scaffoldAuditRoot(root);
    manifest.files.harness.push('src/**');
    await writeJson(path.join(root, '.vibe', 'sync-manifest.json'), manifest);

    const result = runAudit(root);
    const parsed = JSON.parse(result.stdout) as { ok: boolean; findings: Array<{ id: string; path?: string }> };

    assert.equal(result.status, 1);
    assert.equal(parsed.ok, false);
    assert.equal(
      parsed.findings.some((finding) => finding.id === 'project-owned-harness-entry' && finding.path === 'src/**'),
      true,
    );
  });

  it('fails when the harness manifest claims root README ownership', async () => {
    const root = await makeTempDir('vibe-sync-audit-root-readme-owned-');
    const { manifest } = await scaffoldAuditRoot(root);
    manifest.files.harness.push('README.md');
    await writeJson(path.join(root, '.vibe', 'sync-manifest.json'), manifest);

    const result = runAudit(root);
    const parsed = JSON.parse(result.stdout) as { ok: boolean; findings: Array<{ id: string; path?: string }> };

    assert.equal(result.status, 1);
    assert.equal(parsed.ok, false);
    assert.equal(
      parsed.findings.some((finding) => finding.id === 'project-owned-harness-entry' && finding.path === 'README.md'),
      true,
    );
  });

  it('fails when package.json harness keys include product scripts', async () => {
    const root = await makeTempDir('vibe-sync-audit-package-owned-');
    const { manifest } = await scaffoldAuditRoot(root);
    manifest.files.hybrid['package.json'] = {
      ...manifest.files.hybrid['package.json'],
      harnessKeys: [...(manifest.files.hybrid['package.json']?.harnessKeys ?? []), 'scripts.test'],
    };
    await writeJson(path.join(root, '.vibe', 'sync-manifest.json'), manifest);

    const result = runAudit(root);
    const parsed = JSON.parse(result.stdout) as { ok: boolean; findings: Array<{ id: string; path?: string; detail?: string }> };

    assert.equal(result.status, 1);
    assert.equal(parsed.ok, false);
    assert.equal(
      parsed.findings.some(
        (finding) =>
          finding.id === 'forbidden-hybrid-key' &&
          finding.path === 'package.json' &&
          finding.detail?.includes('scripts.test'),
      ),
      true,
    );
  });

  it('fails when the sync runbook omits dry-run-first guidance', async () => {
    const root = await makeTempDir('vibe-sync-audit-skill-drift-');
    await scaffoldAuditRoot(root);
    const skillPath = path.join(root, '.claude', 'skills', 'vibe-sync', 'SKILL.md');
    const skill = await readFile(skillPath, 'utf8');
    await writeText(skillPath, skill.replace('npm run vibe:sync -- --dry-run', 'npm run vibe:sync -- --plan'));

    const result = runAudit(root);
    const parsed = JSON.parse(result.stdout) as { ok: boolean; findings: Array<{ id: string; signal?: string }> };

    assert.equal(result.status, 1);
    assert.equal(parsed.ok, false);
    assert.equal(
      parsed.findings.some((finding) => finding.id === 'missing-critical-signal' && finding.signal === 'dry-run-first'),
      true,
    );
  });

  it('warns (without failing) when product code imports harness internals beyond the surface', async () => {
    const root = await makeTempDir('vibe-sync-audit-ownership-');
    await scaffoldAuditRoot(root);
    await writeText(
      path.join(root, 'src', 'consumer.ts'),
      [
        "import { deriveFinalEvidenceManifest } from '../.vibe/harness/src/universal-integrity-core/index.js';",
        "import { readPacketState } from '../.vibe/harness/src/pro-roundtrip/importer.js';",
        'export const wired = [deriveFinalEvidenceManifest, readPacketState];',
        '',
      ].join('\n'),
    );

    const result = runAudit(root);
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean;
      warnings: Array<{ id: string; path?: string; target?: string }>;
      crossBoundaryImports: Array<{ file: string; target: string }>;
    };

    // Report-only: the ownership signal never gates the audit.
    assert.equal(result.status, 0, result.stderr);
    assert.equal(parsed.ok, true);
    assert.equal(
      parsed.warnings.some(
        (warning) =>
          warning.id === 'harness-internal-import' &&
          warning.path === 'src/consumer.ts' &&
          warning.target === '.vibe/harness/src/pro-roundtrip/importer.js',
      ),
      true,
    );
    assert.equal(
      parsed.crossBoundaryImports.some(
        (entry) =>
          entry.file === 'src/consumer.ts' &&
          entry.target === '.vibe/harness/src/universal-integrity-core/index.js',
      ),
      true,
    );

    // A project-declared allowlist extension silences the warning.
    await writeJson(path.join(root, '.vibe', 'config.json'), {
      audit: { harnessImportAllowlist: ['.vibe/harness/src/pro-roundtrip/importer.js'] },
    });
    const extended = runAudit(root);
    const extendedParsed = JSON.parse(extended.stdout) as {
      warnings: Array<{ id: string }>;
      crossBoundaryImports: Array<{ target: string }>;
    };
    assert.equal(extended.status, 0);
    assert.equal(extendedParsed.warnings.length, 0);
    assert.equal(extendedParsed.crossBoundaryImports.length, 2);
  });

  it('reports declared shared-module mirror drift without failing', async () => {
    const root = await makeTempDir('vibe-sync-audit-mirror-');
    await scaffoldAuditRoot(root);
    await writeText(path.join(root, 'shared', 'core', 'a.js'), 'export const a = 1;\n');
    await writeText(path.join(root, 'shared', 'core', 'b.js'), 'export const b = 2;\n');
    await writeText(path.join(root, '.vibe', 'harness', 'src', 'core-mirror', 'a.js'), 'export const a = 1;\n');
    await writeJson(path.join(root, '.vibe', 'config.json'), {
      audit: {
        sharedModuleMirrors: [
          { projectPath: 'shared/core', harnessPath: '.vibe/harness/src/core-mirror' },
        ],
      },
    });

    const drifted = runAudit(root);
    const driftedParsed = JSON.parse(drifted.stdout) as {
      ok: boolean;
      warnings: Array<{ id: string; path?: string }>;
      sharedModuleMirrors: Array<{ drifted: string[]; onlyInProject: string[]; onlyInHarness: string[] }>;
    };
    assert.equal(drifted.status, 0, drifted.stderr);
    assert.equal(driftedParsed.ok, true);
    assert.equal(
      driftedParsed.warnings.some(
        (warning) => warning.id === 'shared-module-drift' && warning.path === 'shared/core',
      ),
      true,
    );
    assert.deepEqual(driftedParsed.sharedModuleMirrors[0]?.onlyInProject, ['b.js']);

    // Identical mirrors report clean.
    await writeText(path.join(root, '.vibe', 'harness', 'src', 'core-mirror', 'b.js'), 'export const b = 2;\n');
    const clean = runAudit(root);
    const cleanParsed = JSON.parse(clean.stdout) as { warnings: Array<{ id: string }> };
    assert.equal(clean.status, 0);
    assert.equal(cleanParsed.warnings.filter((warning) => warning.id === 'shared-module-drift').length, 0);
  });
});
