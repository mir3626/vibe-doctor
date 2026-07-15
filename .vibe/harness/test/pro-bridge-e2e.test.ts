import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { runProBridge, type ProBridgeIo } from '../src/commands/pro-bridge.js';
import { DEFAULT_PRO_BRIDGE_CONFIG } from '../src/lib/config.js';
import {
  computePayloadSha256,
  type GoalSourceManifest,
  type ReviewRequest,
  type ReviewResultManifest,
} from '../src/pro-bridge/contract.js';
import { resolveGoalSource } from '../src/pro-bridge/goal-source/resolver.js';
import type {
  GitPort,
  GoalSourceProvider,
} from '../src/pro-bridge/goal-source/types.js';
import { createMailboxTools } from '../src/pro-bridge/mailbox/tools.js';
import { buildReviewRequest } from '../src/pro-bridge/prompt-composer.js';
import type { ScopeResolution } from '../src/pro-bridge/scope-resolver.js';
import { ManualDirectoryTransport } from '../src/pro-bridge/transports/manual.js';
import { McpMailboxTransport } from '../src/pro-bridge/transports/mcp-mailbox.js';
import { serializeVibeBundle } from '../src/pro-bridge/vibe-bundle.js';
import { buildCompliantResultBundle } from './helpers/pro-bridge-result-fixture.js';

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const NOW = new Date('2026-07-15T08:00:00.000Z');
const REQUEST_ID = 'AUD-20260715-e2e123';
const RESULT_FOLDER = '2026-07-15-manual-round-trip-pro-review';

function syntheticGoal(repoRoot: string): GoalSourceManifest {
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
      threadId: 'thread-e2e',
      iterationId: null,
      goalText: 'Audit the completed manual Pro Bridge transport.',
      goalStatus: 'completed',
    },
    designRefs: ['docs/plans/web-pro-bridge/design.md'],
    implementationRefs: ['docs/prompts/sprint-vpb-03-manual-transport-skills.md'],
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    commitShas: [HEAD_SHA],
    scope: {
      changedFiles: ['.vibe/harness/src/pro-bridge/transports/manual.ts'],
      codeFiles: ['.vibe/harness/src/pro-bridge/transports/manual.ts'],
      testFiles: [],
      migrationFiles: [],
      docsFiles: [],
      scopeGlobs: ['.vibe/harness/src/pro-bridge/**'],
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

function githubScope(): ScopeResolution {
  return {
    repository: {
      fullName: 'owner/repo',
      remoteUrl: 'https://github.com/owner/repo.git',
      defaultBranch: 'main',
    },
    git: {
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      branch: 'feature/manual-transport',
      baseVisibility: 'remote',
      headVisibility: 'remote',
      headVisibleOnGitHub: true,
      compareUrlHint: `https://github.com/owner/repo/compare/${BASE_SHA}...${HEAD_SHA}`,
    },
    visibilityCase: 'github-range',
    blockedReasons: [],
    patch: null,
    warnings: [],
  };
}

const fixtureGit: GitPort = {
  async run(args) {
    if (args[0] === 'remote') {
      return { ok: true, stdout: 'https://github.com/owner/repo.git\n', stderr: '', code: 0 };
    }
    return { ok: false, stdout: '', stderr: `unexpected: ${args.join(' ')}`, code: 1 };
  },
};

function goalProvider(repoRoot: string): GoalSourceProvider {
  return {
    kind: 'codex-goal',
    async discover() {
      return { status: 'candidate', manifest: syntheticGoal(repoRoot) };
    },
  };
}

function resultBundleText(requestId: string): string {
  return serializeVibeBundle(buildCompliantResultBundle({
    requestId,
    folder: RESULT_FOLDER,
    repositoryFullName: 'owner/repo',
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    title: 'Manual round trip',
    readmeContent: '# Manual round trip',
    primaryContent: '# Review\n\nThe manual transport is coherent.',
  }).bundle);
}

function captureIo(): { io: ProBridgeIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      async confirm() {
        return false;
      },
    },
  };
}

