import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { CodexAppServerGoalProvider } from '../src/pro-bridge/goal-source/codex-app-server.js';
import { resolveGoalSource } from '../src/pro-bridge/goal-source/resolver.js';
import { classifyScope } from '../src/pro-bridge/goal-source/scope.js';
import type {
  GitCommit,
  GitPort,
  GoalSourceProvider,
} from '../src/pro-bridge/goal-source/types.js';

const BASE_SHA = 'a'.repeat(40);
const OLDER_SHA = 'b'.repeat(40);
const HEAD_SHA = 'c'.repeat(40);
const UNRELATED_SHA = 'd'.repeat(40);

interface FakeGitOptions {
  head?: string;
  remote?: string | null;
  status?: string;
  upstream?: string | null;
  unpushed?: number;
  diffFiles?: string[];
  commits?: GitCommit[];
}

class FakeGitPort implements GitPort {
  readonly calls: string[][] = [];

  constructor(private readonly options: FakeGitOptions = {}) {}

  async run(args: string[]): Promise<{
    ok: boolean;
    stdout: string;
    stderr: string;
    code: number | null;
  }> {
    this.calls.push([...args]);
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
      return this.success(`${this.options.head ?? HEAD_SHA}\n`);
    }
    if (args[0] === 'rev-parse' && args.at(-1) === '@{upstream}') {
      return this.options.upstream === null
        ? this.failure('no upstream')
        : this.success(`${this.options.upstream ?? 'origin/main'}\n`);
    }
    if (args[0] === 'rev-list') {
      return this.success(`${this.options.unpushed ?? 0}\n`);
    }
    if (args[0] === 'config') {
      return this.options.remote === null
        ? this.failure('remote not configured')
        : this.success(`${this.options.remote ?? 'https://github.com/owner/repo.git'}\n`);
    }
    if (args[0] === 'status') {
      return this.success(this.options.status ?? '');
    }
    if (args[0] === 'diff') {
      return this.success(`${(this.options.diffFiles ?? []).join('\n')}\n`);
    }
    if (args[0] === 'log') {
      return this.success(renderGitLog(this.options.commits ?? []));
    }
    return this.failure(`unexpected fake git call: ${args.join(' ')}`);
  }

  private success(stdout: string) {
    return { ok: true, stdout, stderr: '', code: 0 };
  }

  private failure(stderr: string) {
    return { ok: false, stdout: '', stderr, code: 1 };
  }
}

function renderGitLog(commits: GitCommit[]): string {
  return commits
    .map(
      (commit) =>
        `${commit.sha}\x1f${commit.parents.join(' ')}\x1f${commit.committedAt}\x1f${commit.subject}\x1f${commit.body}\x1e`,
    )
    .join('\n');
}

function commit(
  sha: string,
  parent: string,
  subject: string,
  committedAt = '2026-07-15T06:00:00.000Z',
  body = '',
): GitCommit {
  return { sha, parents: [parent], committedAt, subject, body };
}

async function makeRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'vibe-pro-bridge-goal-'));
}

async function writeText(root: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}

