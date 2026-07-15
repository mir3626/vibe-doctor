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
    if (args[0] === 'remote') {
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
      assert.equal(await runProBridge(['sync', '--accept-unbound-web-origin'], {
        repoRoot,
        config: enabledConfig({ resultRoot: 'plans' }),
        io: first.io,
        git: new FakeGit(),
        clipboard,
        browser: fakeBrowser(),
        stdin: { isTTY: false },
        now: () => NOW,
      }), 0, first.err.join('\n'));

      clipboardText = auditBundle('# Revised review');
      const revised = captureIo();
      assert.equal(await runProBridge(['sync', '--approve-revision', '--accept-unbound-web-origin'], {
        repoRoot,
        config: enabledConfig({ resultRoot: 'plans' }),
        io: revised.io,
        git: new FakeGit(),
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

  it('rejects --latest on manual transport before reading the clipboard', async () => {
    const repoRoot = await makeRoot();
    let clipboardReads = 0;
    try {
      const capture = captureIo();
      const exit = await runProBridge(['sync', '--latest'], {
        repoRoot,
        config: enabledConfig({ transport: 'manual' }),
        io: capture.io,
        clipboard: {
          async copyFile() {
            return { ok: true, method: 'fake', error: null };
          },
          async readText() {
            clipboardReads += 1;
            return { ok: true, text: '', error: null };
          },
        },
        stdin: { isTTY: false },
      });
      assert.equal(exit, 1);
      assert.equal(clipboardReads, 0);
      assert.equal(
        capture.err.join('\n'),
        '--latest는 mcp-mailbox transport 전용입니다. .vibe/config.local.json에서 proBridge.transport를 설정하거나 --from/클립보드 sync를 사용하세요.',
      );
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
    assert.deepEqual(resolved.mcp, { port: 18488, tunnel: 'none' });
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
        git: new FakeGit(),
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
        git: new FakeGit(), clipboard: fakeClipboard(bundle), browser: fakeBrowser(), now: () => NOW,
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

describe('pro bridge web origin and adapters', () => {
  function designRequest(input: {
    requestId: string;
    repositoryFullName?: string;
    kind?: 'goal_audit' | 'feature_design';
    origin?: 'cli' | 'web';
    headSha?: string;
    createdOffset?: number;
  }): ReviewRequest {
    const kind = input.kind ?? 'feature_design';
    const draft: ReviewRequest = {
      schemaVersion: 'vibe-pro-review-request-v1',
      requestId: input.requestId,
      kind,
      origin: input.origin ?? 'web',
      repository: {
        fullName: input.repositoryFullName ?? 'owner/repo',
        remoteUrl: `https://github.com/${input.repositoryFullName ?? 'owner/repo'}`,
        defaultBranch: 'main',
      },
      git: {
        baseSha: input.headSha ?? HEAD_SHA,
        headSha: input.headSha ?? HEAD_SHA,
        branch: 'main',
        headVisibleOnGitHub: true,
        compareUrlHint: null,
        patchAttachmentSha256: null,
      },
      goalSource: null,
      userGoal: 'Design web-origin sync.',
      reviewPrompt: '# Web-origin design',
      outputContract: {
        requiredFiles: kind === 'goal_audit'
          ? ['README.md', 'REVIEW.md', 'FINDINGS.json', 'prompt/CLI_MAIN_SESSION_PROMPT.md']
          : ['README.md', 'DESIGN.md', 'FINDINGS.json', 'prompt/CLI_MAIN_SESSION_PROMPT.md'],
      },
      createdAt: new Date(NOW.getTime() + (input.createdOffset ?? 0)).toISOString(),
      expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
      payloadSha256: '0'.repeat(64),
    };
    return { ...draft, payloadSha256: computePayloadSha256(draft) };
  }

  async function seedReadyResult(
    repoRoot: string,
    input: ReviewRequest,
    folder: string,
  ): Promise<ReviewResultManifest> {
    const store = new MailboxStore({ repoRoot, now: () => NOW });
    const primary = input.kind === 'goal_audit' ? 'REVIEW.md' : 'DESIGN.md';
    const files = [
      { path: 'README.md', content: '# Web-origin result\n' },
      { path: primary, content: '# Result\n\nRepository-bound package.\n' },
      { path: 'FINDINGS.json', content: '{"findings":[]}\n' },
      { path: 'prompt/CLI_MAIN_SESSION_PROMPT.md', content: '# Implement\n\nWait for approval.\n' },
    ];
    const draft: ReviewResultManifest = {
      schemaVersion: 'vibe-pro-review-result-v1',
      requestId: input.requestId,
      requestPayloadSha256: input.payloadSha256,
      repositoryFullName: input.repository.fullName,
      reviewedBaseSha: input.git.baseSha,
      reviewedHeadSha: input.git.headSha,
      resultKind: input.kind === 'goal_audit' ? 'audit' : 'design',
      proposedFolder: folder,
      disposition: 'approved',
      files: files.map((file) => {
        const bytes = Buffer.from(file.content, 'utf8');
        return {
          path: file.path,
          mediaType: file.path.endsWith('.json') ? 'application/json' : 'text/markdown',
          byteLength: bytes.byteLength,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        };
      }),
      findingsSummary: { p0: 0, p1: 0, p2: 0, p3: 0 },
      reviewerDeclaration: {
        surface: 'chatgpt-web',
        requestedMode: 'pro',
        githubConnectorUsed: true,
        limitations: [],
      },
      createdAt: NOW.toISOString(),
      payloadSha256: '0'.repeat(64),
    };
    const manifest = { ...draft, payloadSha256: computePayloadSha256(draft) };
    await store.createRequest(input);
    await store.claimRequest(input.requestId);
    await store.beginResult(input.requestId);
    for (const file of files) {
      await store.putResultFile(input.requestId, {
        filePath: file.path,
        chunkIndex: 0,
        chunkCount: 1,
        content: file.content,
        chunkSha256: createHash('sha256').update(file.content).digest('hex'),
      });
    }
    await store.finalizeResult(input.requestId, manifest);
    return manifest;
  }

  function repositoryGit(localHead = HEAD_SHA): GitPort {
    return {
      async run(args) {
        if (args[0] === 'remote') {
          return { ok: true, stdout: 'https://github.com/owner/repo.git\n', stderr: '', code: 0 };
        }
        if (args[0] === 'rev-parse') {
          return { ok: true, stdout: `${localHead}\n`, stderr: '', code: 0 };
        }
        return { ok: false, stdout: '', stderr: `unexpected ${args.join(' ')}`, code: 1 };
      },
    };
  }

  async function writeInstalledPrompt(repoRoot: string, folder: string, prompt: string): Promise<void> {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const promptDir = path.join(repoRoot, 'plans', folder, 'prompt');
    await mkdir(promptDir, { recursive: true });
    await writeFile(path.join(promptDir, 'CLI_MAIN_SESSION_PROMPT.md'), prompt, 'utf8');
  }

  it('resolves adapter config defaults when the sections are absent', () => {
    const resolved = resolveProBridgeConfig({ enabled: true });
    assert.equal(resolved.mcp.port, 18488);
    assert.deepEqual(resolved.workspaceAgent, { enabled: false, triggerCommand: [] });
    assert.deepEqual(resolved.api, {
      enabled: false,
      model: '',
      effort: 'high',
      maxInputTokens: 200_000,
      priceInputPerMTok: 0,
      priceOutputPerMTok: 0,
      pollIntervalMs: 5_000,
    });
    assert.deepEqual(resolved.apply, { envId: null });
  });

  it('sync latest matches only result ready requests for the current repository and kind', async () => {
    const repoRoot = await makeRoot();
    try {
      const selected = designRequest({ requestId: 'web-current-design', createdOffset: 1_000 });
      const otherKind = designRequest({
        requestId: 'web-current-audit',
        kind: 'goal_audit',
        createdOffset: 2_000,
      });
      const otherRepo = designRequest({
        requestId: 'web-other-design',
        repositoryFullName: 'other/repo',
        createdOffset: 3_000,
      });
      const selectedManifest = await seedReadyResult(repoRoot, selected, '2026-07-15-current-design');
      await seedReadyResult(repoRoot, otherKind, '2026-07-15-current-audit');
      await seedReadyResult(repoRoot, otherRepo, '2026-07-15-other-design');
      const capture = captureIo();
      const exit = await runProBridge(['sync', '--latest', '--kind', 'feature_design'], {
        repoRoot,
        config: enabledConfig({ transport: 'mcp-mailbox', resultRoot: 'plans' }),
        io: capture.io,
        git: repositoryGit(),
        stdin: { isTTY: false },
        now: () => NOW,
      });
      assert.equal(exit, 0, capture.err.join('\n'));
      await access(path.join(repoRoot, 'plans', selectedManifest.proposedFolder, 'README.md'));
      const store = new MailboxStore({ repoRoot, now: () => NOW });
      assert.equal((await store.getStatus(selected.requestId)).state, 'imported');
      assert.equal((await store.getStatus(otherKind.requestId)).state, 'result-ready');
      assert.equal((await store.getStatus(otherRepo.requestId)).state, 'result-ready');
    } finally { await rm(repoRoot, { recursive: true, force: true }); }
  });

  it('sync gates a web origin head mismatch behind explicit approval', async () => {
    const repoRoot = await makeRoot();
    try {
      const input = designRequest({ requestId: 'web-head-mismatch' });
      const manifest = await seedReadyResult(repoRoot, input, '2026-07-15-head-mismatch');
      const rejected = captureIo();
      const rejectedExit = await runProBridge(['sync', '--latest'], {
        repoRoot,
        config: enabledConfig({ transport: 'mcp-mailbox', resultRoot: 'plans' }),
        io: rejected.io,
        git: repositoryGit('c'.repeat(40)),
        stdin: { isTTY: false },
        now: () => NOW,
      });
      assert.equal(rejectedExit, 1);
      assert.match(rejected.err.join('\n'), /HEAD 불일치/);

      const approved = captureIo();
      const approvedExit = await runProBridge(['sync', '--latest', '--accept-head-mismatch'], {
        repoRoot,
        config: enabledConfig({ transport: 'mcp-mailbox', resultRoot: 'plans' }),
        io: approved.io,
        git: repositoryGit('c'.repeat(40)),
        stdin: { isTTY: false },
        now: () => NOW,
      });
      assert.equal(approvedExit, 0, approved.err.join('\n'));
      const provenance = JSON.parse(await readFile(
        path.join(repoRoot, 'plans', manifest.proposedFolder, '.bridge', 'provenance.json'),
        'utf8',
      )) as { skippedValidations: string[] };
      assert.deepEqual(provenance.skippedValidations, ['local-head-mismatch-acknowledged']);
    } finally { await rm(repoRoot, { recursive: true, force: true }); }
  });

  it('apply refuses to run without an installed prompt file', async () => {
    const repoRoot = await makeRoot();
    try {
      const capture = captureIo();
      const exit = await runProBridge(['apply', '2026-07-15-missing-design'], {
        repoRoot,
        config: enabledConfig({ resultRoot: 'plans' }),
        io: capture.io,
      });
      assert.equal(exit, 1);
      assert.match(capture.err.join('\n'), /프롬프트를 찾을 수 없습니다/);
    } finally { await rm(repoRoot, { recursive: true, force: true }); }
  });

  it('apply prints environment setup guidance and exits zero when envId is missing', async () => {
    const repoRoot = await makeRoot();
    try {
      const folder = '2026-07-15-apply-guidance';
      await writeInstalledPrompt(repoRoot, folder, '# Apply prompt\n');
      let calls = 0;
      const capture = captureIo();
      const exit = await runProBridge(['apply', folder], {
        repoRoot,
        config: enabledConfig({ resultRoot: 'plans', apply: { envId: null } }),
        io: capture.io,
        codexExec: { async run() { calls += 1; return { code: 0, stdout: '', stderr: '' }; } },
      });
      assert.equal(exit, 0);
      assert.equal(calls, 0);
      assert.match(capture.out.join('\n'), /proBridge\.apply\.envId/);
    } finally { await rm(repoRoot, { recursive: true, force: true }); }
  });

  it('apply submits the installed prompt through the codex cloud exec port', async () => {
    const repoRoot = await makeRoot();
    try {
      const folder = '2026-07-15-apply-submit';
      const prompt = '# Apply prompt\n\nImplement only after review.\n';
      await writeInstalledPrompt(repoRoot, folder, prompt);
      const calls: Array<{ args: string[]; stdinText: string }> = [];
      const capture = captureIo();
      const exit = await runProBridge(['apply', folder], {
        repoRoot,
        config: enabledConfig({ resultRoot: 'plans', apply: { envId: 'env-test' } }),
        io: capture.io,
        codexExec: {
          async run(args, stdinText) {
            calls.push({ args, stdinText });
            return { code: 0, stdout: 'submitted', stderr: '' };
          },
        },
      });
      assert.equal(exit, 0, capture.err.join('\n'));
      assert.deepEqual(calls, [{ args: ['cloud', 'exec', '--env', 'env-test'], stdinText: prompt }]);
      assert.equal(calls[0]!.args.some((arg) => /merge|apply/.test(arg)), false);
      assert.match(capture.out.join('\n'), /cloud status.*cloud diff/);
    } finally { await rm(repoRoot, { recursive: true, force: true }); }
  });

  it('mcp subcommand explains windows excluded port ranges on listen errors', async () => {
    const repoRoot = await makeRoot();
    try {
      const capture = captureIo();
      const exit = await runProBridge(['mcp'], {
        repoRoot,
        config: enabledConfig(),
        io: capture.io,
        mcpServer: {
          async start() {
            throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
          },
        },
      });
      assert.equal(exit, 1);
      assert.match(capture.err.join('\n'), /excludedportrange/);
      assert.match(capture.err.join('\n'), /--port/);
    } finally { await rm(repoRoot, { recursive: true, force: true }); }
  });
});
