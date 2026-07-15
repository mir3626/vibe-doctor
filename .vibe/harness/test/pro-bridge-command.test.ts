import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  runProBridge,
  type ProBridgeDeps,
  type ProBridgeIo,
} from '../src/commands/pro-bridge.js';
import {
  DEFAULT_PRO_BRIDGE_CONFIG,
  type ProBridgeConfig,
} from '../src/lib/config.js';
import type { GoalSourceManifest } from '../src/pro-bridge/contract.js';
import { resolveGoalSource } from '../src/pro-bridge/goal-source/resolver.js';
import type { GitPort } from '../src/pro-bridge/goal-source/types.js';
import { serializeVibeBundle } from '../src/pro-bridge/vibe-bundle.js';

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const NOW = new Date('2026-07-15T08:00:00.000Z');
const RESULT_FOLDER = '2026-07-15-command-regression-pro-review';

interface Capture {
  io: ProBridgeIo;
  out: string[];
  err: string[];
  confirmCalls: number;
}

interface GitScenario {
  remote?: string | null;
  baseVisibility?: 'remote' | 'absent' | 'unknown';
  headVisibility?: 'remote' | 'absent' | 'unknown';
  status?: string;
  numstat?: string;
  diffs?: Record<string, string>;
}

class FakeGit implements GitPort {
  readonly calls: string[][] = [];

  constructor(private readonly scenario: GitScenario = {}) {}