async function writeJson(root: string, relativePath: string, value: unknown): Promise<void> {
  await writeText(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeCoherentState(root: string, multipleIterations = false): Promise<void> {
  const firstIteration = [
    '## Iteration 1 — initial-contracts',
    '',
    '- **id**: `sprint-vpb-01`',
    '  - **name**: initial',
    '  - **목표**: establish the initial contract',
    '  - **설계**: `docs/plans/initial/design.md`',
  ].join('\n');
  const secondIteration = [
    '## Iteration 2 — latest-bridge-goal',
    '',
    '- **id**: `sprint-vpb-02`',
    '  - **name**: latest',
    '  - **목표**: implement the most recent bridge goal',
    '  - **설계**: `docs/plans/latest/design.md`',
  ].join('\n');
  await writeText(
    root,
    'docs/plans/sprint-roadmap.md',
    `${multipleIterations ? secondIteration : firstIteration}\n`,
  );
  if (multipleIterations) {
    await writeText(root, 'docs/plans/archive/roadmaps/iteration-1.md', `${firstIteration}\n`);
  }

  const sprints = [
    { id: 'sprint-vpb-01', name: 'initial', status: 'passed' },
    ...(multipleIterations
      ? [{ id: 'sprint-vpb-02', name: 'latest', status: 'in_progress' as const }]
      : []),
  ];
  await writeJson(root, '.vibe/agent/sprint-status.json', {
    schemaVersion: '0.1',
    project: { name: 'fixture', createdAt: '2026-07-15T00:00:00.000Z' },
    sprints,
    verificationCommands: [],
  });
  await writeJson(root, '.vibe/agent/iteration-history.json', {
    currentIteration: multipleIterations ? 'iter-2' : 'iter-1',
    iterations: [
      {
        id: 'iter-1',
        label: 'initial-contracts',
        startedAt: '2026-07-14T00:00:00.000Z',
        completedAt: '2026-07-14T08:00:00.000Z',
        goal: 'Initial bridge goal',
        plannedSprints: ['sprint-vpb-01'],
        completedSprints: ['sprint-vpb-01'],
        milestoneProgress: {},
        summary: 'Initial complete',
      },
      ...(multipleIterations
        ? [
            {
              id: 'iter-2',
              label: 'latest-bridge-goal',
              startedAt: '2026-07-15T05:00:00.000Z',
              completedAt: null,
              goal: 'Most recent bridge goal',
              plannedSprints: ['sprint-vpb-02'],
              completedSprints: [],
              milestoneProgress: {},
              summary: 'In progress',
            },
          ]
        : []),
    ],
  });
  const selectedSprint = multipleIterations ? 'sprint-vpb-02' : 'sprint-vpb-01';
  await writeText(
    root,
    '.vibe/agent/session-log.md',
    `# Session Log\n\n## Entries\n- 2026-07-15T05:00:00.000Z [decision] ${selectedSprint} latest-bridge-goal started\n`,
  );
  await writeText(root, `docs/prompts/${selectedSprint}-fixture.md`, '# Fixture prompt\n');
}

function coherentGit(multipleIterations = false, overrides: FakeGitOptions = {}): FakeGitPort {
  const sprintId = multipleIterations ? 'sprint-vpb-02' : 'sprint-vpb-01';
  return new FakeGitPort({
    diffFiles: [
      '.vibe/harness/src/pro-bridge/contract.ts',
      '.vibe/harness/test/pro-bridge-goal-source.test.ts',
      'migrations/1.0.0.sql',
      'docs/plans/latest/design.md',
    ],
    commits: [commit(HEAD_SHA, BASE_SHA, `feat(bridge): implement ${sprintId}`)],
    ...overrides,
  });
}

describe('goal source discovery', () => {
  it('resolves a vibe-goal-iterate goal from coherent state', async () => {
    const root = await makeRoot();
    try {
      await writeCoherentState(root);
      const result = await resolveGoalSource({ repoRoot: root, git: coherentGit() });
      assert.equal(result.selected?.source.kind, 'vibe-goal-iterate');
      assert.equal(result.selected?.source.confidence, 'high');
      assert.equal(result.selected?.source.goalText, 'Initial bridge goal');
      assert.equal(result.selected?.baseSha, BASE_SHA);
      assert.equal(result.selected?.headSha, HEAD_SHA);
      assert.deepEqual(result.selected?.designRefs, ['docs/plans/initial/design.md']);
      assert.deepEqual(result.selected?.scope.codeFiles, ['.vibe/harness/src/pro-bridge/contract.ts']);
      assert.deepEqual(result.selected?.scope.testFiles, [
        '.vibe/harness/test/pro-bridge-goal-source.test.ts',
      ]);
      assert.deepEqual(result.selected?.scope.migrationFiles, ['migrations/1.0.0.sql']);
      assert.deepEqual(result.selected?.scope.docsFiles, ['docs/plans/latest/design.md']);
      assert.match(result.selected?.payloadSha256 ?? '', /^[0-9a-f]{64}$/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('picks the most recent of multiple iterations', async () => {
    const root = await makeRoot();
    try {
      await writeCoherentState(root, true);
      const result = await resolveGoalSource({ repoRoot: root, git: coherentGit(true) });
      assert.equal(result.selected?.source.iterationId, 'iter-2');
      assert.equal(result.selected?.source.goalText, 'Most recent bridge goal');
      assert.deepEqual(result.selected?.designRefs, ['docs/plans/latest/design.md']);
      assert.deepEqual(result.selected?.implementationRefs, ['docs/prompts/sprint-vpb-02-fixture.md']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('records app-server unavailable and continues the chain', async () => {
    const root = await makeRoot();
    try {
      await writeCoherentState(root);
      const result = await resolveGoalSource({ repoRoot: root, git: coherentGit() });
      assert.deepEqual(result.diagnostics.slice(0, 2), [
        {
          provider: 'codex-goal',
          status: 'unavailable',
          reason: 'codex-app-server-api-unverified',
        },
        { provider: 'vibe-goal-iterate', status: 'candidate' },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reconstructs from handoff when roadmap state is missing', async () => {
    const root = await makeRoot();
    try {
      await writeText(
        root,
        '.vibe/agent/handoff.md',
        '# Handoff\n\n## 2. Status\nBridge contracts are implemented.\n\n## 3. Next Action\nReview `docs/plans/bridge/design.md`.\n',
      );
      await writeText(
        root,
        '.vibe/agent/session-log.md',
        '# Log\n\n## Entries\n- 2026-07-15T05:00:00.000Z [checkpoint] bridge implementation checkpoint\n',
      );
      const result = await resolveGoalSource({ repoRoot: root, git: coherentGit() });
      assert.equal(result.selected?.source.kind, 'handoff-reconstruction');
      assert.equal(result.selected?.source.confidence, 'reconstructed');
      assert.equal(result.selected?.unresolved.includes('reconstructed-from-handoff'), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('captures dirty and unpushed state explicitly', async () => {
    const root = await makeRoot();
    try {
      await writeCoherentState(root);
      const git = coherentGit(false, {
        status: 'M  staged.ts\n M unstaged.ts\n?? untracked.ts\n',
        unpushed: 2,
      });
      const result = await resolveGoalSource({ repoRoot: root, git });
      assert.deepEqual(result.selected?.dirtyState, {
        staged: ['staged.ts'],
        unstaged: ['unstaged.ts'],
        untracked: ['untracked.ts'],
        patchSha256: null,
      });
      assert.equal(result.selected?.unresolved.includes('unpushed-commits:2'), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('flags unrelated recent commits', async () => {
    const root = await makeRoot();
    try {
      const git = new FakeGitPort({
        commits: [
          commit(UNRELATED_SHA, HEAD_SHA, 'docs: unrelated release note', '2026-07-15T07:00:00.000Z'),
          commit(HEAD_SHA, BASE_SHA, 'feat(bridge): implement provider chain'),
        ],
        diffFiles: ['src/provider.ts'],
      });
      const result = await resolveGoalSource({ repoRoot: root, git });
      assert.equal(result.selected?.source.kind, 'git-reconstruction');
      assert.equal(result.selected?.commitShas.includes(UNRELATED_SHA), false);
      assert.equal(result.selected?.unresolved.includes('unrelated-recent-commits-excluded'), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('falls back to git reconstruction with reconstructed label', async () => {
    const root = await makeRoot();
    try {
      const git = new FakeGitPort({
        commits: [commit(HEAD_SHA, BASE_SHA, 'feat(bridge): add fallback provider')],
        diffFiles: ['src/fallback.ts'],
      });
      const result = await resolveGoalSource({ repoRoot: root, git });
      assert.equal(result.selected?.source.kind, 'git-reconstruction');
      assert.equal(result.selected?.source.confidence, 'reconstructed');
      assert.equal(result.selected?.unresolved.includes('reconstructed-from-git-history'), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns null selected with diagnostics when no goal exists', async () => {
    const root = await makeRoot();
    try {
      const result = await resolveGoalSource({ repoRoot: root, git: new FakeGitPort() });
      assert.equal(result.selected, null);
      assert.deepEqual(
        result.diagnostics.map((diagnostic) => diagnostic.status),
        ['unavailable', 'no-goal', 'no-goal', 'no-goal'],
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('app-server stub performs no I/O and never touches thread content', async () => {
    const git = new FakeGitPort();
    const provider = new CodexAppServerGoalProvider();
    const result = await provider.discover({ repoRoot: 'Z:/path-that-does-not-exist', git });
    assert.deepEqual(result, {
      status: 'unavailable',
      reason: 'codex-app-server-api-unverified',
    });
    assert.equal(git.calls.length, 0);
  });

  it('never labels a non-app-server goal source as exact', async () => {
    const iterateRoot = await makeRoot();
    const handoffRoot = await makeRoot();
    const gitRoot = await makeRoot();
    try {
      await writeCoherentState(iterateRoot);
      await writeText(
        handoffRoot,
        '.vibe/agent/handoff.md',
        '# Handoff\n\n## 2. Status\nBridge work is active.\n\n## 3. Next Action\nReview the bridge.\n',
      );
      const results = [
        await resolveGoalSource({ repoRoot: iterateRoot, git: coherentGit() }),
        await resolveGoalSource({ repoRoot: handoffRoot, git: coherentGit() }),
        await resolveGoalSource({
          repoRoot: gitRoot,
          git: new FakeGitPort({
            commits: [commit(HEAD_SHA, BASE_SHA, 'feat(bridge): reconstruct goal')],
            diffFiles: ['src/reconstructed.ts'],
          }),
        }),
      ];
      assert.deepEqual(
        results.map((result) => result.selected?.source.kind),
        ['vibe-goal-iterate', 'handoff-reconstruction', 'git-reconstruction'],
      );
      assert.equal(
        results.every((result) => result.selected?.source.confidence !== 'exact'),
        true,
      );
    } finally {
      await Promise.all([iterateRoot, handoffRoot, gitRoot].map((root) =>
        rm(root, { recursive: true, force: true })));
    }
  });

  it('classifies code, tests, migrations, and docs deterministically', () => {
    assert.deepEqual(
      classifyScope([
        'docs/guide.md',
        'migrations/001.sql',
        'src/feature.ts',
        'src/feature.test.ts',
      ]),
      {
        changedFiles: [
          'docs/guide.md',
          'migrations/001.sql',
          'src/feature.test.ts',
          'src/feature.ts',
        ],
        codeFiles: ['src/feature.ts'],
        testFiles: ['src/feature.test.ts'],
        migrationFiles: ['migrations/001.sql'],
        docsFiles: ['docs/guide.md'],
        scopeGlobs: ['docs/**', 'migrations/**', 'src/**'],
      },
    );
  });

  it('continues after a provider exception and records the isolated failure', async () => {
    const root = await makeRoot();
    try {
      const throwingProvider: GoalSourceProvider = {
        kind: 'codex-goal',
        async discover() {
          throw new Error('fixture-provider-failure');
        },
      };
      const noGoalProvider: GoalSourceProvider = {
        kind: 'git-reconstruction',
        async discover() {
          return { status: 'no-goal', reason: 'fixture-empty' };
        },
      };
      const result = await resolveGoalSource(
        { repoRoot: root, git: new FakeGitPort() },
        { providers: [throwingProvider, noGoalProvider], collectAll: true },
      );
      assert.deepEqual(result.diagnostics, [
        {
          provider: 'codex-goal',
          status: 'error',
          reason: 'fixture-provider-failure',
        },
        { provider: 'git-reconstruction', status: 'no-goal', reason: 'fixture-empty' },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('sorts rosters by code point independent of locale', () => {
    assert.deepEqual(classifyScope(['a', 'B']).changedFiles, ['B', 'a']);
  });
});
