import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
describe('sprint-planner contract', () => {
  it('sprint-planner contract includes component-integration checklist', async () => {
    const content = await readFile('.claude/agents/sprint-planner.md', 'utf8');
    const groups = [/toaster|toastprovider|global.?state provider/i, /null.?safe|optional chaining|early.?return guard|\?\./i, /optimistic|rollback/i];
    assert.ok(groups.filter((pattern) => pattern.test(content)).length >= 2);
  });

  it('sprint-planner and generator report contracts require proof-boundary fields', async () => {
    const [planner, commonRules, orchestration] = await Promise.all([
      readFile('.claude/agents/sprint-planner.md', 'utf8'),
      readFile('.vibe/agent/_common-rules.md', 'utf8'),
      readFile('docs/context/orchestration.md', 'utf8'),
    ]);
    const requiredSignals = [/Sprint Contract/, /Target\/output surface|Target and output surface/i, /Allowed writes/i, /Explicit exceptions/i, /Reference-only values/i, /Proof predicates/i, /Current proof/i, /Non-proof/i];

    for (const signal of requiredSignals) {
      assert.match(planner, signal, `planner missing ${signal}`);
      assert.match(commonRules, signal, `common rules missing ${signal}`);
    }
    assert.match(orchestration, /Sprint Contract/);
    assert.match(orchestration, /proof predicates.*public contract/i);
  });
});
