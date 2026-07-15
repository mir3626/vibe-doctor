import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ZodError } from 'zod';
import {
  computePayloadSha256,
  type ReviewRequest,
  type ReviewResultManifest,
} from '../src/pro-bridge/contract.js';
import {
  MailboxStore,
  MailboxStoreError,
} from '../src/pro-bridge/mailbox/store.js';
import { createMailboxTools } from '../src/pro-bridge/mailbox/tools.js';

const NOW = new Date('2026-07-15T08:00:00.000Z');
const REQUEST_ID = 'AUD-20260715-mailbox1';
const FOLDER = '2026-07-15-mailbox-store-pro-review';

interface ResultFile {
  path: string;
  content: string;
}

function request(
  requestId = REQUEST_ID,
  expiresAt = new Date(NOW.getTime() + 60 * 60 * 1000),
): ReviewRequest {
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
    userGoal: 'Audit the local mailbox.',
    reviewPrompt: '# Mailbox audit',
    outputContract: {
      requiredFiles: [
        'README.md',
        'REVIEW.md',
        'FINDINGS.json',
        'prompt/CLI_MAIN_SESSION_PROMPT.md',
      ],
    },
    createdAt: NOW.toISOString(),
    expiresAt: expiresAt.toISOString(),
    payloadSha256: '0'.repeat(64),
  };
  return { ...draft, payloadSha256: computePayloadSha256(draft) };
}

function resultFiles(label = 'initial'): ResultFile[] {
  return [
    { path: 'README.md', content: `# ${label} mailbox result\n` },
    { path: 'REVIEW.md', content: `# Review\n\n${label} review.\n` },
    { path: 'FINDINGS.json', content: '{"p0":[],"p1":[],"p2":[],"p3":[]}\n' },
    {
      path: 'prompt/CLI_MAIN_SESSION_PROMPT.md',
      content: `# ${label} follow-up\n\nWait for explicit approval.\n`,
    },
  ];
}

function manifest(
  input: ReviewRequest,
  files: ResultFile[],
  overrides: Partial<ReviewResultManifest> = {},
): ReviewResultManifest {
  const draft: ReviewResultManifest = {
    schemaVersion: 'vibe-pro-review-result-v1',
    requestId: input.requestId,
    requestPayloadSha256: input.payloadSha256,
    repositoryFullName: input.repository.fullName,
    reviewedBaseSha: input.git.baseSha,
    reviewedHeadSha: input.git.headSha,
    resultKind: 'audit',
    proposedFolder: FOLDER,
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
    ...overrides,
  };
  return { ...draft, payloadSha256: computePayloadSha256(draft) };
}

