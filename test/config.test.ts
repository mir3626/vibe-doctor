import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeConfig, type VibeConfig } from '../src/lib/config.js';

const base: VibeConfig = {
  defaultCoder: 'codex',
  challenger: 'gemini',
  reviewer: 'claude',
  providers: {
    codex: { command: 'codex', args: ['exec'] },
  },
  qa: {
    preferScripts: ['test'],
  },
};

test('mergeConfig preserves provider map and overrides top-level fields', () => {
  const merged = mergeConfig(base, {
    defaultCoder: 'claude',
    providers: {
      gemini: { command: 'gemini', args: ['run'] },
    },
  });

  assert.equal(merged.defaultCoder, 'claude');
  assert.equal(merged.providers.codex?.command, 'codex');
  assert.equal(merged.providers.gemini?.command, 'gemini');
  assert.deepEqual(merged.qa?.preferScripts, ['test']);
});
