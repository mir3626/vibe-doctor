import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  REQUEST_LIFECYCLE_STATES,
  ReviewRequestSchema,
  ReviewResultManifestSchema,
  canTransition,
  compareStringsByCodePoint,
  computePayloadSha256,
  isSafeRelativePath,
  type RequestLifecycleState,
  type ReviewRequest,
  type ReviewResultManifest,
} from '../contract.js';
import {
  computeResultFilesSha256,
  importReviewResult,
  type ImporterFileInput,
} from '../importer.js';

const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const TERMINAL_STATES = new Set<RequestLifecycleState>([
  'imported',
  'cancelled',
  'expired',
  'failed',
]);
const MAX_CHUNK_BYTES = 1024 * 1024;
const MAX_CHUNKS_PER_FILE = 64;
const MAX_STAGING_FILES = 64;
const MAX_STAGING_BYTES = 8 * 1024 * 1024;

export type MailboxErrorCode =
  | 'not-found'
  | 'expired'
  | 'lifecycle-violation'
  | 'duplicate-request'
  | 'unsafe-path'
  | 'limit-exceeded'
  | 'chunk-sha-mismatch'
  | 'chunk-conflict'
  | 'chunk-missing'
  | 'no-open-upload'
  | 'finalize-conflict'
  | 'finalize-invalid'
  | 'revision-mismatch'
  | 'receipt-mismatch'
  | 'invalid-input';

export class MailboxStoreError extends Error {
  constructor(readonly code: MailboxErrorCode, message: string) {
    super(message);
    this.name = 'MailboxStoreError';
  }
}

export interface MailboxStoreOptions {
  repoRoot: string;
  bridgeRoot?: string;
  now?: () => Date;
}

export interface PutChunkInput {
  filePath: string;
  chunkIndex: number;
  chunkCount: number;
  content?: string;
  contentBase64?: string;
  chunkSha256: string;
}

export interface MailboxRequestStatus {
  requestId: string;
  state: RequestLifecycleState;
  kind: string;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
  detail: string | null;
}

export interface MailboxImportReceipt {
  requestId: string;
  folder: string;
  installedPath: string;
  resultFilesSha256: string;
  importedAt: string;
}

interface StoredStatus {
  state: RequestLifecycleState;
  updatedAt: string;
  detail: string | null;
}

interface UploadDescriptor {
  revision: number;
  revisionOf: string | null;
  openedAt: string;
}

interface StoredChunk {
  index: number;
  sha256: string;
  byteLength: number;
}

interface StagedFileMeta {
  filePath: string;
  chunkCount: number;
  chunks: StoredChunk[];
}

interface ResultRevision {
  revision: number;
  manifestSha256: string;
  resultFilesSha256: string;
  finalizedAt: string;
  revisionOf: string | null;
}

interface ResultIndex {
  current: number;
  revisions: ResultRevision[];
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function bestEffortFsync(filePath: string): Promise<void> {
  try {
    const handle = await open(filePath, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Windows and network filesystems do not consistently support fsync.
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await bestEffortFsync(temporaryPath);
  await rename(temporaryPath, filePath);
}

async function writeBytes(filePath: string, value: Uint8Array): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, value);
  await bestEffortFsync(temporaryPath);
  await rename(temporaryPath, filePath);
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
}

function assertSafeRequestId(requestId: string): void {
  if (!SAFE_REQUEST_ID.test(requestId)) {
    throw new MailboxStoreError('invalid-input', `Unsafe mailbox request id: ${requestId}`);
  }
}

function parseStoredStatus(value: unknown): StoredStatus {
  if (!value || typeof value !== 'object') {
    throw new MailboxStoreError('invalid-input', 'Invalid mailbox status');
  }
  const status = value as Record<string, unknown>;
  if (
    typeof status.state !== 'string'
    || !(REQUEST_LIFECYCLE_STATES as readonly string[]).includes(status.state)
    || typeof status.updatedAt !== 'string'
    || (status.detail !== null && typeof status.detail !== 'string')
  ) {
    throw new MailboxStoreError('invalid-input', 'Invalid mailbox status');
  }
  return {
    state: status.state as RequestLifecycleState,
    updatedAt: status.updatedAt,
    detail: status.detail,
  };
}

function parseUploadDescriptor(value: unknown): UploadDescriptor {
  if (!value || typeof value !== 'object') {
    throw new MailboxStoreError('invalid-input', 'Invalid upload descriptor');
  }
  const descriptor = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(descriptor.revision)
    || (descriptor.revision as number) < 1
    || (descriptor.revisionOf !== null && typeof descriptor.revisionOf !== 'string')
    || typeof descriptor.openedAt !== 'string'
  ) {
    throw new MailboxStoreError('invalid-input', 'Invalid upload descriptor');
  }
  return {
    revision: descriptor.revision as number,
    revisionOf: descriptor.revisionOf as string | null,
    openedAt: descriptor.openedAt,
  };
}

