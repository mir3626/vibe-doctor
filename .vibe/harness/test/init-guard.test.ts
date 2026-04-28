import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  AGENT_INIT_FLAG,
  isAgentSkillInvocation,
  renderDirectInitGuardMessage,
} from '../src/commands/init.js';

const initPath = path.resolve('.vibe', 'harness', 'src', 'commands', 'init.ts');
const tsxLoader = pathToFileURL(path.resolve('node_modules', 'tsx', 'dist', 'loader.mjs')).href;
const tempDirs: string[] = [];

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

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeMinimalSharedConfig(root: string): Promise<void> {
  await writeJson(path.join(root, '.vibe', 'config.json'), {
    harnessVersion: '1.7.0',
    orchestrator: 'claude-opus',
    sprintRoles: { planner: 'claude-opus', generator: 'codex', evaluator: 'claude-opus' },
    sprint: { unit: 'feature', subAgentPerRole: true, freshContextPerSprint: true },
    providers: {},
    mode: 'human',
  });
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

describe('vibe:init agent-skill guard', () => {
  it('requires an explicit agent-skill marker for mechanical init', () => {
    assert.equal(isAgentSkillInvocation([]), false);
    assert.equal(isAgentSkillInvocation([AGENT_INIT_FLAG]), true);
    assert.equal(isAgentSkillInvocation([], { VIBE_INIT_AGENT: '1' }), true);
    assert.equal(isAgentSkillInvocation([], { VIBE_INIT_AGENT: 'true' }), true);
  });

  it('prints direct-shell guidance and exits before touching project files', () => {
    const result = spawnSync(process.execPath, ['--import', tsxLoader, initPath], {
      cwd: process.cwd(),
      env: { ...process.env, VIBE_INIT_AGENT: '' },
      input: '',
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /agent-skill bootstrap step/);
    assert.match(result.stderr, /Claude Code: \/vibe-init/);
    assert.match(result.stderr, /Codex: ask Codex to run the vibe-init workflow/);
    assert.match(result.stderr, /npm run vibe:init -- --from-agent-skill --mode=human/);
  });

  it('keeps the guard message stable enough for shell users', () => {
    assert.match(renderDirectInitGuardMessage(), /not a direct shell entrypoint/);
  });

  it('agent-skill init resets copied template sprint state to an empty project state', async () => {
    const root = await makeTempDir('vibe-init-template-state-');
    await writeMinimalSharedConfig(root);
    await writeJson(path.join(root, '.vibe', 'config.local.example.json'), {
      orchestrator: 'claude-opus',
      sprintRoles: { planner: 'claude-opus', generator: 'codex', evaluator: 'claude-opus' },
      sprint: { unit: 'feature', subAgentPerRole: true, freshContextPerSprint: true },
      providers: {},
    });
    await writeFile(path.join(root, '.env.example'), 'TOKEN=\n', 'utf8');
    await writeJson(path.join(root, '.vibe', 'agent', 'sprint-status.json'), {
      schemaVersion: '0.1',
      project: { name: 'vibe-doctor', createdAt: '2026-04-01T00:00:00.000Z' },
      sprints: [{ id: 'sprint-old', name: 'sprint-old', status: 'passed' }],
      verificationCommands: [],
      sprintsSinceLastAudit: 5,
    });

    const result = spawnSync(process.execPath, ['--import', tsxLoader, initPath, AGENT_INIT_FLAG, '--mode=human'], {
      cwd: root,
      env: { ...process.env, VIBE_INIT_AGENT: '' },
      input: '',
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    const status = await readJson<{
      project?: { name?: string };
      sprints?: unknown[];
      sprintsSinceLastAudit?: number;
    }>(path.join(root, '.vibe', 'agent', 'sprint-status.json'));
    assert.equal(status.project?.name, path.basename(root));
    assert.deepEqual(status.sprints, []);
    assert.equal(status.sprintsSinceLastAudit, 0);
  });

  it('agent-skill init refuses non-interactive bootstrap without an explicit mode', async () => {
    const root = await makeTempDir('vibe-init-missing-mode-');
    await writeMinimalSharedConfig(root);

    const result = spawnSync(process.execPath, ['--import', tsxLoader, initPath, AGENT_INIT_FLAG], {
      cwd: root,
      env: { ...process.env, VIBE_INIT_AGENT: '' },
      input: '',
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires an explicit session mode/);
    assert.equal(await fileExists(path.join(root, '.vibe', 'agent', 'sprint-status.json')), false);
    assert.equal(await fileExists(path.join(root, '.vibe', 'config.local.json')), false);
  });

  it('agent mode renders a Codex delegation prompt without Phase 1-1 bootstrap state', async () => {
    const root = await makeTempDir('vibe-init-agent-mode-');
    await writeMinimalSharedConfig(root);
    await mkdir(path.join(root, '.claude', 'templates'), { recursive: true });
    await writeFile(
      path.join(root, '.claude', 'templates', 'agent-delegation-prompt.md'),
      [
        '# Template intro',
        '',
        '## (이 아래부터가 실제 agent 에게 전달되는 prompt 본문이다)',
        '',
        '너는 <AGENT_RUNTIME_LABEL> agent 다.',
        '',
        '<RUNTIME_MEMORY_STEPS>',
        '',
        'Project:',
        '<ONE_LINER>',
        '',
        '<RUNTIME_DELEGATION_NOTES>',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = spawnSync(
      process.execPath,
      [
        '--import',
        tsxLoader,
        initPath,
        AGENT_INIT_FLAG,
        '--mode=agent',
        '--runtime=codex',
        '--one-liner',
        '테스트 CLI 도구',
      ],
      {
        cwd: root,
        env: { ...process.env, VIBE_INIT_AGENT: '' },
        input: '',
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Agent Delegation Prompt/);
    assert.match(result.stdout, /Codex Orchestrator agent/);
    assert.match(result.stdout, /AGENTS\.md/);
    assert.match(result.stdout, /테스트 CLI 도구/);

    const config = await readJson<{ mode?: string }>(path.join(root, '.vibe', 'config.json'));
    assert.equal(config.mode, 'agent');
    assert.equal(await fileExists(path.join(root, '.env')), false);
    assert.equal(await fileExists(path.join(root, '.vibe', 'config.local.json')), false);
    assert.equal(await fileExists(path.join(root, '.vibe', 'agent', 'sprint-status.json')), false);
    assert.equal(await fileExists(path.join(root, '.vibe', 'interview-log')), false);
  });

  it('keeps the template Codex provider command on the canonical harness wrapper', async () => {
    const example = await readJson<{
      providers?: { codex?: { command?: string } };
    }>(path.join(process.cwd(), '.vibe', 'config.local.example.json'));

    assert.equal(example.providers?.codex?.command, './.vibe/harness/scripts/run-codex.sh');
  });
});
