import {
  execFile as defaultExecFile,
  spawn as defaultSpawn,
  type ChildProcess,
} from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  access,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  ReviewRequestSchema,
  canTransition,
  compareStringsByCodePoint,
  type RequestLifecycleState,
  type ReviewRequest,
  type ReviewResultManifest,
} from '../contract.js';
import type {
  ImportReceipt,
  RequestHandle,
  RequestStatus,
  VibeProBridgeTransport,
} from './types.js';

const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const TERMINAL_STATES = new Set<RequestLifecycleState>([
  'imported',
  'cancelled',
  'expired',
  'failed',
]);
const CHATGPT_URL = 'https://chatgpt.com/';

interface StoredStatus {
  state: RequestLifecycleState;
  updatedAt: string;
  detail: string | null;
}

export interface ManualTransportOptions {
  repoRoot: string;
  bridgeRoot?: string;
  now?: () => Date;
}

export class ManualTransportUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManualTransportUnsupportedError';
  }
}

function assertSafeRequestId(requestId: string): void {
  if (!SAFE_REQUEST_ID.test(requestId)) {
    throw new Error(`Unsafe Pro Bridge request id: ${requestId}`);
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
    // Windows and network filesystems may not support fsync consistently.
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${randomBytes(16).toString('hex')}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await bestEffortFsync(temporaryPath);
  await rename(temporaryPath, filePath);
}

export interface ManualPatchArtifact {
  diffText: string;
  sha256: string;
  byteLength: number;
}

export interface ManualRangeDiffArtifact extends ManualPatchArtifact {
  statText: string;
  statSha256: string;
  statByteLength: number;
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
}

function parseStoredStatus(value: unknown): StoredStatus {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid manual transport status');
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.state !== 'string'
    || typeof record.updatedAt !== 'string'
    || (record.detail !== null && typeof record.detail !== 'string')
  ) {
    throw new Error('Invalid manual transport status');
  }
  return {
    state: record.state as RequestLifecycleState,
    updatedAt: record.updatedAt,
    detail: record.detail,
  };
}

export class ManualDirectoryTransport implements VibeProBridgeTransport {
  readonly bridgeRoot: string;
  readonly outboxRoot: string;
  private readonly now: () => Date;

  constructor(options: ManualTransportOptions) {
    this.bridgeRoot = path.resolve(
      options.bridgeRoot ?? path.join(options.repoRoot, '.vibe', 'pro-bridge'),
    );
    this.outboxRoot = path.join(this.bridgeRoot, 'outbox');
    this.now = options.now ?? (() => new Date());
  }

  async createRequest(input: ReviewRequest): Promise<RequestHandle> {
    const request = ReviewRequestSchema.parse(input);
    assertSafeRequestId(request.requestId);
    const requestDir = this.requestDir(request.requestId);
    if (await exists(requestDir)) {
      throw new Error(`Pro Bridge request already exists: ${request.requestId}`);
    }

    await mkdir(this.outboxRoot, { recursive: true });
    await mkdir(requestDir, { recursive: false });
    const requestPath = path.join(requestDir, 'request.json');
    const promptPath = path.join(requestDir, 'prompt.md');
    const statusPath = path.join(requestDir, 'status.json');
    await writeJson(requestPath, request);
    await writeFile(promptPath, request.reviewPrompt, 'utf8');
    await bestEffortFsync(promptPath);
    await writeJson(statusPath, {
      state: 'ready',
      updatedAt: this.now().toISOString(),
      detail: null,
    } satisfies StoredStatus);

    return {
      requestId: request.requestId,
      transport: 'manual',
      createdAt: request.createdAt,
      requestDir,
      requestPath,
      promptPath,
    };
  }

  async writePatchArtifact(requestId: string, patch: ManualPatchArtifact): Promise<string> {
    await this.requireRequest(requestId);
    const bytes = Buffer.from(patch.diffText, 'utf8');
    if (bytes.byteLength !== patch.byteLength) {
      throw new Error(`Patch byte length mismatch for ${requestId}`);
    }
    if (createHash('sha256').update(bytes).digest('hex') !== patch.sha256) {
      throw new Error(`Patch SHA-256 mismatch for ${requestId}`);
    }
    const patchPath = path.join(this.requestDir(requestId), 'patch.diff');
    const temporaryPath = `${patchPath}.${process.pid}.${randomBytes(16).toString('hex')}.tmp`;
    await writeFile(temporaryPath, bytes);
    await bestEffortFsync(temporaryPath);
    await rename(temporaryPath, patchPath);
    return patchPath;
  }

