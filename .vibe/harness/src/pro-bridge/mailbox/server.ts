import { randomBytes, timingSafeEqual } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { ZodError } from 'zod';
import { MailboxStoreError } from './store.js';
import {
  applyAuthProfile,
  serializeToolDescriptor,
  type McpToolDefinition,
  type ProBridgeAuthMode,
} from './tools.js';

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26'] as const;
const DEFAULT_EXCHANGE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface McpServerOptions {
  auth?: McpServerAuthOptions;
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

export interface McpServerAuthOptions {
  mode: ProBridgeAuthMode;
  introspectToken?: (token: string) => Promise<readonly string[] | null>;
  resource?: string;
  authorizationServers?: readonly string[];
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
        tools: options.tools.map(serializeToolDescriptor),
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
          structuredContent: result,
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

const BRIDGE_OAUTH_SCOPES = [
  'bridge.request.read',
  'bridge.request.write',
  'bridge.result.read',
  'bridge.result.write',
  'bridge.import.ack',
] as const;

export function createStaticTokenIntrospector(
  tokens: Record<string, readonly string[]>,
): (token: string) => Promise<readonly string[] | null> {
  const entries = Object.entries(tokens).map(([candidate, scopes]) => ({
    candidate: Buffer.from(candidate, 'utf8'),
    scopes: [...scopes],
  }));
  return async (token: string): Promise<readonly string[] | null> => {
    const supplied = Buffer.from(token, 'utf8');
    let matched: readonly string[] | null = null;
    for (const entry of entries) {
      const comparable = Buffer.alloc(entry.candidate.byteLength);
      supplied.copy(comparable, 0, 0, Math.min(supplied.byteLength, comparable.byteLength));
      const equal = timingSafeEqual(entry.candidate, comparable)
        && supplied.byteLength === entry.candidate.byteLength;
      if (equal) {
        matched = entry.scopes;
      }
    }
    return matched;
  };
}

function bearerToken(request: IncomingMessage): string | null {
  const match = request.headers.authorization?.match(/^Bearer ([^\s]+)$/);
  return match?.[1] ?? null;
}

function oauthResource(request: IncomingMessage, auth: McpServerAuthOptions): string {
  if (auth.resource !== undefined) {
    return auth.resource;
  }
  return `http://${request.headers.host ?? '127.0.0.1'}/mcp`;
}

function resourceMetadataUrl(request: IncomingMessage, auth: McpServerAuthOptions): string {
  return new URL('/.well-known/oauth-protected-resource', oauthResource(request, auth)).toString();
}

function requiredScopes(tool: McpToolDefinition): readonly string[] {
  const meta = object((tool as unknown as { _meta?: unknown })._meta);
  const value = meta?.['vibe/requiredScopes'];
  return Array.isArray(value) && value.every((scope) => typeof scope === 'string')
    ? value as string[]
    : [];
}

function insufficientScopeChallenge(missingScopes: readonly string[]): string {
  const joined = missingScopes.join(' ');
  return `Bearer error="insufficient_scope", error_description="${joined} is required", scope="${joined}"`;
}

function sendInsufficientScope(
  response: ServerResponse,
  id: string | number,
  required: readonly string[],
  missing: readonly string[],
): void {
  const challenge = insufficientScopeChallenge(missing);
  const joined = missing.join(' ');
  sendJson(response, 200, {
    jsonrpc: '2.0',
    id,
    error: {
      code: -32001,
      message: `insufficient_scope: ${joined} is required`,
      data: {
        requiredScopes: [...required],
        missingScopes: [...missing],
        'mcp/www_authenticate': challenge,
      },
    },
    _meta: { 'mcp/www_authenticate': challenge },
  });
}

function createOauthMcpRequestListener(
  options: McpServerOptions,
  auth: McpServerAuthOptions,
): http.RequestListener {
  const introspectToken = auth.introspectToken;
  if (introspectToken === undefined) {
    throw new Error('OAuth MCP mode requires an introspectToken implementation');
  }
  const tools = new Map(options.tools.map((tool) => [tool.name, tool]));
  const log = options.log ?? (() => undefined);
  const serverInfo = options.serverInfo ?? { name: 'vibe-pro-bridge', version: '1' };

  return async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    log(`${request.method ?? 'UNKNOWN'} ${requestUrl.pathname}`);
    if (
      request.method === 'GET'
      && requestUrl.pathname === '/.well-known/oauth-protected-resource'
    ) {
      sendJson(response, 200, {
        resource: oauthResource(request, auth),
        authorization_servers: [...(auth.authorizationServers ?? [])],
        scopes_supported: [...BRIDGE_OAUTH_SCOPES],
        bearer_methods_supported: ['header'],
      });
      return;
    }
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
      sendJson(response, 403, { error: 'origin-forbidden' });
      return;
    }
    const token = requestUrl.searchParams.has('code') || requestUrl.searchParams.has('token')
      ? null
      : bearerToken(request);
    const granted = token === null ? null : await introspectToken(token);
    if (granted === null) {
      response.setHeader(
        'WWW-Authenticate',
        `Bearer resource_metadata="${resourceMetadataUrl(request, auth)}"`,
      );
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
      ) ? params.protocolVersion : SUPPORTED_PROTOCOL_VERSIONS[0];
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
        tools: options.tools
          .map(serializeToolDescriptor)
          .map((descriptor) => applyAuthProfile(descriptor, 'oauth')),
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
      const required = requiredScopes(tool);
      const grantedSet = new Set(granted);
      const missing = required.filter((scope) => !grantedSet.has(scope));
      if (missing.length > 0) {
        sendInsufficientScope(response, rpc.id, required, missing);
        return;
      }
      try {
        const result = await tool.invoke(params?.arguments ?? {});
        sendRpcResult(response, rpc.id, {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
          isError: false,
        });
      } catch (error) {
        if (error instanceof MailboxStoreError) {
          sendRpcResult(response, rpc.id, {
            content: [{
              type: 'text',
              text: JSON.stringify({ code: error.code, message: error.message }),
            }],
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

function createNoauthMcpRequestListener(options: McpServerOptions): http.RequestListener {
  return createAuthenticatedMcpRequestListener(options, createSessionAuth(options));
}

export function createMcpRequestListener(options: McpServerOptions): http.RequestListener {
  const auth = options.auth ?? { mode: 'noauth-local' as const };
  return auth.mode === 'oauth'
    ? createOauthMcpRequestListener(options, auth)
    : createNoauthMcpRequestListener(options);
}

export async function startMcpServer(options: McpServerOptions): Promise<RunningMcpServer> {
  if (options.auth?.mode === 'oauth' && options.auth.introspectToken === undefined) {
    throw new Error('OAuth MCP mode requires an introspectToken implementation');
  }
  const host = options.host ?? '127.0.0.1';
  const sessionAuth = options.auth?.mode === 'oauth' ? null : createSessionAuth(options);
  const listener = options.auth?.mode === 'oauth'
    ? createOauthMcpRequestListener(options, options.auth)
    : createAuthenticatedMcpRequestListener(options, sessionAuth!);
  const server = http.createServer(listener);
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
      sessionAuth?.revoke();
    },
    getSessionTokenForTesting(): string | null {
      return sessionAuth?.getSessionTokenForTesting() ?? null;
    },
    async close(): Promise<void> {
      sessionAuth?.revoke();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}
