import type {
  ReviewRequest,
  ReviewResultManifest,
  RequestLifecycleState,
} from '../contract.js';

export interface RequestHandle {
  requestId: string;
  transport: string;
  createdAt: string;
  requestDir: string;
  requestPath: string;
  promptPath: string;
}

export interface RequestStatus {
  requestId: string;
  state: RequestLifecycleState;
  kind: string;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
  detail: string | null;
}

export interface ImportReceipt {
  requestId: string;
  folder: string;
  installedPath: string;
  resultFilesSha256: string;
  importedAt: string;
}

export interface VibeProBridgeTransport {
  createRequest(request: ReviewRequest): Promise<RequestHandle>;
  getRequestStatus(requestId: string): Promise<RequestStatus>;
  getResultManifest(requestId: string): Promise<ReviewResultManifest | null>;
  getResultFile(requestId: string, path: string): Promise<Uint8Array>;
  acknowledgeImport(requestId: string, receipt: ImportReceipt): Promise<void>;
}

export const SUPPORTED_TRANSPORTS = ['manual'] as const;
export type SupportedTransportName = (typeof SUPPORTED_TRANSPORTS)[number];

export function resolveTransportName(input: {
  cliOption?: string | undefined;
  configTransport?: string | undefined;
}): SupportedTransportName {
  const selected = input.cliOption ?? input.configTransport ?? 'manual';
  if ((SUPPORTED_TRANSPORTS as readonly string[]).includes(selected)) {
    return selected as SupportedTransportName;
  }

  throw new Error(
    `Unsupported Pro Bridge transport "${selected}". Supported transports: ${SUPPORTED_TRANSPORTS.join(', ')}`,
  );
}