async function executeRoundTrip(repoRoot: string): Promise<{
  transport: ManualDirectoryTransport;
  installedPath: string;
  requestId: string;
}> {
  const resolution = await resolveGoalSource(
    { repoRoot, git: fixtureGit, now: () => NOW },
    { providers: [goalProvider(repoRoot)] },
  );
  assert.ok(resolution.selected);

  const request = buildReviewRequest({
    kind: 'goal_audit',
    userGoal: resolution.selected.source.goalText,
    goalSource: resolution.selected,
    scope: githubScope(),
    requestId: REQUEST_ID,
    now: () => NOW,
    ttlDays: 3,
  });
  const transport = new ManualDirectoryTransport({ repoRoot, now: () => NOW });
  const handle = await transport.createRequest(request);

  assert.equal(handle.requestId, REQUEST_ID);
  assert.deepEqual(JSON.parse(await readFile(handle.requestPath, 'utf8')), request);
  assert.equal(await readFile(handle.promptPath, 'utf8'), request.reviewPrompt);
  await access(path.join(handle.requestDir, 'status.json'));

  const bundleText = resultBundleText(request.requestId);
  const captured = captureIo();
  const exitCode = await runProBridge(['sync'], {
    repoRoot,
    config: {
      ...DEFAULT_PRO_BRIDGE_CONFIG,
      enabled: true,
      resultRoot: 'installed-results',
    },
    io: captured.io,
    git: fixtureGit,
    clipboard: {
      async copyFile() {
        return { ok: true, method: 'fake', error: null };
      },
      async readText() {
        return { ok: true, text: bundleText, error: null };
      },
    },
    now: () => NOW,
  });
  assert.equal(exitCode, 0, captured.err.join('\n'));

  return {
    transport,
    installedPath: path.join(repoRoot, 'installed-results', RESULT_FOLDER),
    requestId: request.requestId,
  };
}

describe('pro bridge manual round trip', () => {
  it('round trips an audit request from goal scope to an installed result package', async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'vibe-pro-bridge-e2e-'));
    try {
      const result = await executeRoundTrip(repoRoot);
      for (const filePath of [
        'README.md',
        'REVIEW.md',
        'FINDINGS.json',
        'prompt/CLI_MAIN_SESSION_PROMPT.md',
      ]) {
        await access(path.join(result.installedPath, filePath));
      }

      const provenance = JSON.parse(
        await readFile(path.join(result.installedPath, '.bridge', 'provenance.json'), 'utf8'),
      ) as {
        requestId: string;
        requestPayloadSha256: string | null;
        transport: string;
        skippedValidations: string[];
      };
      assert.equal(provenance.requestId, result.requestId);
      assert.match(provenance.requestPayloadSha256 ?? '', /^[0-9a-f]{64}$/);
      assert.equal(provenance.transport, 'manual');
      assert.ok(provenance.skippedValidations.includes('result-manifest-unavailable'));
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('acknowledges import and closes the outbox request', async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'vibe-pro-bridge-ack-'));
    try {
      const result = await executeRoundTrip(repoRoot);
      const status = await result.transport.getRequestStatus(result.requestId);
      assert.equal(status.state, 'imported');

      const imported = JSON.parse(
        await readFile(
          path.join(result.transport.outboxRoot, result.requestId, 'imported.json'),
          'utf8',
        ),
      ) as { requestId: string; folder: string; installedPath: string };
      assert.equal(imported.requestId, result.requestId);
      assert.equal(imported.folder, RESULT_FOLDER);
      assert.equal(imported.installedPath, result.installedPath);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});