  async writeRangeDiffArtifacts(
    requestId: string,
    rangeDiff: ManualRangeDiffArtifact,
  ): Promise<{ rangePath: string; statPath: string }> {
    await this.requireRequest(requestId);
    const rangeBytes = Buffer.from(rangeDiff.diffText, 'utf8');
    const statBytes = Buffer.from(rangeDiff.statText, 'utf8');
    if (rangeBytes.byteLength !== rangeDiff.byteLength) {
      throw new Error(`Range diff byte length mismatch for ${requestId}`);
    }
    if (createHash('sha256').update(rangeBytes).digest('hex') !== rangeDiff.sha256) {
      throw new Error(`Range diff SHA-256 mismatch for ${requestId}`);
    }
    if (statBytes.byteLength !== rangeDiff.statByteLength) {
      throw new Error(`Range stat byte length mismatch for ${requestId}`);
    }
    if (createHash('sha256').update(statBytes).digest('hex') !== rangeDiff.statSha256) {
      throw new Error(`Range stat SHA-256 mismatch for ${requestId}`);
    }

    const requestDir = this.requestDir(requestId);
    const rangePath = path.join(requestDir, 'range.diff');
    const statPath = path.join(requestDir, 'range-stat.txt');
    for (const [targetPath, bytes] of [
      [rangePath, rangeBytes],
      [statPath, statBytes],
    ] as const) {
      const temporaryPath = `${targetPath}.${process.pid}.${randomBytes(16).toString('hex')}.tmp`;
      await writeFile(temporaryPath, bytes);
      await bestEffortFsync(temporaryPath);
      await rename(temporaryPath, targetPath);
    }
    return { rangePath, statPath };
  }

