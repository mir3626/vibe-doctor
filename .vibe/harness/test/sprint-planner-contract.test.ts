import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { runtimeHarnessProfile } from '../src/lib/harness-profile.mjs';
const legacyIt = runtimeHarnessProfile().profile === 'astra' ? it.skip : it;
describe('sprint-planner contract', () => {
  it('separates Astra implementation discretion from legacy and preserves the child scope contract', async () => {
    const planner = await readFile('.claude/agents/sprint-planner.md', 'utf8');
    const handoff = planner.split('## Generator handoff')[1]?.split('## Shared contract responsibilities')[0] ?? '';
    assert.match(handoff, /pinned Generator model/);
    assert.match(handoff, /unknown/);
    assert.match(handoff, /recommendations/);
    assert.match(handoff, /explicit allowed[\s\S]*writes\/exclusions/);
    assert.match(handoff, /lower\/unknown Generator models/);
    const coder = await readFile('.codex/agents/coder.toml', 'utf8');
    const shared = coder.split('공통 원칙:')[1]?.split('Legacy 판단 규칙:')[0] ?? '';
    assert.match(shared, /Files Generator may touch/);
    assert.doesNotMatch(shared, /불확실한 설계 판단은 구현하지 않고/);
    assert.match(coder, /Astra는 코드와 요구사항을 조사/);
    assert.match(coder, /Legacy 판단 규칙:[\s\S]*불확실한 설계 판단은 구현하지 않고/);
  });

  legacyIt('sprint-planner contract includes component-integration checklist', async () => {
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
