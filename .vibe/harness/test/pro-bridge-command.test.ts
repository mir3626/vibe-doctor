import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
  resolveProBridgeConfig,
  type ProBridgeConfig,
} from '../src/lib/config.js';
import {
  computePayloadSha256,
  type GoalSourceManifest,
  type ReviewRequest,
  type ReviewResultManifest,
} from '../src/pro-bridge/contract.js';
import { resolveGoalSource } from '../src/pro-bridge/goal-source/resolver.js';
import type { GitPort } from '../src/pro-bridge/goal-source/types.js';
import { MailboxStore } from '../src/pro-bridge/mailbox/store.js';
import { ManualDirectoryTransport } from '../src/pro-bridge/transports/manual.js';
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

function mailboxRequest(requestId = 'AUD-20260715-commandmcp'): ReviewRequest {
  const draft: ReviewRequest = {
    schemaVersion: 'vibe-pro-review-request-v1', requestId, kind: 'goal_audit', origin: 'cli',
    repository: { fullName: 'owner/repo', remoteUrl: 'https://github.com/owner/repo.git', defaultBranch: 'main' },
    git: {
      baseSha: BASE_SHA, headSha: HEAD_SHA, branch: 'main', headVisibleOnGitHub: true,
      compareUrlHint: null, patchAttachmentSha256: null,
    },
    goalSource: null, userGoal: 'Audit command mailbox sync.', reviewPrompt: '# Command mailbox audit',
    outputContract: { requiredFiles: ['README.md', 'REVIEW.md', 'FINDINGS.json', 'prompt/CLI_MAIN_SESSION_PROMPT.md'] },
    createdAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
    payloadSha256: '0'.repeat(64),
  };
  return { ...draft, payloadSha256: computePayloadSha256(draft) };
}

function mailboxFiles(): Array<{ path: string; content: string }> {
  return [
    { path: 'README.md', content: '# Command mailbox result\n' },
    { path: 'REVIEW.md', content: '# Review\n\nCommand sync passed.\n' },
    { path: 'FINDINGS.json', content: '{"findings":[]}\n' },
    { path: 'prompt/CLI_MAIN_SESSION_PROMPT.md', content: '# Next\n\nWait for approval.\n' },
  ];
}

