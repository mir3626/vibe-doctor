import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { ZodError, type ZodTypeAny } from 'zod';
import {
  IterationExecutionBindingSchema,
  IterationHistorySchema,
  ModelRegistrySchema,
  ProRoundtripOperatorCloseSchema,
  ProjectMapSchema,
  SprintApiContractsSchema,
  SprintStatusSchema,
} from '../src/lib/schemas/index.js';

const cases: Array<{
  name: string;
  schema: ZodTypeAny;
  filePath: string;
  bootstrap?: unknown;
  emptyThrows: boolean;
}> = [
  {
    name: 'sprint-status',
    schema: SprintStatusSchema,
    filePath: '.vibe/agent/sprint-status.json',
    bootstrap: {
      schemaVersion: '0.1',
      project: {
        name: 'demo',
        createdAt: '2026-04-01T00:00:00.000Z',
      },
      sprints: [],
      verificationCommands: [],
    },
    emptyThrows: true,
  },
  {
    name: 'project-map',
    schema: ProjectMapSchema,
    filePath: '.vibe/agent/project-map.json',
    emptyThrows: true,
  },
  {
    name: 'sprint-api-contracts',
    schema: SprintApiContractsSchema,
    filePath: '.vibe/agent/sprint-api-contracts.json',
    emptyThrows: true,
  },
  {
    name: 'iteration-history',
    schema: IterationHistorySchema,
    filePath: '.vibe/agent/iteration-history.json',
    emptyThrows: true,
  },
  {
    name: 'model-registry',
    schema: ModelRegistrySchema,
    filePath: '.vibe/model-registry.json',
    emptyThrows: true,
  },
];

describe('state schemas', () => {
  for (const testCase of cases) {
    it(`${testCase.name} parses the production payload`, async () => {
      const payload = JSON.parse(await readFile(testCase.filePath, 'utf8')) as unknown;
      assert.doesNotThrow(() => testCase.schema.parse(payload));
    });

    it(`${testCase.name} handles bootstrap defaults or rejects empty payloads`, () => {
      if (testCase.bootstrap !== undefined) {
        const parsed = testCase.schema.parse(testCase.bootstrap) as {
          pendingRisks?: unknown[];
          lastSprintScope?: unknown[];
          sprintsSinceLastAudit?: number;
        };
        assert.deepEqual(parsed.pendingRisks, []);
        assert.deepEqual(parsed.lastSprintScope, []);
        assert.equal(parsed.sprintsSinceLastAudit, 0);
      } else if (testCase.emptyThrows) {
        assert.throws(() => testCase.schema.parse({}), ZodError);
      }
    });

    it(`${testCase.name} rejects invalid schemaVersion payloads`, () => {
      assert.throws(() => testCase.schema.parse({ schemaVersion: 123 }), ZodError);
    });
  }

  it('accepts exact iteration execution bindings and rejects ambiguous lane/path pairs', () => {
    assert.deepEqual(
      IterationExecutionBindingSchema.parse({
        executionLane: 'standalone-goal-iterate',
        proFlowPath: null,
      }),
      {
        executionLane: 'standalone-goal-iterate',
        proFlowPath: null,
      },
    );
    assert.doesNotThrow(() =>
      IterationExecutionBindingSchema.parse({
        executionLane: 'pro-roundtrip',
        proFlowPath: 'flows/20260831/001-goal-iterate',
      }),
    );
    assert.throws(
      () =>
        IterationExecutionBindingSchema.parse({
          executionLane: 'pro-roundtrip',
          proFlowPath: null,
        }),
      ZodError,
    );
    assert.throws(
      () =>
        IterationExecutionBindingSchema.parse({
          executionLane: 'standalone-goal-iterate',
          proFlowPath: null,
          ignored: true,
        }),
      ZodError,
    );
  });

  it('accepts only exact user-authorized one-line Pro operator-close records', () => {
    const record = {
      schemaVersion: 'vibe-pro-operator-close-v1',
      flowPath: 'flows/20260831/001-wrong-pointer',
      repositoryFullName: 'fixture/repo',
      codeBranch: 'main',
      baseSha: 'a'.repeat(40),
      codeHeadSha: 'b'.repeat(40),
      sourceBridgeSha: 'c'.repeat(40),
      disposition: 'force-closed',
      authorizedBy: 'user',
      reason: 'User intentionally closed the wrongly selected flow.',
      createdAt: '2026-08-31T00:00:00.000Z',
    };

    assert.deepEqual(ProRoundtripOperatorCloseSchema.parse(record), record);
    assert.throws(
      () => ProRoundtripOperatorCloseSchema.parse({ ...record, authorizedBy: 'agent' }),
      ZodError,
    );
    assert.throws(
      () => ProRoundtripOperatorCloseSchema.parse({ ...record, reason: 'line one\nline two' }),
      ZodError,
    );
    assert.throws(
      () => ProRoundtripOperatorCloseSchema.parse({ ...record, ignored: true }),
      ZodError,
    );
  });
});
