import { createHash, randomBytes } from 'node:crypto';
import {
  access,
  lstat,
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
import { setTimeout as delay } from 'node:timers/promises';
import {
  REQUEST_LIFECYCLE_STATES,
  DEFAULT_PUBLISH_LIMITS,
  ReviewRequestSchema,
  ReviewResultManifestSchema,
  canTransition,
  compareStringsByCodePoint,
  computePayloadSha256,
  isSafeRelativePath,
  type RequestLifecycleState,
  type PublishLimits,
  type ReviewDisposition,
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
const DEFAULT_LEASE_STALE_MS = 30_000;
const DEFAULT_LEASE_RETRY_ATTEMPTS = 4;
const DEFAULT_LEASE_RETRY_DELAY_MS = 10;
const FINALIZE_JOURNAL_SCHEMA = 'vibe-pro-bridge-finalize-journal-v1';
const PUBLICATION_RECORD_SCHEMA = 'vibe-pro-bridge-publication-v1';
const CLIENT_PUBLICATION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const OWNED_TEMP_PATTERN = /\.[0-9]+\.[0-9a-f]{32}\.tmp(?:dir)?$/;

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
  | 'stale-owner'
  | 'lease-unavailable'
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
  leaseStaleMs?: number;
  leaseRetryAttempts?: number;
  leaseRetryDelayMs?: number;
  onAfterDurableOp?: (event: DurableOpEvent) => void | Promise<void>;
}

export interface DurableOpEvent {
  scope: string;
  step: string;
  requestId?: string;
  path?: string;
}

export interface PutChunkInput {
  filePath: string;
  chunkIndex: number;
  chunkCount: number;
  content?: string;
  contentBase64?: string;
  chunkSha256: string;
}

export interface PublishPackageFile {
  path: string;
  mediaType: 'text/markdown' | 'application/json';
  content: string;
}

export interface PublishPackageInput {
  proposedFolder: string;
  disposition: ReviewDisposition;
  summary: {
    title: string;
    reviewedRepository: string;
    reviewedBaseSha: string;
    reviewedHeadSha: string;
    p0: number;
    p1: number;
    p2: number;
    p3: number;
    limitations: string[];
  };
  files: PublishPackageFile[];
  clientPublicationId: string;
  reviewerDeclaration?: ReviewResultManifest['reviewerDeclaration'];
}

export interface PublishReceipt {
  status: 'result-ready';
  requestId: string;
  resultId: string;
  proposedFolder: string;
  resultManifestSha256: string;
  fileCount: number;
  totalBytes: number;
  revision: number;
  imported: false;
  idempotentReplay: boolean;
}

export interface ChunkedUploadRequired {
  status: 'chunked-upload-required';
  requestId: string;
  uploadSessionId: string;
  maxChunkBytes: number;
  requiredFiles: string[];
  requiredNextTools: ['put_result_file', 'finalize_result'];
  limits: PublishLimits;
  exceeded: string[];
}

export interface PublicationConflict {
  status: 'conflict';
  reason:
    | 'request-terminal'
    // Reserved until the bridge has principal identity in the OAuth profile.
    | 'claimed-by-another-reviewer'
    | 'different-result-already-finalized'
    | 'request-sha-mismatch'
    | 'publication-id-content-mismatch';
  existingResultId?: string;
  detail: string;
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
  repositoryFullName?: string | undefined;
  resultManifestSha256?: string | undefined;
  verification?: 'out-of-band' | undefined;
}

export type MailboxHealthState =
  | 'empty'
  | 'healthy'
  | 'recovering'
  | 'quarantined-corrupt-entry'
  | 'migration-required';

export interface MailboxHealthDiagnostic {
  requestId: string;
  problem: string;
  detail: string;
}

export interface MailboxHealth {
  state: MailboxHealthState;
  entries: MailboxHealthDiagnostic[];
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

interface StoredPublication {
  manifestSha256: string;
  revision: number;
  resultId: string;
  fileCount: number;
  totalBytes: number;
  title: string;
  recordedAt: string;
}

interface PublicationIndex {
  schemaVersion: typeof PUBLICATION_RECORD_SCHEMA;
  publications: Record<string, StoredPublication>;
}

interface DirectorySnapshot {
  directories: string[];
  files: Array<{ path: string; content: Uint8Array }>;
}

interface PublishRollbackSnapshot {
  status: Pick<StoredStatus, 'state' | 'detail'>;
  uploadPath: string | null;
  upload: DirectorySnapshot | null;
  journal: FinalizeJournal | null;
}

interface FinalizeJournal {
  schemaVersion: typeof FINALIZE_JOURNAL_SCHEMA;
  revision: number;
  revisionOf: string | null;
  manifestSha256: string;
  resultFilesSha256: string;
  manifest: ReviewResultManifest;
  phase: 'prepared' | 'revision-installed' | 'manifest-written' | 'index-written' | 'committed';
  updatedAt: string;
}

interface LeaseRecord {
  fingerprint: string;
  acquiredAt: string;
}

interface LeaseContext extends LeaseRecord {
  requestId: string;
  path: string;
}

class DurableOpHookError extends Error {
  constructor(readonly original: unknown) {
    super(original instanceof Error ? original.message : String(original));
    this.name = 'DurableOpHookError';
  }
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

function parsePublicationIndex(value: unknown): PublicationIndex {
  if (!value || typeof value !== 'object') {
    throw new MailboxStoreError('invalid-input', 'Invalid publication record');
  }
  const index = value as Record<string, unknown>;
  if (
    index.schemaVersion !== PUBLICATION_RECORD_SCHEMA
    || !index.publications
    || typeof index.publications !== 'object'
    || Array.isArray(index.publications)
  ) {
    throw new MailboxStoreError('invalid-input', 'Invalid publication record');
  }
  const publications: Record<string, StoredPublication> = {};
  for (const [clientPublicationId, value] of Object.entries(
    index.publications as Record<string, unknown>,
  )) {
    if (!CLIENT_PUBLICATION_ID.test(clientPublicationId) || !value || typeof value !== 'object') {
      throw new MailboxStoreError('invalid-input', 'Invalid publication record entry');
    }
    const publication = value as Record<string, unknown>;
    if (
      typeof publication.manifestSha256 !== 'string'
      || !SHA256_HEX.test(publication.manifestSha256)
      || !Number.isSafeInteger(publication.revision)
      || (publication.revision as number) < 1
      || typeof publication.resultId !== 'string'
      || !Number.isSafeInteger(publication.fileCount)
      || (publication.fileCount as number) < 1
      || !Number.isSafeInteger(publication.totalBytes)
      || (publication.totalBytes as number) < 0
      || typeof publication.title !== 'string'
      || typeof publication.recordedAt !== 'string'
    ) {
      throw new MailboxStoreError('invalid-input', 'Invalid publication record entry');
    }
    publications[clientPublicationId] = {
      manifestSha256: publication.manifestSha256,
      revision: publication.revision as number,
      resultId: publication.resultId,
      fileCount: publication.fileCount as number,
      totalBytes: publication.totalBytes as number,
      title: publication.title,
      recordedAt: publication.recordedAt,
    };
  }
  return { schemaVersion: PUBLICATION_RECORD_SCHEMA, publications };
}

function parseFinalizeJournal(value: unknown): FinalizeJournal {
  if (!value || typeof value !== 'object') {
    throw new MailboxStoreError('invalid-input', 'Invalid finalize journal');
  }
  const journal = value as Record<string, unknown>;
  const phases = ['prepared', 'revision-installed', 'manifest-written', 'index-written', 'committed'];
  if (
    journal.schemaVersion !== FINALIZE_JOURNAL_SCHEMA
    || !Number.isSafeInteger(journal.revision)
    || (journal.revision as number) < 1
    || (journal.revisionOf !== null && typeof journal.revisionOf !== 'string')
    || typeof journal.manifestSha256 !== 'string'
    || !SHA256_HEX.test(journal.manifestSha256)
    || typeof journal.resultFilesSha256 !== 'string'
    || !SHA256_HEX.test(journal.resultFilesSha256)
    || typeof journal.phase !== 'string'
    || !phases.includes(journal.phase)
    || typeof journal.updatedAt !== 'string'
  ) {
    throw new MailboxStoreError('invalid-input', 'Invalid finalize journal');
  }
  const manifest = ReviewResultManifestSchema.parse(journal.manifest);
  if (computePayloadSha256(manifest) !== journal.manifestSha256) {
    throw new MailboxStoreError('invalid-input', 'Finalize journal manifest hash does not match');
  }
  return {
    schemaVersion: FINALIZE_JOURNAL_SCHEMA,
    revision: journal.revision as number,
    revisionOf: journal.revisionOf as string | null,
    manifestSha256: journal.manifestSha256,
    resultFilesSha256: journal.resultFilesSha256,
    manifest,
    phase: journal.phase as FinalizeJournal['phase'],
    updatedAt: journal.updatedAt,
  };
}

function parseLeaseRecord(value: unknown): LeaseRecord {
  if (!value || typeof value !== 'object') {
    throw new MailboxStoreError('invalid-input', 'Invalid mailbox lease');
  }
  const lease = value as Record<string, unknown>;
  if (typeof lease.fingerprint !== 'string' || typeof lease.acquiredAt !== 'string') {
    throw new MailboxStoreError('invalid-input', 'Invalid mailbox lease');
  }
  return { fingerprint: lease.fingerprint, acquiredAt: lease.acquiredAt };
}

function parseImportReceipt(value: unknown): MailboxImportReceipt {
  if (!value || typeof value !== 'object') {
    throw new MailboxStoreError('invalid-input', 'Invalid import receipt');
  }
  const receipt = value as Record<string, unknown>;
  if (
    typeof receipt.requestId !== 'string'
    || typeof receipt.folder !== 'string'
    || typeof receipt.installedPath !== 'string'
    || typeof receipt.resultFilesSha256 !== 'string'
    || !SHA256_HEX.test(receipt.resultFilesSha256)
    || typeof receipt.importedAt !== 'string'
    || (receipt.repositoryFullName !== undefined && typeof receipt.repositoryFullName !== 'string')
    || (receipt.resultManifestSha256 !== undefined && (
      typeof receipt.resultManifestSha256 !== 'string'
      || !SHA256_HEX.test(receipt.resultManifestSha256)
    ))
    || (receipt.verification !== undefined && receipt.verification !== 'out-of-band')
  ) {
    throw new MailboxStoreError('invalid-input', 'Invalid import receipt');
  }
  return {
    requestId: receipt.requestId,
    folder: receipt.folder,
    installedPath: receipt.installedPath,
    resultFilesSha256: receipt.resultFilesSha256,
    importedAt: receipt.importedAt,
    ...(typeof receipt.repositoryFullName === 'string'
      ? { repositoryFullName: receipt.repositoryFullName }
      : {}),
    ...(typeof receipt.resultManifestSha256 === 'string'
      ? { resultManifestSha256: receipt.resultManifestSha256 }
      : {}),
    ...(receipt.verification === 'out-of-band' ? { verification: 'out-of-band' as const } : {}),
  };
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

function publicationResultId(revision: number, manifestSha256: string): string {
  return `rev${revision}-${manifestSha256.slice(0, 12)}`;
}

export function validatePublishLimits(input: PublishLimits): PublishLimits {
  for (const [name, value] of Object.entries(input)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new MailboxStoreError('invalid-input', `${name} must be a positive safe integer`);
    }
  }
  if (
    input.maxFiles > MAX_STAGING_FILES
    || input.maxTotalBytes > MAX_STAGING_BYTES
    || input.maxFileBytes > MAX_CHUNK_BYTES
  ) {
    throw new MailboxStoreError(
      'invalid-input',
      `Publish limits cannot exceed the staging ceilings (${MAX_STAGING_FILES} files, ${MAX_STAGING_BYTES} total bytes, ${MAX_CHUNK_BYTES} bytes per file)`,
    );
  }
  return { ...input };
}

function publishReceipt(
  requestId: string,
  manifest: ReviewResultManifest,
  publication: Pick<StoredPublication, 'revision' | 'resultId' | 'fileCount' | 'totalBytes'>,
  idempotentReplay: boolean,
): PublishReceipt {
  return {
    status: 'result-ready',
    requestId,
    resultId: publication.resultId,
    proposedFolder: manifest.proposedFolder,
    resultManifestSha256: manifest.payloadSha256,
    fileCount: publication.fileCount,
    totalBytes: publication.totalBytes,
    revision: publication.revision,
    imported: false,
    idempotentReplay,
  };
}

export class MailboxStore {
  readonly bridgeRoot: string;
  readonly requestsRoot: string;
  readonly resultsRoot: string;
  readonly locksRoot: string;
  private readonly repoRoot: string;
  private readonly now: () => Date;
  private readonly leaseStaleMs: number;
  private readonly leaseRetryAttempts: number;
  private readonly leaseRetryDelayMs: number;
  private readonly onAfterDurableOp: (event: DurableOpEvent) => void | Promise<void>;
  private readonly mutationQueues = new Map<string, Promise<void>>();

  constructor(options: MailboxStoreOptions) {
    this.repoRoot = path.resolve(options.repoRoot);
    this.bridgeRoot = path.resolve(
      options.bridgeRoot ?? path.join(this.repoRoot, '.vibe', 'pro-bridge'),
    );
    this.requestsRoot = path.join(this.bridgeRoot, 'requests');
    this.resultsRoot = path.join(this.bridgeRoot, 'results');
    this.locksRoot = path.join(this.bridgeRoot, 'locks');
    this.now = options.now ?? (() => new Date());
    this.leaseStaleMs = options.leaseStaleMs ?? DEFAULT_LEASE_STALE_MS;
    this.leaseRetryAttempts = options.leaseRetryAttempts ?? DEFAULT_LEASE_RETRY_ATTEMPTS;
    this.leaseRetryDelayMs = options.leaseRetryDelayMs ?? DEFAULT_LEASE_RETRY_DELAY_MS;
    this.onAfterDurableOp = options.onAfterDurableOp ?? (() => undefined);
  }

  private async mutate<T>(
    requestId: string,
    operation: (lease: LeaseContext) => Promise<T>,
    options: { reconcile?: boolean } = {},
  ): Promise<T> {
    assertSafeRequestId(requestId);
    const previous = this.mutationQueues.get(requestId) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(async () => {
        const lease = await this.acquireLease(requestId);
        let release = true;
        try {
          if (options.reconcile !== false) {
            await this.reconcileUnsafe(requestId, lease);
          }
          return await operation(lease);
        } catch (error) {
          if (error instanceof DurableOpHookError) {
            release = false;
            throw error.original;
          }
          throw error;
        } finally {
          if (release) {
            await this.releaseLease(lease);
          }
        }
      });
    const tail = run.then(() => undefined, () => undefined);
    this.mutationQueues.set(requestId, tail);
    try {
      return await run;
    } finally {
      if (this.mutationQueues.get(requestId) === tail) {
        this.mutationQueues.delete(requestId);
      }
    }
  }

  private async acquireLease(requestId: string): Promise<LeaseContext> {
    await mkdir(this.locksRoot, { recursive: true });
    const leasePath = path.join(this.locksRoot, `${requestId}.lock`);
    for (let attempt = 0; attempt < this.leaseRetryAttempts; attempt += 1) {
      const fingerprint = randomBytes(16).toString('hex');
      const acquiredAt = this.now().toISOString();
      try {
        await writeFile(
          leasePath,
          `${JSON.stringify({ fingerprint, acquiredAt } satisfies LeaseRecord)}\n`,
          { encoding: 'utf8', flag: 'wx' },
        );
        await bestEffortFsync(leasePath);
        return { requestId, path: leasePath, fingerprint, acquiredAt };
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) {
          throw error;
        }
        let stale = true;
        try {
          const existing = parseLeaseRecord(await readJson(leasePath));
          const acquired = Date.parse(existing.acquiredAt);
          stale = !Number.isFinite(acquired) || this.now().getTime() - acquired >= this.leaseStaleMs;
        } catch {
          stale = true;
        }
        if (stale) {
          await rm(leasePath, { force: true });
          continue;
        }
        if (attempt + 1 < this.leaseRetryAttempts && this.leaseRetryDelayMs > 0) {
          await delay(this.leaseRetryDelayMs);
        }
      }
    }
    throw new MailboxStoreError(
      'lease-unavailable',
      `Mailbox request ${requestId} is locked by another active process`,
    );
  }

  private async assertLease(lease: LeaseContext): Promise<void> {
    let current: LeaseRecord | null = null;
    try {
      current = parseLeaseRecord(await readJson(lease.path));
    } catch {
      current = null;
    }
    if (current?.fingerprint !== lease.fingerprint) {
      throw new MailboxStoreError(
        'stale-owner',
        `Mailbox request ${lease.requestId} lease was reclaimed by another owner`,
      );
    }
  }

  private async releaseLease(lease: LeaseContext): Promise<void> {
    try {
      const current = parseLeaseRecord(await readJson(lease.path));
      if (current.fingerprint === lease.fingerprint) {
        await rm(lease.path, { force: true });
      }
    } catch {
      // A missing or replaced lease belongs to no current work by this owner.
    }
  }

  private async afterDurableOp(
    step: string,
    requestId: string,
    filePath?: string,
  ): Promise<void> {
    try {
      await this.onAfterDurableOp({
        scope: 'mailbox-store',
        step,
        requestId,
        ...(filePath === undefined ? {} : { path: filePath }),
      });
    } catch (error) {
      throw new DurableOpHookError(error);
    }
  }

  private async commitJson(
    filePath: string,
    value: unknown,
    lease: LeaseContext,
    step: string,
  ): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${randomBytes(16).toString('hex')}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await bestEffortFsync(temporaryPath);
    await this.assertLease(lease);
    await rename(temporaryPath, filePath);
    await this.afterDurableOp(step, lease.requestId, filePath);
  }

  private async commitBytes(
    filePath: string,
    value: Uint8Array | string,
    lease: LeaseContext,
    step: string,
  ): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${randomBytes(16).toString('hex')}.tmp`;
    await writeFile(temporaryPath, value);
    await bestEffortFsync(temporaryPath);
    await this.assertLease(lease);
    await rename(temporaryPath, filePath);
    await this.afterDurableOp(step, lease.requestId, filePath);
  }

  async createRequest(input: ReviewRequest): Promise<{ requestId: string; created: boolean }> {
    const request = ReviewRequestSchema.parse(input);
    assertSafeRequestId(request.requestId);
    return this.mutate(request.requestId, (lease) => this.createRequestUnsafe(request, lease));
  }

  private async createRequestUnsafe(
    request: ReviewRequest,
    lease: LeaseContext,
  ): Promise<{ requestId: string; created: boolean }> {
    const sameId = await this.getRequest(request.requestId);
    if (sameId) {
      if (sameId.payloadSha256 === request.payloadSha256) {
        await this.ensureRequestArtifacts(request, lease);
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

    await this.commitJson(path.join(requestDir, 'request.json'), request, lease, 'create:request');
    await this.commitBytes(path.join(requestDir, 'prompt.md'), request.reviewPrompt, lease, 'create:prompt');
    await this.commitBytes(
      path.join(requestDir, 'invocation.txt'),
      `@Vibe Pro Bridge review ${request.requestId}\n`,
      lease,
      'create:invocation',
    );
    await this.writeStatus(request.requestId, 'ready', null, lease);
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

  async inspectMailboxHealth(): Promise<MailboxHealth> {
    const requestEntries = await this.directoryEntryNames(this.requestsRoot);
    const resultEntries = await this.directoryEntryNames(this.resultsRoot);
    const names = new Set([...requestEntries, ...resultEntries]);
    if (names.size === 0) {
      return { state: 'empty', entries: [] };
    }

    const entries: MailboxHealthDiagnostic[] = [];
    for (const requestId of [...names].sort(compareStringsByCodePoint)) {
      if (!SAFE_REQUEST_ID.test(requestId)) {
        entries.push({
          requestId,
          problem: 'corrupt-request-id',
          detail: 'Mailbox entry name is not a safe requestId',
        });
        continue;
      }
      entries.push(...await this.inspectHealthEntry(requestId));
    }

    const state: MailboxHealthState = entries.some((entry) => entry.problem === 'migration-required')
      ? 'migration-required'
      : entries.some((entry) => entry.problem !== 'recovery-pending')
        ? 'quarantined-corrupt-entry'
        : entries.some((entry) => entry.problem === 'recovery-pending')
          ? 'recovering'
          : 'healthy';
    return { state, entries };
  }

  private async directoryEntryNames(root: string): Promise<string[]> {
    if (!(await exists(root))) {
      return [];
    }
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => !OWNED_TEMP_PATTERN.test(entry.name))
      .map((entry) => entry.name);
  }

  private async inspectHealthEntry(requestId: string): Promise<MailboxHealthDiagnostic[]> {
    const diagnostics: MailboxHealthDiagnostic[] = [];
    const requestDir = this.requestDir(requestId);
    const requestPath = path.join(requestDir, 'request.json');
    if (!(await exists(requestPath))) {
      diagnostics.push({
        requestId,
        problem: 'corrupt-request',
        detail: 'request.json is missing',
      });
      return diagnostics;
    }

    let rawRequest: unknown;
    try {
      rawRequest = await readJson(requestPath);
    } catch (error) {
      diagnostics.push({
        requestId,
        problem: 'corrupt-request',
        detail: `request.json parse failed: ${validationMessage(error)}`,
      });
      return diagnostics;
    }
    if (
      rawRequest
      && typeof rawRequest === 'object'
      && 'schemaVersion' in rawRequest
      && (rawRequest as Record<string, unknown>).schemaVersion !== 'vibe-pro-review-request-v1'
    ) {
      diagnostics.push({
        requestId,
        problem: 'migration-required',
        detail: `Unsupported request schemaVersion: ${String((rawRequest as Record<string, unknown>).schemaVersion)}`,
      });
      return diagnostics;
    }
    try {
      ReviewRequestSchema.parse(rawRequest);
    } catch (error) {
      diagnostics.push({
        requestId,
        problem: 'corrupt-request',
        detail: `request.json is incomplete: ${validationMessage(error)}`,
      });
      return diagnostics;
    }

    const statusPath = path.join(requestDir, 'status.json');
    if (!(await exists(statusPath))) {
      diagnostics.push({
        requestId,
        problem: 'missing-status',
        detail: 'status.json is missing',
      });
      return diagnostics;
    }
    let status: StoredStatus;
    try {
      const rawStatus = await readJson(statusPath);
      if (
        rawStatus
        && typeof rawStatus === 'object'
        && 'schemaVersion' in rawStatus
        && (rawStatus as Record<string, unknown>).schemaVersion !== 1
      ) {
        diagnostics.push({
          requestId,
          problem: 'migration-required',
          detail: `Unsupported status schemaVersion: ${String((rawStatus as Record<string, unknown>).schemaVersion)}`,
        });
        return diagnostics;
      }
      status = parseStoredStatus(rawStatus);
    } catch (error) {
      diagnostics.push({
        requestId,
        problem: 'corrupt-status',
        detail: `status.json parse failed: ${validationMessage(error)}`,
      });
      return diagnostics;
    }

    const resultDir = this.resultDir(requestId);
    if (!(await exists(resultDir))) {
      return diagnostics;
    }
    if (!(await lstat(resultDir)).isDirectory()) {
      diagnostics.push({
        requestId,
        problem: 'corrupt-result-entry',
        detail: 'Result entry is not a directory',
      });
      return diagnostics;
    }

    let journal: FinalizeJournal | null = null;
    const journalPath = path.join(resultDir, 'journal.json');
    if (await exists(journalPath)) {
      try {
        const rawJournal = await readJson(journalPath);
        if (
          rawJournal
          && typeof rawJournal === 'object'
          && (rawJournal as Record<string, unknown>).schemaVersion !== FINALIZE_JOURNAL_SCHEMA
        ) {
          diagnostics.push({
            requestId,
            problem: 'migration-required',
            detail: `Unsupported journal schemaVersion: ${String((rawJournal as Record<string, unknown>).schemaVersion)}`,
          });
          return diagnostics;
        }
        journal = parseFinalizeJournal(rawJournal);
      } catch (error) {
        diagnostics.push({
          requestId,
          problem: 'corrupt-journal',
          detail: `journal.json parse failed: ${validationMessage(error)}`,
        });
        return diagnostics;
      }
    }

    let index: ResultIndex | null = null;
    const indexPath = path.join(resultDir, 'result.json');
    if (await exists(indexPath)) {
      try {
        const rawIndex = await readJson(indexPath);
        if (
          rawIndex
          && typeof rawIndex === 'object'
          && 'schemaVersion' in rawIndex
          && (rawIndex as Record<string, unknown>).schemaVersion !== 1
        ) {
          diagnostics.push({
            requestId,
            problem: 'migration-required',
            detail: `Unsupported result index schemaVersion: ${String((rawIndex as Record<string, unknown>).schemaVersion)}`,
          });
          return diagnostics;
        }
        index = parseResultIndex(rawIndex);
        const current = this.currentRevision(index);
        const manifestPath = path.join(resultDir, `rev${index.current}`, 'manifest.json');
        if (!(await exists(manifestPath))) {
          diagnostics.push({
            requestId,
            problem: 'partial-result-index',
            detail: `Current revision ${index.current} manifest is missing`,
          });
        } else {
          const manifest = ReviewResultManifestSchema.parse(await readJson(manifestPath));
          if (computePayloadSha256(manifest) !== current.manifestSha256) {
            diagnostics.push({
              requestId,
              problem: 'partial-result-index',
              detail: `Current revision ${index.current} manifest hash does not match result.json`,
            });
          }
        }
      } catch (error) {
        diagnostics.push({
          requestId,
          problem: 'partial-result-index',
          detail: `result.json parse failed: ${validationMessage(error)}`,
        });
      }
    } else {
      const revisions = (await readdir(resultDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && /^rev[1-9][0-9]*$/.test(entry.name));
      if (revisions.length > 0 && journal === null) {
        diagnostics.push({
          requestId,
          problem: 'partial-result-index',
          detail: 'Revision directories exist without result.json or a recovery journal',
        });
      }
    }

    let uploads: Array<{ path: string; descriptor: UploadDescriptor }> = [];
    try {
      uploads = await this.findOpenUploads(requestId);
    } catch (error) {
      diagnostics.push({
        requestId,
        problem: 'corrupt-upload',
        detail: `Open upload parse failed: ${validationMessage(error)}`,
      });
      return diagnostics;
    }
    if (uploads.length > 1) {
      diagnostics.push({
        requestId,
        problem: 'multiple-open-uploads',
        detail: `Found ${uploads.length} open staging revisions`,
      });
    }
    const currentRevision = index?.current ?? 0;
    for (const upload of uploads) {
      if (upload.descriptor.revision > currentRevision + 1) {
        diagnostics.push({
          requestId,
          problem: 'revision-gap',
          detail: `Open revision ${upload.descriptor.revision} skips current revision ${currentRevision}`,
        });
      } else if (
        upload.descriptor.revision <= currentRevision
        && journal?.revision !== upload.descriptor.revision
      ) {
        diagnostics.push({
          requestId,
          problem: 'stale-upload-unproven',
          detail: `Upload revision ${upload.descriptor.revision} is stale without a matching durable journal`,
        });
      }
    }

    if (journal) {
      const indexed = index?.revisions.some((entry) =>
        entry.revision === journal!.revision
        && entry.manifestSha256 === journal!.manifestSha256
        && entry.resultFilesSha256 === journal!.resultFilesSha256);
      const matchingUpload = uploads.some((upload) => upload.descriptor.revision === journal!.revision);
      if (
        journal.phase !== 'committed'
        || !indexed
        || (journal.revision === 1 && status.state === 'result-uploading')
        || (matchingUpload && journal.revision <= currentRevision)
      ) {
        diagnostics.push({
          requestId,
          problem: 'recovery-pending',
          detail: `Finalize journal revision ${journal.revision} is at phase ${journal.phase}`,
        });
      }
    } else if (index && uploads.length === 0 && status.state === 'result-uploading') {
      diagnostics.push({
        requestId,
        problem: 'recovery-pending',
        detail: 'Legacy finalized result needs status promotion to result-ready',
      });
    }
    return diagnostics;
  }

  async claimRequest(requestId: string): Promise<MailboxRequestStatus> {
    return this.mutate(requestId, (lease) => this.claimRequestUnsafe(requestId, lease));
  }

  private async claimRequestUnsafe(
    requestId: string,
    lease: LeaseContext,
  ): Promise<MailboxRequestStatus> {
    const status = await this.requireActiveStatus(requestId);
    if (!canTransition(status.state, 'claimed')) {
      throw new MailboxStoreError(
        'lifecycle-violation',
        `Invalid request lifecycle transition: ${status.state} -> claimed`,
      );
    }
    await this.writeStatus(requestId, 'claimed', null, lease);
    return this.getStatus(requestId);
  }

  async publishReviewPackage(
    requestId: string,
    input: PublishPackageInput,
    limits: PublishLimits = DEFAULT_PUBLISH_LIMITS,
  ): Promise<PublishReceipt | ChunkedUploadRequired | PublicationConflict> {
    const publishLimits = validatePublishLimits(limits);
    return this.mutate(requestId, async (lease) => {
      const request = await this.requireRequest(requestId);
      const status = await this.requireActiveStatus(requestId);
      if (TERMINAL_STATES.has(status.state)) {
        return {
          status: 'conflict',
          reason: 'request-terminal',
          detail: `Request ${requestId} is already ${status.state}`,
        };
      }
      if (
        input.summary.reviewedRepository !== request.repository.fullName
        || input.summary.reviewedBaseSha !== request.git.baseSha
        || input.summary.reviewedHeadSha !== request.git.headSha
      ) {
        return {
          status: 'conflict',
          reason: 'request-sha-mismatch',
          detail: 'Publication summary does not match the request repository and exact refs',
        };
      }

      const publicationIndex = await this.readPublicationIndex(requestId);
      const recorded = Object.prototype.hasOwnProperty.call(
        publicationIndex.publications,
        input.clientPublicationId,
      )
        ? publicationIndex.publications[input.clientPublicationId]
        : undefined;
      const resultIndex = await this.readResultIndex(requestId);
      const recordedManifest = recorded === undefined
        ? null
        : await this.readRevisionManifest(requestId, recorded.revision);
      if (recorded !== undefined && recordedManifest === null) {
        throw new MailboxStoreError(
          'invalid-input',
          `Publication ${input.clientPublicationId} references a missing result revision`,
        );
      }
      const currentManifest = recorded === undefined && status.state === 'result-ready' && resultIndex
        ? await this.readRevisionManifest(requestId, resultIndex.current)
        : null;
      if (status.state === 'result-ready' && resultIndex && currentManifest === null && recorded === undefined) {
        throw new MailboxStoreError('invalid-input', 'Current result revision manifest is missing');
      }
      if (recorded !== undefined && recordedManifest !== null) {
        const indexed = resultIndex?.revisions.some((revision) =>
          revision.revision === recorded.revision
          && revision.manifestSha256 === recorded.manifestSha256);
        const recordedTotalBytes = recordedManifest.files.reduce(
          (total, file) => total + file.byteLength,
          0,
        );
        if (!indexed) {
          throw new MailboxStoreError(
            'invalid-input',
            `Publication ${input.clientPublicationId} is not present in the result index`,
          );
        }
        if (
          recordedManifest.payloadSha256 !== recorded.manifestSha256
          || recorded.resultId !== publicationResultId(recorded.revision, recorded.manifestSha256)
          || recorded.fileCount !== recordedManifest.files.length
          || recorded.totalBytes !== recordedTotalBytes
        ) {
          throw new MailboxStoreError(
            'invalid-input',
            `Publication ${input.clientPublicationId} receipt metadata is inconsistent`,
          );
        }
      }
      if (currentManifest !== null && resultIndex !== null) {
        const current = this.currentRevision(resultIndex);
        if (currentManifest.payloadSha256 !== current.manifestSha256) {
          throw new MailboxStoreError(
            'invalid-input',
            'Current revision manifest does not match the result index',
          );
        }
      }

      // createdAt participates in the canonical SHA. Reuse the server timestamp already bound
      // to this publication/result so a later exact retry remains byte-for-byte idempotent.
      const createdAt = recordedManifest?.createdAt
        ?? currentManifest?.createdAt
        ?? this.now().toISOString();
      const manifest = this.buildPublicationManifest(request, input, createdAt);
      const manifestSha256 = manifest.payloadSha256;

      if (recorded !== undefined) {
        if (recorded.manifestSha256 !== manifestSha256) {
          return {
            status: 'conflict',
            reason: 'publication-id-content-mismatch',
            existingResultId: recorded.resultId,
            detail: `Publication id ${input.clientPublicationId} is already bound to different content`,
          };
        }
        return publishReceipt(requestId, recordedManifest!, recorded, true);
      }

      if (status.state === 'result-ready') {
        if (!resultIndex || !currentManifest) {
          throw new MailboxStoreError('invalid-input', 'Result-ready request has no current result');
        }
        const current = this.currentRevision(resultIndex);
        const existingResultId = publicationResultId(current.revision, current.manifestSha256);
        if (current.manifestSha256 === manifestSha256) {
          const converged: StoredPublication = {
            manifestSha256,
            revision: current.revision,
            resultId: existingResultId,
            fileCount: manifest.files.length,
            totalBytes: manifest.files.reduce((total, file) => total + file.byteLength, 0),
            title: input.summary.title,
            recordedAt: this.now().toISOString(),
          };
          await this.recordPublication(
            requestId,
            input.clientPublicationId,
            converged,
            publicationIndex,
            lease,
          );
          return publishReceipt(requestId, currentManifest, converged, true);
        }
        return {
          status: 'conflict',
          reason: 'different-result-already-finalized',
          existingResultId,
          detail: 'A different immutable result is already finalized; use begin_result with revisionOf to publish a revision',
        };
      }

      const totalBytes = manifest.files.reduce((total, file) => total + file.byteLength, 0);
      const exceeded: string[] = [];
      if (manifest.files.length > publishLimits.maxFiles) {
        exceeded.push('maxFiles');
      }
      if (totalBytes > publishLimits.maxTotalBytes) {
        exceeded.push('maxTotalBytes');
      }
      if (manifest.files.some((file) => file.byteLength > publishLimits.maxFileBytes)) {
        exceeded.push('maxFileBytes');
      }

      const openUpload = await this.findOpenUpload(requestId);
      const snapshot: PublishRollbackSnapshot = {
        status: { state: status.state, detail: status.detail },
        uploadPath: openUpload?.path ?? null,
        upload: openUpload === null ? null : await this.snapshotDirectory(openUpload.path),
        journal: await this.readFinalizeJournal(requestId),
      };
      let finalizedInThisCall = false;
      try {
        if (status.state === 'ready') {
          await this.claimRequestUnsafe(requestId, lease);
        }
        const upload = await this.beginResultUnsafe(requestId, undefined, lease);
        if (exceeded.length > 0) {
          return {
            status: 'chunked-upload-required',
            requestId,
            uploadSessionId: `staging-rev${upload.revision}`,
            maxChunkBytes: MAX_CHUNK_BYTES,
            requiredFiles: [...request.outputContract.requiredFiles],
            requiredNextTools: ['put_result_file', 'finalize_result'],
            limits: publishLimits,
            exceeded,
          };
        }

        for (const file of input.files) {
          const bytes = Buffer.from(file.content, 'utf8');
          await this.putResultFileUnsafe(
            requestId,
            {
              filePath: file.path,
              chunkIndex: 0,
              chunkCount: 1,
              content: file.content,
              chunkSha256: sha256(bytes),
            },
            lease,
          );
        }
        const finalized = await this.finalizeResultUnsafe(requestId, manifest, lease);
        finalizedInThisCall = true;
        const resultId = publicationResultId(finalized.revision, finalized.manifestSha256);
        const publication: StoredPublication = {
          manifestSha256: finalized.manifestSha256,
          revision: finalized.revision,
          resultId,
          fileCount: manifest.files.length,
          totalBytes,
          title: input.summary.title,
          recordedAt: this.now().toISOString(),
        };
        // If this atomic record write fails after finalize, retry converges through the
        // current-manifest branch above and records the same deterministic receipt.
        await this.recordPublication(
          requestId,
          input.clientPublicationId,
          publication,
          publicationIndex,
          lease,
        );
        return publishReceipt(requestId, manifest, publication, false);
      } catch (error) {
        if (error instanceof DurableOpHookError || finalizedInThisCall) {
          throw error;
        }
        await this.rollbackPublish(requestId, snapshot, lease);
        throw error;
      }
    });
  }

  async beginResult(requestId: string, revisionOf?: string): Promise<{ revision: number }> {
    return this.mutate(requestId, (lease) => this.beginResultUnsafe(requestId, revisionOf, lease));
  }

  private async beginResultUnsafe(
    requestId: string,
    revisionOf: string | undefined,
    lease: LeaseContext,
  ): Promise<{ revision: number }> {
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
      await this.createUpload(requestId, { revision, revisionOf }, lease);
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
      await this.writeStatus(requestId, 'reviewing', null, lease);
      state = 'reviewing';
    }
    if (state === 'reviewing') {
      if (!canTransition(state, 'result-uploading')) {
        throw new MailboxStoreError('lifecycle-violation', `${state} cannot transition to result-uploading`);
      }
      await this.writeStatus(requestId, 'result-uploading', null, lease);
    }
    await this.createUpload(requestId, { revision: 1, revisionOf: null }, lease);
    return { revision: 1 };
  }

  async putResultFile(
    requestId: string,
    chunk: PutChunkInput,
  ): Promise<{ filePath: string; receivedChunks: number; chunkCount: number }> {
    return this.mutate(requestId, (lease) => this.putResultFileUnsafe(requestId, chunk, lease));
  }

  private async putResultFileUnsafe(
    requestId: string,
    chunk: PutChunkInput,
    lease: LeaseContext,
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
    const finalizeJournal = await this.readFinalizeJournal(requestId);
    if (
      finalizeJournal
      && finalizeJournal.phase !== 'committed'
      && finalizeJournal.revision === upload.descriptor.revision
    ) {
      throw new MailboxStoreError(
        'finalize-conflict',
        'Result upload is fenced by an in-progress finalize journal',
      );
    }
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
    const chunkPath = path.join(fileRoot, `${chunk.chunkIndex}.chunk`);
    if (await exists(chunkPath)) {
      if (sha256(await readFile(chunkPath)) !== chunk.chunkSha256) {
        throw new MailboxStoreError(
          'chunk-conflict',
          `Chunk ${chunk.chunkIndex} bytes conflict with the staged file`,
        );
      }
    } else {
      await this.commitBytes(chunkPath, bytes, lease, 'put:chunk');
    }
    const updated: StagedFileMeta = {
      filePath: chunk.filePath,
      chunkCount: chunk.chunkCount,
      chunks: [
        ...(existingMeta?.chunks ?? []),
        { index: chunk.chunkIndex, sha256: chunk.chunkSha256, byteLength: bytes.byteLength },
      ].sort((left, right) => left.index - right.index),
    };
    await this.commitJson(metaPath, updated, lease, 'put:metadata');
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
    return this.mutate(requestId, (lease) => this.finalizeResultUnsafe(requestId, input, lease));
  }

  private async finalizeResultUnsafe(
    requestId: string,
    input: ReviewResultManifest,
    lease: LeaseContext,
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
    if (manifest.payloadSha256 !== manifestSha256) {
      throw new MailboxStoreError(
        'finalize-invalid',
        'result-hash-mismatch: Result manifest payload hash is invalid',
      );
    }

    let existingIndex = await this.readResultIndex(requestId);
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
    const expectedResultFilesSha256 = computeResultFilesSha256(files);
    let journal = await this.readFinalizeJournal(requestId);
    if (journal && journal.manifestSha256 !== manifestSha256) {
      if (journal.phase === 'committed' && (existingIndex?.current ?? 0) >= journal.revision) {
        journal = null;
      } else {
        throw new MailboxStoreError(
          'finalize-conflict',
          'A different exact manifest is already being finalized',
        );
      }
    }
    if (journal && (
      journal.revision !== upload.descriptor.revision
      || journal.revisionOf !== upload.descriptor.revisionOf
      || journal.resultFilesSha256 !== expectedResultFilesSha256
    )) {
      throw new MailboxStoreError('finalize-conflict', 'Finalize journal does not match the open upload');
    }
    if (!journal) {
      journal = {
        schemaVersion: FINALIZE_JOURNAL_SCHEMA,
        revision: upload.descriptor.revision,
        revisionOf: upload.descriptor.revisionOf,
        manifestSha256,
        resultFilesSha256: expectedResultFilesSha256,
        manifest,
        phase: 'prepared',
        updatedAt: this.now().toISOString(),
      };
      await this.writeFinalizeJournal(requestId, journal, lease, 'finalize:journal-prepared');
    }

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
        currentRepositoryFullName: request.repository.fullName,
        requestRepositoryFullName: request.repository.fullName,
        transport: 'mcp-mailbox',
        now: this.now,
        assertDurableLease: () => this.assertLease(lease),
        onAfterDurableOp: async (event) => {
          try {
            await this.onAfterDurableOp(event);
          } catch (error) {
            throw new DurableOpHookError(error);
          }
        },
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

    const resultFilesSha256 = outcome.resultFilesSha256;
    if (resultFilesSha256 !== expectedResultFilesSha256) {
      throw new MailboxStoreError(
        'finalize-invalid',
        'Installed provenance result files SHA does not match the staged payload',
      );
    }
    journal = await this.advanceFinalizeJournal(
      requestId,
      journal,
      'revision-installed',
      lease,
      'finalize:journal-revision-installed',
    );

    await mkdir(revisionRoot, { recursive: true });
    const revisionManifestPath = path.join(revisionRoot, 'manifest.json');
    if (await exists(revisionManifestPath)) {
      const stored = ReviewResultManifestSchema.parse(await readJson(revisionManifestPath));
      if (computePayloadSha256(stored) !== manifestSha256) {
        throw new MailboxStoreError(
          'finalize-conflict',
          `Immutable revision ${upload.descriptor.revision} has a different manifest`,
        );
      }
    } else {
      await this.commitJson(
        revisionManifestPath,
        manifest,
        lease,
        'finalize:revision-manifest',
      );
    }
    journal = await this.advanceFinalizeJournal(
      requestId,
      journal,
      'manifest-written',
      lease,
      'finalize:journal-manifest-written',
    );

    existingIndex = await this.readResultIndex(requestId);
    const existingRevision = existingIndex?.revisions.find(
      (entry) => entry.revision === upload.descriptor.revision,
    );
    if (existingRevision) {
      if (
        existingRevision.manifestSha256 !== manifestSha256
        || existingRevision.resultFilesSha256 !== resultFilesSha256
        || existingRevision.revisionOf !== upload.descriptor.revisionOf
      ) {
        throw new MailboxStoreError('finalize-conflict', 'Result index revision conflicts with the journal');
      }
    } else {
      const priorCurrent = existingIndex?.current ?? 0;
      if (priorCurrent !== upload.descriptor.revision - 1) {
        throw new MailboxStoreError(
          'revision-mismatch',
          `Result revision gap: current=${priorCurrent}, incoming=${upload.descriptor.revision}`,
        );
      }
      const nextIndex: ResultIndex = {
        current: upload.descriptor.revision,
        revisions: [
          ...(existingIndex?.revisions ?? []),
          {
            revision: upload.descriptor.revision,
            manifestSha256,
            resultFilesSha256,
            finalizedAt: this.now().toISOString(),
            revisionOf: upload.descriptor.revisionOf,
          },
        ],
      };
      await this.commitJson(
        path.join(this.resultDir(requestId), 'result.json'),
        nextIndex,
        lease,
        'finalize:result-index',
      );
      existingIndex = nextIndex;
    }
    journal = await this.advanceFinalizeJournal(
      requestId,
      journal,
      'index-written',
      lease,
      'finalize:journal-index-written',
    );

    if (!isRevision) {
      if (!canTransition('result-uploading', 'result-ready')) {
        throw new MailboxStoreError('lifecycle-violation', 'result-uploading cannot transition to result-ready');
      }
      await this.writeStatus(requestId, 'result-ready', null, lease);
    }
    journal = await this.advanceFinalizeJournal(
      requestId,
      journal,
      'committed',
      lease,
      'finalize:journal-committed',
    );
    await this.removePath(upload.path, lease, 'finalize:upload-removed');
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
    return this.mutate(requestId, (lease) => this.acknowledgeImportUnsafe(requestId, receipt, lease));
  }

  private async acknowledgeImportUnsafe(
    requestId: string,
    receipt: MailboxImportReceipt,
    lease: LeaseContext,
  ): Promise<void> {
    const status = await this.requireActiveStatus(requestId);
    const request = await this.requireRequest(requestId);
    if (receipt.requestId !== requestId) {
      throw new MailboxStoreError(
        'receipt-mismatch',
        'Import receipt requestId does not match the mailbox request',
      );
    }
    if (
      receipt.repositoryFullName !== undefined
      && receipt.repositoryFullName !== request.repository.fullName
    ) {
      throw new MailboxStoreError(
        'receipt-mismatch',
        'Import receipt repository does not match the mailbox request repository',
      );
    }

    const importedPath = path.join(this.requestDir(requestId), 'imported.json');
    if (await exists(importedPath)) {
      const existing = parseImportReceipt(await readJson(importedPath));
      if (
        existing.requestId === receipt.requestId
        && existing.resultFilesSha256 === receipt.resultFilesSha256
      ) {
        if (status.state !== 'imported') {
          await this.writeStatus(requestId, 'imported', null, lease);
        }
        return;
      }
      throw new MailboxStoreError('receipt-mismatch', 'A different import receipt is already recorded');
    }

    const index = await this.readResultIndex(requestId);
    let storedReceipt: MailboxImportReceipt = receipt;
    if (index) {
      if ((await this.findOpenUploads(requestId)).length > 0) {
        throw new MailboxStoreError(
          'lifecycle-violation',
          'Cannot acknowledge an import while a result revision upload is open',
        );
      }
      const current = this.currentRevision(index);
      if (
        receipt.verification === 'out-of-band'
        || receipt.resultFilesSha256 !== current.resultFilesSha256
        || (
          receipt.resultManifestSha256 !== undefined
          && receipt.resultManifestSha256 !== current.manifestSha256
        )
      ) {
        throw new MailboxStoreError(
          'receipt-mismatch',
          'Import receipt does not match the current result index',
        );
      }
      if (!canTransition(status.state, 'imported')) {
        throw new MailboxStoreError(
          'lifecycle-violation',
          `Invalid request lifecycle transition: ${status.state} -> imported`,
        );
      }
    } else {
      if (receipt.verification !== 'out-of-band') {
        throw new MailboxStoreError(
          'receipt-mismatch',
          'Out-of-band acknowledgement requires an explicit verification marker',
        );
      }
      const uploads = await this.findOpenUploads(requestId);
      if (uploads.length > 0) {
        throw new MailboxStoreError(
          'receipt-mismatch',
          'Out-of-band acknowledgement is not allowed while an upload is open',
        );
      }
      if (TERMINAL_STATES.has(status.state)) {
        throw new MailboxStoreError(
          'lifecycle-violation',
          `Cannot acknowledge out-of-band import from ${status.state}`,
        );
      }
      if (receipt.repositoryFullName !== request.repository.fullName) {
        throw new MailboxStoreError(
          'receipt-mismatch',
          'Out-of-band acknowledgement requires an exact repository binding',
        );
      }
      storedReceipt = { ...receipt, verification: 'out-of-band' };
    }

    await this.commitJson(importedPath, storedReceipt, lease, 'ack:receipt');
    await this.writeStatus(requestId, 'imported', null, lease);
  }

  async cancelRequest(requestId: string): Promise<void> {
    return this.mutate(requestId, (lease) => this.cancelRequestUnsafe(requestId, lease));
  }

  private async cancelRequestUnsafe(requestId: string, lease: LeaseContext): Promise<void> {
    const status = await this.getStatus(requestId);
    if (TERMINAL_STATES.has(status.state) || !canTransition(status.state, 'cancelled')) {
      throw new MailboxStoreError(
        'lifecycle-violation',
        `Cannot cancel ${requestId} from ${status.state}`,
      );
    }
    await this.writeStatus(requestId, 'cancelled', 'Cancelled by user', lease);
  }

  async reconcileRequest(requestId: string): Promise<void> {
    await this.mutate(requestId, (lease) => this.reconcileUnsafe(requestId, lease), {
      reconcile: false,
    });
  }

  async getCurrentResultFilesSha256(requestId: string): Promise<string | null> {
    assertSafeRequestId(requestId);
    const index = await this.readResultIndex(requestId);
    return index ? this.currentRevision(index).resultFilesSha256 : null;
  }

  private buildPublicationManifest(
    request: ReviewRequest,
    input: PublishPackageInput,
    createdAt: string,
  ): ReviewResultManifest {
    if (!CLIENT_PUBLICATION_ID.test(input.clientPublicationId)) {
      throw new MailboxStoreError('invalid-input', 'clientPublicationId has an invalid format');
    }
    if (typeof input.summary.title !== 'string' || input.summary.title.trim().length === 0) {
      throw new MailboxStoreError('invalid-input', 'Publication summary title is required');
    }
    if (!Array.isArray(input.files) || input.files.length === 0) {
      throw new MailboxStoreError('invalid-input', 'Publication requires at least one result file');
    }
    const seen = new Set<string>();
    const files = input.files.map((file) => {
      if (!isSafeRelativePath(file.path)) {
        throw new MailboxStoreError('unsafe-path', `Unsafe result file path: ${file.path}`);
      }
      if (seen.has(file.path)) {
        throw new MailboxStoreError('invalid-input', `Duplicate result file path: ${file.path}`);
      }
      if (typeof file.content !== 'string') {
        throw new MailboxStoreError('invalid-input', `Result file content must be UTF-8 text: ${file.path}`);
      }
      seen.add(file.path);
      const bytes = Buffer.from(file.content, 'utf8');
      return {
        path: file.path,
        mediaType: file.mediaType,
        byteLength: bytes.byteLength,
        sha256: sha256(bytes),
      };
    });
    const draft: ReviewResultManifest = {
      schemaVersion: 'vibe-pro-review-result-v1',
      requestId: request.requestId,
      requestPayloadSha256: request.payloadSha256,
      repositoryFullName: request.repository.fullName,
      reviewedBaseSha: request.git.baseSha,
      reviewedHeadSha: request.git.headSha,
      resultKind: request.kind === 'feature_design' ? 'design' : 'audit',
      proposedFolder: input.proposedFolder,
      disposition: input.disposition,
      files,
      findingsSummary: {
        p0: input.summary.p0,
        p1: input.summary.p1,
        p2: input.summary.p2,
        p3: input.summary.p3,
      },
      reviewerDeclaration: input.reviewerDeclaration ?? {
        surface: 'chatgpt-web',
        requestedMode: 'pro',
        githubConnectorUsed: true,
        limitations: [...input.summary.limitations],
      },
      createdAt,
      payloadSha256: '0'.repeat(64),
    };
    try {
      return ReviewResultManifestSchema.parse({
        ...draft,
        payloadSha256: computePayloadSha256(draft),
      });
    } catch (error) {
      throw new MailboxStoreError('invalid-input', validationMessage(error));
    }
  }

  private async readRevisionManifest(
    requestId: string,
    revision: number,
  ): Promise<ReviewResultManifest | null> {
    const manifestPath = path.join(this.resultDir(requestId), `rev${revision}`, 'manifest.json');
    if (!(await exists(manifestPath))) {
      return null;
    }
    let manifest: ReviewResultManifest;
    try {
      manifest = ReviewResultManifestSchema.parse(await readJson(manifestPath));
    } catch (error) {
      throw new MailboxStoreError(
        'invalid-input',
        `Invalid revision ${revision} manifest: ${validationMessage(error)}`,
      );
    }
    if (computePayloadSha256(manifest) !== manifest.payloadSha256) {
      throw new MailboxStoreError('invalid-input', `Revision ${revision} manifest hash is invalid`);
    }
    return manifest;
  }

  private async readPublicationIndex(requestId: string): Promise<PublicationIndex> {
    const publicationPath = path.join(this.resultDir(requestId), 'publications.json');
    if (!(await exists(publicationPath))) {
      return { schemaVersion: PUBLICATION_RECORD_SCHEMA, publications: {} };
    }
    try {
      return parsePublicationIndex(await readJson(publicationPath));
    } catch (error) {
      if (error instanceof MailboxStoreError) {
        throw error;
      }
      throw new MailboxStoreError(
        'invalid-input',
        `Invalid publication record: ${validationMessage(error)}`,
      );
    }
  }

  private async recordPublication(
    requestId: string,
    clientPublicationId: string,
    publication: StoredPublication,
    current: PublicationIndex,
    lease: LeaseContext,
  ): Promise<void> {
    await this.commitJson(
      path.join(this.resultDir(requestId), 'publications.json'),
      {
        schemaVersion: PUBLICATION_RECORD_SCHEMA,
        publications: {
          ...current.publications,
          [clientPublicationId]: publication,
        },
      } satisfies PublicationIndex,
      lease,
      'publish:publication-record',
    );
  }

  private async snapshotDirectory(directory: string): Promise<DirectorySnapshot> {
    const snapshot: DirectorySnapshot = { directories: [], files: [] };
    const visit = async (current: string, relative: string): Promise<void> => {
      const entries = (await readdir(current, { withFileTypes: true }))
        .sort((left, right) => compareStringsByCodePoint(left.name, right.name));
      for (const entry of entries) {
        const entryRelative = relative.length === 0
          ? entry.name
          : path.join(relative, entry.name);
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) {
          snapshot.directories.push(entryRelative);
          await visit(absolute, entryRelative);
        } else if (entry.isFile()) {
          snapshot.files.push({ path: entryRelative, content: await readFile(absolute) });
        } else {
          throw new MailboxStoreError(
            'invalid-input',
            `Unsupported staging entry type: ${entryRelative}`,
          );
        }
      }
    };
    await visit(directory, '');
    return snapshot;
  }

  private async restoreDirectory(
    directory: string,
    snapshot: DirectorySnapshot,
    lease: LeaseContext,
  ): Promise<void> {
    await this.removePath(directory, lease, 'publish:rollback-upload-reset');
    await mkdir(directory, { recursive: true });
    for (const relative of snapshot.directories) {
      await mkdir(path.join(directory, relative), { recursive: true });
    }
    for (const file of snapshot.files) {
      await this.commitBytes(
        path.join(directory, file.path),
        file.content,
        lease,
        'publish:rollback-upload-restore',
      );
    }
  }

  private async rollbackPublish(
    requestId: string,
    snapshot: PublishRollbackSnapshot,
    lease: LeaseContext,
  ): Promise<void> {
    let journal = await this.readFinalizeJournal(requestId);
    const mayAbortPreparedWork = journal === null
      || (snapshot.journal === null && journal.phase === 'prepared');
    if (mayAbortPreparedWork) {
      if (snapshot.uploadPath === null) {
        const upload = await this.findOpenUpload(requestId);
        if (upload) {
          await this.removePath(upload.path, lease, 'publish:rollback-upload');
        }
      } else if (snapshot.upload !== null) {
        await this.restoreDirectory(snapshot.uploadPath, snapshot.upload, lease);
      }
    }
    journal = await this.readFinalizeJournal(requestId);
    if (snapshot.journal === null && journal?.phase === 'prepared') {
      await this.removePath(
        path.join(this.resultDir(requestId), 'journal.json'),
        lease,
        'publish:rollback-journal',
      );
      journal = null;
    }
    // revision-installed and later phases are authoritative and must roll forward via reconcile.
    if (journal === null) {
      const current = await this.getStatus(requestId);
      if (current.state !== snapshot.status.state || current.detail !== snapshot.status.detail) {
        await this.writeStatus(
          requestId,
          snapshot.status.state,
          snapshot.status.detail,
          lease,
        );
      }
    }
  }

  private async ensureRequestArtifacts(request: ReviewRequest, lease: LeaseContext): Promise<void> {
    const requestDir = this.requestDir(request.requestId);
    const promptPath = path.join(requestDir, 'prompt.md');
    const invocationPath = path.join(requestDir, 'invocation.txt');
    const statusPath = path.join(requestDir, 'status.json');
    if (!(await exists(promptPath))) {
      await this.commitBytes(promptPath, request.reviewPrompt, lease, 'create:prompt');
    }
    if (!(await exists(invocationPath))) {
      await this.commitBytes(
        invocationPath,
        `@Vibe Pro Bridge review ${request.requestId}\n`,
        lease,
        'create:invocation',
      );
    }
    if (!(await exists(statusPath))) {
      await this.writeStatus(request.requestId, 'ready', null, lease);
    }
  }

  private async readFinalizeJournal(requestId: string): Promise<FinalizeJournal | null> {
    const journalPath = path.join(this.resultDir(requestId), 'journal.json');
    if (!(await exists(journalPath))) {
      return null;
    }
    return parseFinalizeJournal(await readJson(journalPath));
  }

  private async writeFinalizeJournal(
    requestId: string,
    journal: FinalizeJournal,
    lease: LeaseContext,
    step: string,
  ): Promise<void> {
    await this.commitJson(
      path.join(this.resultDir(requestId), 'journal.json'),
      journal,
      lease,
      step,
    );
  }

  private async advanceFinalizeJournal(
    requestId: string,
    journal: FinalizeJournal,
    phase: FinalizeJournal['phase'],
    lease: LeaseContext,
    step: string,
  ): Promise<FinalizeJournal> {
    const phases: FinalizeJournal['phase'][] = [
      'prepared',
      'revision-installed',
      'manifest-written',
      'index-written',
      'committed',
    ];
    if (phases.indexOf(journal.phase) >= phases.indexOf(phase)) {
      return journal;
    }
    const updated: FinalizeJournal = {
      ...journal,
      phase,
      updatedAt: this.now().toISOString(),
    };
    await this.writeFinalizeJournal(requestId, updated, lease, step);
    return updated;
  }

  private async removePath(
    targetPath: string,
    lease: LeaseContext,
    step: string,
  ): Promise<void> {
    await this.assertLease(lease);
    await rm(targetPath, { recursive: true, force: true });
    await this.afterDurableOp(step, lease.requestId, targetPath);
  }

  private async reconcileUnsafe(requestId: string, lease: LeaseContext): Promise<void> {
    const requestPath = path.join(this.requestDir(requestId), 'request.json');
    if (!(await exists(requestPath))) {
      await this.cleanupOwnedTemps(this.requestDir(requestId), lease);
      await this.cleanupOwnedTemps(this.resultDir(requestId), lease);
      return;
    }
    const statusPath = path.join(this.requestDir(requestId), 'status.json');
    if (!(await exists(statusPath))) {
      return;
    }
    let status = parseStoredStatus(await readJson(statusPath));
    const importedPath = path.join(this.requestDir(requestId), 'imported.json');
    if (await exists(importedPath)) {
      parseImportReceipt(await readJson(importedPath));
      if (status.state !== 'imported') {
        await this.writeStatus(requestId, 'imported', null, lease);
      }
      await this.cleanupOwnedTemps(this.requestDir(requestId), lease);
      await this.cleanupOwnedTemps(this.resultDir(requestId), lease);
      return;
    }

    let index = await this.readResultIndex(requestId);
    let journal = await this.readFinalizeJournal(requestId);
    const uploads = await this.findOpenUploads(requestId);
    if (journal) {
      const manifestPath = path.join(
        this.resultDir(requestId),
        `rev${journal.revision}`,
        'manifest.json',
      );
      let manifestComplete = false;
      if (await exists(manifestPath)) {
        const manifest = ReviewResultManifestSchema.parse(await readJson(manifestPath));
        if (computePayloadSha256(manifest) !== journal.manifestSha256) {
          throw new MailboxStoreError(
            'finalize-conflict',
            `Revision ${journal.revision} manifest conflicts with its finalize journal`,
          );
        }
        manifestComplete = true;
      }

      let indexed = index?.revisions.find((entry) => entry.revision === journal!.revision);
      if (indexed && (
        indexed.manifestSha256 !== journal.manifestSha256
        || indexed.resultFilesSha256 !== journal.resultFilesSha256
        || indexed.revisionOf !== journal.revisionOf
      )) {
        throw new MailboxStoreError('finalize-conflict', 'Result index conflicts with finalize journal');
      }
      if (!indexed && manifestComplete) {
        const priorCurrent = index?.current ?? 0;
        if (priorCurrent !== journal.revision - 1) {
          throw new MailboxStoreError(
            'revision-mismatch',
            `Result revision gap: current=${priorCurrent}, journal=${journal.revision}`,
          );
        }
        const nextIndex: ResultIndex = {
          current: journal.revision,
          revisions: [
            ...(index?.revisions ?? []),
            {
              revision: journal.revision,
              manifestSha256: journal.manifestSha256,
              resultFilesSha256: journal.resultFilesSha256,
              finalizedAt: journal.updatedAt,
              revisionOf: journal.revisionOf,
            },
          ],
        };
        await this.commitJson(
          path.join(this.resultDir(requestId), 'result.json'),
          nextIndex,
          lease,
          'reconcile:result-index',
        );
        index = nextIndex;
        indexed = nextIndex.revisions.at(-1);
        journal = await this.advanceFinalizeJournal(
          requestId,
          journal,
          'index-written',
          lease,
          'reconcile:journal-index-written',
        );
      }

      if (indexed) {
        if (journal.revision === 1 && status.state === 'result-uploading') {
          await this.writeStatus(requestId, 'result-ready', null, lease);
          status = parseStoredStatus(await readJson(statusPath));
        }
        const requestReady = journal.revision > 1 || status.state === 'result-ready';
        if (requestReady) {
          journal = await this.advanceFinalizeJournal(
            requestId,
            journal,
            'committed',
            lease,
            'reconcile:journal-committed',
          );
          for (const upload of uploads) {
            if (
              upload.descriptor.revision === journal.revision
              && upload.descriptor.revision <= (index?.current ?? 0)
            ) {
              await this.removePath(upload.path, lease, 'reconcile:stale-upload-removed');
            }
          }
        }
      }
    } else if (
      index
      && uploads.length === 0
      && status.state === 'result-uploading'
    ) {
      await this.writeStatus(requestId, 'result-ready', null, lease);
    }

    await this.cleanupOwnedTemps(this.requestDir(requestId), lease);
    await this.cleanupOwnedTemps(this.resultDir(requestId), lease);
  }

  private async cleanupOwnedTemps(root: string, lease: LeaseContext): Promise<void> {
    if (!(await exists(root))) {
      return;
    }
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const target = path.join(root, entry.name);
      if (OWNED_TEMP_PATTERN.test(entry.name)) {
        await this.removePath(target, lease, 'reconcile:owned-temp-removed');
      } else if (entry.isDirectory() && !/^rev[1-9][0-9]*$/.test(entry.name)) {
        await this.cleanupOwnedTemps(target, lease);
      }
    }
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
    lease: LeaseContext,
  ): Promise<void> {
    await this.commitJson(
      path.join(this.requestDir(requestId), 'status.json'),
      {
        state,
        updatedAt: this.now().toISOString(),
        detail,
      } satisfies StoredStatus,
      lease,
      `status:${state}`,
    );
  }

  private async createUpload(
    requestId: string,
    input: { revision: number; revisionOf: string | null },
    lease: LeaseContext,
  ): Promise<void> {
    const uploadRoot = path.join(this.resultDir(requestId), `staging-rev${input.revision}`);
    await mkdir(path.join(uploadRoot, 'chunks'), { recursive: true });
    await this.commitJson(
      path.join(uploadRoot, 'upload.json'),
      {
        revision: input.revision,
        revisionOf: input.revisionOf,
        openedAt: this.now().toISOString(),
      } satisfies UploadDescriptor,
      lease,
      'begin:upload',
    );
  }

  private async findOpenUpload(
    requestId: string,
  ): Promise<{ path: string; descriptor: UploadDescriptor } | null> {
    const uploads = await this.findOpenUploads(requestId);
    if (uploads.length === 0) {
      return null;
    }
    if (uploads.length > 1) {
      throw new MailboxStoreError('invalid-input', 'Multiple open mailbox result uploads were found');
    }
    return uploads[0]!;
  }

  private async findOpenUploads(
    requestId: string,
  ): Promise<Array<{ path: string; descriptor: UploadDescriptor }>> {
    const resultDir = this.resultDir(requestId);
    if (!(await exists(resultDir))) {
      return [];
    }
    const entries = (await readdir(resultDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^staging-rev[1-9][0-9]*$/.test(entry.name))
      .sort((left, right) => compareStringsByCodePoint(left.name, right.name));
    return Promise.all(entries.map(async (entry) => {
      const uploadPath = path.join(resultDir, entry.name);
      return {
        path: uploadPath,
        descriptor: parseUploadDescriptor(await readJson(path.join(uploadPath, 'upload.json'))),
      };
    }));
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
