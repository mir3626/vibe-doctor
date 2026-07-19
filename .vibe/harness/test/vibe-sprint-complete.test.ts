import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, it } from 'node:test';

const tempDirs: string[] = [];
const sprintCompleteScriptPath = path.resolve('.vibe', 'harness', 'scripts', 'vibe-sprint-complete.mjs');
type ArchiveSprintPrompts = (sprintId: string, rootDir?: string) => string[];
type ValidateActiveProSprintCompletion = (
  sprintId: string,
  status: string,
  rootDir: string,
  currentHead: string,
) => { required: boolean; checkpointPath: string | null };

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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function loadArchiveSprintPrompts(): Promise<ArchiveSprintPrompts> {
  const moduleUrl = pathToFileURL(sprintCompleteScriptPath).href;
  const loaded: unknown = await import(moduleUrl);

  if (!isRecord(loaded) || typeof loaded.archiveSprintPrompts !== 'function') {
    throw new Error('archiveSprintPrompts export missing');
  }

  return loaded.archiveSprintPrompts as ArchiveSprintPrompts;
}

async function loadProCompletionGate(): Promise<ValidateActiveProSprintCompletion> {
  const moduleUrl = pathToFileURL(sprintCompleteScriptPath).href;
  const loaded: unknown = await import(moduleUrl);

  if (
    !isRecord(loaded) ||
    typeof loaded.validateActiveProSprintCompletion !== 'function'
  ) {
    throw new Error('validateActiveProSprintCompletion export missing');
  }

  return loaded.validateActiveProSprintCompletion as ValidateActiveProSprintCompletion;
}

describe('vibe-sprint-complete', () => {
  it('archives exact sprint prompt names and suffixed prompt names only', async () => {
    const root = await makeTempDir('vibe-sprint-complete-');
    const sprintId = 'sprint-M5-native-interview';
    const promptDir = path.join(root, 'docs', 'prompts');
    const archiveDir = path.join(root, '.vibe', 'archive', 'prompts');

    await mkdir(promptDir, { recursive: true });
    await writeFile(path.join(promptDir, `${sprintId}.md`), 'exact\n', 'utf8');
    await writeFile(path.join(promptDir, `${sprintId}-fix.md`), 'suffix\n', 'utf8');
    await writeFile(path.join(promptDir, 'sprint-M5.md'), 'partial\n', 'utf8');

    const archiveSprintPrompts = await loadArchiveSprintPrompts();
    const archived = archiveSprintPrompts(sprintId, root);

    assert.deepEqual(
      archived.toSorted(),
      [
        path.join(archiveDir, `${sprintId}.md`).replace(/\\/g, '/'),
        path.join(archiveDir, `${sprintId}-fix.md`).replace(/\\/g, '/'),
      ].toSorted(),
    );
    assert.equal(await fileExists(path.join(promptDir, `${sprintId}.md`)), false);
    assert.equal(await fileExists(path.join(promptDir, `${sprintId}-fix.md`)), false);
    assert.equal(await readFile(path.join(promptDir, 'sprint-M5.md'), 'utf8'), 'partial\n');
    assert.equal(await readFile(path.join(archiveDir, `${sprintId}.md`), 'utf8'), 'exact\n');
    assert.equal(await readFile(path.join(archiveDir, `${sprintId}-fix.md`), 'utf8'), 'suffix\n');
    assert.equal(await fileExists(path.join(archiveDir, 'sprint-M5.md')), false);
  });

  it('requires a HEAD-bound cumulative Pro checkpoint before Sprint completion', async () => {
    const root = await makeTempDir('vibe-pro-completion-gate-');
    const flowPath = 'flows/20260719/001-login-policy';
    const currentHead = 'b'.repeat(40);
    const packetRoot = path.join(
      root,
      '.vibe',
      'agent',
      'pro-roundtrip',
      '20260719',
      '001-login-policy',
    );
    await mkdir(path.join(packetRoot, 'sprints', 'SPR-001-login-policy'), {
      recursive: true,
    });
    await writeFile(
      path.join(root, '.vibe', 'agent', 'pro-roundtrip', 'ACTIVE.json'),
      `${JSON.stringify(
        {
          schemaVersion: 'vibe-pro-active-flow-v1',
          flowPath,
          repositoryFullName: 'owner/repo',
          codeBranch: 'main',
          baseSha: 'a'.repeat(40),
          designEventId: '0100--pro--design--r01',
          currentSprintId: 'SPR-001',
          sprintIds: ['SPR-001'],
          latestEventId: '0100--pro--design--r01',
          latestEventKind: 'design',
          nextActor: 'codex',
          nextWriteTarget:
            `${flowPath}/0200--codex--implementation-report--r01`,
          autoReportRequired: true,
          status: 'active',
          updatedAt: '2026-07-19T12:00:00Z',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const validate = await loadProCompletionGate();
    assert.throws(
      () => validate('SPR-001', 'passed', root, currentHead),
      /record the automatic Pro report checkpoint/,
    );

    const checkpointPath = path.join(
      packetRoot,
      'sprints',
      'SPR-001-login-policy',
      'CHECKPOINT.json',
    );
    await writeFile(
      checkpointPath,
      `${JSON.stringify(
        {
          schemaVersion: 'vibe-pro-sprint-checkpoint-v1',
          input: {
            flowPath,
            designEventId: '0100--pro--design--r01',
            sprintId: 'SPR-001',
            baseSha: 'a'.repeat(40),
            headSha: currentHead,
            sprintGatePassed: true,
            cumulativeGatePassed: true,
            finalGatePassed: false,
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    assert.throws(
      () => validate('SPR-001', 'passed', root, currentHead),
      /final workflow gate/,
    );

    const checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8')) as {
      input: { finalGatePassed: boolean };
    };
    checkpoint.input.finalGatePassed = true;
    await writeFile(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
    const activePath = path.join(
      root,
      '.vibe',
      'agent',
      'pro-roundtrip',
      'ACTIVE.json',
    );
    const active = JSON.parse(await readFile(activePath, 'utf8')) as {
      currentSprintId: string | null;
    };
    active.currentSprintId = null;
    await writeFile(activePath, `${JSON.stringify(active, null, 2)}\n`, 'utf8');
    assert.deepEqual(validate('SPR-001', 'passed', root, currentHead), {
      required: true,
      checkpointPath,
    });
  });
});
