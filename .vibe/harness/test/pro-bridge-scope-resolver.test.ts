import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  resolveGitHubScope,
  type VisibilityVerdict,
} from '../src/pro-bridge/scope-resolver.js';
import type { GitPort } from '../src/pro-bridge/goal-source/types.js';

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);

interface FakeOptions {
  remote?: string | null;
  baseVisibility?: VisibilityVerdict;
  headVisibility?: VisibilityVerdict;
  status?: string;
  numstat?: string;
  diffs?: Record<string, string>;
}

class FakeGit implements GitPort {
  readonly calls: string[][] = [];

  constructor(private readonly options: FakeOptions = {}) {}

  async run(args: string[]) {
    this.calls.push([...args]);
    if (args[0] === 'config') {
      return this.options.remote === null
        ? this.failure('no remote')
        : this.success(`${this.options.remote ?? 'https://github.com/owner/repo.git'}\n`);
    }
    if (args[0] === 'symbolic-ref') {
      return this.success('origin/main\n');
    }
    if (args[0] === 'rev-parse') {
      return this.success('main\n');
    }
    if (args[0] === 'branch') {
      const verdict = args.at(-1) === BASE_SHA
        ? this.options.baseVisibility ?? 'remote'
        : this.options.headVisibility ?? 'remote';
      if (verdict === 'unknown') {
        return this.failure('remote refs unavailable');
      }
      return this.success(verdict === 'remote' ? '  origin/main\n' : '');
    }
    if (args[0] === 'status') {
      return this.success(this.options.status ?? '');
    }
    if (args[0] === 'diff' && args.includes('--numstat')) {
      return this.success(this.options.numstat ?? '');
    }
    if (args[0] === 'diff' && args.includes('--')) {
      const filePath = args[args.indexOf('--') + 1]!;
      return this.success(
        this.options.diffs?.[filePath] ??
          `diff --git a/${filePath} b/${filePath}\n--- a/${filePath}\n+++ b/${filePath}\n@@ -1 +1 @@\n-old\n+new\n`,
      );
    }
    return this.failure(`unexpected command: ${args.join(' ')}`);
  }

  private success(stdout: string) {
    return { ok: true, stdout, stderr: '', code: 0 };
  }

  private failure(stderr: string) {
    return { ok: false, stdout: '', stderr, code: 1 };
  }
}

async function makeRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'vibe-pro-scope-'));
}