  async run(args: string[]) {
    this.calls.push([...args]);
    if (args[0] === 'config') {
      return this.scenario.remote === null
        ? this.failure('no remote')
        : this.success(`${this.scenario.remote ?? 'https://github.com/owner/repo.git'}\n`);
    }
    if (args[0] === 'symbolic-ref') {
      return this.success('origin/main\n');
    }
    if (args[0] === 'rev-parse') {
      return this.success(args.includes('--abbrev-ref') ? 'main\n' : `${HEAD_SHA}\n`);
    }
    if (args[0] === 'branch') {
      const sha = args.at(-1);
      const verdict = sha === BASE_SHA
        ? this.scenario.baseVisibility ?? 'remote'
        : this.scenario.headVisibility ?? 'remote';
      return verdict === 'unknown'
        ? this.failure('remote refs unavailable')
        : this.success(verdict === 'remote' ? '  origin/main\n' : '');
    }
    if (args[0] === 'status') {
      return this.success(this.scenario.status ?? '');
    }
    if (args[0] === 'diff' && args.includes('--numstat')) {
      return this.success(this.scenario.numstat ?? '');
    }
    if (args[0] === 'diff' && args.includes('--')) {
      const filePath = args[args.indexOf('--') + 1]!;
      return this.success(
        this.scenario.diffs?.[filePath]
          ?? `diff --git a/${filePath} b/${filePath}\n--- a/${filePath}\n+++ b/${filePath}\n@@ -1 +1 @@\n-old\n+new\n`,
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

function enabledConfig(overrides: Partial<ProBridgeConfig> = {}): ProBridgeConfig {
  return {
    ...DEFAULT_PRO_BRIDGE_CONFIG,
    enabled: true,
    copyInvocation: false,
    openBrowser: false,
    ...overrides,
  };
}

function captureIo(confirmResult = false): Capture {
  const capture: Capture = {
    out: [],
    err: [],
    confirmCalls: 0,
    io: undefined as unknown as ProBridgeIo,
  };
  capture.io = {
    out: (line) => capture.out.push(line),
    err: (line) => capture.err.push(line),
    async confirm() {
      capture.confirmCalls += 1;
      return confirmResult;
    },
  };
  return capture;
}

function fakeClipboard(readText = ''): NonNullable<ProBridgeDeps['clipboard']> {
  return {
    async copyFile() {
      return { ok: true, method: 'fake', error: null };
    },
    async readText() {
      return { ok: true, text: readText, error: null };
    },
  };
}

function fakeBrowser(): NonNullable<ProBridgeDeps['browser']> {
  return {
    async open() {
      return { ok: true, error: null };
    },
  };
}

function auditGoal(repoRoot: string): GoalSourceManifest {
  return {
    schemaVersion: 'vibe-goal-source-v1',
    repository: {
      root: repoRoot,
      remoteUrl: 'https://github.com/owner/repo.git',
      fullName: 'owner/repo',
    },
    source: {
      kind: 'codex-goal',
      confidence: 'exact',
      threadId: 'thread-command-test',
      iterationId: null,
      goalText: 'Audit the Pro Bridge command regressions.',
      goalStatus: 'completed',
    },
    designRefs: ['docs/plans/web-pro-bridge/design.md'],
    implementationRefs: ['docs/prompts/sprint-vpb-03-manual-transport-skills.md'],
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    commitShas: [HEAD_SHA],
    scope: {
      changedFiles: ['.vibe/harness/src/commands/pro-bridge.ts'],
      codeFiles: ['.vibe/harness/src/commands/pro-bridge.ts'],
      testFiles: ['.vibe/harness/test/pro-bridge-command.test.ts'],
      migrationFiles: [],
      docsFiles: [],
      scopeGlobs: ['.vibe/harness/src/commands/**'],
    },
    dirtyState: {
      staged: [],
      unstaged: [],
      untracked: [],
      patchSha256: null,
    },
    unresolved: [],
    payloadSha256: '0'.repeat(64),
  };
}

function goalResolver(repoRoot: string): typeof resolveGoalSource {
  return (async () => ({
    selected: auditGoal(repoRoot),
    candidates: [],
    diagnostics: [],
  })) as unknown as typeof resolveGoalSource;
}

function auditBundle(readme: string): string {
  return serializeVibeBundle({
    requestId: 'web-origin',
    folder: RESULT_FOLDER,
    files: [
      { path: 'README.md', content: readme },
      { path: 'REVIEW.md', content: '# Review\n\nCommand behavior verified.' },
      { path: 'FINDINGS.json', content: '{"findings":[]}' },
      {
        path: 'prompt/CLI_MAIN_SESSION_PROMPT.md',
        content: '# Next goal\n\nWait for explicit user approval before implementation.',
      },
    ],
  });
}

async function makeRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'vibe-pro-command-'));
}

describe('pro bridge command', () => {
  it('blocks publishing subcommands while disabled but permits status and list', async () => {
    const repoRoot = await makeRoot();
    try {
      for (const command of ['audit', 'design', 'sync']) {
        const capture = captureIo();
        const exit = await runProBridge([command], {
          repoRoot,
          config: { ...DEFAULT_PRO_BRIDGE_CONFIG, enabled: false },
          io: capture.io,
          clipboard: fakeClipboard(),
          browser: fakeBrowser(),
          stdin: { isTTY: false },
        });
        assert.equal(exit, 1);
        assert.match(capture.err.join('\n'), /Pro Bridge가 꺼져 있습니다/);
      }
      for (const command of ['status', 'list']) {
        const capture = captureIo();
        const exit = await runProBridge([command], {
          repoRoot,
          config: { ...DEFAULT_PRO_BRIDGE_CONFIG, enabled: false },
          io: capture.io,
          clipboard: fakeClipboard(),
          browser: fakeBrowser(),
          stdin: { isTTY: false },
        });
        assert.equal(exit, 0);
        assert.match(capture.out.join('\n'), /요청이 없습니다/);
      }
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('requires yes in non-interactive mode and publishes when it is supplied', async () => {
    const repoRoot = await makeRoot();
    try {
      const rejected = captureIo(true);
      const rejectedExit = await runProBridge(['design', 'Design a safer bridge'], {
        repoRoot,
        config: enabledConfig(),
        io: rejected.io,
        git: new FakeGit(),
        clipboard: fakeClipboard(),
        browser: fakeBrowser(),
        stdin: { isTTY: false },
        now: () => NOW,
      });
      assert.equal(rejectedExit, 1);
      assert.equal(rejected.confirmCalls, 0);
      assert.match(rejected.err.join('\n'), /비대화 환경.*--yes/);

      const approved = captureIo();
      const approvedExit = await runProBridge(['design', 'Design a safer bridge', '--yes'], {
        repoRoot,
        config: enabledConfig(),
        io: approved.io,
        git: new FakeGit(),
        clipboard: fakeClipboard(),
        browser: fakeBrowser(),
        stdin: { isTTY: false },
        now: () => NOW,
      });
      assert.equal(approvedExit, 0, approved.err.join('\n'));
      assert.equal(approved.confirmCalls, 0);
      assert.match(approved.out.join('\n'), /requestId:/);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('prints Korean guidance for every scope blocked reason without pushing', async () => {
    const repoRoot = await makeRoot();
    try {
      const scenarios: Array<{
        git: FakeGit;
        config: ProBridgeConfig;
        expected: RegExp;
      }> = [
        {
          git: new FakeGit({ remote: 'https://gitlab.com/owner/repo.git' }),
          config: enabledConfig(),
          expected: /GitHub remote.*manual\/API/,
        },
        {
          git: new FakeGit({ baseVisibility: 'absent' }),
          config: enabledConfig(),
          expected: /base branch.*직접 push/,
        },
        {
          git: new FakeGit({
            headVisibility: 'absent',
            numstat: '1\t1\tsrc/large.ts\n',
            diffs: { 'src/large.ts': 'x'.repeat(128) },
          }),
          config: enabledConfig({ maxPatchBytes: 16 }),
          expected: /head의 patch가 상한.*직접 push/,
        },
      ];

      for (const scenario of scenarios) {
        const capture = captureIo();
        const exit = await runProBridge(['audit', '--yes'], {
          repoRoot,
          config: scenario.config,
          io: capture.io,
          git: scenario.git,
          clipboard: fakeClipboard(),
          browser: fakeBrowser(),
          stdin: { isTTY: false },
          goalResolver: goalResolver(repoRoot),
          now: () => NOW,
        });
        assert.equal(exit, 1);
        assert.match(capture.err.join('\n'), scenario.expected);
        assert.equal(
          scenario.git.calls.some((args) => ['push', 'commit', 'checkout'].includes(args[0]!)),
          false,
        );
      }
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('passes approve revision through import context and installs rev2', async () => {
    const repoRoot = await makeRoot();
    let clipboardText = auditBundle('# First review');
    const clipboard: NonNullable<ProBridgeDeps['clipboard']> = {
      async copyFile() {
        return { ok: true, method: 'fake', error: null };
      },
      async readText() {
        return { ok: true, text: clipboardText, error: null };
      },
    };
    try {
      const first = captureIo();
      assert.equal(await runProBridge(['sync'], {
        repoRoot,
        config: enabledConfig({ resultRoot: 'plans' }),
        io: first.io,
        clipboard,
        browser: fakeBrowser(),
        stdin: { isTTY: false },
        now: () => NOW,
      }), 0, first.err.join('\n'));

      clipboardText = auditBundle('# Revised review');
      const revised = captureIo();
      assert.equal(await runProBridge(['sync', '--approve-revision'], {
        repoRoot,
        config: enabledConfig({ resultRoot: 'plans' }),
        io: revised.io,
        clipboard,
        browser: fakeBrowser(),
        stdin: { isTTY: false },
        now: () => NOW,
      }), 0, revised.err.join('\n'));

      const revisionRoot = path.join(repoRoot, 'plans', `${RESULT_FOLDER}-rev2`);
      await access(revisionRoot);
      assert.equal(await readFile(path.join(revisionRoot, 'README.md'), 'utf8'), '# Revised review');
      assert.match(revised.out.join('\n'), /-rev2/);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('prints bundle parser error code message and line while retaining the truncation hint', async () => {
    const repoRoot = await makeRoot();
    try {
      const duplicate = captureIo();
      const duplicateText = 'VIBE-BUNDLE v1\nVIBE-BUNDLE v1\n==== VIBE:END ====\n';
      assert.equal(await runProBridge(['sync'], {
        repoRoot,
        config: enabledConfig(),
        io: duplicate.io,
        clipboard: fakeClipboard(duplicateText),
        browser: fakeBrowser(),
        stdin: { isTTY: false },
      }), 1);
      assert.match(duplicate.err.join('\n'), /duplicate-header/);
      assert.match(duplicate.err.join('\n'), /More than one VIBE-BUNDLE v1 header was found/);
      assert.match(duplicate.err.join('\n'), /line 2/);

      const truncated = captureIo();
      const truncatedText = [
        'VIBE-BUNDLE v1',
        'requestId: web-origin',
        `folder: ${RESULT_FOLDER}`,
        'files: 0',
      ].join('\n');
      assert.equal(await runProBridge(['sync'], {
        repoRoot,
        config: enabledConfig(),
        io: truncated.io,
        clipboard: fakeClipboard(truncatedText),
        browser: fakeBrowser(),
        stdin: { isTTY: false },
      }), 1);
      assert.match(truncated.err.join('\n'), /missing-end-sentinel/);
      assert.match(truncated.err.join('\n'), /VIBE:END sentinel was not found/);
      assert.match(truncated.err.join('\n'), /VIBE:END가 없습니다/);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('omits compare url output when the head is not visible on github', async () => {
    const repoRoot = await makeRoot();
    try {
      const capture = captureIo();
      const exit = await runProBridge(['audit', '--yes'], {
        repoRoot,
        config: enabledConfig(),
        io: capture.io,
        git: new FakeGit({
          headVisibility: 'absent',
          numstat: '1\t1\tsrc/local.ts\n',
        }),
        clipboard: fakeClipboard(),
        browser: fakeBrowser(),
        stdin: { isTTY: false },
        goalResolver: goalResolver(repoRoot),
        now: () => NOW,
      });
      assert.equal(exit, 0, capture.err.join('\n'));
      assert.doesNotMatch(capture.out.join('\n'), /(?:compare:|github\.com\/owner\/repo\/compare)/);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('does not expose raw binary or secret exclusion labels', async () => {
    const repoRoot = await makeRoot();
    try {
      const capture = captureIo();
      const exit = await runProBridge(['audit', '--yes'], {
        repoRoot,
        config: enabledConfig(),
        io: capture.io,
        git: new FakeGit({
          headVisibility: 'absent',
          numstat: '-\t-\tassets/image.png\n1\t1\t.env.local\n',
        }),
        clipboard: fakeClipboard(),
        browser: fakeBrowser(),
        stdin: { isTTY: false },
        goalResolver: goalResolver(repoRoot),
        now: () => NOW,
      });
      assert.equal(exit, 0, capture.err.join('\n'));
      const output = [...capture.out, ...capture.err].join('\n');
      assert.doesNotMatch(output, /\b(?:binary|secret)\b/);
      assert.match(output, /보안 필터 제외 1, 비텍스트 제외 1/);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
