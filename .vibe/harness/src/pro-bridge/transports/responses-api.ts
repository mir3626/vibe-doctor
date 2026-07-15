import { createHash } from 'node:crypto';
import type { ProBridgeApiConfig } from '../../lib/config.js';
import {
  compareStringsByCodePoint,
  computePayloadSha256,
  type ReviewDisposition,
  type ReviewRequest,
  type ReviewResultManifest,
} from '../contract.js';
import { parseVibeBundle, type VibeBundle } from '../vibe-bundle.js';
import { McpMailboxTransport } from './mcp-mailbox.js';
import type {
  ImportReceipt,
  RequestHandle,
  RequestStatus,
  VibeProBridgeTransport,
} from './types.js';

export interface ResponsesApiFetchPort {
  fetch: typeof fetch;
}

export interface ResponsesApiTransportOptions {
  repoRoot: string;
  bridgeRoot?: string;
  now?: () => Date;
  apiKey: string;
  api: ProBridgeApiConfig;
  baseUrl?: string;
  ports?: {
    fetch?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
  };
}

export const ESTIMATED_OUTPUT_TOKENS = 30_000;

export class ResponsesApiExecutionError extends Error {
  constructor(message: string, readonly attempts: number) {
    super(message);
    this.name = 'ResponsesApiExecutionError';
  }
}

class ApiRequestError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

function reviewPrompt(request: ReviewRequest): string {
  return [
    request.reviewPrompt,
    '',
    'Return exactly one VIBE-BUNDLE v1 block.',
    `Echo requestId: ${request.requestId}.`,
    `Include every required file: ${request.outputContract.requiredFiles.join(', ')}.`,
  ].join('\n');
}