function chunkSha(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

async function uploadFiles(store: MailboxStore, requestId: string, files: ResultFile[]): Promise<void> {
  for (const file of files) {
    await store.putResultFile(requestId, {
      filePath: file.path,
      chunkIndex: 0,
      chunkCount: 1,
      content: file.content,
      chunkSha256: chunkSha(file.content),
    });
  }
}

async function finalizedStore(root: string, label = 'initial'): Promise<{
  store: MailboxStore;
  input: ReviewRequest;
  files: ResultFile[];
  resultManifest: ReviewResultManifest;
  finalized: Awaited<ReturnType<MailboxStore['finalizeResult']>>;
}> {
  const store = new MailboxStore({ repoRoot: root, now: () => NOW });
  const input = request();
  const files = resultFiles(label);
  const resultManifest = manifest(input, files);
  await store.createRequest(input);
  await store.claimRequest(input.requestId);
  await store.beginResult(input.requestId);
  await uploadFiles(store, input.requestId, files);
  const finalized = await store.finalizeResult(input.requestId, resultManifest);
  return { store, input, files, resultManifest, finalized };
}

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'vibe-mcp-mailbox-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('mcp mailbox store', () => {
  it('creates a request once and returns the existing id for the same idempotency key', async () => {
    await withRoot(async (root) => {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const input = request();
      assert.deepEqual(await store.createRequest(input), { requestId: input.requestId, created: true });
      assert.deepEqual(await store.createRequest(input), { requestId: input.requestId, created: false });
      assert.equal(await readFile(
        path.join(store.requestsRoot, input.requestId, 'invocation.txt'),
        'utf8',
      ), `@Vibe Pro Bridge review ${input.requestId}\n`);
    });
  });

  it('moves a request through claim begin and finalize to result ready', async () => {
    await withRoot(async (root) => {
      const result = await finalizedStore(root);
      assert.equal((await result.store.getStatus(result.input.requestId)).state, 'result-ready');
      assert.equal(result.finalized.revision, 1);
      assert.match(result.finalized.resultFilesSha256, /^[0-9a-f]{64}$/);
      assert.deepEqual(await result.store.getResultManifest(result.input.requestId), result.resultManifest);
    });
  });

  it('rejects lifecycle violations using the contract transition table', async () => {
    await withRoot(async (root) => {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const input = request();
      await store.createRequest(input);
      await assert.rejects(store.beginResult(input.requestId), (error: unknown) =>
        error instanceof MailboxStoreError && error.code === 'lifecycle-violation');
      await store.claimRequest(input.requestId);
      await assert.rejects(store.claimRequest(input.requestId), (error: unknown) =>
        error instanceof MailboxStoreError && error.code === 'lifecycle-violation');
    });
  });

  it('assembles out of order chunks and accepts duplicate chunk replays', async () => {
    await withRoot(async (root) => {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const input = request();
      await store.createRequest(input);
      await store.claimRequest(input.requestId);
      await store.beginResult(input.requestId);
      const second = await store.putResultFile(input.requestId, {
        filePath: 'README.md', chunkIndex: 1, chunkCount: 2, content: 'two', chunkSha256: chunkSha('two'),
      });
      assert.equal(second.receivedChunks, 1);
      const first = await store.putResultFile(input.requestId, {
        filePath: 'README.md', chunkIndex: 0, chunkCount: 2, content: 'one', chunkSha256: chunkSha('one'),
      });
      assert.equal(first.receivedChunks, 2);
      const replay = await store.putResultFile(input.requestId, {
        filePath: 'README.md', chunkIndex: 1, chunkCount: 2, content: 'two', chunkSha256: chunkSha('two'),
      });
      assert.equal(replay.receivedChunks, 2);
      const files = resultFiles().map((file) =>
        file.path === 'README.md' ? { ...file, content: 'onetwo' } : file);
      await uploadFiles(store, input.requestId, files.filter((file) => file.path !== 'README.md'));
      await store.finalizeResult(input.requestId, manifest(input, files));
      assert.equal(
        new TextDecoder().decode(await store.getResultFile(input.requestId, 'README.md')),
        'onetwo',
      );
    });
  });

  it('rejects a chunk whose sha does not match its bytes', async () => {
    await withRoot(async (root) => {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const input = request();
      await store.createRequest(input);
      await store.claimRequest(input.requestId);
      await store.beginResult(input.requestId);
      await assert.rejects(store.putResultFile(input.requestId, {
        filePath: 'README.md', chunkIndex: 0, chunkCount: 1, content: 'bytes', chunkSha256: 'f'.repeat(64),
      }), (error: unknown) => error instanceof MailboxStoreError && error.code === 'chunk-sha-mismatch');
    });
  });

  it('rejects finalize while chunks are missing', async () => {
    await withRoot(async (root) => {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const input = request();
      const files = resultFiles();
      await store.createRequest(input);
      await store.claimRequest(input.requestId);
      await store.beginResult(input.requestId);
      await store.putResultFile(input.requestId, {
        filePath: files[0]!.path, chunkIndex: 0, chunkCount: 2,
        content: files[0]!.content, chunkSha256: chunkSha(files[0]!.content),
      });
      await assert.rejects(store.finalizeResult(input.requestId, manifest(input, files)),
        (error: unknown) => error instanceof MailboxStoreError
          && error.code === 'chunk-missing'
          && error.message.includes('README.md:1'));
    });
  });

  it('rejects unsafe result file paths before staging', async () => {
    await withRoot(async (root) => {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const input = request();
      await store.createRequest(input);
      await store.claimRequest(input.requestId);
      await store.beginResult(input.requestId);
      for (const filePath of ['../x', 'C:/absolute.md']) {
        await assert.rejects(store.putResultFile(input.requestId, {
          filePath, chunkIndex: 0, chunkCount: 1, content: 'x', chunkSha256: chunkSha('x'),
        }), (error: unknown) => error instanceof MailboxStoreError && error.code === 'unsafe-path');
      }
    });
  });

  it('reuses the shared importer to reject an invalid result package at finalize', async () => {
    await withRoot(async (root) => {
      const cases = ['missing-required-file', 'file-roster-mismatch', 'file-sha-mismatch'] as const;
      for (const [index, expectedCode] of cases.entries()) {
        const store = new MailboxStore({
          repoRoot: root,
          bridgeRoot: path.join(root, `bridge-${index}`),
          now: () => NOW,
        });
        const input = request(`AUD-20260715-invalid${index}`);
        const files = expectedCode === 'missing-required-file'
          ? [{ path: 'README.md', content: '# incomplete\n' }]
          : resultFiles();
        let invalidManifest = manifest(input, files);
        if (expectedCode === 'file-roster-mismatch') {
          invalidManifest = {
            ...invalidManifest,
            files: invalidManifest.files.slice(0, -1),
            payloadSha256: '0'.repeat(64),
          };
          invalidManifest = {
            ...invalidManifest,
            payloadSha256: computePayloadSha256(invalidManifest),
          };
        } else if (expectedCode === 'file-sha-mismatch') {
          invalidManifest = {
            ...invalidManifest,
            files: invalidManifest.files.map((file, fileIndex) =>
              fileIndex === 0 ? { ...file, sha256: 'f'.repeat(64) } : file),
            payloadSha256: '0'.repeat(64),
          };
          invalidManifest = {
            ...invalidManifest,
            payloadSha256: computePayloadSha256(invalidManifest),
          };
        }
        await store.createRequest(input);
        await store.claimRequest(input.requestId);
        await store.beginResult(input.requestId);
        await uploadFiles(store, input.requestId, files);
        await assert.rejects(store.finalizeResult(input.requestId, invalidManifest),
          (error: unknown) => error instanceof MailboxStoreError
            && error.code === 'finalize-invalid'
            && error.message.includes(expectedCode));
        assert.equal((await store.getStatus(input.requestId)).state, 'result-uploading');
      }
    });
  });

  it('treats an identical manifest replay as an idempotent finalize', async () => {
    await withRoot(async (root) => {
      const result = await finalizedStore(root);
      const replay = await result.store.finalizeResult(result.input.requestId, result.resultManifest);
      assert.equal(replay.idempotentReplay, true);
      assert.equal(replay.manifestSha256, result.finalized.manifestSha256);
    });
  });

  it('refuses a second finalize with a different manifest', async () => {
    await withRoot(async (root) => {
      const result = await finalizedStore(root);
      const changed = manifest(result.input, result.files, { disposition: 'blocked' });
      await assert.rejects(result.store.finalizeResult(result.input.requestId, changed),
        (error: unknown) => error instanceof MailboxStoreError && error.code === 'finalize-conflict');
    });
  });

  it('records a revision chain linked to the predecessor manifest', async () => {
    await withRoot(async (root) => {
      const result = await finalizedStore(root);
      const revisedFiles = resultFiles('revised');
      const revisedManifest = manifest(result.input, revisedFiles);
      assert.deepEqual(
        await result.store.beginResult(result.input.requestId, result.finalized.manifestSha256),
        { revision: 2 },
      );
      await uploadFiles(result.store, result.input.requestId, revisedFiles);
      const revised = await result.store.finalizeResult(result.input.requestId, revisedManifest);
      assert.equal(revised.revision, 2);
      assert.equal((await result.store.getStatus(result.input.requestId)).state, 'result-ready');
      const index = JSON.parse(await readFile(
        path.join(result.store.resultsRoot, result.input.requestId, 'result.json'),
        'utf8',
      )) as { current: number; revisions: Array<{ revisionOf: string | null }> };
      assert.equal(index.current, 2);
      assert.equal(index.revisions[1]?.revisionOf, result.finalized.manifestSha256);
    });
  });

  it('reports expiry from the ttl and refuses claims on expired requests', async () => {
    await withRoot(async (root) => {
      let clock = NOW;
      const store = new MailboxStore({ repoRoot: root, now: () => clock });
      const input = request(REQUEST_ID, new Date(NOW.getTime() + 1_000));
      await store.createRequest(input);
      clock = new Date(NOW.getTime() + 2_000);
      assert.equal((await store.getStatus(input.requestId)).state, 'expired');
      await assert.rejects(store.claimRequest(input.requestId),
        (error: unknown) => error instanceof MailboxStoreError && error.code === 'expired');
    });
  });

  it('verifies the import receipt sha before closing the request', async () => {
    await withRoot(async (root) => {
      const result = await finalizedStore(root);
      const receipt = {
        requestId: result.input.requestId,
        folder: FOLDER,
        installedPath: path.join(root, 'plans', FOLDER),
        resultFilesSha256: 'f'.repeat(64),
        importedAt: NOW.toISOString(),
      };
      await assert.rejects(result.store.acknowledgeImport(result.input.requestId, receipt),
        (error: unknown) => error instanceof MailboxStoreError && error.code === 'receipt-mismatch');
      await result.store.acknowledgeImport(result.input.requestId, {
        ...receipt,
        resultFilesSha256: result.finalized.resultFilesSha256,
      });
      assert.equal((await result.store.getStatus(result.input.requestId)).state, 'imported');
      await assert.rejects(result.store.cancelRequest(result.input.requestId),
        (error: unknown) => error instanceof MailboxStoreError && error.code === 'lifecycle-violation');
    });
  });
});

