import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExecutionPlan } from '../src/providers/runner.js';
import type { ProviderRunner } from '../src/lib/config.js';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const baseRunner: ProviderRunner = {
  command: 'codex',
  args: ['exec', '{prompt}'],
  env: { LOCALE: '{cwd}' },
};

const baseInput = {
  provider: 'codex',
  role: 'coder',
  prompt: 'hello world',
  cwd: '/tmp/sprint',
  taskId: 't-123',
  runner: baseRunner,
};

test('buildExecutionPlan substitutes {prompt} in args', () => {
  const plan = buildExecutionPlan(baseInput);
  assert.deepEqual(plan.command, 'codex');
  assert.deepEqual(plan.args, ['exec', 'hello world']);
});

test('buildExecutionPlan substitutes template vars in env values', () => {
  const plan = buildExecutionPlan(baseInput);
  assert.equal(plan.env.LOCALE, '/tmp/sprint');
});

test('buildExecutionPlan drops args that resolve to empty string', () => {
  // {promptFile} → '' when not provided, and filter(Boolean) strips it
  const plan = buildExecutionPlan({
    ...baseInput,
    runner: { command: 'codex', args: ['exec', '{promptFile}', '{prompt}'] },
  });
  assert.deepEqual(plan.args, ['exec', 'hello world']);
});

test('buildExecutionPlan preserves promptFile when provided', () => {
  const plan = buildExecutionPlan({
    ...baseInput,
    promptFile: '/tmp/prompt.md',
    runner: { command: 'codex', args: ['exec', '{promptFile}'] },
  });
  assert.deepEqual(plan.args, ['exec', '/tmp/prompt.md']);
});

test('buildExecutionPlan substitutes {role} and {taskId}', () => {
  const plan = buildExecutionPlan({
    ...baseInput,
    runner: { command: 'run', args: ['--role={role}', '--task={taskId}'] },
  });
  assert.deepEqual(plan.args, ['--role=coder', '--task=t-123']);
});

test('buildExecutionPlan returns empty env when runner.env is undefined', () => {
  const plan = buildExecutionPlan({
    ...baseInput,
    runner: { command: 'codex', args: [] },
  });
  assert.deepEqual(plan.env, {});
});

test('buildExecutionPlan handles wrapper-style command (run-codex.sh)', () => {
  const plan = buildExecutionPlan({
    ...baseInput,
    runner: { command: './scripts/run-codex.sh', args: ['{prompt}'] },
  });
  assert.equal(plan.command, './scripts/run-codex.sh');
  assert.deepEqual(plan.args, ['hello world']);
});

test('model-selected runners pin canonical defaults and require explicit custom model transport', () => {
  const wrapper = { command: './.vibe/harness/scripts/run-codex.sh', args: ['{prompt}'] };
  const input = { ...baseInput, runner: wrapper, model: 'gpt-6-astra' };
  assert.equal(buildExecutionPlan(input).env.CODEX_MODEL, 'gpt-6-astra');
  assert.equal(buildExecutionPlan({ ...input, runner: { ...wrapper, env: { CODEX_MODEL: '' } } }).env.CODEX_MODEL, 'gpt-6-astra');
  assert.equal(buildExecutionPlan({ ...input, runner: { ...wrapper, env: { CODEX_MODEL: 'gpt-5.5' } } }).env.CODEX_MODEL, 'gpt-5.5');
  assert.deepEqual(buildExecutionPlan({ ...input, runner: { command: 'custom', args: ['--model', '{model}', '{prompt}'] } }).args,
    ['--model', 'gpt-6-astra', 'hello world']);
  assert.throws(() => buildExecutionPlan({ ...input, runner: baseRunner }), /declare \{model\}/);
  assert.throws(() => buildExecutionPlan({ ...baseInput, runner: { command: 'custom', args: ['{model}'] } }), /requires an explicit model/);
});

test('model template expansion preserves literal task placeholders and replacement metacharacters', () => {
  const prompt = '한글 {model} {role} {cwd} {promptFile} {taskId} $& $` $\' ${literal}';
  const result = buildExecutionPlan({ ...baseInput, model: 'gpt-6-astra', prompt,
    runner: { command: 'custom', args: ['--model={model}', '{prompt}'] } });
  assert.deepEqual(result.args, ['--model=gpt-6-astra', prompt]);
});