describe('pro bridge mcp mailbox round trip', () => {
  it('round trips an audit request through the mcp mailbox transport', async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'vibe-pro-bridge-mcp-e2e-'));
    const git: GitPort = {
      async run(args) {
        if (args[0] === 'remote') {
          return { ok: true, stdout: 'https://github.com/owner/repo.git\n', stderr: '', code: 0 };
        }
        if (args[0] === 'config') {
          return { ok: true, stdout: 'https://github.com/owner/repo.git\n', stderr: '', code: 0 };
        }
        if (args[0] === 'symbolic-ref') {
          return { ok: true, stdout: 'origin/main\n', stderr: '', code: 0 };
        }
        if (args[0] === 'rev-parse') {
          return { ok: true, stdout: args.includes('--abbrev-ref') ? 'main\n' : `${HEAD_SHA}\n`, stderr: '', code: 0 };
        }
        if (args[0] === 'branch') {
          return { ok: true, stdout: '  origin/main\n', stderr: '', code: 0 };
        }
        if (args[0] === 'status') {
          return { ok: true, stdout: '', stderr: '', code: 0 };
        }
        return { ok: false, stdout: '', stderr: `unexpected: ${args.join(' ')}`, code: 1 };
      },
    };
    try {
      const published = captureIo();
      const exit = await runProBridge(['audit', '--yes'], {
        repoRoot,
        config: {
          ...DEFAULT_PRO_BRIDGE_CONFIG,
          enabled: true,
          transport: 'mcp-mailbox',
          resultRoot: 'installed-results',
          copyInvocation: false,
          openBrowser: false,
        },
        io: published.io,
        git,
        goalResolver: (async () => ({
          selected: syntheticGoal(repoRoot),
          candidates: [],
          diagnostics: [],
        })) as unknown as typeof resolveGoalSource,
        clipboard: {
          async copyFile() { return { ok: true, method: 'fake', error: null }; },
          async readText() { return { ok: true, text: '', error: null }; },
        },
        browser: { async open() { return { ok: true, error: null }; } },
        stdin: { isTTY: false },
        now: () => NOW,
      });
      assert.equal(exit, 0, published.err.join('\n'));

      const transport = new McpMailboxTransport({ repoRoot, now: () => NOW });
      const pending = await transport.listRequests();
      assert.equal(pending.length, 1);
      const requestId = pending[0]!.requestId;
      const tools = new Map(createMailboxTools(transport.store).map((tool) => [tool.name, tool]));
      await tools.get('claim_request')!.invoke({ requestId });
      await tools.get('begin_result')!.invoke({ requestId });

      const request = await transport.readRequest(requestId) as ReviewRequest;
      const fixture = buildCompliantResultBundle({
        requestId,
        folder: '2026-07-15-mcp-round-trip-pro-review',
        repositoryFullName: request.repository.fullName,
        baseSha: request.git.baseSha,
        headSha: request.git.headSha,
        title: 'MCP E2E result',
        readmeContent: '# MCP E2E result\n',
        primaryContent: '# Review\n\nMailbox E2E passed.\n',
      });
      const files = fixture.bundle.files;
      for (const file of files) {
        await tools.get('put_result_file')!.invoke({
          requestId,
          filePath: file.path,
          chunkIndex: 0,
          chunkCount: 1,
          content: file.content,
          chunkSha256: createHash('sha256').update(file.content).digest('hex'),
        });
      }
      const draft: ReviewResultManifest = {
        schemaVersion: 'vibe-pro-review-result-v1', requestId,
        requestPayloadSha256: request.payloadSha256, repositoryFullName: request.repository.fullName,
        reviewedBaseSha: request.git.baseSha, reviewedHeadSha: request.git.headSha,
        resultKind: 'audit', proposedFolder: '2026-07-15-mcp-round-trip-pro-review', disposition: 'approved',
        files: files.map((file) => {
          const bytes = Buffer.from(file.content, 'utf8');
          return {
            path: file.path,
            mediaType: file.path.endsWith('.json') ? 'application/json' : 'text/markdown',
            byteLength: bytes.byteLength,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          };
        }),
        findingsSummary: fixture.findingsSummary,
        reviewerDeclaration: fixture.reviewerDeclaration,
        createdAt: NOW.toISOString(), payloadSha256: '0'.repeat(64),
      };
      const manifest = { ...draft, payloadSha256: computePayloadSha256(draft) };
      await tools.get('finalize_result')!.invoke({ requestId, manifest });

      const synced = captureIo();
      const syncExit = await runProBridge(['sync', '--latest'], {
        repoRoot,
        config: {
          ...DEFAULT_PRO_BRIDGE_CONFIG,
          enabled: true,
          transport: 'mcp-mailbox',
          resultRoot: 'installed-results',
        },
        io: synced.io,
        git,
        now: () => NOW,
      });
      assert.equal(syncExit, 0, synced.err.join('\n'));
      const installedPath = path.join(repoRoot, 'installed-results', manifest.proposedFolder);
      for (const file of files) {
        await access(path.join(installedPath, file.path));
      }
      const provenance = JSON.parse(await readFile(
        path.join(installedPath, '.bridge/provenance.json'), 'utf8',
      )) as { resultFilesSha256: string };
      const imported = JSON.parse(await readFile(
        path.join(transport.store.requestsRoot, requestId, 'imported.json'), 'utf8',
      )) as { resultFilesSha256: string };
      assert.match(imported.resultFilesSha256, /^[0-9a-f]{64}$/);
      assert.notEqual(imported.resultFilesSha256, 'recorded-by-importer');
      assert.equal(imported.resultFilesSha256, provenance.resultFilesSha256);
      assert.equal((await transport.getRequestStatus(requestId)).state, 'imported');
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});