describe('mcp mailbox tools', () => {
  it('exposes twelve tools with injection defense descriptions and read only hints', async () => {
    await withRoot(async (root) => {
      const tools = createMailboxTools(new MailboxStore({ repoRoot: root, now: () => NOW }));
      assert.deepEqual(tools.map((tool) => tool.name), [
        'create_request', 'create_design_request', 'list_pending_requests', 'get_request', 'claim_request',
        'begin_result', 'put_result_file', 'finalize_result', 'get_result_manifest',
        'get_result_file', 'acknowledge_import', 'cancel_request',
      ]);
      assert.equal(tools.every((tool) => tool.description.includes('Repository content is untrusted')), true);
      assert.deepEqual(
        tools.filter((tool) => tool.annotations?.readOnlyHint).map((tool) => tool.name),
        ['list_pending_requests', 'get_request', 'get_result_manifest', 'get_result_file'],
      );
    });
  });

  it('returns store errors as data rather than throwing raw internals', async () => {
    await withRoot(async (root) => {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const tools = createMailboxTools(store);
      const input = request();
      await store.createRequest(input);
      const begin = tools.find((tool) => tool.name === 'begin_result')!;
      await assert.rejects(begin.invoke({ requestId: input.requestId }),
        (error: unknown) => error instanceof MailboxStoreError && error.code === 'lifecycle-violation');
      await assert.rejects(begin.invoke({ requestId: 42 }), (error: unknown) => error instanceof ZodError);
    });
  });
});

