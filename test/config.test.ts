import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeConfig, type VibeConfig } from '../src/lib/config.js';

const base: VibeConfig = {
  orchestrator: 'claude-opus',
  sprintRoles: {
    planner: 'claude-opus',
    generator: 'codex',
    evaluator: 'claude-opus',
  },
  sprint: {
    unit: 'feature',
    subAgentPerRole: true,
    freshContextPerSprint: true,
  },
  providers: {
    'claude-opus': { command: 'claude', args: ['-p', '{prompt}'] },
    codex: { command: 'codex', args: ['exec', '--json', '{prompt}'] },
  },
  qa: {
    preferScripts: ['test'],
  },
};

test('mergeConfig preserves provider map and overrides top-level fields', () => {
  const merged = mergeConfig(base, {
    orchestrator: 'claude-sonnet',
    providers: {
      gemini: { command: 'gemini', args: ['run'] },
    },
  });

  assert.equal(merged.orchestrator, 'claude-sonnet');
  assert.equal(merged.providers['claude-opus']?.command, 'claude');
  assert.equal(merged.providers.gemini?.command, 'gemini');
  assert.deepEqual(merged.qa?.preferScripts, ['test']);
});

test('mergeConfig deep-merges sprintRoles', () => {
  const merged = mergeConfig(base, {
    sprintRoles: { generator: 'gemini' },
  });

  assert.equal(merged.sprintRoles.generator, 'gemini');
  assert.equal(merged.sprintRoles.planner, 'claude-opus');
  assert.equal(merged.sprintRoles.evaluator, 'claude-opus');
});

test('mergeConfig deep-merges sprint config', () => {
  const merged = mergeConfig(base, {
    sprint: { unit: 'page' },
  });

  assert.equal(merged.sprint.unit, 'page');
  assert.equal(merged.sprint.subAgentPerRole, true);
});

test('mergeConfig deep-merges dashboard config', () => {
  const merged = mergeConfig(
    {
      ...base,
      dashboard: {
        enabled: false,
        port: 5175,
        host: '127.0.0.1',
        autoStart: false,
        notificationLevel: 'urgent',
        retentionDays: 30,
      },
    },
    {
      dashboard: {
        autoStart: true,
        port: 45175,
      },
    },
  );

  assert.equal(merged.dashboard?.enabled, false);
  assert.equal(merged.dashboard?.autoStart, true);
  assert.equal(merged.dashboard?.port, 45175);
  assert.equal(merged.dashboard?.host, '127.0.0.1');
});
