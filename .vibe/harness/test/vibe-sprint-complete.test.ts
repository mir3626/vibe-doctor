import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, it } from 'node:test';

const execFile = promisify(execFileCallback);
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

function activeProState(flowPath: string, sprintIds = ['SPR-001']): Record<string, unknown> {
  return {
    schemaVersion: 'vibe-pro-active-flow-v1',
    flowPath,
    repositoryFullName: 'owner/repo',
    codeBranch: 'main',
    baseSha: 'a'.repeat(40),
    designEventId: '0100--pro--design--r01',
    currentSprintId: sprintIds[0] ?? null,
    sprintIds,
    latestEventId: '0100--pro--design--r01',
    latestEventKind: 'design',
    nextActor: 'codex',
    nextWriteTarget: `${flowPath}/0200--codex--implementation-report--r01`,
    autoReportRequired: true,
    status: 'active',
    updatedAt: '2026-07-19T12:00:00Z',
  };
}

async function writeActiveProFixture(
  root: string,
  flowPath = 'flows/20260719/001-login-policy',
  sprintIds = ['SPR-001'],
): Promise<{ activePath: string; packetRoot: string }> {
  const [, date, slug] = flowPath.split('/');
  if (!date || !slug) {
    throw new Error(`invalid test flow path: ${flowPath}`);
  }
  const proRoot = path.join(root, '.vibe', 'agent', 'pro-roundtrip');
  const packetRoot = path.join(proRoot, date, slug);
  await mkdir(path.join(packetRoot, 'sprints'), { recursive: true });
  const activePath = path.join(proRoot, 'ACTIVE.json');
  await writeFile(
    activePath,
    `${JSON.stringify(activeProState(flowPath, sprintIds), null, 2)}\n`,
    'utf8',
  );
  return { activePath, packetRoot };
}

async function writeIterationFixture(
  root: string,
  sprintId: string,
  executionBinding?: Record<string, unknown>,
  options: { duplicateCurrent?: boolean; includeSprint?: boolean } = {},
): Promise<void> {
  const entry = {
    id: 'iter-1',
    label: 'Goal loop',
    startedAt: '2026-08-31T00:00:00.000Z',
    completedAt: null,
    goal: 'drain the local queue',
    plannedSprints: options.includeSprint === false ? ['another-sprint'] : [sprintId],
    completedSprints: [],
    milestoneProgress: {},
    summary: '',
    ...(executionBinding ? { executionBinding } : {}),
  };
  await writeIterationHistoryFixture(root, {
    currentIteration: 'iter-1',
    iterations: options.duplicateCurrent ? [entry, { ...entry }] : [entry],
  });
}

async function writeIterationHistoryFixture(
  root: string,
  history: Record<string, unknown>,
): Promise<void> {
  const stateDir = path.join(root, '.vibe', 'agent');
  await mkdir(stateDir, { recursive: true });
  await writeFile(
    path.join(stateDir, 'iteration-history.json'),
    `${JSON.stringify(history, null, 2)}\n`,
    'utf8',
  );
}

