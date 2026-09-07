import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { it } from 'node:test';
import { codexInvocationProfile, resolveHarnessProfile, runtimeHarnessProfile } from '../src/lib/harness-profile.mjs';
import { computeGroupInputHash, selectVerificationGroups, type VerificationManifest } from '../src/commands/verify.js';
import { resolveGitBashPath } from '../src/lib/shell.js';

const root = process.cwd();
const dispatcher = path.resolve('.vibe/harness/scripts/vibe-codex-dispatch.mjs');
const astraEnv = { ...process.env, CODEX_MODEL: 'gpt-6-astra', VIBE_ACTIVE_MODEL: 'gpt-6-astra',
  VIBE_HARNESS_PROFILE: '', CODEX_EXTRA_CONFIG: '', CODEX_SANDBOX: 'danger-full-access' };

it('only explicit eligible models get Astra; unknown, aliases and lower tiers retain legacy', () => {
  for (const model of [undefined, '', 'codex', 'gpt-5.5', 'gpt-5.6-sol', 'gpt-6-luna', 'gpt-7', 'gpt-6-astra-preview']) {
    assert.equal(resolveHarnessProfile({ model, override: 'astra' }).profile, 'legacy', String(model));
  }
  assert.equal(resolveHarnessProfile({ model: 'gpt-6-astra' }).profile, 'astra');
  assert.equal(resolveHarnessProfile({ model: 'gpt-6-astra', provider: 'claude' }).profile, 'legacy');
  assert.equal(resolveHarnessProfile({ model: 'gpt-6-astra', override: 'legacy' }).profile, 'legacy');
  const registry = { schemaVersion: 1, providers: { codex: { knownModels: { successor: { apiId: 'verified-successor', harnessProfile: 'astra' } } } } };
  assert.equal(resolveHarnessProfile({ model: 'verified-successor', registry }).profile, 'astra');
  assert.equal(resolveHarnessProfile({ model: 'verified-successor' }).profile, 'legacy');
  assert.equal(resolveHarnessProfile({ model: 'verified-successor', registry: { ...registry, schemaVersion: 99 } }).profile, 'legacy');
  const wrongRegistry = { schemaVersion: 1, providers: { codex: { knownModels: { lower: { apiId: 'gpt-5.5', harnessProfile: 'astra' } } } } };
  assert.equal(resolveHarnessProfile({ model: 'gpt-5.5', registry: wrongRegistry }).profile, 'legacy');
  assert.equal(runtimeHarnessProfile({ CODEX_MODEL: 'gpt-6-astra' }).profile, 'legacy');
});

it('child arguments and configuration ambiguity cannot inherit or smuggle an Astra profile', () => {
  assert.equal(codexInvocationProfile([], { VIBE_ACTIVE_MODEL: 'gpt-6-astra', VIBE_HARNESS_PROFILE: 'astra' }).profile, 'legacy');
  for (const args of [['-m', 'gpt-5.5'], ['--model=gpt-5.5'], ['-mgpt-5.5'], ['-c', 'model="gpt-5.5"'],
    ['-cmodel="gpt-5.5"'], ['-p', 'other'], ['-pother'], ['--profile=other'], ['-c', 'model_provider="other"'],
    ['-m', 'gpt-6-astra', '-c', 'model="gpt-5.5"']]) {
    assert.equal(codexInvocationProfile(args, astraEnv).profile, 'legacy', JSON.stringify(args));
  }
  assert.equal(codexInvocationProfile(['-m', 'gpt-6-astra'], { CODEX_MODEL: 'gpt-5.5' }).profile, 'astra');
  assert.equal(codexInvocationProfile(['--output-last-message', '--model=gpt-6-astra'], { CODEX_MODEL: 'gpt-5.5' }).profile, 'legacy');
  assert.equal(codexInvocationProfile(['--oss', '-m', 'gpt-6-astra'], {}).profile, 'legacy');
  const receipt = codexInvocationProfile(['-m', 'gpt-6-astra', '-c', 'model_reasoning_effort="high"'], {});
  assert.equal(receipt.requestedEffort, 'high');
  assert.equal(receipt.effectiveModel, null);
  assert.equal(receipt.effectiveEffort, null);
});