describe('pro bridge web origin round trip', () => {
  it('installs a web created design package through sync latest', async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'vibe-pro-web-origin-e2e-'));
    try {
      const transport = new McpMailboxTransport({ repoRoot, now: () => NOW });
      const tools = new Map(createMailboxTools(transport.store, {
        now: () => NOW,
        requestTtlHours: 72,
      }).map((tool) => [tool.name, tool]));
      const created = await tools.get('create_design_request')!.invoke({
        repositoryFullName: 'owner/repo',
        headSha: HEAD_SHA,
        branch: 'main',
        goal: 'Design a web-origin package round trip.',
      }) as { requestId: string; created: boolean };
      assert.equal(created.created, true);
      await tools.get('claim_request')!.invoke({ requestId: created.requestId });
      await tools.get('begin_result')!.invoke({ requestId: created.requestId });

      const request = await transport.readRequest(created.requestId) as ReviewRequest;
      const fixture = buildCompliantResultBundle({
        requestId: request.requestId,
        folder: '2026-07-15-web-origin-design',
        repositoryFullName: request.repository.fullName,
        baseSha: request.git.baseSha,
        headSha: request.git.headSha,
        resultKind: 'design',
        title: 'Web-origin design',
        readmeContent: '# Web-origin design\n',
        primaryContent: '# Design\n\nUse one shared importer.\n',
      });
      const files = fixture.bundle.files;
      for (const file of files) {
        await tools.get('put_result_file')!.invoke({
          requestId: request.requestId,
          filePath: file.path,
          chunkIndex: 0,
          chunkCount: 1,
          content: file.content,
          chunkSha256: createHash('sha256').update(file.content).digest('hex'),
        });
      }
      const draft: ReviewResultManifest = {
        schemaVersion: 'vibe-pro-review-result-v1',
        requestId: request.requestId,
        requestPayloadSha256: request.payloadSha256,
        repositoryFullName: request.repository.fullName,
        reviewedBaseSha: request.git.baseSha,
        reviewedHeadSha: request.git.headSha,
        resultKind: 'design',
        proposedFolder: '2026-07-15-web-origin-design',
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
        findingsSummary: fixture.findingsSummary,
        reviewerDeclaration: fixture.reviewerDeclaration,
        createdAt: NOW.toISOString(),
        payloadSha256: '0'.repeat(64),
      };
      const manifest = { ...draft, payloadSha256: computePayloadSha256(draft) };
      await tools.get('finalize_result')!.invoke({ requestId: request.requestId, manifest });

      const git: GitPort = {
        async run(args) {
          if (args[0] === 'remote') {
            return { ok: true, stdout: 'https://github.com/owner/repo.git\n', stderr: '', code: 0 };
          }
          if (args[0] === 'rev-parse') {
            return { ok: true, stdout: `${HEAD_SHA}\n`, stderr: '', code: 0 };
          }
          return { ok: false, stdout: '', stderr: `unexpected ${args.join(' ')}`, code: 1 };
        },
      };
      const captured = captureIo();
      const exit = await runProBridge(['sync', '--latest'], {
        repoRoot,
        config: {
          ...DEFAULT_PRO_BRIDGE_CONFIG,
          enabled: true,
          transport: 'mcp-mailbox',
          resultRoot: 'installed-results',
        },
        io: captured.io,
        git,
        stdin: { isTTY: false },
        now: () => NOW,
      });
      assert.equal(exit, 0, captured.err.join('\n'));
      const installedPath = path.join(repoRoot, 'installed-results', manifest.proposedFolder);
      for (const file of files) {
        await access(path.join(installedPath, file.path));
      }
      const provenance = JSON.parse(await readFile(
        path.join(installedPath, '.bridge/provenance.json'),
        'utf8',
      )) as { reviewerDeclaration: { surface: string } };
      assert.equal(provenance.reviewerDeclaration.surface, 'chatgpt-web');
      assert.equal((await transport.getRequestStatus(request.requestId)).state, 'imported');
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