function parseStagedFileMeta(value: unknown): StagedFileMeta {
  if (!value || typeof value !== 'object') {
    throw new MailboxStoreError('invalid-input', 'Invalid staged file metadata');
  }
  const meta = value as Record<string, unknown>;
  if (
    typeof meta.filePath !== 'string'
    || !Number.isSafeInteger(meta.chunkCount)
    || !Array.isArray(meta.chunks)
  ) {
    throw new MailboxStoreError('invalid-input', 'Invalid staged file metadata');
  }
  const chunks = meta.chunks.map((value): StoredChunk => {
    if (!value || typeof value !== 'object') {
      throw new MailboxStoreError('invalid-input', 'Invalid staged chunk metadata');
    }
    const chunk = value as Record<string, unknown>;
    if (
      !Number.isSafeInteger(chunk.index)
      || typeof chunk.sha256 !== 'string'
      || !SHA256_HEX.test(chunk.sha256)
      || !Number.isSafeInteger(chunk.byteLength)
    ) {
      throw new MailboxStoreError('invalid-input', 'Invalid staged chunk metadata');
    }
    return {
      index: chunk.index as number,
      sha256: chunk.sha256,
      byteLength: chunk.byteLength as number,
    };
  });
  return {
    filePath: meta.filePath,
    chunkCount: meta.chunkCount as number,
    chunks,
  };
}

function parseResultIndex(value: unknown): ResultIndex {
  if (!value || typeof value !== 'object') {
    throw new MailboxStoreError('invalid-input', 'Invalid result index');
  }
  const index = value as Record<string, unknown>;
  if (!Number.isSafeInteger(index.current) || !Array.isArray(index.revisions)) {
    throw new MailboxStoreError('invalid-input', 'Invalid result index');
  }
  const revisions = index.revisions.map((value): ResultRevision => {
    if (!value || typeof value !== 'object') {
      throw new MailboxStoreError('invalid-input', 'Invalid result revision');
    }
    const revision = value as Record<string, unknown>;
    if (
      !Number.isSafeInteger(revision.revision)
      || typeof revision.manifestSha256 !== 'string'
      || typeof revision.resultFilesSha256 !== 'string'
      || typeof revision.finalizedAt !== 'string'
      || (revision.revisionOf !== null && typeof revision.revisionOf !== 'string')
    ) {
      throw new MailboxStoreError('invalid-input', 'Invalid result revision');
    }
    return {
      revision: revision.revision as number,
      manifestSha256: revision.manifestSha256,
      resultFilesSha256: revision.resultFilesSha256,
      finalizedAt: revision.finalizedAt,
      revisionOf: revision.revisionOf as string | null,
    };
  });
  return { current: index.current as number, revisions };
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function decodeBase64(value: string): Uint8Array {
  const unpadded = value.replace(/=+$/, '');
  if (
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
    || unpadded.length % 4 === 1
    || value.slice(0, -2).includes('=')
  ) {
    throw new MailboxStoreError('invalid-input', 'contentBase64 is not valid base64');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64').replace(/=+$/, '') !== unpadded) {
    throw new MailboxStoreError('invalid-input', 'contentBase64 is not valid base64');
  }
  return bytes;
}

function validationMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error && Array.isArray(error.issues)) {
    return error.issues
      .map((issue) => issue && typeof issue === 'object' && 'message' in issue ? String(issue.message) : String(issue))
      .join('; ');
  }
  return error instanceof Error ? error.message : String(error);
}

