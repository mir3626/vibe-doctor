import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  computePayloadSha256,
  type ReviewRequest,
  type ReviewResultManifest,
} from '../src/pro-bridge/contract.js';
import {
  MailboxStore,
  type PublishPackageInput,
  type PublishReceipt,
} from '../src/pro-bridge/mailbox/store.js';
import { createMailboxTools } from '../src/pro-bridge/mailbox/tools.js';
import { buildCompliantResultBundle } from './helpers/pro-bridge-result-fixture.js';

const NOW = new Date('2026-07-16T04:00:00.000Z');
const REQUEST_ID = 'AUD-20260716-publish1';
const FOLDER = '2026-07-16-publish-facade-pro-review';

function request(requestId = REQUEST_ID): ReviewRequest {
  const draft: ReviewRequest = {
    schemaVersion: 'vibe-pro-review-request-v1',
    requestId,
    kind: 'goal_audit',
    origin: 'cli',
    repository: {
      fullName: 'owner/repo',
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
    userGoal: 'Audit the one-call publication facade.',
    reviewPrompt: '# Publish facade audit',
    outputContract: {
      requiredFiles: [
        'README.md',
        'REVIEW.md',
        'FINDINGS.json',
        'prompt/CLI_MAIN_SESSION_PROMPT.md',
      ],
    },
    createdAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(),
    payloadSha256: '0'.repeat(64),
  };
  return { ...draft, payloadSha256: computePayloadSha256(draft) };
}

function publication(input: ReviewRequest, label = 'complete'): PublishPackageInput {
  const fixture = buildCompliantResultBundle({
    requestId: input.requestId,
    folder: FOLDER,
    repositoryFullName: input.repository.fullName,
    baseSha: input.git.baseSha,
    headSha: input.git.headSha,
    title: `${label} publication`,
    readmeContent: `# ${label} publication\n`,
    primaryContent: `# Review\n\n${label} publication review.\n`,
  });
  return {
    proposedFolder: FOLDER,
    disposition: 'approved',
    summary: {
      title: `${label} publication`,
      reviewedRepository: input.repository.fullName,
      reviewedBaseSha: input.git.baseSha,
      reviewedHeadSha: input.git.headSha,
      ...fixture.findingsSummary,
      limitations: [],
    },
    files: fixture.bundle.files.map((file) => ({
      ...file,
      mediaType: file.path.endsWith('.json') ? 'application/json' : 'text/markdown',
    })),
    clientPublicationId: 'publication-1',
  };
}

function lowLevelManifest(
  input: ReviewRequest,
  packageInput: PublishPackageInput,
  createdAt = NOW,
): ReviewResultManifest {
  const draft: ReviewResultManifest = {
    schemaVersion: 'vibe-pro-review-result-v1',
    requestId: input.requestId,
    requestPayloadSha256: input.payloadSha256,
    repositoryFullName: input.repository.fullName,
    reviewedBaseSha: input.git.baseSha,
    reviewedHeadSha: input.git.headSha,
    resultKind: 'audit',
    proposedFolder: packageInput.proposedFolder,
    disposition: packageInput.disposition,
    files: packageInput.files.map((file) => {
      const bytes = Buffer.from(file.content, 'utf8');
      return {
        path: file.path,
        mediaType: file.mediaType,
        byteLength: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    }),
    findingsSummary: {
      p0: packageInput.summary.p0,
      p1: packageInput.summary.p1,
      p2: packageInput.summary.p2,
      p3: packageInput.summary.p3,
    },
    reviewerDeclaration: packageInput.reviewerDeclaration ?? {
      surface: 'chatgpt-web',
      requestedMode: 'pro',
      githubConnectorUsed: true,
      limitations: packageInput.summary.limitations,
    },
    createdAt: createdAt.toISOString(),
    payloadSha256: '0'.repeat(64),
  };
  return { ...draft, payloadSha256: computePayloadSha256(draft) };
}

async function uploadLowLevel(
  store: MailboxStore,
  input: ReviewRequest,
  packageInput: PublishPackageInput,
): Promise<void> {
  for (const file of packageInput.files) {
    await store.putResultFile(input.requestId, {
      filePath: file.path,
      chunkIndex: 0,
      chunkCount: 1,
      content: file.content,
      chunkSha256: createHash('sha256').update(file.content, 'utf8').digest('hex'),
    });
  }
}

async function finalizeLowLevel(
  store: MailboxStore,
  input: ReviewRequest,
  packageInput: PublishPackageInput,
): Promise<ReviewResultManifest> {
  await store.claimRequest(input.requestId);
  await store.beginResult(input.requestId);
  await uploadLowLevel(store, input, packageInput);
  const manifest = lowLevelManifest(input, packageInput);
  await store.finalizeResult(input.requestId, manifest);
  return manifest;
}

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'vibe-publish-facade-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function requireReceipt(
  result: Awaited<ReturnType<MailboxStore['publishReviewPackage']>>,
): PublishReceipt {
  if (result.status !== 'result-ready') {
    throw new Error(`Expected result-ready, received ${result.status}`);
  }
  assert.equal(result.status, 'result-ready');
  return result;
}

describe('publish review package facade', () => {
  it('publishes a complete package in one call and returns the result-ready receipt', async () => {
    await withRoot(async (root) => {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const input = request();
      const packageInput = publication(input);
      await store.createRequest(input);

      const receipt = requireReceipt(await store.publishReviewPackage(input.requestId, packageInput));
      const manifest = await store.getResultManifest(input.requestId);
      assert.ok(manifest);
      assert.deepEqual(receipt, {
        status: 'result-ready',
        requestId: input.requestId,
        resultId: `rev1-${manifest.payloadSha256.slice(0, 12)}`,
        proposedFolder: FOLDER,
        resultManifestSha256: manifest.payloadSha256,
        fileCount: packageInput.files.length,
        totalBytes: packageInput.files.reduce(
          (total, file) => total + Buffer.byteLength(file.content, 'utf8'),
          0,
        ),
        revision: 1,
        imported: false,
        idempotentReplay: false,
      });
      assert.equal((await store.getStatus(input.requestId)).state, 'result-ready');
    });
  });

  it('produces a manifest identical to the low-level finalize path for the same package', async () => {
    const facadeRoot = await mkdtemp(path.join(tmpdir(), 'vibe-publish-parity-facade-'));
    const lowLevelRoot = await mkdtemp(path.join(tmpdir(), 'vibe-publish-parity-low-'));
    try {
      const input = request('AUD-20260716-parity01');
      const packageInput = publication(input);
      const facadeStore = new MailboxStore({ repoRoot: facadeRoot, now: () => NOW });
      const lowLevelStore = new MailboxStore({ repoRoot: lowLevelRoot, now: () => NOW });
      await facadeStore.createRequest(input);
      await lowLevelStore.createRequest(input);

      await facadeStore.publishReviewPackage(input.requestId, packageInput);
      const lowLevel = await finalizeLowLevel(lowLevelStore, input, packageInput);
      const facade = await facadeStore.getResultManifest(input.requestId);
      assert.ok(facade);
      assert.deepEqual(facade, lowLevel);
      assert.equal(facade.payloadSha256, lowLevel.payloadSha256);
    } finally {
      await rm(facadeRoot, { recursive: true, force: true });
      await rm(lowLevelRoot, { recursive: true, force: true });
    }
  });

  it('reads a published package back through the manifest and file tools and acknowledges import', async () => {
    await withRoot(async (root) => {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const input = request();
      const packageInput = publication(input);
      await store.createRequest(input);
      const receipt = requireReceipt(await store.publishReviewPackage(input.requestId, packageInput));
      const tools = createMailboxTools(store);
      const getManifest = tools.find((tool) => tool.name === 'get_result_manifest')!;
      const getFile = tools.find((tool) => tool.name === 'get_result_file')!;
      const acknowledge = tools.find((tool) => tool.name === 'acknowledge_import')!;
      const manifestResult = await getManifest.invoke({ requestId: input.requestId }) as {
        manifest: ReviewResultManifest;
      };

      assert.equal(manifestResult.manifest.payloadSha256, receipt.resultManifestSha256);
      for (const file of packageInput.files) {
        const received = await getFile.invoke({ requestId: input.requestId, path: file.path }) as {
          content: string;
          sha256: string;
        };
        assert.equal(received.content, file.content);
        assert.equal(received.sha256, createHash('sha256').update(file.content).digest('hex'));
      }
      await acknowledge.invoke({
        requestId: input.requestId,
        receipt: {
          requestId: input.requestId,
          folder: FOLDER,
          installedPath: path.join(root, 'docs', 'plans', FOLDER),
          resultFilesSha256: await store.getCurrentResultFilesSha256(input.requestId),
          resultManifestSha256: receipt.resultManifestSha256,
          importedAt: NOW.toISOString(),
        },
      });
      assert.equal((await store.getStatus(input.requestId)).state, 'imported');
    });
  });

  it('claims a ready request atomically inside publish', async () => {
    await withRoot(async (root) => {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const input = request();
      await store.createRequest(input);
      assert.equal((await store.getStatus(input.requestId)).state, 'ready');
      requireReceipt(await store.publishReviewPackage(input.requestId, publication(input)));
      assert.equal((await store.getStatus(input.requestId)).state, 'result-ready');
    });
  });

  it('continues publishing a request the session already claimed', async () => {
    await withRoot(async (root) => {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const input = request();
      await store.createRequest(input);
      await store.claimRequest(input.requestId);
      const receipt = requireReceipt(await store.publishReviewPackage(input.requestId, publication(input)));
      assert.equal(receipt.revision, 1);
      assert.equal((await store.getStatus(input.requestId)).state, 'result-ready');
    });
  });

  it('returns the existing receipt for an exact publish replay', async () => {
    await withRoot(async (root) => {
      let clock = NOW;
      const store = new MailboxStore({ repoRoot: root, now: () => clock });
      const input = request();
      const packageInput = publication(input);
      packageInput.clientPublicationId = 'constructor';
      await store.createRequest(input);
      const first = requireReceipt(await store.publishReviewPackage(input.requestId, packageInput));
      clock = new Date(NOW.getTime() + 5 * 60 * 1000);
      const replay = requireReceipt(await store.publishReviewPackage(input.requestId, packageInput));
      const records = JSON.parse(await readFile(
        path.join(root, '.vibe', 'pro-bridge', 'results', input.requestId, 'publications.json'),
        'utf8',
      )) as { publications: Record<string, unknown> };

      assert.equal(replay.idempotentReplay, true);
      assert.equal(replay.resultId, first.resultId);
      assert.equal(replay.resultManifestSha256, first.resultManifestSha256);
      assert.equal(replay.revision, 1);
      assert.equal(Object.keys(records.publications).length, 1);
    });
  });

  it('returns a conflict when the same client publication id carries different content', async () => {
    await withRoot(async (root) => {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const input = request();
      const first = publication(input);
      await store.createRequest(input);
      await store.publishReviewPackage(input.requestId, first);
      const changed = publication(input, 'changed');
      changed.clientPublicationId = first.clientPublicationId;
      const conflict = await store.publishReviewPackage(input.requestId, changed);

      assert.equal(conflict.status, 'conflict');
      if (conflict.status === 'conflict') {
        assert.equal(conflict.reason, 'publication-id-content-mismatch');
      }
    });
  });

  it('converges to the existing receipt when the same manifest was already finalized', async () => {
    await withRoot(async (root) => {
      let clock = NOW;
      const store = new MailboxStore({ repoRoot: root, now: () => clock });
      const input = request();
      const packageInput = publication(input);
      await store.createRequest(input);
      const lowLevel = await finalizeLowLevel(store, input, packageInput);
      clock = new Date(NOW.getTime() + 10 * 60 * 1000);
      const receipt = requireReceipt(await store.publishReviewPackage(input.requestId, packageInput));

      assert.equal(receipt.idempotentReplay, true);
      assert.equal(receipt.revision, 1);
      assert.equal(receipt.resultManifestSha256, lowLevel.payloadSha256);
      assert.equal(receipt.resultId, `rev1-${lowLevel.payloadSha256.slice(0, 12)}`);
    });
  });

  it('returns different-result-already-finalized with the existing result id', async () => {
    await withRoot(async (root) => {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const input = request();
      await store.createRequest(input);
      const first = requireReceipt(await store.publishReviewPackage(input.requestId, publication(input)));
      const different = publication(input, 'different');
      different.clientPublicationId = 'publication-2';
      const conflict = await store.publishReviewPackage(input.requestId, different);

      assert.equal(conflict.status, 'conflict');
      if (conflict.status === 'conflict') {
        assert.equal(conflict.reason, 'different-result-already-finalized');
        assert.equal(conflict.existingResultId, first.resultId);
        assert.match(conflict.detail, /begin_result.*revisionOf/);
      }
    });
  });

  it('returns request-terminal for a cancelled request', async () => {
    await withRoot(async (root) => {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const input = request();
      await store.createRequest(input);
      await store.cancelRequest(input.requestId);
      const conflict = await store.publishReviewPackage(input.requestId, publication(input));
      assert.equal(conflict.status, 'conflict');
      if (conflict.status === 'conflict') {
        assert.equal(conflict.reason, 'request-terminal');
      }
    });
  });

  it('returns request-sha-mismatch when the summary binding disagrees with the request', async () => {
    await withRoot(async (root) => {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const input = request();
      const packageInput = publication(input);
      packageInput.summary.reviewedHeadSha = 'c'.repeat(40);
      await store.createRequest(input);
      const conflict = await store.publishReviewPackage(input.requestId, packageInput);
      assert.equal(conflict.status, 'conflict');
      if (conflict.status === 'conflict') {
        assert.equal(conflict.reason, 'request-sha-mismatch');
      }
      assert.equal((await store.getStatus(input.requestId)).state, 'ready');
    });
  });

  it('restores the request state and leaves no result when publish validation fails', async () => {
    await withRoot(async (root) => {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const input = request();
      const invalid = publication(input);
      invalid.files = invalid.files.filter((file) => file.path !== 'REVIEW.md');
      await store.createRequest(input);

      await assert.rejects(store.publishReviewPackage(input.requestId, invalid));
      assert.equal((await store.getStatus(input.requestId)).state, 'ready');
      assert.equal(await store.getResultManifest(input.requestId), null);
      const resultEntries = await readdir(
        path.join(root, '.vibe', 'pro-bridge', 'results', input.requestId),
      );
      assert.equal(resultEntries.some((entry) => entry.startsWith('staging-rev')), false);
      assert.equal(resultEntries.includes('journal.json'), false);
    });
  });

  it('reports a diagnostics-free mailbox after a failed publish', async () => {
    await withRoot(async (root) => {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const input = request();
      const invalid = publication(input);
      invalid.files = invalid.files.filter((file) => file.path !== 'REVIEW.md');
      await store.createRequest(input);
      await assert.rejects(store.publishReviewPackage(input.requestId, invalid));

      const health = await store.inspectMailboxHealth();
      assert.equal(health.entries.length, 0);
      assert.equal(health.state, 'healthy');
    });
  });

  it('retries safely with the same client publication id after a failed publish', async () => {
    await withRoot(async (root) => {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const input = request();
      const valid = publication(input);
      const invalid = {
        ...valid,
        files: valid.files.map((file) =>
          file.path === 'FINDINGS.json' ? { ...file, content: '{}\n' } : file),
      };
      await store.createRequest(input);
      await store.claimRequest(input.requestId);
      await store.beginResult(input.requestId);
      await assert.rejects(store.publishReviewPackage(input.requestId, invalid));
      assert.equal((await store.getStatus(input.requestId)).state, 'result-uploading');
      assert.deepEqual(await readdir(path.join(
        root,
        '.vibe',
        'pro-bridge',
        'results',
        input.requestId,
        'staging-rev1',
        'chunks',
      )), []);

      const receipt = requireReceipt(await store.publishReviewPackage(input.requestId, valid));
      const records = JSON.parse(await readFile(
        path.join(root, '.vibe', 'pro-bridge', 'results', input.requestId, 'publications.json'),
        'utf8',
      )) as { publications: Record<string, unknown> };
      assert.equal(receipt.idempotentReplay, false);
      assert.equal(receipt.revision, 1);
      assert.deepEqual(Object.keys(records.publications), [valid.clientPublicationId]);
    });
  });

  it('returns chunked-upload-required with an open upload session when limits are exceeded', async () => {
    await withRoot(async (root) => {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const input = request();
      const packageInput = publication(input);
      const limits = { maxFiles: 32, maxTotalBytes: 1, maxFileBytes: 49_152 };
      await store.createRequest(input);
      const fallback = await store.publishReviewPackage(input.requestId, packageInput, limits);

      assert.deepEqual(fallback, {
        status: 'chunked-upload-required',
        requestId: input.requestId,
        uploadSessionId: 'staging-rev1',
        maxChunkBytes: 1024 * 1024,
        requiredFiles: input.outputContract.requiredFiles,
        requiredNextTools: ['put_result_file', 'finalize_result'],
        limits,
        exceeded: ['maxTotalBytes'],
      });
      assert.deepEqual(await store.beginResult(input.requestId), { revision: 1 });
      assert.equal((await store.getStatus(input.requestId)).state, 'result-uploading');
      const chunks = await readdir(path.join(
        root,
        '.vibe',
        'pro-bridge',
        'results',
        input.requestId,
        'staging-rev1',
        'chunks',
      ));
      assert.deepEqual(chunks, []);
    });
  });

  it('repeats the same fallback plan while the upload session stays open', async () => {
    await withRoot(async (root) => {
      let clock = NOW;
      const store = new MailboxStore({ repoRoot: root, now: () => clock });
      const input = request();
      const packageInput = publication(input);
      const limits = { maxFiles: 32, maxTotalBytes: 1, maxFileBytes: 49_152 };
      await store.createRequest(input);
      const first = await store.publishReviewPackage(input.requestId, packageInput, limits);
      clock = new Date(NOW.getTime() + 30_000);
      const second = await store.publishReviewPackage(input.requestId, packageInput, limits);

      assert.deepEqual(second, first);
      assert.deepEqual(await store.beginResult(input.requestId), { revision: 1 });
    });
  });

  it('completes the fallback plan through put_result_file and finalize_result', async () => {
    await withRoot(async (root) => {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const input = request();
      const packageInput = publication(input);
      await store.createRequest(input);
      const fallback = await store.publishReviewPackage(
        input.requestId,
        packageInput,
        { maxFiles: 32, maxTotalBytes: 1, maxFileBytes: 49_152 },
      );
      assert.equal(fallback.status, 'chunked-upload-required');

      await uploadLowLevel(store, input, packageInput);
      const finalized = await store.finalizeResult(
        input.requestId,
        lowLevelManifest(input, packageInput),
      );
      assert.equal(finalized.revision, 1);
      assert.equal((await store.getStatus(input.requestId)).state, 'result-ready');
      assert.ok(await store.getResultManifest(input.requestId));
    });
  });

  it('routes a single file above the per-file limit to the chunked fallback', async () => {
    await withRoot(async (root) => {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const input = request();
      const packageInput = publication(input);
      const readme = packageInput.files.find((file) => file.path === 'README.md')!;
      readme.content = `# Oversize\n\n${'x'.repeat(5_000)}\n`;
      const maxFileBytes = 4_096;
      assert.equal(
        packageInput.files.filter(
          (file) => Buffer.byteLength(file.content, 'utf8') > maxFileBytes,
        ).length,
        1,
      );
      await store.createRequest(input);
      const fallback = await store.publishReviewPackage(
        input.requestId,
        packageInput,
        { maxFiles: 32, maxTotalBytes: 131_072, maxFileBytes },
      );

      assert.equal(fallback.status, 'chunked-upload-required');
      if (fallback.status === 'chunked-upload-required') {
        assert.deepEqual(fallback.exceeded, ['maxFileBytes']);
        assert.equal(fallback.uploadSessionId, 'staging-rev1');
      }
    });
  });
});
