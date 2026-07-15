import { randomBytes, timingSafeEqual } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { ZodError } from 'zod';
import { MailboxStoreError } from './store.js';
import type { McpToolDefinition } from './tools.js';

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26'] as const;
const DEFAULT_EXCHANGE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface McpServerOptions {
  tools: McpToolDefinition[];
  connectCode: string;
  port: number;
  host?: string;
  log?: (line: string) => void;
  serverInfo?: { name: string; version: string };
  now?: () => Date;
  exchangeTtlMs?: number;
  sessionTtlMs?: number;
  randomSessionToken?: () => string;
}

export interface RunningMcpServer {
  port: number;
  url: string;
  revoke(): void;
  getSessionTokenForTesting(): string | null;
  close(): Promise<void>;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: unknown;
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.end(`${JSON.stringify(value)}\n`);
}

function sendRpcResult(response: ServerResponse, id: string | number, result: unknown): void {
  sendJson(response, 200, { jsonrpc: '2.0', id, result });
}

function sendRpcError(
  response: ServerResponse,
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): void {
  const error = data === undefined ? { code, message } : { code, message, data };
  sendJson(response, 200, { jsonrpc: '2.0', id, error });
}

interface SessionAuth {
  authorize(request: IncomingMessage, requestUrl: URL): boolean;
  revoke(): void;
  getSessionTokenForTesting(): string | null;
}

function suppliedBearer(request: IncomingMessage): string | null {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length);
  }
  return null;
}

function credentialMatches(expected: string | null, supplied: string | null): boolean {
  if (expected === null || supplied === null) {
    return false;
  }
  const expectedBytes = Buffer.from(expected, 'utf8');
  const suppliedBytes = Buffer.from(supplied, 'utf8');
  return expectedBytes.byteLength === suppliedBytes.byteLength
    && timingSafeEqual(expectedBytes, suppliedBytes);
}