function mailboxManifest(input: ReviewRequest): ReviewResultManifest {
  const draft: ReviewResultManifest = {
    schemaVersion: 'vibe-pro-review-result-v1', requestId: input.requestId,
    requestPayloadSha256: input.payloadSha256, repositoryFullName: input.repository.fullName,
    reviewedBaseSha: input.git.baseSha, reviewedHeadSha: input.git.headSha, resultKind: 'audit',
    proposedFolder: '2026-07-15-command-mailbox-pro-review', disposition: 'approved',
    files: mailboxFiles().map((file) => {
      const bytes = Buffer.from(file.content, 'utf8');
      return {
        path: file.path,
        mediaType: file.path.endsWith('.json') ? 'application/json' : 'text/markdown',
        byteLength: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    }),
    findingsSummary: { p0: 0, p1: 0, p2: 0, p3: 0 },
    reviewerDeclaration: { surface: 'chatgpt-web', requestedMode: 'pro', githubConnectorUsed: true, limitations: [] },
    createdAt: NOW.toISOString(), payloadSha256: '0'.repeat(64),
  };
  return { ...draft, payloadSha256: computePayloadSha256(draft) };
}

async function seedMailboxResult(repoRoot: string): Promise<{
  store: MailboxStore;
  input: ReviewRequest;
  manifest: ReviewResultManifest;
  resultFilesSha256: string;
}> {
  const store = new MailboxStore({ repoRoot, now: () => NOW });
  const input = mailboxRequest();
  const manifest = mailboxManifest(input);
  await store.createRequest(input);
  await store.claimRequest(input.requestId);
  await store.beginResult(input.requestId);
  for (const file of mailboxFiles()) {
    await store.putResultFile(input.requestId, {
      filePath: file.path, chunkIndex: 0, chunkCount: 1, content: file.content,
      chunkSha256: createHash('sha256').update(file.content).digest('hex'),
    });
  }
  const finalized = await store.finalizeResult(input.requestId, manifest);
  return { store, input, manifest, resultFilesSha256: finalized.resultFilesSha256 };
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

  it('resolves mcp mailbox config defaults when the section is absent', () => {
    const resolved = resolveProBridgeConfig({ enabled: true, transport: 'mcp-mailbox' });
    assert.deepEqual(resolved.mcp, { port: 8848, tunnel: 'none' });
  });

  it('sync pulls a result ready mailbox request through the shared importer', async () => {
    const repoRoot = await makeRoot();
    try {
      const seeded = await seedMailboxResult(repoRoot);
      const capture = captureIo();
      const exit = await runProBridge(['sync'], {
        repoRoot,
        config: enabledConfig({ transport: 'mcp-mailbox', resultRoot: 'plans' }),
        io: capture.io,
        clipboard: fakeClipboard(),
        browser: fakeBrowser(),
        now: () => NOW,
      });
      assert.equal(exit, 0, capture.err.join('\n'));
      await access(path.join(repoRoot, 'plans', seeded.manifest.proposedFolder, 'README.md'));
      assert.equal((await seeded.store.getStatus(seeded.input.requestId)).state, 'imported');
    } finally { await rm(repoRoot, { recursive: true, force: true }); }
  });

  it('sync ack receipt carries the importer result files sha', async () => {
    const repoRoot = await makeRoot();
    try {
      const input = mailboxRequest('AUD-20260715-manualack');
      const transport = new ManualDirectoryTransport({ repoRoot, now: () => NOW });
      const handle = await transport.createRequest(input);
      const bundle = serializeVibeBundle({
        requestId: input.requestId,
        folder: RESULT_FOLDER,
        files: mailboxFiles(),
      });
      const capture = captureIo();
      const exit = await runProBridge(['sync'], {
        repoRoot, config: enabledConfig({ resultRoot: 'plans' }), io: capture.io,
        clipboard: fakeClipboard(bundle), browser: fakeBrowser(), now: () => NOW,
      });
      assert.equal(exit, 0, capture.err.join('\n'));
      const receipt = JSON.parse(await readFile(path.join(handle.requestDir, 'imported.json'), 'utf8')) as {
        resultFilesSha256: string;
      };
      assert.match(receipt.resultFilesSha256, /^[0-9a-f]{64}$/);
      assert.notEqual(receipt.resultFilesSha256, 'recorded-by-importer');
    } finally { await rm(repoRoot, { recursive: true, force: true }); }
  });

  it('mcp subcommand starts the server and prints the connector url with the token once', async () => {
    const repoRoot = await makeRoot();
    const capture = captureIo();
    const token = 'one-time-command-token';
    let closed = false;
    let stopped = false;
    try {
      const exit = await runProBridge(['mcp'], {
        repoRoot, config: enabledConfig(), io: capture.io, randomToken: () => token,
        mcpServer: {
          async start() {
            return { port: 8848, url: 'http://127.0.0.1:8848', async close() { closed = true; } };
          },
        },
        tunnel: {
          async start() {
            return { kind: 'cloudflared', publicUrl: 'https://unit.trycloudflare.com', async stop() { stopped = true; } };
          },
        },
        async waitForShutdown() {},
      });
      assert.equal(exit, 0, capture.err.join('\n'));
      assert.equal(capture.out.join('\n').split(token).length - 1, 1);
      assert.equal(closed, true);
      assert.equal(stopped, true);
      await assert.rejects(access(path.join(repoRoot, '.vibe')));
    } finally { await rm(repoRoot, { recursive: true, force: true }); }
  });

  it('mcp subcommand falls back to a local url when the tunnel binary is missing', async () => {
    const repoRoot = await makeRoot();
    const capture = captureIo();
    try {
      const exit = await runProBridge(['mcp', '--tunnel', 'cloudflared'], {
        repoRoot, config: enabledConfig(), io: capture.io, randomToken: () => 'fallback-token',
        mcpServer: {
          async start() {
            return { port: 8848, url: 'http://127.0.0.1:8848', async close() {} };
          },
        },
        tunnel: {
          async start() {
            return { kind: 'cloudflared', publicUrl: null, reason: 'ENOENT', async stop() {} };
          },
        },
        async waitForShutdown() {},
      });
      assert.equal(exit, 0);
      assert.match(capture.err.join('\n'), /로컬 URL.*ENOENT/);
      assert.match(capture.out.join('\n'), /http:\/\/127\.0\.0\.1:8848\/mcp\?token=/);
    } finally { await rm(repoRoot, { recursive: true, force: true }); }
  });
});
