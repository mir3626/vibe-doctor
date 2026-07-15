import path from 'node:path';
import type { ReviewRequest, ReviewResultManifest } from '../contract.js';
import {
  MailboxStore,
  type MailboxHealth,
} from '../mailbox/store.js';
import type {
  ImportReceipt,
  RequestHandle,
  RequestStatus,
  VibeProBridgeTransport,
} from './types.js';

export interface McpMailboxTransportOptions {
  repoRoot: string;
  bridgeRoot?: string;
  now?: () => Date;
}

export class McpMailboxTransport implements VibeProBridgeTransport {
  readonly store: MailboxStore;

  constructor(options: McpMailboxTransportOptions) {
    this.store = new MailboxStore(options);
  }

  async createRequest(request: ReviewRequest): Promise<RequestHandle> {
    const created = await this.store.createRequest(request);
    const requestDir = path.join(this.store.requestsRoot, created.requestId);
    return {
      requestId: created.requestId,
      transport: 'mcp-mailbox',
      createdAt: (await this.store.getRequest(created.requestId))?.createdAt ?? request.createdAt,
      requestDir,
      requestPath: path.join(requestDir, 'request.json'),
      promptPath: path.join(requestDir, 'prompt.md'),
    };
  }

  getRequestStatus(requestId: string): Promise<RequestStatus> {
    return this.store.getStatus(requestId);
  }

  getResultManifest(requestId: string): Promise<ReviewResultManifest | null> {
    return this.store.getResultManifest(requestId);
  }

  getResultFile(requestId: string, filePath: string): Promise<Uint8Array> {
    // CLI and MCP share one process/filesystem, so loopback HTTP would add no trust boundary.
    return this.store.getResultFile(requestId, filePath);
  }

  acknowledgeImport(requestId: string, receipt: ImportReceipt): Promise<void> {
    return this.store.acknowledgeImport(requestId, receipt);
  }

  listRequests(): Promise<RequestStatus[]> {
    return this.store.listRequests();
  }

  cancelRequest(requestId: string): Promise<void> {
    return this.store.cancelRequest(requestId);
  }

  readRequest(requestId: string): Promise<ReviewRequest | null> {
    return this.store.getRequest(requestId);
  }

  inspectMailboxHealth(): Promise<MailboxHealth> {
    return this.store.inspectMailboxHealth();
  }

  getCurrentResultFilesSha256(requestId: string): Promise<string | null> {
    return this.store.getCurrentResultFilesSha256(requestId);
  }

  async listResultReady(): Promise<RequestStatus[]> {
    return (await this.store.listRequests()).filter((status) => status.state === 'result-ready');
  }
}