export function estimateReviewCost(
  request: ReviewRequest,
  api: ProBridgeApiConfig,
): {
  inputTokens: number;
  outputTokens: number;
  usd: number;
  exceedsLimit: boolean;
} {
  const inputTokens = Math.ceil(Buffer.byteLength(reviewPrompt(request), 'utf8') / 4);
  const outputTokens = ESTIMATED_OUTPUT_TOKENS;
  return {
    inputTokens,
    outputTokens,
    usd: (
      inputTokens * api.priceInputPerMTok
      + outputTokens * api.priceOutputPerMTok
    ) / 1_000_000,
    exceedsLimit: inputTokens > api.maxInputTokens,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function responseStatus(value: unknown): string | null {
  const status = record(value)?.status;
  return typeof status === 'string' ? status : null;
}

function responseId(value: unknown): string | null {
  const id = record(value)?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function outputText(value: unknown): string | null {
  const direct = record(value)?.output_text;
  if (typeof direct === 'string' && direct.length > 0) {
    return direct;
  }
  const output = record(value)?.output;
  if (!Array.isArray(output)) {
    return null;
  }
  const text = output.flatMap((item) => {
    const content = record(item)?.content;
    if (!Array.isArray(content)) {
      return [];
    }
    return content.flatMap((entry) => {
      const itemRecord = record(entry);
      return itemRecord?.type === 'output_text' && typeof itemRecord.text === 'string'
        ? [itemRecord.text]
        : [];
    });
  }).join('');
  return text.length > 0 ? text : null;
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function findingsMetadata(files: VibeBundle['files']): {
  disposition: ReviewDisposition;
  summary: { p0: number; p1: number; p2: number; p3: number };
} {
  const fallback = {
    disposition: 'approved-with-remediation' as const,
    summary: { p0: 0, p1: 0, p2: 0, p3: 0 },
  };
  const content = files.find((file) => file.path === 'FINDINGS.json')?.content;
  if (content === undefined) {
    return fallback;
  }
  try {
    const parsed = record(JSON.parse(content));
    const validDispositions = new Set<ReviewDisposition>([
      'approved',
      'approved-with-remediation',
      'remediation-required',
      'blocked',
    ]);
    const rawDisposition = parsed?.disposition;
    const disposition = typeof rawDisposition === 'string'
      && validDispositions.has(rawDisposition as ReviewDisposition)
      ? rawDisposition as ReviewDisposition
      : fallback.disposition;
    const summary = { p0: 0, p1: 0, p2: 0, p3: 0 };
    const p0Findings = parsed?.P0;
    const p1Findings = parsed?.P1;
    const p2Findings = parsed?.P2;
    const p3Findings = parsed?.P3;
    const hasV1Findings = [p0Findings, p1Findings, p2Findings, p3Findings].some(
      Array.isArray,
    );
    if (Array.isArray(p0Findings)) summary.p0 = p0Findings.length;
    if (Array.isArray(p1Findings)) summary.p1 = p1Findings.length;
    if (Array.isArray(p2Findings)) summary.p2 = p2Findings.length;
    if (Array.isArray(p3Findings)) summary.p3 = p3Findings.length;
    const findings = parsed?.findings;
    if (!hasV1Findings && Array.isArray(findings)) {
      for (const finding of findings) {
        const priority = record(finding)?.priority;
        if (priority === 'P0') summary.p0 += 1;
        if (priority === 'P1') summary.p1 += 1;
        if (priority === 'P2') summary.p2 += 1;
        if (priority === 'P3') summary.p3 += 1;
      }
    }
    return { disposition, summary };
  } catch {
    return fallback;
  }
}

export class ResponsesApiTransport implements VibeProBridgeTransport {
  private readonly mailbox: McpMailboxTransport;
  private readonly apiKey: string;
  private readonly api: ProBridgeApiConfig;
  private readonly baseUrl: string;
  private readonly fetchPort: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(options: ResponsesApiTransportOptions) {
    if (options.apiKey.length === 0) {
      throw new Error('Responses API key must not be empty');
    }
    this.now = options.now ?? (() => new Date());
    this.mailbox = new McpMailboxTransport({
      repoRoot: options.repoRoot,
      ...(options.bridgeRoot === undefined ? {} : { bridgeRoot: options.bridgeRoot }),
      now: this.now,
    });
    this.apiKey = options.apiKey;
    this.api = options.api;
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com').replace(/\/$/, '');
    this.fetchPort = options.ports?.fetch ?? fetch;
    this.sleep = options.ports?.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async createRequest(request: ReviewRequest): Promise<RequestHandle> {
    const handle = await this.mailbox.createRequest(request);
    return { ...handle, transport: 'responses-api' };
  }

  getRequestStatus(requestId: string): Promise<RequestStatus> {
    return this.mailbox.getRequestStatus(requestId);
  }

  getResultManifest(requestId: string): Promise<ReviewResultManifest | null> {
    return this.mailbox.getResultManifest(requestId);
  }

  getResultFile(requestId: string, filePath: string): Promise<Uint8Array> {
    return this.mailbox.getResultFile(requestId, filePath);
  }

  acknowledgeImport(requestId: string, receipt: ImportReceipt): Promise<void> {
    return this.mailbox.acknowledgeImport(requestId, receipt);
  }

  listRequests(): Promise<RequestStatus[]> {
    return this.mailbox.listRequests();
  }

  cancelRequest(requestId: string): Promise<void> {
    return this.mailbox.cancelRequest(requestId);
  }

  readRequest(requestId: string): Promise<ReviewRequest | null> {
    return this.mailbox.readRequest(requestId);
  }

  listResultReady(): Promise<RequestStatus[]> {
    return this.mailbox.listResultReady();
  }

  async execute(requestId: string): Promise<{ resultReady: boolean; attempts: number }> {
    const status = await this.mailbox.getRequestStatus(requestId);
    if (status.state !== 'ready') {
      throw new ResponsesApiExecutionError(`request already ${status.state}`, 0);
    }
    const request = await this.mailbox.readRequest(requestId);
    if (request === null) {
      throw new ResponsesApiExecutionError(`Mailbox request not found: ${requestId}`, 0);
    }
    await this.mailbox.store.claimRequest(requestId);
    await this.mailbox.store.beginResult(requestId);

    let attempts = 0;
    while (attempts < 2) {
      attempts += 1;
      try {
        const response = await this.submitAndPoll(reviewPrompt(request));
        const text = outputText(response);
        if (text === null) {
          throw new ApiRequestError('Responses API completed without output text', false);
        }
        const parsed = parseVibeBundle(text);
        if (!parsed.ok) {
          throw new ApiRequestError(`Vibe bundle parse failed: ${parsed.error.message}`, false);
        }
        if (parsed.bundle.requestId !== requestId) {
          throw new ApiRequestError(
            `Vibe bundle requestId ${parsed.bundle.requestId} does not match ${requestId}`,
            false,
          );
        }
        await this.uploadBundle(request, parsed.bundle);
        return { resultReady: true, attempts };
      } catch (error) {
        const failure = error instanceof ApiRequestError
          ? error
          : new ApiRequestError(error instanceof Error ? error.message : String(error), false);
        if (failure.retryable && attempts < 2) {
          continue;
        }
        throw new ResponsesApiExecutionError(failure.message, attempts);
      }
    }
    throw new ResponsesApiExecutionError('Responses API retry limit reached', attempts);
  }

  private async submitAndPoll(prompt: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchPort(`${this.baseUrl}/v1/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.api.model,
          background: true,
          reasoning: { effort: this.api.effort },
          input: prompt,
        }),
      });
    } catch (error) {
      throw new ApiRequestError(
        `Responses API network error: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }
    if (!response.ok) {
      throw new ApiRequestError(
        `Responses API POST failed with HTTP ${response.status}`,
        response.status >= 500,
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new ApiRequestError(
        `Responses API returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        false,
      );
    }
    const id = responseId(payload);
    if (id === null) {
      throw new ApiRequestError('Responses API response id is missing', false);
    }
    while (responseStatus(payload) === 'queued' || responseStatus(payload) === 'in_progress') {
      await this.sleep(this.api.pollIntervalMs);
      let poll: Response;
      try {
        poll = await this.fetchPort(`${this.baseUrl}/v1/responses/${encodeURIComponent(id)}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${this.apiKey}` },
        });
      } catch (error) {
        throw new ApiRequestError(
          `Responses API poll network error: ${error instanceof Error ? error.message : String(error)}`,
          true,
        );
      }
      if (!poll.ok) {
        throw new ApiRequestError(
          `Responses API poll failed with HTTP ${poll.status}`,
          poll.status >= 500,
        );
      }
      try {
        payload = await poll.json();
      } catch (error) {
        throw new ApiRequestError(
          `Responses API poll returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
          false,
        );
      }
    }
    const status = responseStatus(payload);
    if (status === 'failed') {
      throw new ApiRequestError('Responses API reached terminal failed status', true);
    }
    if (status !== 'completed') {
      throw new ApiRequestError(`Unexpected Responses API status: ${status ?? 'missing'}`, false);
    }
    return payload;
  }

  private async uploadBundle(request: ReviewRequest, bundle: VibeBundle): Promise<void> {
    const files = [...bundle.files].sort((left, right) =>
      compareStringsByCodePoint(left.path, right.path),
    );
    const metadata = findingsMetadata(files);
    const manifestDraft: ReviewResultManifest = {
      schemaVersion: 'vibe-pro-review-result-v1',
      requestId: request.requestId,
      requestPayloadSha256: request.payloadSha256,
      repositoryFullName: request.repository.fullName,
      reviewedBaseSha: request.git.baseSha,
      reviewedHeadSha: request.git.headSha,
      resultKind: request.kind === 'goal_audit' ? 'audit' : 'design',
      proposedFolder: bundle.folder,
      disposition: metadata.disposition,
      files: files.map((file) => {
        const bytes = Buffer.from(file.content, 'utf8');
        return {
          path: file.path,
          mediaType: file.path.endsWith('.json') ? 'application/json' : 'text/markdown',
          byteLength: bytes.byteLength,
          sha256: sha256(bytes),
        };
      }),
      findingsSummary: metadata.summary,
      reviewerDeclaration: {
        surface: 'responses-api',
        requestedMode: 'frontier',
        githubConnectorUsed: false,
        limitations: ['no live GitHub grounding; prompt and attached patch only'],
      },
      createdAt: this.now().toISOString(),
      payloadSha256: '0'.repeat(64),
    };
    const manifest: ReviewResultManifest = {
      ...manifestDraft,
      // Local provenance is authoritative; model claims never determine the API review surface.
      payloadSha256: computePayloadSha256(manifestDraft),
    };
    for (const file of files) {
      await this.mailbox.store.putResultFile(request.requestId, {
        filePath: file.path,
        chunkIndex: 0,
        chunkCount: 1,
        content: file.content,
        chunkSha256: sha256(file.content),
      });
    }
    await this.mailbox.store.finalizeResult(request.requestId, manifest);
  }
}