export class MailboxStore {
  readonly bridgeRoot: string;
  readonly requestsRoot: string;
  readonly resultsRoot: string;
  private readonly repoRoot: string;
  private readonly now: () => Date;

  constructor(options: MailboxStoreOptions) {
    this.repoRoot = path.resolve(options.repoRoot);
    this.bridgeRoot = path.resolve(
      options.bridgeRoot ?? path.join(this.repoRoot, '.vibe', 'pro-bridge'),
    );
    this.requestsRoot = path.join(this.bridgeRoot, 'requests');
    this.resultsRoot = path.join(this.bridgeRoot, 'results');
    this.now = options.now ?? (() => new Date());
  }

  async createRequest(input: ReviewRequest): Promise<{ requestId: string; created: boolean }> {
    const request = ReviewRequestSchema.parse(input);
    assertSafeRequestId(request.requestId);
    const sameId = await this.getRequest(request.requestId);
    if (sameId) {
      if (sameId.payloadSha256 === request.payloadSha256) {
        return { requestId: sameId.requestId, created: false };
      }
      throw new MailboxStoreError(
        'duplicate-request',
        `Mailbox request ${request.requestId} already exists with a different payload`,
      );
    }

    for (const status of await this.listRequests()) {
      if (TERMINAL_STATES.has(status.state)) {
        continue;
      }
      const existing = await this.getRequest(status.requestId);
      if (
        existing
        && existing.repository.fullName === request.repository.fullName
        && existing.payloadSha256 === request.payloadSha256
      ) {
        return { requestId: existing.requestId, created: false };
      }
    }

    await mkdir(this.requestsRoot, { recursive: true });
    const requestDir = this.requestDir(request.requestId);
    try {
      await mkdir(requestDir);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
        const raced = await this.getRequest(request.requestId);
        if (raced?.payloadSha256 === request.payloadSha256) {
          return { requestId: raced.requestId, created: false };
        }
        throw new MailboxStoreError('duplicate-request', `Mailbox request already exists: ${request.requestId}`);
      }
      throw error;
    }

