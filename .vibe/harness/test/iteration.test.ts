import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  completeIteration,
  computeMilestoneProgress,
  readIterationHistory,
  recordSprintCompletion,
  startIteration,
  type IterationHistory,
  type Milestone,
} from '../src/lib/iteration.js';

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true }));
    }
  }
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('iteration history', () => {
  it('startIteration creates history and sets currentIteration', async () => {
    const root = await makeTempDir('iteration-start-');

    await startIteration(
      {
        id: 'iter-1',
        label: 'Prototype',
        goal: 'first usable flow',
        plannedSprints: ['sprint-01-engine'],
        executionBinding: {
          executionLane: 'standalone-goal-iterate',
          proFlowPath: null,
        },
      },
      root,
    );

    const history = await readIterationHistory(root);
    assert.equal(history.currentIteration, 'iter-1');
    assert.equal(history.iterations[0]?.plannedSprints[0], 'sprint-01-engine');
    assert.deepEqual(history.iterations[0]?.executionBinding, {
      executionLane: 'standalone-goal-iterate',
      proFlowPath: null,
    });
  });

  it('preserves an explicit Pro binding across write and fresh reload', async () => {
    const root = await makeTempDir('iteration-pro-binding-');
    const executionBinding = {
      executionLane: 'pro-roundtrip' as const,
      proFlowPath: 'flows/20260831/001-goal-iterate',
    };

    await startIteration(
      {
        id: 'iter-2',
        label: 'Pro remediation',
        goal: 'finish the bound Pro Sprint',
        plannedSprints: ['SPR-001'],
        executionBinding,
      },
      root,
    );
    await recordSprintCompletion('SPR-001', root);

    const reloaded = await readIterationHistory(root);
    assert.deepEqual(reloaded.iterations[0]?.executionBinding, executionBinding);
    assert.deepEqual(reloaded.iterations[0]?.completedSprints, ['SPR-001']);
  });

  it('rejects malformed persisted execution bindings instead of downgrading to legacy', async () => {
    const root = await makeTempDir('iteration-invalid-binding-');
    const stateDir = path.join(root, '.vibe', 'agent');
    await mkdir(stateDir, { recursive: true });
    await writeFile(
      path.join(stateDir, 'iteration-history.json'),
      `${JSON.stringify({
        currentIteration: 'iter-1',
        iterations: [
          {
            id: 'iter-1',
            label: 'Invalid binding',
            startedAt: '2026-08-31T00:00:00.000Z',
            completedAt: null,
            goal: 'must fail closed',
            plannedSprints: ['SPR-001'],
            completedSprints: [],
            milestoneProgress: {},
            summary: '',
            executionBinding: {
              executionLane: 'pro-roundtrip',
              proFlowPath: null,
            },
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );

    await assert.rejects(() => readIterationHistory(root), /invalid iteration execution binding/);
  });

  it('recordSprintCompletion appends without duplicates', async () => {
    const root = await makeTempDir('iteration-record-');

    await startIteration(
      {
        id: 'iter-1',
        label: 'Prototype',
        goal: 'first usable flow',
        plannedSprints: ['sprint-01-engine', 'sprint-02-ui'],
      },
      root,
    );
    await recordSprintCompletion('sprint-01-engine', root);
    await recordSprintCompletion('sprint-01-engine', root);

    const history = await readIterationHistory(root);
    assert.deepEqual(history.iterations[0]?.completedSprints, ['sprint-01-engine']);
  });

  it('does not record an unplanned Sprint into the current iteration', async () => {
    const root = await makeTempDir('iteration-record-unplanned-');

    await startIteration(
      {
        id: 'iter-next',
        label: 'Next iteration',
        goal: 'keep the next queue isolated',
        plannedSprints: ['iter-next-sprint-01'],
      },
      root,
    );
    await recordSprintCompletion('iter-old-sprint-01', root);

    const history = await readIterationHistory(root);
    assert.deepEqual(history.iterations[0]?.completedSprints, []);
  });

  it('completeIteration sets completedAt, summary, and clears currentIteration', async () => {
    const root = await makeTempDir('iteration-complete-');

    await startIteration(
      {
        id: 'iter-1',
        label: 'Prototype',
        goal: 'first usable flow',
        plannedSprints: ['sprint-01-engine'],
      },
      root,
    );
    const completed = await completeIteration('Prototype finished.', root);
    const history = await readIterationHistory(root);

    assert.equal(history.currentIteration, null);
    assert.equal(completed.summary, 'Prototype finished.');
    assert.notEqual(completed.completedAt, null);
  });
});

describe('computeMilestoneProgress', () => {
  const milestones: Milestone[] = [
    {
      id: 'prototype',
      name: 'Prototype',
      targetIteration: 'iter-1',
      progressMetric: 'sprint_complete_ratio',
    },
    {
      id: 'beta',
      name: 'Beta',
      targetIteration: 'iter-2',
      progressMetric: 'feature_coverage',
    },
  ];

  it('returns 0 for no target sprints and unsupported metrics', () => {
    const history: IterationHistory = {
      currentIteration: 'iter-1',
      iterations: [
        {
          id: 'iter-1',
          label: 'Prototype',
          startedAt: '2026-04-16T00:00:00.000Z',
          completedAt: null,
          goal: 'empty',
          plannedSprints: [],
          completedSprints: [],
          milestoneProgress: {},
          summary: '',
        },
      ],
    };

    assert.deepEqual(computeMilestoneProgress(history, milestones), {
      prototype: 0,
      beta: 0,
    });
  });

  it('computes partial and complete sprint ratios', () => {
    const partial: IterationHistory = {
      currentIteration: 'iter-1',
      iterations: [
        {
          id: 'iter-1',
          label: 'Prototype',
          startedAt: '2026-04-16T00:00:00.000Z',
          completedAt: null,
          goal: 'partial',
          plannedSprints: ['a', 'b'],
          completedSprints: ['a'],
          milestoneProgress: {},
          summary: '',
        },
      ],
    };
    const complete: IterationHistory = {
      ...partial,
      iterations: [
        {
          ...partial.iterations[0]!,
          completedSprints: ['a', 'b'],
        },
      ],
    };

    assert.equal(computeMilestoneProgress(partial, milestones).prototype, 0.5);
    assert.equal(computeMilestoneProgress(complete, milestones).prototype, 1);
  });
});