function normalizeTtl(value: number | undefined, fallback: number, name: string): number {
  const ttl = value ?? fallback;
  if (!Number.isSafeInteger(ttl) || ttl < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return ttl;
}

function createSessionAuth(options: McpServerOptions): SessionAuth {
  const now = options.now ?? (() => new Date());
  const exchangeTtlMs = normalizeTtl(
    options.exchangeTtlMs,
    DEFAULT_EXCHANGE_TTL_MS,
    'exchangeTtlMs',
  );
  const sessionTtlMs = normalizeTtl(
    options.sessionTtlMs,
    DEFAULT_SESSION_TTL_MS,
    'sessionTtlMs',
  );
  const randomSessionToken = options.randomSessionToken
    ?? (() => randomBytes(32).toString('base64url'));
  const startedAt = now().getTime();
  let connectCode: string | null = options.connectCode;
  let sessionToken: string | null = null;
  let exchangedAt: number | null = null;

  return {
    authorize(request, requestUrl) {
      if (requestUrl.searchParams.has('token') || connectCode === null) {
        return false;
      }
      const currentTime = now().getTime();
      const bearer = suppliedBearer(request);
      const supplied = bearer ?? requestUrl.searchParams.get('code');
      if (credentialMatches(connectCode, supplied)) {
        if (exchangedAt === null) {
          if (currentTime - startedAt > exchangeTtlMs) {
            return false;
          }
          exchangedAt = currentTime;
          sessionToken = randomSessionToken();
        }
        return currentTime - exchangedAt <= sessionTtlMs;
      }
      return exchangedAt !== null
        && currentTime - exchangedAt <= sessionTtlMs
        && credentialMatches(sessionToken, supplied);
    },
    revoke() {
      connectCode = null;
      sessionToken = null;
      exchangedAt = null;
    },
    getSessionTokenForTesting() {
      return sessionToken;
    },
  };
}

async function readBody(request: IncomingMessage): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    length += bytes.byteLength;
    if (length > MAX_BODY_BYTES) {
      return null;
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function parseRequest(value: unknown): JsonRpcRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const request = value as Record<string, unknown>;
  if (
    request.jsonrpc !== '2.0'
    || typeof request.method !== 'string'
    || (
      request.id !== undefined
      && typeof request.id !== 'string'
      && typeof request.id !== 'number'
    )
  ) {
    return null;
  }
  const parsed: JsonRpcRequest = {
    jsonrpc: '2.0',
    method: request.method,
  };
  if (request.id !== undefined) {
    parsed.id = request.id as string | number;
  }
  if (request.params !== undefined) {
    parsed.params = request.params;
  }
  return parsed;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function createAuthenticatedMcpRequestListener(
  options: McpServerOptions,
  auth: SessionAuth,
): http.RequestListener {
  const tools = new Map(options.tools.map((tool) => [tool.name, tool]));
  const log = options.log ?? (() => undefined);
  const serverInfo = options.serverInfo ?? { name: 'vibe-pro-bridge', version: '1' };

  return async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    log(`${request.method ?? 'UNKNOWN'} ${requestUrl.pathname}`);
    if (requestUrl.pathname !== '/mcp') {
      sendJson(response, 404, { error: 'not-found' });
      return;
    }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      sendJson(response, 405, { error: 'method-not-allowed' });
      return;
    }
    if (request.headers.origin !== undefined) {
      // Expected clients are server-to-server; rejecting browser Origin blocks DNS rebinding.
      sendJson(response, 403, { error: 'origin-forbidden' });
      return;
    }
    if (!auth.authorize(request, requestUrl)) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      sendJson(response, 401, { error: 'unauthorized' });
      return;
    }

    const bytes = await readBody(request);
    if (bytes === null) {
      sendJson(response, 413, { error: 'payload-too-large' });
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
    } catch {
      sendRpcError(response, null, -32700, 'Parse error');
      return;
    }
    // MCP removed JSON-RPC batch messages; this server intentionally accepts one message per POST.
    if (Array.isArray(raw)) {
      sendRpcError(response, null, -32600, 'Invalid Request');
      return;
    }
    const rpc = parseRequest(raw);
    if (!rpc) {
      const candidate = object(raw);
      if (candidate && candidate.jsonrpc === '2.0' && candidate.method === undefined) {
        response.statusCode = 202;
        response.end();
        return;
      }
      sendRpcError(response, null, -32600, 'Invalid Request');
      return;
    }
    if (rpc.id === undefined || rpc.method.startsWith('notifications/')) {
      response.statusCode = 202;
      response.end();
      return;
    }

    if (rpc.method === 'initialize') {
      const params = object(rpc.params);
      if (!params || typeof params.protocolVersion !== 'string') {
        sendRpcError(response, rpc.id, -32602, 'Invalid params');
        return;
      }
      const protocolVersion = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(
        params.protocolVersion,
      )
        ? params.protocolVersion
        : SUPPORTED_PROTOCOL_VERSIONS[0];
      sendRpcResult(response, rpc.id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo,
      });
      return;
    }
    if (rpc.method === 'ping') {
      sendRpcResult(response, rpc.id, {});
      return;
    }
    if (rpc.method === 'tools/list') {
      sendRpcResult(response, rpc.id, {
        tools: options.tools.map((tool) => {
          const listed = {
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          };
          return tool.annotations === undefined
            ? listed
            : { ...listed, annotations: tool.annotations };
        }),
      });
      return;
    }
    if (rpc.method === 'tools/call') {
      const params = object(rpc.params);
      const name = typeof params?.name === 'string' ? params.name : null;
      const tool = name === null ? undefined : tools.get(name);
      if (!tool) {
        sendRpcError(response, rpc.id, -32602, 'Invalid params: unknown tool');
        return;
      }
      try {
        const result = await tool.invoke(params?.arguments ?? {});
        sendRpcResult(response, rpc.id, {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          isError: false,
        });
      } catch (error) {
        if (error instanceof MailboxStoreError) {
          sendRpcResult(response, rpc.id, {
            content: [{ type: 'text', text: JSON.stringify({ code: error.code, message: error.message }) }],
            isError: true,
          });
        } else if (error instanceof ZodError) {
          sendRpcError(response, rpc.id, -32602, 'Invalid params', error.issues);
        } else {
          sendRpcError(response, rpc.id, -32603, 'Internal error');
        }
      }
      return;
    }
    sendRpcError(response, rpc.id, -32601, 'Method not found');
  };
}

export function createMcpRequestListener(options: McpServerOptions): http.RequestListener {
  return createAuthenticatedMcpRequestListener(options, createSessionAuth(options));
}

export async function startMcpServer(options: McpServerOptions): Promise<RunningMcpServer> {
  const host = options.host ?? '127.0.0.1';
  const auth = createSessionAuth(options);
  const server = http.createServer(createAuthenticatedMcpRequestListener(options, auth));
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(options.port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('MCP server did not expose a TCP port');
  }
  return {
    port: address.port,
    url: `http://${host}:${address.port}`,
    revoke(): void {
      auth.revoke();
    },
    getSessionTokenForTesting(): string | null {
      return auth.getSessionTokenForTesting();
    },
    async close(): Promise<void> {
      auth.revoke();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}