    await writeJson(path.join(requestDir, 'request.json'), request);
    await writeFile(path.join(requestDir, 'prompt.md'), request.reviewPrompt, 'utf8');
    await writeFile(
      path.join(requestDir, 'invocation.txt'),
      `@Vibe Pro Bridge review ${request.requestId}\n`,
      'utf8',
    );
    await this.writeStatus(request.requestId, 'ready', null);
    return { requestId: request.requestId, created: true };
  }

  async getRequest(requestId: string): Promise<ReviewRequest | null> {
    assertSafeRequestId(requestId);
    const requestPath = path.join(this.requestDir(requestId), 'request.json');
    if (!(await exists(requestPath))) {
      return null;
    }
    return ReviewRequestSchema.parse(await readJson(requestPath));
  }

  async getStatus(requestId: string): Promise<MailboxRequestStatus> {
    const request = await this.getRequest(requestId);
    if (!request) {
      throw new MailboxStoreError('not-found', `Mailbox request not found: ${requestId}`);
    }
    const status = parseStoredStatus(await readJson(path.join(this.requestDir(requestId), 'status.json')));
    let state = status.state;
    let updatedAt = status.updatedAt;
    if (await exists(path.join(this.requestDir(requestId), 'imported.json'))) {
      state = 'imported';
    } else if (
      !TERMINAL_STATES.has(state)
      && this.now().getTime() > new Date(request.expiresAt).getTime()
    ) {
      state = 'expired';
      updatedAt = this.now().toISOString();
    }
    return {
      requestId,
      state,
      kind: request.kind,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
      updatedAt,
      detail: status.detail,
    };
  }

  async listRequests(): Promise<MailboxRequestStatus[]> {
    if (!(await exists(this.requestsRoot))) {
      return [];
    }
    const entries = await readdir(this.requestsRoot, { withFileTypes: true });
    const statuses: MailboxRequestStatus[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !SAFE_REQUEST_ID.test(entry.name)) {
        continue;
      }
      try {
        statuses.push(await this.getStatus(entry.name));
      } catch {
        // Partial or corrupt entries are never presented as valid mailbox requests.
      }
    }
    return statuses.sort((left, right) => {
      const byCreatedAt = compareStringsByCodePoint(right.createdAt, left.createdAt);
      return byCreatedAt !== 0
        ? byCreatedAt
        : compareStringsByCodePoint(left.requestId, right.requestId);
    });
  }

  async claimRequest(requestId: string): Promise<MailboxRequestStatus> {
    const status = await this.requireActiveStatus(requestId);
    if (!canTransition(status.state, 'claimed')) {
      throw new MailboxStoreError(
        'lifecycle-violation',
        `Invalid request lifecycle transition: ${status.state} -> claimed`,
      );
    }
    await this.writeStatus(requestId, 'claimed', null);
    return this.getStatus(requestId);
  }

  async beginResult(requestId: string, revisionOf?: string): Promise<{ revision: number }> {
    const status = await this.requireActiveStatus(requestId);
    await mkdir(this.resultDir(requestId), { recursive: true });
    const existingUpload = await this.findOpenUpload(requestId);

    if (revisionOf !== undefined) {
      if (status.state !== 'result-ready') {
        throw new MailboxStoreError(
          'lifecycle-violation',
          `A result revision cannot begin from ${status.state}`,
        );
      }
      const index = await this.requireResultIndex(requestId);
      const current = this.currentRevision(index);
      if (current.manifestSha256 !== revisionOf) {
        throw new MailboxStoreError(
          'revision-mismatch',
          'revisionOf does not match the current result manifest hash',
        );
      }
      if (existingUpload) {
        if (
          existingUpload.descriptor.revision === index.current + 1
          && existingUpload.descriptor.revisionOf === revisionOf
        ) {
          return { revision: existingUpload.descriptor.revision };
        }
        throw new MailboxStoreError('revision-mismatch', 'A different result revision is already open');
      }
      const revision = index.current + 1;
      // Revisions are a result-store lifecycle; request state intentionally remains result-ready.
      await this.createUpload(requestId, { revision, revisionOf });
      return { revision };
    }

    if (!['claimed', 'reviewing', 'result-uploading'].includes(status.state)) {
      throw new MailboxStoreError(
        'lifecycle-violation',
        `An initial result cannot begin from ${status.state}`,
      );
    }
    if (existingUpload) {
      if (existingUpload.descriptor.revision === 1 && existingUpload.descriptor.revisionOf === null) {
        return { revision: 1 };
      }
      throw new MailboxStoreError('revision-mismatch', 'A result revision is already open');
    }

    let state = status.state;
    if (state === 'claimed') {
      // Keep the contract transition table unchanged by validating both hops individually.
      if (!canTransition(state, 'reviewing')) {
        throw new MailboxStoreError('lifecycle-violation', `${state} cannot transition to reviewing`);
      }
      await this.writeStatus(requestId, 'reviewing', null);
      state = 'reviewing';
    }
    if (state === 'reviewing') {
      if (!canTransition(state, 'result-uploading')) {
        throw new MailboxStoreError('lifecycle-violation', `${state} cannot transition to result-uploading`);
      }
      await this.writeStatus(requestId, 'result-uploading', null);
    }
    await this.createUpload(requestId, { revision: 1, revisionOf: null });
    return { revision: 1 };
  }

  async putResultFile(
    requestId: string,
    chunk: PutChunkInput,
  ): Promise<{ filePath: string; receivedChunks: number; chunkCount: number }> {
    await this.requireActiveStatus(requestId);
    if (!isSafeRelativePath(chunk.filePath)) {
      throw new MailboxStoreError('unsafe-path', `Unsafe result file path: ${chunk.filePath}`);
    }
    if (
      !Number.isSafeInteger(chunk.chunkIndex)
      || !Number.isSafeInteger(chunk.chunkCount)
      || chunk.chunkCount < 1
      || chunk.chunkCount > MAX_CHUNKS_PER_FILE
      || chunk.chunkIndex < 0
      || chunk.chunkIndex >= chunk.chunkCount
    ) {
      throw new MailboxStoreError('chunk-conflict', 'chunkIndex/chunkCount are outside the allowed range');
    }
    if ((chunk.content === undefined) === (chunk.contentBase64 === undefined)) {
      throw new MailboxStoreError(
        'invalid-input',
        'Exactly one of content or contentBase64 must be supplied',
      );
    }
    if (!SHA256_HEX.test(chunk.chunkSha256)) {
      throw new MailboxStoreError('invalid-input', 'chunkSha256 must be a lowercase SHA-256 hex value');
    }

    const bytes = chunk.content !== undefined
      ? Buffer.from(chunk.content, 'utf8')
      : decodeBase64(chunk.contentBase64!);
    if (bytes.byteLength > MAX_CHUNK_BYTES) {
      throw new MailboxStoreError('limit-exceeded', 'Decoded chunk exceeds the 1 MiB limit');
    }
    if (sha256(bytes) !== chunk.chunkSha256) {
      throw new MailboxStoreError('chunk-sha-mismatch', 'Decoded chunk SHA-256 does not match chunkSha256');
    }

    const upload = await this.requireOpenUpload(requestId);
    const chunkRoot = path.join(upload.path, 'chunks');
    const fileRoot = path.join(chunkRoot, sha256(chunk.filePath));
    const metaPath = path.join(fileRoot, 'meta.json');
    const existingMeta = await exists(metaPath)
      ? parseStagedFileMeta(await readJson(metaPath))
      : null;
    if (existingMeta && (
      existingMeta.filePath !== chunk.filePath
      || existingMeta.chunkCount !== chunk.chunkCount
    )) {
      throw new MailboxStoreError('chunk-conflict', 'File path hash or chunkCount conflicts with staged data');
    }

    const duplicate = existingMeta?.chunks.find((item) => item.index === chunk.chunkIndex);
    if (duplicate) {
      if (duplicate.sha256 !== chunk.chunkSha256) {
        throw new MailboxStoreError('chunk-conflict', `Chunk ${chunk.chunkIndex} was already uploaded with another SHA`);
      }
      return {
        filePath: chunk.filePath,
        receivedChunks: existingMeta!.chunks.length,
        chunkCount: existingMeta!.chunkCount,
      };
    }

    const staged = await this.readStagedMetadata(upload.path);
    if (existingMeta === null && staged.length >= MAX_STAGING_FILES) {
      throw new MailboxStoreError('limit-exceeded', 'Staging file count exceeds 64');
    }
    const stagedBytes = staged.reduce(
      (total, meta) => total + meta.chunks.reduce((sum, item) => sum + item.byteLength, 0),
      0,
    );
    if (stagedBytes + bytes.byteLength > MAX_STAGING_BYTES) {
      throw new MailboxStoreError('limit-exceeded', 'Staging payload exceeds the 8 MiB limit');
    }

    await mkdir(fileRoot, { recursive: true });
    await writeBytes(path.join(fileRoot, `${chunk.chunkIndex}.chunk`), bytes);
    const updated: StagedFileMeta = {
      filePath: chunk.filePath,
      chunkCount: chunk.chunkCount,
      chunks: [
        ...(existingMeta?.chunks ?? []),
        { index: chunk.chunkIndex, sha256: chunk.chunkSha256, byteLength: bytes.byteLength },
      ].sort((left, right) => left.index - right.index),
    };
    await writeJson(metaPath, updated);
    return {
      filePath: chunk.filePath,
      receivedChunks: updated.chunks.length,
      chunkCount: updated.chunkCount,
    };
  }

  async finalizeResult(
    requestId: string,
    input: ReviewResultManifest,
  ): Promise<{
    revision: number;
    manifestSha256: string;
    resultFilesSha256: string;
    idempotentReplay: boolean;
  }> {
    const status = await this.requireActiveStatus(requestId);
    let manifest: ReviewResultManifest;
    try {
      manifest = ReviewResultManifestSchema.parse(input);
    } catch (error) {
      throw new MailboxStoreError('finalize-invalid', validationMessage(error));
    }
    if (manifest.requestId !== requestId) {
      throw new MailboxStoreError('finalize-invalid', 'Result manifest requestId does not match the request');
    }
    const manifestSha256 = computePayloadSha256(manifest);

    const existingIndex = await this.readResultIndex(requestId);
    const upload = await this.findOpenUpload(requestId);
    if (status.state === 'result-ready' && existingIndex && upload === null) {
      const current = this.currentRevision(existingIndex);
      if (
        current.manifestSha256 === manifestSha256
        && manifest.payloadSha256 === manifestSha256
      ) {
        return {
          revision: current.revision,
          manifestSha256: current.manifestSha256,
          resultFilesSha256: current.resultFilesSha256,
          idempotentReplay: true,
        };
      }
    }

    if (!upload) {
      throw new MailboxStoreError(
        'finalize-conflict',
        'No open upload matches this manifest; begin a revision before replacing an immutable result',
      );
    }
    const isRevision = upload.descriptor.revisionOf !== null;
    if ((!isRevision && status.state !== 'result-uploading') || (isRevision && status.state !== 'result-ready')) {
      throw new MailboxStoreError(
        'lifecycle-violation',
        `Cannot finalize revision ${upload.descriptor.revision} from ${status.state}`,
      );
    }

    const files = await this.assembleStagedFiles(upload.path);
    const request = await this.requireRequest(requestId);
    const revisionRoot = path.join(this.resultDir(requestId), `rev${upload.descriptor.revision}`);
    const outcome = await importReviewResult(
      {
        kind: 'files',
        requestId,
        folder: manifest.proposedFolder,
        files,
      },
      {
        repoRoot: this.repoRoot,
        installRoot: revisionRoot,
        request,
        resultManifest: manifest,
        // This binds request to manifest; sync/install/ack separately enforce current-repo identity from origin.
        expectedRepositoryFullName: request.repository.fullName,
        transport: 'mcp-mailbox',
        now: this.now,
      },
    );
    if (outcome.status === 'invalid') {
      throw new MailboxStoreError(
        'finalize-invalid',
        outcome.errors.map((error) => `${error.code}${error.path ? `(${error.path})` : ''}: ${error.message}`).join('; '),
      );
    }
    if (outcome.status === 'refused') {
      throw new MailboxStoreError('finalize-invalid', `${outcome.code}: ${outcome.message}`);
    }

    const resultFilesSha256 = outcome.status === 'installed'
      ? outcome.resultFilesSha256
      : computeResultFilesSha256(files);
    await mkdir(revisionRoot, { recursive: true });
    await writeJson(path.join(revisionRoot, 'manifest.json'), manifest);
    const finalizedAt = this.now().toISOString();
    const previousRevisions = existingIndex?.revisions ?? [];
    const nextIndex: ResultIndex = {
      current: upload.descriptor.revision,
      revisions: [
        ...previousRevisions,
        {
          revision: upload.descriptor.revision,
          manifestSha256,
          resultFilesSha256,
          finalizedAt,
          revisionOf: upload.descriptor.revisionOf,
        },
      ],
    };
    await writeJson(path.join(this.resultDir(requestId), 'result.json'), nextIndex);
    await rm(upload.path, { recursive: true, force: true });

    if (!isRevision) {
      if (!canTransition('result-uploading', 'result-ready')) {
        throw new MailboxStoreError('lifecycle-violation', 'result-uploading cannot transition to result-ready');
      }
      await this.writeStatus(requestId, 'result-ready', null);
    }
    return {
      revision: upload.descriptor.revision,
      manifestSha256,
      resultFilesSha256,
      idempotentReplay: false,
    };
  }

  async getResultManifest(requestId: string): Promise<ReviewResultManifest | null> {
    assertSafeRequestId(requestId);
    const index = await this.readResultIndex(requestId);
    if (!index) {
      return null;
    }
    return ReviewResultManifestSchema.parse(
      await readJson(path.join(this.resultDir(requestId), `rev${index.current}`, 'manifest.json')),
    );
  }

  async getResultFile(requestId: string, filePath: string): Promise<Uint8Array> {
    if (!isSafeRelativePath(filePath)) {
      throw new MailboxStoreError('unsafe-path', `Unsafe result file path: ${filePath}`);
    }
    const manifest = await this.getResultManifest(requestId);
    if (!manifest || !manifest.files.some((file) => file.path === filePath)) {
      throw new MailboxStoreError('not-found', `Result file is not in the current manifest: ${filePath}`);
    }
    const index = await this.requireResultIndex(requestId);
    try {
      return await readFile(
        path.join(this.resultDir(requestId), `rev${index.current}`, manifest.proposedFolder, filePath),
      );
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        throw new MailboxStoreError('not-found', `Result file not found: ${filePath}`);
      }
      throw error;
    }
  }

  async acknowledgeImport(requestId: string, receipt: MailboxImportReceipt): Promise<void> {
    const status = await this.requireActiveStatus(requestId);
    const index = await this.requireResultIndex(requestId);
    const current = this.currentRevision(index);
    if (
      receipt.requestId !== requestId
      || receipt.resultFilesSha256 !== current.resultFilesSha256
    ) {
      throw new MailboxStoreError(
        'receipt-mismatch',
        'Import receipt does not match the current request and result files SHA',
      );
    }
    if (!canTransition(status.state, 'imported')) {
      throw new MailboxStoreError(
        'lifecycle-violation',
        `Invalid request lifecycle transition: ${status.state} -> imported`,
      );
    }
    await writeJson(path.join(this.requestDir(requestId), 'imported.json'), receipt);
    await this.writeStatus(requestId, 'imported', null);
  }

  async cancelRequest(requestId: string): Promise<void> {
    const status = await this.getStatus(requestId);
    if (TERMINAL_STATES.has(status.state) || !canTransition(status.state, 'cancelled')) {
      throw new MailboxStoreError(
        'lifecycle-violation',
        `Cannot cancel ${requestId} from ${status.state}`,
      );
    }
    await this.writeStatus(requestId, 'cancelled', 'Cancelled by user');
  }

  private requestDir(requestId: string): string {
    assertSafeRequestId(requestId);
    return path.join(this.requestsRoot, requestId);
  }

  private resultDir(requestId: string): string {
    assertSafeRequestId(requestId);
    return path.join(this.resultsRoot, requestId);
  }

  private async requireRequest(requestId: string): Promise<ReviewRequest> {
    const request = await this.getRequest(requestId);
    if (!request) {
      throw new MailboxStoreError('not-found', `Mailbox request not found: ${requestId}`);
    }
    return request;
  }

  private async requireActiveStatus(requestId: string): Promise<MailboxRequestStatus> {
    const status = await this.getStatus(requestId);
    if (status.state === 'expired') {
      throw new MailboxStoreError('expired', `Mailbox request expired: ${requestId}`);
    }
    return status;
  }

  private async writeStatus(
    requestId: string,
    state: RequestLifecycleState,
    detail: string | null,
  ): Promise<void> {
    await writeJson(path.join(this.requestDir(requestId), 'status.json'), {
      state,
      updatedAt: this.now().toISOString(),
      detail,
    } satisfies StoredStatus);
  }

  private async createUpload(
    requestId: string,
    input: { revision: number; revisionOf: string | null },
  ): Promise<void> {
    const uploadRoot = path.join(this.resultDir(requestId), `staging-rev${input.revision}`);
    await mkdir(path.join(uploadRoot, 'chunks'), { recursive: true });
    await writeJson(path.join(uploadRoot, 'upload.json'), {
      revision: input.revision,
      revisionOf: input.revisionOf,
      openedAt: this.now().toISOString(),
    } satisfies UploadDescriptor);
  }

  private async findOpenUpload(
    requestId: string,
  ): Promise<{ path: string; descriptor: UploadDescriptor } | null> {
    const resultDir = this.resultDir(requestId);
    if (!(await exists(resultDir))) {
      return null;
    }
    const entries = (await readdir(resultDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^staging-rev[1-9][0-9]*$/.test(entry.name))
      .sort((left, right) => compareStringsByCodePoint(left.name, right.name));
    if (entries.length === 0) {
      return null;
    }
    if (entries.length > 1) {
      throw new MailboxStoreError('invalid-input', 'Multiple open mailbox result uploads were found');
    }
    const uploadPath = path.join(resultDir, entries[0]!.name);
    return {
      path: uploadPath,
      descriptor: parseUploadDescriptor(await readJson(path.join(uploadPath, 'upload.json'))),
    };
  }

  private async requireOpenUpload(
    requestId: string,
  ): Promise<{ path: string; descriptor: UploadDescriptor }> {
    const upload = await this.findOpenUpload(requestId);
    if (!upload) {
      throw new MailboxStoreError('no-open-upload', `No result upload is open for ${requestId}`);
    }
    return upload;
  }

  private async readStagedMetadata(uploadRoot: string): Promise<StagedFileMeta[]> {
    const chunkRoot = path.join(uploadRoot, 'chunks');
    if (!(await exists(chunkRoot))) {
      return [];
    }
    const entries = await readdir(chunkRoot, { withFileTypes: true });
    const metadata: StagedFileMeta[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const metaPath = path.join(chunkRoot, entry.name, 'meta.json');
      if (await exists(metaPath)) {
        metadata.push(parseStagedFileMeta(await readJson(metaPath)));
      }
    }
    return metadata.sort((left, right) => compareStringsByCodePoint(left.filePath, right.filePath));
  }

  private async assembleStagedFiles(uploadRoot: string): Promise<ImporterFileInput[]> {
    const metadata = await this.readStagedMetadata(uploadRoot);
    const missing: string[] = [];
    const files: ImporterFileInput[] = [];
    for (const meta of metadata) {
      const byIndex = new Map(meta.chunks.map((chunk) => [chunk.index, chunk]));
      const chunks: Uint8Array[] = [];
      const fileRoot = path.join(uploadRoot, 'chunks', sha256(meta.filePath));
      for (let index = 0; index < meta.chunkCount; index += 1) {
        const stored = byIndex.get(index);
        const chunkPath = path.join(fileRoot, `${index}.chunk`);
        if (!stored || !(await exists(chunkPath))) {
          missing.push(`${meta.filePath}:${index}`);
          continue;
        }
        const bytes = await readFile(chunkPath);
        if (sha256(bytes) !== stored.sha256) {
          throw new MailboxStoreError(
            'finalize-invalid',
            `Staged chunk hash changed before finalize: ${meta.filePath}:${index}`,
          );
        }
        chunks.push(bytes);
      }
      if (chunks.length === meta.chunkCount) {
        files.push({ path: meta.filePath, content: Buffer.concat(chunks) });
      }
    }
    if (missing.length > 0) {
      throw new MailboxStoreError(
        'chunk-missing',
        `Missing result chunks: ${missing.sort(compareStringsByCodePoint).join(', ')}`,
      );
    }
    return files;
  }

  private async readResultIndex(requestId: string): Promise<ResultIndex | null> {
    const indexPath = path.join(this.resultDir(requestId), 'result.json');
    if (!(await exists(indexPath))) {
      return null;
    }
    return parseResultIndex(await readJson(indexPath));
  }

  private async requireResultIndex(requestId: string): Promise<ResultIndex> {
    const index = await this.readResultIndex(requestId);
    if (!index) {
      throw new MailboxStoreError('not-found', `No finalized result exists for ${requestId}`);
    }
    return index;
  }

  private currentRevision(index: ResultIndex): ResultRevision {
    const revision = index.revisions.find((entry) => entry.revision === index.current);
    if (!revision) {
      throw new MailboxStoreError('invalid-input', 'Result index current revision is missing');
    }
    return revision;
  }
}
