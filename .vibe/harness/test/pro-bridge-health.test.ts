import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  runProBridge,
  type ProBridgeIo,
} from '../src/commands/pro-bridge.js';
import {
  DEFAULT_PRO_BRIDGE_CONFIG,
  type ProBridgeConfig,
} from '../src/lib/config.js';
import {
  computePayloadSha256,
  type ReviewRequest,
  type ReviewResultManifest,
} from '../src/pro-bridge/contract.js';
import { importReviewResult } from '../src/pro-bridge/importer.js';
import { MailboxStore } from '../src/pro-bridge/mailbox/store.js';

const NOW = new Date('2026-07-15T08:00:00.000Z');
const REPOSITORY = 'owner/repo';

interface ResultFile {
  path: string;
  content: string;
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function request(requestId: string): ReviewRequest {
  const draft: ReviewRequest = {
    schemaVersion: 'vibe-pro-review-request-v1',
    requestId,
    kind: 'goal_audit',
    origin: 'cli',
    repository: {
      fullName: REPOSITORY,
      remoteUrl: 'https://github.com/owner/repo.git',
      defaultBranch: 'main',
    },
    git: {
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
      branch: 'main',
      headVisibleOnGitHub: true,
      compareUrlHint: null,
      patchAttachmentSha256: null,
    },
    goalSource: null,
    userGoal: 'Inspect mailbox health and revision recovery.',
    reviewPrompt: '# Mailbox health review',
    outputContract: {
      requiredFiles: [
        'README.md',
        'REVIEW.md',
        'FINDINGS.json',
        'prompt/CLI_MAIN_SESSION_PROMPT.md',
      ],
    },
    createdAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
    payloadSha256: '0'.repeat(64),
  };
  return { ...draft, payloadSha256: computePayloadSha256(draft) };
}

function files(label: string): ResultFile[] {
  return [
    { path: 'README.md', content: `# ${label}\n` },
    { path: 'REVIEW.md', content: `# Review\n\n${label}.\n` },
    { path: 'FINDINGS.json', content: '{"findings":[]}\n' },
    { path: 'prompt/CLI_MAIN_SESSION_PROMPT.md', content: `# ${label} prompt\n\nWait.\n` },
  ];
}

function manifest(
  input: ReviewRequest,
  resultFiles: ResultFile[],
  label: string,
): ReviewResultManifest {
  const draft: ReviewResultManifest = {
    schemaVersion: 'vibe-pro-review-result-v1',
    requestId: input.requestId,
    requestPayloadSha256: input.payloadSha256,
    repositoryFullName: input.repository.fullName,
    reviewedBaseSha: input.git.baseSha,
    reviewedHeadSha: input.git.headSha,
    resultKind: 'audit',
    proposedFolder: `2026-07-15-${label}-pro-review`,
    disposition: 'approved',
    files: resultFiles.map((file) => {
      const bytes = Buffer.from(file.content, 'utf8');
      return {
        path: file.path,
        mediaType: file.path.endsWith('.json') ? 'application/json' : 'text/markdown',
        byteLength: bytes.byteLength,
        sha256: sha256(bytes),
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
  return { ...draft, payloadSha256: computePayloadSha256(draft) };
}

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'vibe-pro-health-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function upload(store: MailboxStore, requestId: string, resultFiles: ResultFile[]): Promise<void> {
  for (const file of resultFiles) {
    await store.putResultFile(requestId, {
      filePath: file.path,
      chunkIndex: 0,
      chunkCount: 1,
      content: file.content,
      chunkSha256: sha256(file.content),
    });
  }
}

async function ready(
  root: string,
  requestId: string,
  label: string,
): Promise<{
  store: MailboxStore;
  request: ReviewRequest;
  files: ResultFile[];
  manifest: ReviewResultManifest;
  manifestSha256: string;
  resultFilesSha256: string;
}> {
  const store = new MailboxStore({ repoRoot: root, now: () => NOW });
  const input = request(requestId);
  const resultFiles = files(label);
  const resultManifest = manifest(input, resultFiles, label);
  await store.createRequest(input);
  await store.claimRequest(requestId);
  await store.beginResult(requestId);
  await upload(store, requestId, resultFiles);
  const finalized = await store.finalizeResult(requestId, resultManifest);
  return {
    store,
    request: input,
    files: resultFiles,
    manifest: resultManifest,
    manifestSha256: finalized.manifestSha256,
    resultFilesSha256: finalized.resultFilesSha256,
  };
}

async function finalizeRevision(
  seeded: Awaited<ReturnType<typeof ready>>,
  revision: number,
): Promise<{ manifestSha256: string; resultFilesSha256: string }> {
  const revisedFiles = files(`revision-${revision}`);
  const revisedManifest = manifest(seeded.request, revisedFiles, `revision-${revision}`);
  await seeded.store.beginResult(seeded.request.requestId, seeded.manifestSha256);
  await upload(seeded.store, seeded.request.requestId, revisedFiles);
  const finalized = await seeded.store.finalizeResult(seeded.request.requestId, revisedManifest);
  seeded.manifestSha256 = finalized.manifestSha256;
  seeded.resultFilesSha256 = finalized.resultFilesSha256;
  return finalized;
}

function enabledConfig(): ProBridgeConfig {
  return {
    ...DEFAULT_PRO_BRIDGE_CONFIG,
    enabled: true,
    transport: 'mcp-mailbox',
    copyInvocation: false,
    openBrowser: false,
  };
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

describe('mailbox revision journal', () => {
  it('finalizes a rev2 revision through the journaled lifecycle', async () => {
    await withRoot(async (root) => {
      const seeded = await ready(root, 'AUD-20260715-health-rev2', 'health-rev2-base');
      const finalized = await finalizeRevision(seeded, 2);
      const index = JSON.parse(await readFile(
        path.join(seeded.store.resultsRoot, seeded.request.requestId, 'result.json'),
        'utf8',
      )) as { current: number; revisions: unknown[] };
      const journal = JSON.parse(await readFile(
        path.join(seeded.store.resultsRoot, seeded.request.requestId, 'journal.json'),
        'utf8',
      )) as { phase: string; revision: number };
      assert.equal(finalized.manifestSha256, seeded.manifestSha256);
      assert.equal(index.current, 2);
      assert.equal(index.revisions.length, 2);
      assert.deepEqual(journal, { ...journal, phase: 'committed', revision: 2 });
    });
  });

  it('finalizes a rev3 revision through the journaled lifecycle', async () => {
    await withRoot(async (root) => {
      const seeded = await ready(root, 'AUD-20260715-health-rev3', 'health-rev3-base');
      await finalizeRevision(seeded, 2);
      await finalizeRevision(seeded, 3);
      const index = JSON.parse(await readFile(
        path.join(seeded.store.resultsRoot, seeded.request.requestId, 'result.json'),
        'utf8',
      )) as { current: number; revisions: unknown[] };
      assert.equal(index.current, 3);
      assert.equal(index.revisions.length, 3);
      assert.equal((await seeded.store.inspectMailboxHealth()).state, 'healthy');
    });
  });

  it('reports a revision gap without silently repairing it', async () => {
    await withRoot(async (root) => {
      const seeded = await ready(root, 'AUD-20260715-health-gap', 'health-gap');
      const gap = path.join(seeded.store.resultsRoot, seeded.request.requestId, 'staging-rev3');
      await mkdir(path.join(gap, 'chunks'), { recursive: true });
      await writeFile(path.join(gap, 'upload.json'), `${JSON.stringify({
        revision: 3,
        revisionOf: seeded.manifestSha256,
        openedAt: NOW.toISOString(),
      })}\n`, 'utf8');
      const health = await seeded.store.inspectMailboxHealth();
      assert.equal(health.state, 'quarantined-corrupt-entry');
      assert.equal(health.entries.some((entry) => entry.problem === 'revision-gap'), true);
      await access(path.join(gap, 'upload.json'));
    });
  });

  it('treats a same-revision finalize replay as a no-op', async () => {
    await withRoot(async (root) => {
      const seeded = await ready(root, 'AUD-20260715-health-replay', 'health-replay');
      const replay = await seeded.store.finalizeResult(seeded.request.requestId, seeded.manifest);
      const index = JSON.parse(await readFile(
        path.join(seeded.store.resultsRoot, seeded.request.requestId, 'result.json'),
        'utf8',
      )) as { revisions: unknown[] };
      assert.equal(replay.idempotentReplay, true);
      assert.equal(index.revisions.length, 1);
    });
  });
});

describe('mailbox health', () => {
  it('reports corrupt request JSON as a quarantined entry', async () => {
    await withRoot(async (root) => {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const input = request('AUD-20260715-health-corrupt-request');
      await store.createRequest(input);
      const requestPath = path.join(store.requestsRoot, input.requestId, 'request.json');
      await writeFile(requestPath, '{broken', 'utf8');
      const health = await store.inspectMailboxHealth();
      assert.equal(health.state, 'quarantined-corrupt-entry');
      assert.equal(health.entries[0]?.requestId, input.requestId);
      await access(requestPath);
    });
  });

  it('reports a missing status file as a quarantined entry', async () => {
    await withRoot(async (root) => {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const input = request('AUD-20260715-health-missing-status');
      await store.createRequest(input);
      await rm(path.join(store.requestsRoot, input.requestId, 'status.json'));
      const health = await store.inspectMailboxHealth();
      assert.equal(health.state, 'quarantined-corrupt-entry');
      assert.equal(health.entries.some((entry) => entry.problem === 'missing-status'), true);
    });
  });

  it('reports a partial result index as a quarantined entry', async () => {
    await withRoot(async (root) => {
      const seeded = await ready(root, 'AUD-20260715-health-partial-index', 'health-partial-index');
      const indexPath = path.join(seeded.store.resultsRoot, seeded.request.requestId, 'result.json');
      await writeFile(indexPath, '{"current":1,"revisions":', 'utf8');
      const health = await seeded.store.inspectMailboxHealth();
      assert.equal(health.state, 'quarantined-corrupt-entry');
      assert.equal(health.entries.some((entry) => entry.problem === 'partial-result-index'), true);
      await access(indexPath);
    });
  });

  it('recovers a quarantined entry after the damaged file is repaired', async () => {
    await withRoot(async (root) => {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const input = request('AUD-20260715-health-repaired');
      await store.createRequest(input);
      const requestPath = path.join(store.requestsRoot, input.requestId, 'request.json');
      await writeFile(requestPath, '{broken', 'utf8');
      assert.equal((await store.inspectMailboxHealth()).state, 'quarantined-corrupt-entry');
      await writeFile(requestPath, `${JSON.stringify(input, null, 2)}\n`, 'utf8');
      assert.equal((await store.inspectMailboxHealth()).state, 'healthy');
      assert.equal((await store.getRequest(input.requestId))?.payloadSha256, input.payloadSha256);
    });
  });

  it('keeps old-layout mailbox state readable without migration', async () => {
    await withRoot(async (root) => {
      const seeded = await ready(root, 'AUD-20260715-health-old-layout', 'health-old-layout');
      const resultRoot = path.join(seeded.store.resultsRoot, seeded.request.requestId);
      const immutableBefore = sha256(await readFile(path.join(resultRoot, 'rev1', 'manifest.json')));
      await rm(path.join(resultRoot, 'journal.json'));
      await seeded.store.acknowledgeImport(seeded.request.requestId, {
        requestId: seeded.request.requestId,
        folder: seeded.manifest.proposedFolder,
        installedPath: path.join(root, 'plans', seeded.manifest.proposedFolder),
        resultFilesSha256: seeded.resultFilesSha256,
        importedAt: NOW.toISOString(),
      });
      assert.equal((await seeded.store.getStatus(seeded.request.requestId)).state, 'imported');
      assert.equal((await seeded.store.listRequests()).length, 1);
      assert.notEqual((await seeded.store.inspectMailboxHealth()).state, 'migration-required');
      assert.equal(sha256(await readFile(path.join(resultRoot, 'rev1', 'manifest.json'))), immutableBefore);

      const installRoot = path.join(root, 'plans');
      const installed = await importReviewResult(
        { kind: 'files', requestId: seeded.request.requestId, folder: seeded.manifest.proposedFolder, files: seeded.files },
        {
          repoRoot: root,
          installRoot,
          request: seeded.request,
          resultManifest: seeded.manifest,
          expectedRepositoryFullName: REPOSITORY,
          currentRepositoryFullName: REPOSITORY,
          requestRepositoryFullName: REPOSITORY,
        },
      );
      assert.equal(installed.status, 'installed');
      const provenancePath = path.join(installRoot, seeded.manifest.proposedFolder, '.bridge', 'provenance.json');
      const provenance = JSON.parse(await readFile(provenancePath, 'utf8')) as Record<string, unknown>;
      delete provenance.currentRepositoryFullName;
      delete provenance.requestRepositoryFullName;
      await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
      const legacyNoOp = await importReviewResult(
        { kind: 'files', requestId: seeded.request.requestId, folder: seeded.manifest.proposedFolder, files: seeded.files },
        {
          repoRoot: root,
          installRoot,
          request: seeded.request,
          resultManifest: seeded.manifest,
          expectedRepositoryFullName: REPOSITORY,
        },
      );
      assert.equal(legacyNoOp.status, 'no-op');
      if (legacyNoOp.status === 'no-op') {
        assert.equal(legacyNoOp.legacyRepositoryIdentity, true);
      }
    });
  });

  it('status command reports a quarantined entry in the mailbox health summary', async () => {
    await withRoot(async (root) => {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const input = request('AUD-20260715-health-command-corrupt');
      await store.createRequest(input);
      await writeFile(path.join(store.requestsRoot, input.requestId, 'request.json'), '{broken', 'utf8');
      const capture = captureIo();
      const exit = await runProBridge(['status'], {
        repoRoot: root,
        config: enabledConfig(),
        io: capture.io,
        now: () => NOW,
      });
      assert.equal(exit, 0, capture.err.join('\n'));
      assert.match(capture.out.join('\n'), /mailbox health: quarantined-corrupt-entry/);
      assert.match(capture.out.join('\n'), new RegExp(input.requestId));
      assert.match(capture.out.join('\n'), /corrupt-request/);
    });
  });
});
