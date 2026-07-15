import { spawn } from 'node:child_process';
import type { ReviewRequest, ReviewResultManifest } from '../contract.js';
import { McpMailboxTransport } from './mcp-mailbox.js';
import type {
  ImportReceipt,
  RequestHandle,
  RequestStatus,
  VibeProBridgeTransport,
} from './types.js';

export interface WorkspaceAgentTriggerPort {
  run(argv: string[]): Promise<{
    ok: boolean;
    code: number | null;
    stdout: string;
    stderr: string;
  }>;
}

export interface WorkspaceAgentTransportOptions {
  repoRoot: string;
  bridgeRoot?: string;
  now?: () => Date;
  triggerCommand: string[];
  trigger?: WorkspaceAgentTriggerPort;
}

function createTriggerPort(repoRoot: string): WorkspaceAgentTriggerPort {
  return {
    run(argv) {
      return new Promise((resolve, reject) => {
        const command = argv[0];
        if (command === undefined) {
          reject(new Error('Workspace agent trigger command is empty'));
          return;
        }
        const child = spawn(command, argv.slice(1), {
          cwd: repoRoot,
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => { stdout += chunk; });
        child.stderr.on('data', (chunk: string) => { stderr += chunk; });
        child.once('error', reject);
        child.once('close', (code) => resolve({
          ok: code === 0,
          code,
          stdout,
          stderr,
        }));
      });
    },
  };
}

export class WorkspaceAgentTransport implements VibeProBridgeTransport {
  private readonly mailbox: McpMailboxTransport;
  private readonly triggerCommand: string[];
  private readonly triggerPort: WorkspaceAgentTriggerPort;

  constructor(options: WorkspaceAgentTransportOptions) {
    if (options.triggerCommand.length === 0) {
      throw new Error('Workspace agent triggerCommand must not be empty');
    }
    this.mailbox = new McpMailboxTransport({
      repoRoot: options.repoRoot,
      ...(options.bridgeRoot === undefined ? {} : { bridgeRoot: options.bridgeRoot }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    this.triggerCommand = [...options.triggerCommand];
    this.triggerPort = options.trigger ?? createTriggerPort(options.repoRoot);
  }

  async createRequest(request: ReviewRequest): Promise<RequestHandle> {
    const handle = await this.mailbox.createRequest(request);
    return { ...handle, transport: 'workspace-agent' };
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

  async trigger(requestId: string): Promise<{ triggered: boolean; reason: string }> {
    const status = await this.mailbox.getRequestStatus(requestId);
    if (status.state !== 'ready') {
      return { triggered: false, reason: `request already ${status.state}` };
    }
    const hasPlaceholder = this.triggerCommand.includes('{requestId}');
    const argv = this.triggerCommand.map((part) => (
      part === '{requestId}' ? requestId : part
    ));
    if (!hasPlaceholder) {
      argv.push(requestId);
    }
    const result = await this.triggerPort.run(argv);
    if (!result.ok) {
      throw new Error(
        `Workspace agent trigger was not accepted (exit ${result.code ?? 'unknown'}): ${result.stderr.trim() || 'no stderr'}`,
      );
    }
    // The trigger response is 202-only acceptance data; mailbox status is the only completion source.
    return { triggered: true, reason: 'trigger accepted; poll bridge status for completion' };
  }
}
