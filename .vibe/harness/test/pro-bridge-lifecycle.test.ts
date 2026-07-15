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
import type { GitPort } from '../src/pro-bridge/goal-source/types.js';
import { importReviewResult } from '../src/pro-bridge/importer.js';
import {
  MailboxStore,
  MailboxStoreError,
  type DurableOpEvent,
} from '../src/pro-bridge/mailbox/store.js';

const NOW = new Date('2026-07-15T08:00:00.000Z');
const REPOSITORY = 'owner/repo';

interface ResultFile {
  path: string;
  content: string;
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function reviewRequest(
  requestId: string,
  createdOffset = 0,
): ReviewRequest {
  const createdAt = new Date(NOW.getTime() + createdOffset);
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
    userGoal: 'Exercise restart-safe mailbox lifecycle behavior.',
    reviewPrompt: '# Mailbox lifecycle review',
    outputContract: {
      requiredFiles: [
        'README.md',
        'REVIEW.md',
        'FINDINGS.json',
        'prompt/CLI_MAIN_SESSION_PROMPT.md',
      ],
    },
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + 3_600_000).toISOString(),
    payloadSha256: '0'.repeat(64),
  };
  return { ...draft, payloadSha256: computePayloadSha256(draft) };
}

function resultFiles(label = 'initial'): ResultFile[] {
  return [
    { path: 'README.md', content: `# ${label} result\n` },
    { path: 'REVIEW.md', content: `# Review\n\n${label} lifecycle review.\n` },
    { path: 'FINDINGS.json', content: '{"findings":[]}\n' },
    {
      path: 'prompt/CLI_MAIN_SESSION_PROMPT.md',
      content: `# ${label} next step\n\nWait for explicit approval.\n`,
    },
  ];
}