  async getRequestStatus(requestId: string): Promise<RequestStatus> {
    const request = await this.requireRequest(requestId);
    const requestDir = this.requestDir(requestId);
    const status = parseStoredStatus(await readJson(path.join(requestDir, 'status.json')));
    let state = status.state;
    let updatedAt = status.updatedAt;

    if (await exists(path.join(requestDir, 'imported.json'))) {
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

  async getResultManifest(_requestId: string): Promise<ReviewResultManifest | null> {
    // The Phase 1 manual wire returns a clipboard/file vibe-bundle, not a remote manifest.
    return null;
  }

  async getResultFile(_requestId: string, _path: string): Promise<Uint8Array> {
    throw new ManualTransportUnsupportedError(
      'Manual transport delivers results via a clipboard or file vibe-bundle.',
    );
  }

  async acknowledgeImport(requestId: string, receipt: ImportReceipt): Promise<void> {
    await this.requireRequest(requestId);
    if (receipt.requestId !== requestId) {
      throw new Error(`Import receipt request id mismatch: ${receipt.requestId}`);
    }
    const requestDir = this.requestDir(requestId);
    await writeJson(path.join(requestDir, 'imported.json'), receipt);
    // Manual import has no remote claimed/result-ready events, so the receipt closes it directly.
    await this.writeStatus(requestId, 'imported', null);
  }

  async listRequests(): Promise<RequestStatus[]> {
    if (!(await exists(this.outboxRoot))) {
      return [];
    }
    const entries = await readdir(this.outboxRoot, { withFileTypes: true });
    const statuses: RequestStatus[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !SAFE_REQUEST_ID.test(entry.name)) {
        continue;
      }
      try {
        statuses.push(await this.getRequestStatus(entry.name));
      } catch {
        // A partial/corrupt mailbox entry is not presented as a valid request.
      }
    }
    return statuses.sort((left, right) => {
      const byCreatedAt = compareStringsByCodePoint(right.createdAt, left.createdAt);
      return byCreatedAt !== 0
        ? byCreatedAt
        : compareStringsByCodePoint(left.requestId, right.requestId);
    });
  }

  async cancelRequest(requestId: string): Promise<void> {
    const current = await this.getRequestStatus(requestId);
    if (TERMINAL_STATES.has(current.state)) {
      throw new Error(`Cannot cancel ${requestId} from terminal state ${current.state}`);
    }
    if (!canTransition(current.state, 'cancelled')) {
      throw new Error(`Invalid request lifecycle transition: ${current.state} -> cancelled`);
    }
    await this.writeStatus(requestId, 'cancelled', 'Cancelled by user');
  }

  async readRequest(requestId: string): Promise<ReviewRequest | null> {
    assertSafeRequestId(requestId);
    const requestPath = path.join(this.requestDir(requestId), 'request.json');
    if (!(await exists(requestPath))) {
      return null;
    }
    return ReviewRequestSchema.parse(await readJson(requestPath));
  }

  private requestDir(requestId: string): string {
    assertSafeRequestId(requestId);
    return path.join(this.outboxRoot, requestId);
  }

  private async requireRequest(requestId: string): Promise<ReviewRequest> {
    const request = await this.readRequest(requestId);
    if (!request) {
      throw new Error(`Pro Bridge request not found: ${requestId}`);
    }
    return request;
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
}

export interface HostExecPorts {
  execFile?: typeof defaultExecFile;
  spawn?: typeof defaultSpawn;
  platform?: NodeJS.Platform;
}

interface ExecResult {
  ok: boolean;
  stdout: string;
  error: string | null;
}

function execute(
  command: string,
  args: string[],
  ports: HostExecPorts,
  input?: string,
): Promise<ExecResult> {
  const execFile = ports.execFile ?? defaultExecFile;
  return new Promise((resolve) => {
    const child = execFile(
      command,
      args,
      { encoding: 'utf8', windowsHide: true },
      (error, stdout, stderr) => {
        resolve({
          ok: error === null,
          stdout: String(stdout ?? ''),
          error: error ? String(stderr || error.message) : null,
        });
      },
    );
    if (input !== undefined) {
      child.stdin?.end(input);
    }
  });
}

export async function copyFileToClipboard(
  filePath: string,
  ports: HostExecPorts = {},
): Promise<{ ok: boolean; method: string | null; error: string | null }> {
  const platform = ports.platform ?? process.platform;
  if (platform === 'win32') {
    const literalPath = `'${filePath.replaceAll("'", "''")}'`;
    const result = await execute(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-Content -Raw -Encoding utf8 -LiteralPath ${literalPath} | Set-Clipboard`,
      ],
      ports,
    );
    return { ok: result.ok, method: result.ok ? 'powershell' : null, error: result.error };
  }

  const content = await readFile(filePath, 'utf8');
  const candidates = platform === 'darwin'
    ? [{ command: 'pbcopy', args: [] as string[], method: 'pbcopy' }]
    : [
        { command: 'xclip', args: ['-selection', 'clipboard'], method: 'xclip' },
        { command: 'wl-copy', args: [], method: 'wl-copy' },
      ];
  let lastError: string | null = null;
  for (const candidate of candidates) {
    const result = await execute(candidate.command, candidate.args, ports, content);
    if (result.ok) {
      return { ok: true, method: candidate.method, error: null };
    }
    lastError = result.error;
  }
  return { ok: false, method: null, error: lastError ?? 'No clipboard command succeeded' };
}

export async function readClipboardText(
  ports: HostExecPorts = {},
): Promise<{ ok: boolean; text: string | null; error: string | null }> {
  const platform = ports.platform ?? process.platform;
  const candidates = platform === 'win32'
    ? [{ command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', 'Get-Clipboard -Raw'] }]
    : platform === 'darwin'
      ? [{ command: 'pbpaste', args: [] as string[] }]
      : [
          { command: 'xclip', args: ['-selection', 'clipboard', '-o'] },
          { command: 'wl-paste', args: [] },
        ];
  let lastError: string | null = null;
  for (const candidate of candidates) {
    const result = await execute(candidate.command, candidate.args, ports);
    if (result.ok) {
      return { ok: true, text: result.stdout, error: null };
    }
    lastError = result.error;
  }
  return { ok: false, text: null, error: lastError ?? 'No clipboard command succeeded' };
}

function browserTarget(url: string): string {
  return Buffer.byteLength(url, 'utf8') > 2048 && url.startsWith(CHATGPT_URL)
    ? CHATGPT_URL
    : url;
}

export async function openInBrowser(
  url: string,
  ports: HostExecPorts = {},
): Promise<{ ok: boolean; error: string | null }> {
  const platform = ports.platform ?? process.platform;
  const target = browserTarget(url);
  const command = platform === 'win32' ? 'cmd.exe' : platform === 'darwin' ? 'open' : 'xdg-open';
  const args = platform === 'win32' ? ['/d', '/c', 'start', '', target] : [target];
  const spawn = ports.spawn ?? defaultSpawn;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { ok: boolean; error: string | null }): void => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        shell: false,
      });
    } catch (error) {
      finish({ ok: false, error: error instanceof Error ? error.message : String(error) });
      return;
    }
    child.once('error', (error) => finish({ ok: false, error: error.message }));
    child.once('spawn', () => finish({ ok: true, error: null }));
    child.unref();
  });
}