test('run-agent resolves target-checkout roles and sends the pinned model and role to the actual child', async (t) => {
  const sourceRoot = process.cwd();
  const root = await mkdtemp(path.join(tmpdir(), 'vibe-role-runner-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, '.vibe'), { recursive: true });
  const registry = JSON.parse(await readFile(path.join(sourceRoot, '.vibe/model-registry.json'), 'utf8'));
  const wrapper = path.join(sourceRoot, '.vibe/harness/scripts/run-codex.sh');
  const capturePath = path.join(root, 'capture.json');
  const fake = path.join(root, 'codex-mock.mjs');
  await writeFile(fake, "import fs from 'node:fs'; fs.writeFileSync(process.env.ROLE_CAPTURE, JSON.stringify({args:process.argv.slice(2),input:fs.readFileSync(0,'utf8'),model:process.env.VIBE_ACTIVE_MODEL}));\n");
  const config = { providers: { codex: { command: wrapper, args: ['{prompt}'],
    env: { CODEX_BIN: fake, ROLE_CAPTURE: capturePath } as Record<string, string> } },
    sprintRoles: { planner: { provider: 'codex', tier: 'flagship' }, generator: 'codex',
      evaluator: { provider: 'codex', tier: 'flagship' } } };
  await writeFile(path.join(root, '.vibe/config.json'), JSON.stringify(config));
  await writeFile(path.join(root, '.vibe/model-registry.json'), JSON.stringify(registry));
  await writeFile(path.join(root, 'task.md'), '한글 기획 요청: 승인된 범위만 조사한다.');
  const env = { ...process.env, VIBE_ACTIVE_MODEL: 'gpt-5.5', VIBE_HARNESS_PROFILE: '',
    CODEX_MODEL: '', CODEX_EXTRA_CONFIG: '', VIBE_SKIP_AGENT_SESSION_START: '1', VIBE_DISABLE_ATTENTION: '1' };
  const loader = pathToFileURL(path.join(sourceRoot, 'node_modules/tsx/dist/loader.mjs')).href;
  const cli = path.join(sourceRoot, '.vibe/harness/src/commands/run-agent.ts');
  const invoke = (args: string[], overrides = {}) => spawnSync(process.execPath,
    ['--import', loader, cli, '--cwd', root, '--prompt-file', 'task.md', ...args],
    { cwd: sourceRoot, env: { ...env, ...overrides }, encoding: 'utf8' });
  const receipt = async (task: string) => {
    const [day] = await readdir(path.join(root, '.vibe/runs'));
    return JSON.parse(await readFile(path.join(root, '.vibe/runs', day!, `${task}.jsonl`), 'utf8'));
  };
  const run = invoke(['--role', 'planner', '--task-id', 'planner']);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const child = JSON.parse(await readFile(capturePath, 'utf8'));
  assert.equal(child.args[child.args.indexOf('-m') + 1], 'gpt-6-astra');
  assert.equal(child.model, 'gpt-6-astra');
  assert.match(child.input, /Assigned task role: planner/);
  assert.match(child.input, /한글 기획 요청/);
  assert.doesNotMatch(child.input, /Host OS sandbox limitation/);
  const planner = await receipt('planner');
  assert.equal(planner.roleModel, 'gpt-6-astra');
  assert.equal(planner.modelProvenance.profile, 'astra');
  assert.equal(planner.modelProvenance.effectiveModel, null);

  for (const [role, profile] of [['evaluator', 'astra'], ['generator', 'legacy']] as const) {
    const result = invoke(['--role', role, '--task-id', role, '--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal((await receipt(role)).modelProvenance.profile, profile);
  }
  const rollback = invoke(['--role', 'planner', '--task-id', 'rollback', '--dry-run'], { VIBE_HARNESS_PROFILE: 'legacy' });
  assert.equal(rollback.status, 0, rollback.stderr);
  assert.equal((await receipt('rollback')).modelProvenance.profile, 'legacy');

  config.providers.codex.env.CODEX_MODEL = 'gpt-5.5';
  await writeFile(path.join(root, '.vibe/config.local.json'), JSON.stringify({ providers: config.providers }));
  const pinned = invoke(['--role', 'planner', '--task-id', 'pinned', '--dry-run']);
  assert.equal(pinned.status, 0, pinned.stderr);
  assert.equal((await receipt('pinned')).modelProvenance.requestedModel, 'gpt-5.5');
  const conflict = invoke(['--role', 'planner', '--model', 'gpt-6-astra', '--dry-run']);
  assert.equal(conflict.status, 1);
  assert.match(conflict.stderr, /conflicts/);
});