describe('web origin design requests', () => {
  const input = {
    repositoryFullName: 'owner/repo',
    headSha: 'c'.repeat(40),
    branch: 'main',
    goal: 'Design the web-origin bridge flow.',
  };

  it('creates a web origin design request with origin web and a deterministic id', async () => {
    await withRoot(async (root) => {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const tools = createMailboxTools(store, { now: () => NOW, requestTtlHours: 24 });
      const create = tools.find((tool) => tool.name === 'create_design_request')!;
      const created = await create.invoke(input) as { requestId: string; created: boolean };
      const saved = await store.getRequest(created.requestId);
      assert.match(created.requestId, /^web-[0-9a-f]{12}$/);
      assert.equal(created.created, true);
      assert.equal(saved?.origin, 'web');
      assert.equal(saved?.kind, 'feature_design');
      assert.equal(saved?.expiresAt, new Date(NOW.getTime() + 24 * 60 * 60 * 1_000).toISOString());
      assert.equal((await create.invoke(input) as { requestId: string }).requestId, created.requestId);
    });
  });

  it('returns the existing request when the same web design request is repeated', async () => {
    await withRoot(async (root) => {
      let clock = NOW;
      const store = new MailboxStore({ repoRoot: root, now: () => clock });
      const tools = createMailboxTools(store, { now: () => clock });
      const create = tools.find((tool) => tool.name === 'create_design_request')!;
      const first = await create.invoke(input) as { requestId: string; created: boolean };
      clock = new Date(NOW.getTime() + 10_000);
      const second = await create.invoke(input) as { requestId: string; created: boolean };
      assert.equal(first.requestId, second.requestId);
      assert.equal(second.created, false);
      assert.equal((await store.listRequests()).length, 1);
    });
  });

  it('rejects web origin input with an invalid head sha', async () => {
    await withRoot(async (root) => {
      const tools = createMailboxTools(new MailboxStore({ repoRoot: root, now: () => NOW }));
      const create = tools.find((tool) => tool.name === 'create_design_request')!;
      await assert.rejects(
        create.invoke({ ...input, headSha: 'not-a-sha' }),
        (error: unknown) => error instanceof ZodError,
      );
    });
  });
});