async function writeText(root: string, relativePath: string, content: string): Promise<void> {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

async function resolve(git: FakeGit, repoRoot = '.') {
  return resolveGitHubScope({ repoRoot, git }, { baseSha: BASE_SHA, headSha: HEAD_SHA });
}

describe('github scope resolver', () => {
  it('resolves fullName from https and ssh remotes', async () => {
    for (const [remote, expected] of [
      ['https://github.com/acme/widget.git', 'acme/widget'],
      ['git@github.com:acme/widget.git', 'acme/widget'],
      ['ssh://git@github.com/acme/widget.git', 'acme/widget'],
      ['https://gitlab.com/acme/widget.git', null],
    ] as const) {
      const result = await resolve(new FakeGit({ remote }));
      assert.equal(result.repository.fullName, expected);
    }
  });

  it('classifies pushed clean head as github-range', async () => {
    const result = await resolve(new FakeGit());
    assert.equal(result.visibilityCase, 'github-range');
    assert.equal(result.patch, null);
    assert.equal(
      result.git.compareUrlHint,
      `https://github.com/owner/repo/compare/${BASE_SHA}...${HEAD_SHA}`,
    );
  });

  it('classifies unpushed commits as github-base plus patch', async () => {
    const result = await resolve(
      new FakeGit({
        headVisibility: 'absent',
        numstat: '1\t1\tsrc/local.ts\n',
      }),
    );
    assert.equal(result.visibilityCase, 'github-base-plus-patch');
    assert.equal(result.patch?.files[0]?.path, 'src/local.ts');
  });

  it('classifies dirty worktree as github-range plus patch', async () => {
    const result = await resolve(
      new FakeGit({
        status: ' M src/dirty.ts\n',
        numstat: '1\t1\tsrc/dirty.ts\n',
      }),
    );
    assert.equal(result.visibilityCase, 'github-range-plus-patch');
    assert.equal(result.patch?.files[0]?.kind, 'tracked');
  });

  it('reports unknown visibility honestly when remote refs are unavailable', async () => {
    const result = await resolve(
      new FakeGit({ baseVisibility: 'unknown', headVisibility: 'unknown' }),
    );
    assert.equal(result.git.baseVisibility, 'unknown');
    assert.equal(result.git.headVisibility, 'unknown');
    assert.equal(result.visibilityCase, 'github-base-plus-patch');
    assert.equal(result.warnings.includes('visibility-from-local-remote-refs'), true);
    assert.equal(result.warnings.includes('base-visibility-unknown'), true);
  });

  it('blocks when base is not on the remote', async () => {
    const result = await resolve(new FakeGit({ baseVisibility: 'absent' }));
    assert.equal(result.visibilityCase, 'blocked');
    assert.deepEqual(result.blockedReasons, ['base-not-on-remote']);
  });

  it('blocks when repository fullName cannot be resolved', async () => {
    const result = await resolve(new FakeGit({ remote: 'https://gitlab.com/acme/widget.git' }));
    assert.equal(result.visibilityCase, 'blocked');
    assert.equal(result.blockedReasons.includes('repository-fullname-unresolved'), true);
  });

  it('excludes secret paths from the patch and records them', async () => {
    const result = await resolve(
      new FakeGit({
        headVisibility: 'absent',
        status: [
          '?? .env.local',
          '?? config/credentials.json',
          '?? auth/session-token.txt',
          '?? keys/id_rsa',
          '?? data/prod.sql.gz',
          '?? node_modules/pkg/x.js',
          '?? dist/app.js',
          '?? backup/repo.tar.zst',
          '',
        ].join('\n'),
        numstat: [
          '1\t1\t.env.local',
          '1\t1\tconfig/credentials.json',
          '1\t1\tauth/session-token.txt',
          '1\t1\tkeys/id_rsa',
          '1\t1\tdata/prod.sql.gz',
          '1\t1\tnode_modules/pkg/x.js',
          '1\t1\tdist/app.js',
          '1\t1\tbackup/repo.tar.zst',
        ].join('\n'),
      }),
    );
    assert.deepEqual(
      result.patch?.excluded.map((entry) => entry.path),
      [
        '.env.local',
        'auth/session-token.txt',
        'backup/repo.tar.zst',
        'config/credentials.json',
        'data/prod.sql.gz',
        'dist/app.js',
        'keys/id_rsa',
        'node_modules/pkg/x.js',
      ],
    );
    assert.equal(result.patch?.excluded.every((entry) => entry.reason === 'secret'), true);
  });

  it('excludes binary content from the patch', async () => {
    const result = await resolve(
      new FakeGit({
        headVisibility: 'absent',
        numstat: '-\t-\tassets/image.png\n',
      }),
    );
    assert.deepEqual(result.patch?.excluded, [{ path: 'assets/image.png', reason: 'binary' }]);
  });

  it('omits oversized patch and blocks publish when head is not visible', async () => {
    const git = new FakeGit({
      headVisibility: 'absent',
      numstat: '1\t1\tsrc/large.ts\n',
      diffs: { 'src/large.ts': 'x'.repeat(128) },
    });
    const result = await resolveGitHubScope(
      { repoRoot: '.', git },
      { baseSha: BASE_SHA, headSha: HEAD_SHA },
      { maxPatchBytes: 16 },
    );
    assert.equal(result.visibilityCase, 'blocked');
    assert.equal(result.patch, null);
    assert.equal(result.blockedReasons.includes('patch-oversized'), true);
    assert.equal(result.warnings.some((warning) => warning.startsWith('patch-bytes:')), true);
  });

  it('includes untracked safe files as synthesized diff', async () => {
    const root = await makeRoot();
    try {
      await writeText(root, 'src/new.ts', 'export const answer = 42;\n');
      const result = await resolve(
        new FakeGit({ headVisibility: 'absent', status: '?? src/new.ts\n' }),
        root,
      );
      assert.match(result.patch?.diffText ?? '', /--- \/dev\/null/);
      assert.match(result.patch?.diffText ?? '', /\+export const answer = 42;/);
      assert.deepEqual(result.patch?.files, [{ path: 'src/new.ts', kind: 'untracked' }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('records patch roster and sha256', async () => {
    const result = await resolve(
      new FakeGit({
        headVisibility: 'absent',
        numstat: '1\t1\tsrc/a.ts\n1\t1\tsrc/B.ts\n',
      }),
    );
    assert.deepEqual(result.patch?.files.map((file) => file.path), ['src/B.ts', 'src/a.ts']);
    assert.equal(
      result.patch?.sha256,
      createHash('sha256').update(result.patch?.diffText ?? '', 'utf8').digest('hex'),
    );
  });

  it('disables rename detection so renamed files stay in the patch roster', async () => {
    const git = new FakeGit({
      status: ' R src/old.ts -> src/new.ts\n',
      numstat: '1\t0\tsrc/new.ts\n0\t1\tsrc/old.ts\n',
      diffs: {
        'src/new.ts': 'diff --git a/src/new.ts b/src/new.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1 @@\n+renamed\n',
        'src/old.ts': 'diff --git a/src/old.ts b/src/old.ts\ndeleted file mode 100644\n--- a/src/old.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-renamed\n',
      },
    });
    const result = await resolve(git);

    assert.deepEqual(
      result.patch?.files,
      [
        { path: 'src/new.ts', kind: 'tracked' },
        { path: 'src/old.ts', kind: 'tracked' },
      ],
    );
    assert.match(result.patch?.diffText ?? '', /new file mode 100644/);
    assert.match(result.patch?.diffText ?? '', /deleted file mode 100644/);
    assert.equal(
      git.calls.filter((args) => args[0] === 'diff').every((args) => args.includes('--no-renames')),
      true,
    );
  });

  it('never invokes mutating git commands', async () => {
    const git = new FakeGit({
      headVisibility: 'absent',
      status: ' M src/a.ts\n',
      numstat: '1\t1\tsrc/a.ts\n',
    });
    await resolve(git);
    const allowed = new Set(['config', 'symbolic-ref', 'rev-parse', 'branch', 'status', 'diff']);
    assert.equal(git.calls.every((args) => allowed.has(args[0]!)), true);
    assert.equal(
      git.calls.some((args) => ['push', 'fetch', 'commit', 'checkout'].includes(args[0]!)),
      false,
    );
  });
});