it('Astra injects only the short contract for both stdin and Unicode positional prompts', () => {
  const prompt = '한글 & $(literal) ! 요청: .codex/skills/vibe-iterate/SKILL.md';
  for (const useStdin of [true, false]) {
    const result = spawnSync(process.execPath, [dispatcher, '--diagnose-md-injection', useStdin ? '-' : prompt], {
      env: astraEnv, input: useStdin ? prompt : '', encoding: 'utf8', windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.injectedFiles, ['.vibe/agent/astra-rules.md']);
    assert.equal(output.windowsSandboxHeaderInjected, false);
    assert.equal(output.payload.endsWith(prompt), true);
    assert.ok(output.injectedBytes < 6500);
    assert.doesNotMatch(output.payload, /§16|WINDOWS SANDBOX LIMITATION/);
  }
});

it('Astra native, Bash and Windows wrappers preserve UTF-8 and never replay a failed task', async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), 'astra 한글 space '));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const fake = path.join(temp, 'codex mock.mjs');
  const log = path.join(temp, 'attempts.jsonl');
  await writeFile(fake, "import fs from 'node:fs'; fs.appendFileSync(process.env.PROFILE_TEST_LOG, JSON.stringify({args:process.argv.slice(2),input:fs.readFileSync(0,'utf8'),active:process.env.VIBE_ACTIVE_MODEL})+'\\n'); process.exit(17);\n");
  const env = { ...astraEnv, CODEX_BIN: fake, CODEX_RETRY: '3', PROFILE_TEST_LOG: log };
  const cases: [string, string[]][] = [[process.execPath, [dispatcher, '-']],
    [process.execPath, [dispatcher, '--model', 'gpt-6-astra', '--sandbox', 'danger-full-access', '-']]];
  const bash = process.platform === 'win32' ? resolveGitBashPath() : 'bash';
  if (bash) cases.push([bash, [path.resolve('.vibe/harness/scripts/run-codex.sh'), '-']]);
  if (process.platform === 'win32') cases.push([process.env.COMSPEC ?? 'cmd.exe', ['/d', '/s', '/c', '"' + path.resolve('.vibe/harness/scripts/run-codex.cmd') + '" -']]);
  for (const [command, args] of cases) {
    const result = spawnSync(command, args, { env, input: '요청 & <tag> !\r\n두 번째 줄', encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: /cmd\.exe$/i.test(command), timeout: 15000 });
    assert.equal(result.status, 17, result.stderr);
  }
  const attempts = (await readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(attempts.length, cases.length);
  for (const attempt of attempts) {
    assert.equal(attempt.active, 'gpt-6-astra');
    assert.equal(attempt.input.endsWith('요청 & <tag> !\r\n두 번째 줄'), true);
    assert.ok(attempt.args.includes('danger-full-access'));
    assert.equal(attempt.args.filter((arg: string) => arg === '-m').length, 1);
    assert.equal(attempt.args.filter((arg: string) => arg === '-s').length, 1);
  }
});

it('legacy child execution clears an inherited active Astra identity', async (t) => {
  const bash = process.platform === 'win32' ? resolveGitBashPath() : 'bash';
  if (!bash) return t.skip('Bash unavailable');
  const temp = await mkdtemp(path.join(tmpdir(), 'astra-child-boundary-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const fake = path.join(temp, 'codex-stub.sh');
  await writeFile(fake, '#!/usr/bin/env bash\ncat >/dev/null\nprintf "ACTIVE=%s" "${VIBE_ACTIVE_MODEL:-unknown}"\n');
  await chmod(fake, 0o755);
  const result = spawnSync(bash, [path.join(root, '.vibe/harness/scripts/run-codex.sh'), '-'], {
    cwd: temp,
    env: { ...astraEnv, CODEX_MODEL: 'gpt-5.5', CODEX_BIN: fake, CODEX_RETRY: '1', VIBE_SKIP_AGENT_SESSION_START: '1', VIBE_DISABLE_ATTENTION: '1' },
    input: 'Read-only local test', encoding: 'utf8', windowsHide: true, timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ACTIVE=unknown/);
});

it('legacy Windows transport preserves prompt bytes and never replays a partial failure', { skip: process.platform !== 'win32' }, async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), 'legacy transport 한글 '));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const fake = path.join(temp, 'codex mock.mjs');
  const log = path.join(temp, 'attempts.jsonl');
  await writeFile(fake, "import fs from 'node:fs'; fs.appendFileSync(process.env.PROFILE_TEST_LOG, JSON.stringify({args:process.argv.slice(2),input:fs.readFileSync(0,'utf8'),active:process.env.VIBE_ACTIVE_MODEL})+'\\n'); process.exit(17);\n");
  const env = { ...astraEnv, CODEX_MODEL: 'gpt-5.5', CODEX_BIN: fake, CODEX_RETRY: '3',
    PROFILE_TEST_LOG: log, VIBE_DISABLE_ATTENTION: '1' };
  const wrapper = path.join(root, '.vibe/harness/scripts/run-codex.cmd');
  const prompt = '요청 & <tag> ! 두 번째 줄';
  for (const cli of ['-', `--model gpt-5.6-sol --sandbox workspace-write "${prompt}"`]) {
    const result = spawnSync(process.env.COMSPEC ?? 'cmd.exe', ['/d', '/s', '/c', `""${wrapper}" ${cli}"`],
      { cwd: temp, env, input: prompt, encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true, timeout: 15000 });
    assert.equal(result.status, 17, result.stderr);
  }
  const attempts = (await readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].input, prompt);
  assert.equal(attempts[1].args.at(-1), prompt);
  assert.equal(attempts[1].args.includes('gpt-5.5'), false);
  assert.equal(attempts[1].args.includes('danger-full-access'), false);
  assert.ok(attempts.every((attempt) => attempt.active === '' && !attempt.input.includes('--- Task ---')));
});