async function writeSprintCompletionCliFixture(
  root: string,
  sprintId: string,
): Promise<void> {
  const stateDir = path.join(root, '.vibe', 'agent');
  await mkdir(stateDir, { recursive: true });
  await writeFile(
    path.join(stateDir, 'sprint-status.json'),
    `${JSON.stringify({
      schemaVersion: '0.1',
      project: {
        name: 'test-project',
        createdAt: '2026-08-30T00:00:00.000Z',
      },
      sprints: [
        {
          id: sprintId,
          name: sprintId,
          status: 'passed',
          completedAt: '2026-08-30T01:00:00.000Z',
        },
      ],
      verificationCommands: [],
      pendingRisks: [],
      lastSprintScope: [],
      lastSprintScopeGlob: [],
      sprintsSinceLastAudit: 1,
      stateUpdatedAt: '2026-08-30T01:00:00.000Z',
      handoff: {
        currentSprintId: 'idle',
        lastActionSummary: 'ready',
        orchestratorContextBudget: 'low',
        preferencesActive: [],
        handoffDocPath: '.vibe/agent/handoff.md',
        updatedAt: '2026-08-30T01:00:00.000Z',
      },
    }, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    path.join(stateDir, 'handoff.md'),
    [
      '# Handoff',
      '',
      '## 2. Status: IDLE',
      '',
      '## 3. Sprint History',
      '',
      '| Sprint | Summary | Status |',
      '|---|---|---|',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    path.join(stateDir, 'session-log.md'),
    '# Session Log\n\n## Entries\n',
    'utf8',
  );
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

  it('allows a durable standalone Sprint and leaves unrelated Pro state byte-identical', async () => {
    const root = await makeTempDir('vibe-standalone-completion-gate-');
    const localSprintId = 'iter-1-sprint-01-local';
    const { activePath, packetRoot } = await writeActiveProFixture(root);
    const packetEvidencePath = path.join(packetRoot, 'FLOW.json');
    await writeFile(packetEvidencePath, '{"immutable":true}\n', 'utf8');
    const validate = await loadProCompletionGate();

    assert.throws(
      () => validate(localSprintId, 'passed', root, 'b'.repeat(40)),
      /does not contain Sprint/,
    );

    await writeIterationFixture(root, localSprintId, {
      executionLane: 'standalone-goal-iterate',
      proFlowPath: null,
    });
    const activeBefore = await readFile(activePath);
    const packetBefore = await readFile(packetEvidencePath);

    assert.deepEqual(validate(localSprintId, 'passed', root, 'b'.repeat(40)), {
      required: false,
      checkpointPath: null,
    });
    assert.deepEqual(await readFile(activePath), activeBefore);
    assert.deepEqual(await readFile(packetEvidencePath), packetBefore);

    await writeIterationFixture(root, localSprintId, {
      executionLane: 'standalone-goal-iterate',
      proFlowPath: null,
    });
    assert.deepEqual(validate(localSprintId, 'passed', root, 'b'.repeat(40)), {
      required: false,
      checkpointPath: null,
    });
  });

  it('requires the exact active flow for an explicit Pro execution binding', async () => {
    const flowPath = 'flows/20260719/001-login-policy';
    const validate = await loadProCompletionGate();

    const missingRoot = await makeTempDir('vibe-pro-binding-missing-active-');
    await writeIterationFixture(missingRoot, 'SPR-001', {
      executionLane: 'pro-roundtrip',
      proFlowPath: flowPath,
    });
    assert.throws(
      () => validate('SPR-001', 'passed', missingRoot, 'b'.repeat(40)),
      /requires active flow/,
    );

    const mismatchRoot = await makeTempDir('vibe-pro-binding-mismatch-');
    await writeActiveProFixture(mismatchRoot, flowPath);
    await writeIterationFixture(mismatchRoot, 'SPR-001', {
      executionLane: 'pro-roundtrip',
      proFlowPath: 'flows/20260719/002-other-flow',
    });
    assert.throws(
      () => validate('SPR-001', 'passed', mismatchRoot, 'b'.repeat(40)),
      /does not match active flow/,
    );

    const invalidRoot = await makeTempDir('vibe-pro-binding-invalid-');
    await writeActiveProFixture(invalidRoot, flowPath);
    await writeIterationFixture(invalidRoot, 'SPR-001', {
      executionLane: 'pro-roundtrip',
      proFlowPath: null,
    });
    assert.throws(
      () => validate('SPR-001', 'passed', invalidRoot, 'b'.repeat(40)),
      /invalid iteration execution binding/,
    );
  });

  it('rejects ambiguous standalone iteration owners without inferring from Sprint names', async () => {
    const validate = await loadProCompletionGate();
    const duplicateRoot = await makeTempDir('vibe-standalone-duplicate-owner-');
    await writeIterationFixture(
      duplicateRoot,
      'iter-1-sprint-01-local',
      { executionLane: 'standalone-goal-iterate', proFlowPath: null },
      { duplicateCurrent: true },
    );
    assert.throws(
      () => validate('iter-1-sprint-01-local', 'passed', duplicateRoot, 'b'.repeat(40)),
      /has 2 durable entries/,
    );

    const ambiguousRoot = await makeTempDir('vibe-standalone-ambiguous-owner-');
    const completedEntry = {
      id: 'iter-old',
      label: 'Completed local loop',
      startedAt: '2026-08-30T00:00:00.000Z',
      completedAt: '2026-08-30T01:00:00.000Z',
      goal: 'completed local work',
      plannedSprints: ['same-sprint'],
      completedSprints: ['same-sprint'],
      milestoneProgress: {},
      summary: 'done',
      executionBinding: {
        executionLane: 'standalone-goal-iterate',
        proFlowPath: null,
      },
    };
    await writeIterationHistoryFixture(ambiguousRoot, {
      currentIteration: null,
      iterations: [completedEntry, { ...completedEntry, id: 'iter-also-old' }],
    });
    assert.throws(
      () => validate('same-sprint', 'passed', ambiguousRoot, 'b'.repeat(40)),
      /has 2 completed bound iteration owners/,
    );
  });

  it('keeps a same-named legacy Pro Sprint gated despite completed standalone history', async () => {
    const root = await makeTempDir('vibe-legacy-pro-standalone-collision-');
    const flowPath = 'flows/20260719/001-login-policy';
    const { packetRoot } = await writeActiveProFixture(root, flowPath, ['SPR-001']);
    await mkdir(path.join(packetRoot, 'sprints', 'SPR-001-login-policy'), {
      recursive: true,
    });
    await writeIterationHistoryFixture(root, {
      currentIteration: null,
      iterations: [
        {
          id: 'iter-old',
          label: 'Old local loop',
          startedAt: '2026-08-30T00:00:00.000Z',
          completedAt: '2026-08-30T01:00:00.000Z',
          goal: 'completed local work',
          plannedSprints: ['SPR-001'],
          completedSprints: ['SPR-001'],
          milestoneProgress: {},
          summary: 'done',
          executionBinding: {
            executionLane: 'standalone-goal-iterate',
            proFlowPath: null,
          },
        },
      ],
    });

    const validate = await loadProCompletionGate();
    assert.throws(
      () => validate('SPR-001', 'passed', root, 'b'.repeat(40)),
      /record the automatic Pro report checkpoint/,
    );
  });

  it('replays a completed standalone Sprint after the current iteration advances', async () => {
    const root = await makeTempDir('vibe-standalone-repeat-completion-');
    await writeActiveProFixture(root, 'flows/20260719/001-login-policy', ['SPR-001']);
    await writeIterationHistoryFixture(root, {
      currentIteration: 'iter-next',
      iterations: [
        {
          id: 'iter-old',
          label: 'Completed local loop',
          startedAt: '2026-08-30T00:00:00.000Z',
          completedAt: '2026-08-30T01:00:00.000Z',
          goal: 'completed local work',
          plannedSprints: ['iter-old-sprint-01'],
          completedSprints: ['iter-old-sprint-01'],
          milestoneProgress: {},
          summary: 'done',
          executionBinding: {
            executionLane: 'standalone-goal-iterate',
            proFlowPath: null,
          },
        },
        {
          id: 'iter-next',
          label: 'Next local loop',
          startedAt: '2026-08-31T00:00:00.000Z',
          completedAt: null,
          goal: 'next work',
          plannedSprints: ['iter-next-sprint-01'],
          completedSprints: [],
          milestoneProgress: {},
          summary: '',
          executionBinding: {
            executionLane: 'standalone-goal-iterate',
            proFlowPath: null,
          },
        },
      ],
    });

    const validate = await loadProCompletionGate();
    assert.deepEqual(
      validate('iter-old-sprint-01', 'passed', root, 'b'.repeat(40)),
      { required: false, checkpointPath: null },
    );
  });

  it('does not mutate the next iteration during a full CLI replay of an old standalone Sprint', async () => {
    const root = await makeTempDir('vibe-standalone-cli-repeat-');
    const oldSprintId = 'iter-old-sprint-01';
    await writeActiveProFixture(root, 'flows/20260719/001-login-policy', ['SPR-001']);
    await writeIterationHistoryFixture(root, {
      currentIteration: 'iter-next',
      iterations: [
        {
          id: 'iter-old',
          label: 'Completed local loop',
          startedAt: '2026-08-30T00:00:00.000Z',
          completedAt: '2026-08-30T01:00:00.000Z',
          goal: 'completed local work',
          plannedSprints: [oldSprintId],
          completedSprints: [oldSprintId],
          milestoneProgress: {},
          summary: 'done',
          executionBinding: {
            executionLane: 'standalone-goal-iterate',
            proFlowPath: null,
          },
        },
        {
          id: 'iter-next',
          label: 'Next local loop',
          startedAt: '2026-08-31T00:00:00.000Z',
          completedAt: null,
          goal: 'next work',
          plannedSprints: ['iter-next-sprint-01'],
          completedSprints: [],
          milestoneProgress: {},
          summary: '',
          executionBinding: {
            executionLane: 'standalone-goal-iterate',
            proFlowPath: null,
          },
        },
      ],
    });
    await writeSprintCompletionCliFixture(root, oldSprintId);
    const iterationPath = path.join(root, '.vibe', 'agent', 'iteration-history.json');
    const before = await readFile(iterationPath);

    await execFile('node', [sprintCompleteScriptPath, oldSprintId, 'passed'], {
      cwd: root,
      env: process.env,
    });

    assert.deepEqual(await readFile(iterationPath), before);
  });

  it('keeps legacy ambient Pro protection when the new binding is absent', async () => {
    const root = await makeTempDir('vibe-legacy-pro-completion-gate-');
    const flowPath = 'flows/20260719/001-login-policy';
    const { packetRoot } = await writeActiveProFixture(root, flowPath);
    await writeIterationFixture(root, 'SPR-001');
    await mkdir(path.join(packetRoot, 'sprints', 'SPR-001-login-policy'), {
      recursive: true,
    });
    const validate = await loadProCompletionGate();

    assert.throws(
      () => validate('SPR-001', 'passed', root, 'b'.repeat(40)),
      /record the automatic Pro report checkpoint/,
    );
  });

  it('requires a HEAD-bound cumulative Pro checkpoint for an explicitly bound Sprint', async () => {
    const root = await makeTempDir('vibe-pro-completion-gate-');
    const flowPath = 'flows/20260719/001-login-policy';
    const currentHead = 'b'.repeat(40);
    const { packetRoot } = await writeActiveProFixture(root, flowPath);
    await writeIterationFixture(root, 'SPR-001', {
      executionLane: 'pro-roundtrip',
      proFlowPath: flowPath,
    });
    await mkdir(path.join(packetRoot, 'sprints', 'SPR-001-login-policy'), {
      recursive: true,
    });

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
      `${JSON.stringify({
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
      }, null, 2)}\n`,
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
    assert.deepEqual(validate('SPR-001', 'passed', root, currentHead), {
      required: true,
      checkpointPath,
    });
  });
});