function resultManifest(
  request: ReviewRequest,
  files: ResultFile[],
  folder: string,
): ReviewResultManifest {
  const draft: ReviewResultManifest = {
    schemaVersion: 'vibe-pro-review-result-v1',
    requestId: request.requestId,
    requestPayloadSha256: request.payloadSha256,
    repositoryFullName: request.repository.fullName,
    reviewedBaseSha: request.git.baseSha,
    reviewedHeadSha: request.git.headSha,
    resultKind: 'audit',
    proposedFolder: folder,
    disposition: 'approved',
    files: files.map((file) => {
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

function folder(label: string): string {
  return `2026-07-15-${label}-pro-review`;
}

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'vibe-pro-lifecycle-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function upload(
  store: MailboxStore,
  requestId: string,
  files: ResultFile[],
): Promise<void> {
  for (const file of files) {
    await store.putResultFile(requestId, {
      filePath: file.path,
      chunkIndex: 0,
      chunkCount: 1,
      content: file.content,
      chunkSha256: sha256(file.content),
    });
  }
}

async function seedUpload(
  root: string,
  requestId: string,
  label = 'initial',
): Promise<{
  store: MailboxStore;
  request: ReviewRequest;
  files: ResultFile[];
  manifest: ReviewResultManifest;
}> {
  const store = new MailboxStore({ repoRoot: root, now: () => NOW });
  const request = reviewRequest(requestId);
  const files = resultFiles(label);
  const manifest = resultManifest(request, files, folder(label));
  await store.createRequest(request);
  await store.claimRequest(requestId);
  await store.beginResult(requestId);
  await upload(store, requestId, files);
  return { store, request, files, manifest };
}

async function seedReady(
  root: string,
  requestId: string,
  label: string,
  createdOffset = 0,
): Promise<{
  store: MailboxStore;
  request: ReviewRequest;
  files: ResultFile[];
  manifest: ReviewResultManifest;
  resultFilesSha256: string;
}> {
  const store = new MailboxStore({ repoRoot: root, now: () => NOW });
  const request = reviewRequest(requestId, createdOffset);
  const files = resultFiles(label);
  const manifest = resultManifest(request, files, folder(label));
  await store.createRequest(request);
  await store.claimRequest(requestId);
  await store.beginResult(requestId);
  await upload(store, requestId, files);
  const finalized = await store.finalizeResult(requestId, manifest);
  return { store, request, files, manifest, resultFilesSha256: finalized.resultFilesSha256 };
}

function restartingStore(root: string): MailboxStore {
  return new MailboxStore({
    repoRoot: root,
    now: () => NOW,
    leaseStaleMs: 0,
    leaseRetryDelayMs: 0,
  });
}

function crashStore(root: string, targetStep: string): MailboxStore {
  let crashed = false;
  return new MailboxStore({
    repoRoot: root,
    now: () => NOW,
    leaseStaleMs: 0,
    leaseRetryDelayMs: 0,
    onAfterDurableOp(event) {
      if (!crashed && event.step === targetStep) {
        crashed = true;
        throw new Error(`crash:${targetStep}`);
      }
    },
  });
}

function metaPath(store: MailboxStore, requestId: string, filePath: string): string {
  return path.join(
    store.resultsRoot,
    requestId,
    'staging-rev1',
    'chunks',
    sha256(filePath),
    'meta.json',
  );
}

class FakeGit implements GitPort {
  async run(args: string[]) {
    if (args[0] === 'remote') {
      return { ok: true, stdout: 'https://github.com/owner/repo.git\n', stderr: '', code: 0 };
    }
    if (args[0] === 'rev-parse') {
      return { ok: true, stdout: `${'b'.repeat(40)}\n`, stderr: '', code: 0 };
    }
    return { ok: false, stdout: '', stderr: `unexpected: ${args.join(' ')}`, code: 1 };
  }
}

function enabledConfig(): ProBridgeConfig {
  return {
    ...DEFAULT_PRO_BRIDGE_CONFIG,
    enabled: true,
    transport: 'mcp-mailbox',
    resultRoot: 'plans',
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

async function preinstall(
  root: string,
  request: ReviewRequest,
  files: ResultFile[],
  manifest: ReviewResultManifest,
): Promise<void> {
  const outcome = await importReviewResult(
    { kind: 'files', requestId: request.requestId, folder: manifest.proposedFolder, files },
    {
      repoRoot: root,
      installRoot: path.join(root, 'plans'),
      request,
      resultManifest: manifest,
      expectedRepositoryFullName: request.repository.fullName,
      currentRepositoryFullName: request.repository.fullName,
      requestRepositoryFullName: request.repository.fullName,
      transport: 'mcp-mailbox',
      now: () => NOW,
    },
  );
  assert.equal(outcome.status, 'installed');
}

describe('mailbox lifecycle concurrency', () => {
  it('serializes two concurrent claims to exactly one owner', async () => {
    await withRoot(async (root) => {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const request = reviewRequest('AUD-20260715-concurrent-claim');
      await store.createRequest(request);
      const results = await Promise.allSettled([
        store.claimRequest(request.requestId),
        store.claimRequest(request.requestId),
      ]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
      assert.equal((await store.getStatus(request.requestId)).state, 'claimed');
    });
  });

  it('serializes two concurrent begin_result calls to one open upload', async () => {
    await withRoot(async (root) => {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const request = reviewRequest('AUD-20260715-concurrent-begin');
      await store.createRequest(request);
      await store.claimRequest(request.requestId);
      assert.deepEqual(await Promise.all([
        store.beginResult(request.requestId),
        store.beginResult(request.requestId),
      ]), [{ revision: 1 }, { revision: 1 }]);
      const entries = await access(path.join(store.resultsRoot, request.requestId, 'staging-rev1'))
        .then(() => ['staging-rev1']);
      assert.deepEqual(entries, ['staging-rev1']);
    });
  });

  it('keeps all parallel chunks for one file in the staged metadata', async () => {
    await withRoot(async (root) => {
      const seeded = await seedUpload(root, 'AUD-20260715-parallel-one-file');
      const pieces = ['zero', 'one', 'two', 'three'];
      await Promise.all(pieces.map((content, chunkIndex) => seeded.store.putResultFile(
        seeded.request.requestId,
        { filePath: 'source/parallel.md', chunkIndex, chunkCount: pieces.length, content, chunkSha256: sha256(content) },
      )));
      const meta = JSON.parse(await readFile(
        metaPath(seeded.store, seeded.request.requestId, 'source/parallel.md'),
        'utf8',
      )) as { chunks: Array<{ index: number }> };
      assert.deepEqual(meta.chunks.map((chunk) => chunk.index), [0, 1, 2, 3]);
    });
  });

  it('keeps parallel chunks for different files independent', async () => {
    await withRoot(async (root) => {
      const seeded = await seedUpload(root, 'AUD-20260715-parallel-files');
      await Promise.all(['source/a.md', 'source/b.md', 'source/c.md'].map((filePath) =>
        seeded.store.putResultFile(seeded.request.requestId, {
          filePath, chunkIndex: 0, chunkCount: 1, content: filePath, chunkSha256: sha256(filePath),
        })));
      for (const filePath of ['source/a.md', 'source/b.md', 'source/c.md']) {
        const meta = JSON.parse(await readFile(
          metaPath(seeded.store, seeded.request.requestId, filePath),
          'utf8',
        )) as { filePath: string };
        assert.equal(meta.filePath, filePath);
      }
    });
  });

  it('accepts a duplicate identical chunk idempotently', async () => {
    await withRoot(async (root) => {
      const seeded = await seedUpload(root, 'AUD-20260715-duplicate-chunk');
      const input = {
        filePath: 'source/duplicate.md', chunkIndex: 0, chunkCount: 1,
        content: 'same', chunkSha256: sha256('same'),
      };
      await seeded.store.putResultFile(seeded.request.requestId, input);
      const replay = await seeded.store.putResultFile(seeded.request.requestId, input);
      assert.equal(replay.receivedChunks, 1);
    });
  });

  it('rejects a conflicting duplicate chunk without losing staged state', async () => {
    await withRoot(async (root) => {
      const seeded = await seedUpload(root, 'AUD-20260715-conflicting-chunk');
      const filePath = 'source/conflict.md';
      await seeded.store.putResultFile(seeded.request.requestId, {
        filePath, chunkIndex: 0, chunkCount: 1, content: 'first', chunkSha256: sha256('first'),
      });
      await assert.rejects(seeded.store.putResultFile(seeded.request.requestId, {
        filePath, chunkIndex: 0, chunkCount: 1, content: 'second', chunkSha256: sha256('second'),
      }), (error: unknown) => error instanceof MailboxStoreError && error.code === 'chunk-conflict');
      const meta = JSON.parse(await readFile(
        metaPath(seeded.store, seeded.request.requestId, filePath),
        'utf8',
      )) as { chunks: Array<{ sha256: string }> };
      assert.equal(meta.chunks[0]?.sha256, sha256('first'));
    });
  });

  it('serializes finalize against an active upload deterministically', async () => {
    await withRoot(async (root) => {
      const seeded = await seedUpload(root, 'AUD-20260715-finalize-race');
      const finalize = seeded.store.finalizeResult(seeded.request.requestId, seeded.manifest);
      const latePut = seeded.store.putResultFile(seeded.request.requestId, {
        filePath: 'source/late.md', chunkIndex: 0, chunkCount: 1, content: 'late', chunkSha256: sha256('late'),
      });
      const [finalized, late] = await Promise.allSettled([finalize, latePut]);
      assert.equal(finalized.status, 'fulfilled');
      assert.equal(late.status, 'rejected');
      assert.equal((await seeded.store.getStatus(seeded.request.requestId)).state, 'result-ready');
    });
  });

  it('returns an idempotent replay for two finalize calls with the same manifest', async () => {
    await withRoot(async (root) => {
      const seeded = await seedUpload(root, 'AUD-20260715-double-finalize');
      const [first, second] = await Promise.all([
        seeded.store.finalizeResult(seeded.request.requestId, seeded.manifest),
        seeded.store.finalizeResult(seeded.request.requestId, seeded.manifest),
      ]);
      assert.equal(first.idempotentReplay, false);
      assert.equal(second.idempotentReplay, true);
      assert.equal(first.resultFilesSha256, second.resultFilesSha256);
    });
  });

  it('rejects a stale claimant after ownership transfer', async () => {
    await withRoot(async (root) => {
      const request = reviewRequest('AUD-20260715-stale-owner');
      const base = new MailboxStore({ repoRoot: root, now: () => NOW });
      await base.createRequest(request);
      await base.claimRequest(request.requestId);
      let replaced = false;
      const stale = new MailboxStore({
        repoRoot: root,
        now: () => NOW,
        async onAfterDurableOp(event: DurableOpEvent) {
          if (!replaced && event.step === 'status:reviewing') {
            replaced = true;
            await writeFile(
              path.join(base.locksRoot, `${request.requestId}.lock`),
              `${JSON.stringify({ fingerprint: 'replacement', acquiredAt: NOW.toISOString() })}\n`,
              'utf8',
            );
          }
        },
      });
      await assert.rejects(stale.beginResult(request.requestId),
        (error: unknown) => error instanceof MailboxStoreError && error.code === 'stale-owner');
      await restartingStore(root).beginResult(request.requestId);
    });
  });
});

describe('mailbox crash recovery', () => {
  it('converges beginResult after a crash at every durable step', async () => {
    for (const step of ['status:reviewing', 'status:result-uploading', 'begin:upload']) {
      await withRoot(async (root) => {
        const request = reviewRequest(`AUD-20260715-begin-${step.replaceAll(':', '-')}`);
        const base = new MailboxStore({ repoRoot: root, now: () => NOW });
        await base.createRequest(request);
        await base.claimRequest(request.requestId);
        await assert.rejects(crashStore(root, step).beginResult(request.requestId), /crash:/);
        const restarted = restartingStore(root);
        assert.deepEqual(await restarted.beginResult(request.requestId), { revision: 1 });
        assert.equal((await restarted.getStatus(request.requestId)).state, 'result-uploading');
      });
    }
  });

  it('converges putResultFile after a crash at every durable step', async () => {
    for (const step of ['put:chunk', 'put:metadata']) {
      await withRoot(async (root) => {
        const seeded = await seedUpload(root, `AUD-20260715-put-${step.replaceAll(':', '-')}`);
        const input = {
          filePath: 'source/crash.md', chunkIndex: 0, chunkCount: 1,
          content: 'restart-safe', chunkSha256: sha256('restart-safe'),
        };
        await assert.rejects(crashStore(root, step).putResultFile(seeded.request.requestId, input), /crash:/);
        const restarted = restartingStore(root);
        assert.equal((await restarted.putResultFile(seeded.request.requestId, input)).receivedChunks, 1);
        const meta = JSON.parse(await readFile(
          metaPath(restarted, seeded.request.requestId, input.filePath),
          'utf8',
        )) as { chunks: unknown[] };
        assert.equal(meta.chunks.length, 1);
      });
    }
  });

  it('converges finalizeResult after a crash at every durable step', async () => {
    const steps = [
      'finalize:journal-prepared',
      'stale-staging-removed',
      'result-file-written',
      'provenance-written',
      'installation-renamed',
      'finalize:journal-revision-installed',
      'finalize:revision-manifest',
      'finalize:journal-manifest-written',
      'finalize:result-index',
      'finalize:journal-index-written',
      'status:result-ready',
      'finalize:journal-committed',
      'finalize:upload-removed',
    ];
    const trace: Array<{ step: string; state: string; manifestSha256: string; resultFilesSha256: string }> = [];
    for (const [index, step] of steps.entries()) {
      await withRoot(async (root) => {
        const seeded = await seedUpload(root, `AUD-20260715-finalize-crash-${index}`, `finalize-crash-${index}`);
        await assert.rejects(crashStore(root, step).finalizeResult(
          seeded.request.requestId,
          seeded.manifest,
        ), /crash:/);
        const restarted = restartingStore(root);
        const finalized = await restarted.finalizeResult(seeded.request.requestId, seeded.manifest);
        const status = await restarted.getStatus(seeded.request.requestId);
        const indexValue = JSON.parse(await readFile(
          path.join(restarted.resultsRoot, seeded.request.requestId, 'result.json'),
          'utf8',
        )) as { revisions: unknown[] };
        assert.equal(status.state, 'result-ready');
        assert.equal(indexValue.revisions.length, 1);
        trace.push({
          step,
          state: status.state,
          manifestSha256: finalized.manifestSha256,
          resultFilesSha256: finalized.resultFilesSha256,
        });
      });
    }
    assert.equal(new Set(trace.map((item) => item.resultFilesSha256)).size, steps.length);
    console.log(`finalize crash/restart trace ${JSON.stringify(trace)}`);
  });

  it('converges importReviewResult after a crash and a stale staging directory', async () => {
    await withRoot(async (root) => {
      const request = reviewRequest('AUD-20260715-importer-crash');
      const files = resultFiles('importer-crash');
      const manifest = resultManifest(request, files, folder('importer-crash'));
      const installRoot = path.join(root, 'plans');
      const stale = path.join(installRoot, `.tmp-${manifest.proposedFolder}`);
      await mkdir(stale, { recursive: true });
      await writeFile(path.join(stale, 'stale.txt'), 'stale', 'utf8');
      let crashed = false;
      await assert.rejects(importReviewResult(
        { kind: 'files', requestId: request.requestId, folder: manifest.proposedFolder, files },
        {
          repoRoot: root,
          installRoot,
          request,
          resultManifest: manifest,
          expectedRepositoryFullName: REPOSITORY,
          currentRepositoryFullName: REPOSITORY,
          requestRepositoryFullName: REPOSITORY,
          onAfterDurableOp(event) {
            if (!crashed && event.step === 'result-file-written') {
              crashed = true;
              throw new Error('importer-crash');
            }
          },
        },
      ), /importer-crash/);
      const outcome = await importReviewResult(
        { kind: 'files', requestId: request.requestId, folder: manifest.proposedFolder, files },
        {
          repoRoot: root,
          installRoot,
          request,
          resultManifest: manifest,
          expectedRepositoryFullName: REPOSITORY,
          currentRepositoryFullName: REPOSITORY,
          requestRepositoryFullName: REPOSITORY,
        },
      );
      assert.equal(outcome.status, 'installed');
      await access(path.join(installRoot, manifest.proposedFolder, 'README.md'));
    });
  });

  it('converges acknowledgeImport after a crash at every durable step', async () => {
    for (const [index, step] of ['ack:receipt', 'status:imported'].entries()) {
      await withRoot(async (root) => {
        const seeded = await seedReady(root, `AUD-20260715-ack-crash-${index}`, `ack-crash-${index}`);
        const receipt = {
          requestId: seeded.request.requestId,
          folder: seeded.manifest.proposedFolder,
          installedPath: path.join(root, 'plans', seeded.manifest.proposedFolder),
          resultFilesSha256: seeded.resultFilesSha256,
          importedAt: NOW.toISOString(),
          repositoryFullName: REPOSITORY,
          resultManifestSha256: seeded.manifest.payloadSha256,
        };
        await assert.rejects(crashStore(root, step).acknowledgeImport(seeded.request.requestId, receipt), /crash:/);
        const restarted = restartingStore(root);
        await restarted.acknowledgeImport(seeded.request.requestId, receipt);
        assert.equal((await restarted.getStatus(seeded.request.requestId)).state, 'imported');
      });
    }
  });
});

describe('install and acknowledgement recovery', () => {
  it('converges an installed-unacknowledged result to imported on the next sync', async () => {
    await withRoot(async (root) => {
      const seeded = await seedReady(root, 'AUD-20260715-installed-unacked', 'installed-unacked');
      await preinstall(root, seeded.request, seeded.files, seeded.manifest);
      const capture = captureIo();
      const before = await seeded.store.getStatus(seeded.request.requestId);
      const exit = await runProBridge(['sync', '--latest'], {
        repoRoot: root,
        config: enabledConfig(),
        io: capture.io,
        git: new FakeGit(),
        stdin: { isTTY: false },
        now: () => NOW,
      });
      const after = await restartingStore(root).getStatus(seeded.request.requestId);
      assert.equal(exit, 0, capture.err.join('\n'));
      assert.equal(before.state, 'result-ready');
      assert.equal(after.state, 'imported');
      const trace = [
        { state: before.state, resultFilesSha256: seeded.resultFilesSha256 },
        { state: 'installed', resultFilesSha256: seeded.resultFilesSha256 },
        { state: after.state, resultFilesSha256: seeded.resultFilesSha256 },
      ];
      assert.match(capture.out.join('\n'), /복구 수렴/);
      console.log(`install/ack crash/restart trace ${JSON.stringify(trace)}`);
    });
  });

  it('does not acknowledge a no-op whose installed provenance mismatches the current result', async () => {
    await withRoot(async (root) => {
      const seeded = await seedReady(root, 'AUD-20260715-noop-mismatch', 'noop-mismatch');
      await preinstall(root, seeded.request, seeded.files, seeded.manifest);
      const provenancePath = path.join(
        root,
        'plans',
        seeded.manifest.proposedFolder,
        '.bridge',
        'provenance.json',
      );
      const provenance = JSON.parse(await readFile(provenancePath, 'utf8')) as Record<string, unknown>;
      await writeFile(provenancePath, `${JSON.stringify({
        ...provenance,
        resultFilesSha256: 'f'.repeat(64),
      }, null, 2)}\n`, 'utf8');
      const capture = captureIo();
      const exit = await runProBridge(['sync', '--latest'], {
        repoRoot: root,
        config: enabledConfig(),
        io: capture.io,
        git: new FakeGit(),
        stdin: { isTTY: false },
        now: () => NOW,
      });
      assert.equal(exit, 1);
      assert.equal((await seeded.store.getStatus(seeded.request.requestId)).state, 'result-ready');
    });
  });

  it('treats a duplicate acknowledgement with the same receipt as idempotent', async () => {
    await withRoot(async (root) => {
      const seeded = await seedReady(root, 'AUD-20260715-duplicate-ack', 'duplicate-ack');
      const receipt = {
        requestId: seeded.request.requestId,
        folder: seeded.manifest.proposedFolder,
        installedPath: path.join(root, 'plans', seeded.manifest.proposedFolder),
        resultFilesSha256: seeded.resultFilesSha256,
        importedAt: NOW.toISOString(),
        repositoryFullName: REPOSITORY,
      };
      await seeded.store.acknowledgeImport(seeded.request.requestId, receipt);
      await seeded.store.acknowledgeImport(seeded.request.requestId, receipt);
      assert.equal((await seeded.store.getStatus(seeded.request.requestId)).state, 'imported');
    });
  });

  it('frees --latest after converging an installed-unacknowledged request', async () => {
    await withRoot(async (root) => {
      const remaining = await seedReady(root, 'AUD-20260715-ready-remaining', 'ready-remaining', 1_000);
      const installed = await seedReady(root, 'AUD-20260715-ready-installed', 'ready-installed', 2_000);
      await preinstall(root, installed.request, installed.files, installed.manifest);
      const capture = captureIo();
      const exit = await runProBridge(['sync', '--latest'], {
        repoRoot: root,
        config: enabledConfig(),
        io: capture.io,
        git: new FakeGit(),
        stdin: { isTTY: false },
        now: () => NOW,
      });
      assert.equal(exit, 0, capture.err.join('\n'));
      assert.equal((await installed.store.getStatus(installed.request.requestId)).state, 'imported');
      assert.equal((await remaining.store.getStatus(remaining.request.requestId)).state, 'result-ready');
      assert.match(capture.out.join('\n'), /남은 result-ready 요청 1건/);
    });
  });

  it('acknowledges an out-of-band manual result for a mailbox request with an explicit marker', async () => {
    await withRoot(async (root) => {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const request = reviewRequest('AUD-20260715-out-of-band');
      await store.createRequest(request);
      await store.claimRequest(request.requestId);
      const receipt = {
        requestId: request.requestId,
        folder: folder('out-of-band'),
        installedPath: path.join(root, 'plans', folder('out-of-band')),
        resultFilesSha256: 'c'.repeat(64),
        importedAt: NOW.toISOString(),
        repositoryFullName: REPOSITORY,
        verification: 'out-of-band' as const,
      };
      await store.acknowledgeImport(request.requestId, receipt);
      const stored = JSON.parse(await readFile(
        path.join(store.requestsRoot, request.requestId, 'imported.json'),
        'utf8',
      )) as { verification?: string };
      assert.equal(stored.verification, 'out-of-band');
      assert.equal((await store.getStatus(request.requestId)).state, 'imported');

      const indexed = await seedReady(root, 'AUD-20260715-out-of-band-indexed', 'out-of-band-indexed');
      await assert.rejects(indexed.store.acknowledgeImport(indexed.request.requestId, {
        requestId: indexed.request.requestId,
        folder: indexed.manifest.proposedFolder,
        installedPath: path.join(root, 'plans', indexed.manifest.proposedFolder),
        resultFilesSha256: indexed.resultFilesSha256,
        importedAt: NOW.toISOString(),
        repositoryFullName: REPOSITORY,
        verification: 'out-of-band',
      }), (error: unknown) => error instanceof MailboxStoreError && error.code === 'receipt-mismatch');
    });
  });
});