it('core selection and hashes follow every Planner document dependency for all models', async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), 'astra-inputs-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const manifest = JSON.parse(await readFile('.vibe/harness/test/groups.json', 'utf8')) as VerificationManifest;
  const core = manifest.groups.find((group) => group.id === 'core')!;
  for (const file of ['.claude/agents/sprint-planner.md', '.vibe/agent/_common-rules.md', 'docs/context/orchestration.md']) {
    await mkdir(path.dirname(path.join(temp, file)), { recursive: true });
    await writeFile(path.join(temp, file), 'before');
    const before = await computeGroupInputHash(temp, manifest, core, [file]);
    await writeFile(path.join(temp, file), 'after');
    assert.notEqual(await computeGroupInputHash(temp, manifest, core, [file]), before);
    const selection = selectVerificationGroups(manifest, [file], { harnessPatterns: ['**'], hybridPaths: new Set() }, {});
    assert.ok(selection.selectedGroupIds.includes('core'), file);
  }
  assert.ok(manifest.groups.some((group) => group.testFiles?.includes('.vibe/harness/test/integration/meta-smoke.test.ts')));
});

it('audit cache reuses successes only and invalidates changed, added and corrupt inputs', async (t) => {
  const { runCachedAudits } = await import(pathToFileURL(path.join(root, '.vibe/harness/scripts/lib/preflight-audit-cache.mjs')).href);
  const temp = await mkdtemp(path.join(tmpdir(), 'astra-audit-cache-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  await mkdir(path.join(temp, 'inputs'));
  await writeFile(path.join(temp, 'inputs/a.md'), 'first');
  let count = 0;
  let success = true;
  const check = (force = false) => {
    const results: unknown[] = [];
    const status = runCachedAudits({ root: temp, inputs: ['inputs'], results, force,
      run: () => { count++; results.push({ id: 'contract', ok: success, detail: 'checked', level: success ? 'ok' : 'fail' }); } });
    return status;
  };
  assert.equal(check(), 'ran');
  assert.equal(check(), 'reused');
  assert.equal(count, 1);
  await writeFile(path.join(temp, 'inputs/a.md'), 'mutated');
  assert.equal(check(), 'ran');
  await writeFile(path.join(temp, 'inputs/b.md'), 'new dependency');
  success = false;
  assert.equal(check(), 'ran');
  assert.equal(check(), 'ran');
  assert.equal(count, 4);
  success = true;
  assert.equal(check(), 'ran');
  const receipts = await readdir(path.join(temp, '.vibe/runs/preflight-audits'));
  for (const receipt of receipts) await writeFile(path.join(temp, '.vibe/runs/preflight-audits', receipt), '{torn');
  assert.equal(check(), 'ran');
  assert.equal(check(), 'reused');
  assert.equal(check(true), 'ran');
  assert.equal(count, 7);
});

it('Astra preflight makes ceremony advisory but still rejects an uninitialized project', async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), 'astra-preflight-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  await mkdir(path.join(temp, '.vibe/agent'), { recursive: true });
  await mkdir(path.join(temp, 'docs/context'), { recursive: true });
  await writeFile(path.join(temp, '.vibe/config.json'), JSON.stringify({ sprintRoles: { planner: 'missing-tool' }, providers: {} }));
  const status = {
    schemaVersion: '0.1',
    project: { name: 'fixture', createdAt: '2026-09-07T00:00:00.000Z' },
    sprints: [], verificationCommands: [], pendingRisks: [], sprintsSinceLastAudit: 100,
  };
  await writeFile(path.join(temp, '.vibe/agent/sprint-status.json'), JSON.stringify(status));
  await writeFile(path.join(temp, 'docs/context/product.md'), 'PROJECT NOT INITIALIZED');
  await writeFile(path.join(temp, '.vibe/agent/handoff.md'), '# handoff\nKnown task.');
  await writeFile(path.join(temp, '.vibe/agent/session-log.md'), '## Entries\n');
  const run = (legacy: boolean) => {
    const result = spawnSync(process.execPath, [path.join(root, '.vibe/harness/scripts/vibe-preflight.mjs'), '--json'], {
      cwd: temp, env: { ...astraEnv, VIBE_HARNESS_PROFILE: legacy ? 'legacy' : '' }, encoding: 'utf8', windowsHide: true,
    });
    return JSON.parse(result.stdout) as { id: string; ok: boolean; detail: string }[];
  };
  const astra = run(false), legacy = run(true);
  assert.equal(astra.find((entry) => entry.id === 'audit.overdue')?.ok, true);
  assert.equal(legacy.find((entry) => entry.id === 'audit.overdue')?.ok, false);
  assert.equal(astra.some((entry) => entry.id === 'planner.presence'), false);
  assert.equal(astra.some((entry) => entry.id === 'provider.missing-tool'), false);
  assert.equal(astra.find((entry) => entry.id === 'phase0.product')?.ok, false);
  assert.equal(legacy.find((entry) => entry.id === 'audits.cache')?.detail, 'reused');
  status.sprintsSinceLastAudit = 0;
  await writeFile(path.join(temp, '.vibe/agent/sprint-status.json'), JSON.stringify(status));
  const refreshed = run(true);
  assert.equal(refreshed.find((entry) => entry.id === 'audits.cache')?.detail, 'reused');
  assert.equal(refreshed.find((entry) => entry.id === 'audit.overdue')?.ok, true);
});

it('Astra rule audit provides no automatic delete/tighten verdict and no undisposed-rule gate', async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), 'astra-rule-evidence-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'CLAUDE.md');
  await writeFile(source, '# Rule\n## Build\nYou MUST build useful output.\n');
  await writeFile(path.join(temp, 'gaps.md'), '');
  const result = spawnSync(process.execPath, [path.join(root, '.vibe/harness/scripts/vibe-rule-audit.mjs'), '--format=json',
    '--fail-on-undisposed', `--claude-md=${source}`, `--gaps=${path.join(temp, 'gaps.md')}`, `--scan-transcripts=${temp}`],
  { env: astraEnv, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.ok(output.rules.length > 0);
  assert.equal(output.rules[0].cluster.tier, 'unclassified');
  assert.match(output.rules[0].cluster.recommendedAction, /manual-review/);
  assert.doesNotMatch(output.rules[0].cluster.recommendedAction, /delete-md|tighten/);
});

it('run-agent provenance resolves a registered successor in the target checkout without claiming an effective model', async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), 'astra-provenance-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  await mkdir(path.join(temp, '.vibe'), { recursive: true });
  await writeFile(path.join(temp, '.vibe/config.json'), JSON.stringify({ providers: { codex: {
    command: 'unused-dry-run', args: [], env: { CODEX_MODEL: 'verified-successor' },
  } } }));
  await writeFile(path.join(temp, '.vibe/model-registry.json'), JSON.stringify({ schemaVersion: 1, providers: { codex: {
    knownModels: { future: { apiId: 'verified-successor', harnessProfile: 'astra' } },
  } } }));
  const loader = pathToFileURL(path.join(root, 'node_modules/tsx/dist/loader.mjs')).href;
  const result = spawnSync(process.execPath, ['--import', loader, path.join(root, '.vibe/harness/src/commands/run-agent.ts'),
    '--provider', 'codex', '--prompt', 'local dry run', '--task-id', 'profile-check', '--dry-run'],
  { cwd: temp, env: astraEnv, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const [day] = await readdir(path.join(temp, '.vibe/runs'));
  const record = JSON.parse(await readFile(path.join(temp, '.vibe/runs', day!, 'profile-check.jsonl'), 'utf8'));
  assert.equal(record.modelProvenance.profile, 'astra');
  assert.equal(record.modelProvenance.requestedModel, 'verified-successor');
  assert.equal(record.modelProvenance.effectiveModel, null);
});
