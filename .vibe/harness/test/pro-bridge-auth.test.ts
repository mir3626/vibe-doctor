import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  runProBridge,
  type ProBridgeIo,
} from '../src/commands/pro-bridge.js';
import {
  DEFAULT_PRO_BRIDGE_CONFIG,
  type ProBridgeConfig,
} from '../src/lib/config.js';
import {
  computePayloadSha256,
  type ReviewRequest,
} from '../src/pro-bridge/contract.js';
import type { GitPort } from '../src/pro-bridge/goal-source/types.js';
import {
  createStaticTokenIntrospector,
  startMcpServer,
  type RunningMcpServer,
} from '../src/pro-bridge/mailbox/server.js';
import { MailboxStore } from '../src/pro-bridge/mailbox/store.js';
import {
  applyAuthProfile,
  auditToolCatalog,
  createMailboxTools,
  serializeToolDescriptor,
  type McpToolDefinition,
} from '../src/pro-bridge/mailbox/tools.js';

const NOW = new Date('2026-07-16T12:00:00.000Z');
const CONNECT_CODE = 'auth-test-connect-code-long-enough';
const READ_TOKEN = 'oauth-read-token';
const WRITE_TOKEN = 'oauth-write-token';
const EMPTY_TOKEN = 'oauth-empty-token';
const REQUEST_ID = 'AUD-20260716-authscope';
const RESOURCE = 'https://bridge.example.test/mcp';

interface RpcEnvelope {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: Record<string, unknown>;
  error?: {
    code: number;
    message: string;
    data?: Record<string, unknown>;
  };
  _meta?: Record<string, unknown>;
}

interface Fixture {
  root: string;
  store: MailboxStore;
  server: RunningMcpServer;
}

function inertServer(port: number): RunningMcpServer {
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    revoke() {},
    getSessionTokenForTesting() { return null; },
    async close() {},
  };
}

function requestFixture(): ReviewRequest {
  const draft: ReviewRequest = {
    schemaVersion: 'vibe-pro-review-request-v1',
    requestId: REQUEST_ID,
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
    userGoal: 'Verify OAuth scopes.',
    reviewPrompt: '# OAuth scope verification',
    outputContract: {
      requiredFiles: [
        'README.md',
        'REVIEW.md',
        'FINDINGS.json',
        'prompt/CLI_MAIN_SESSION_PROMPT.md',
      ],
    },
    createdAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
    payloadSha256: '0'.repeat(64),
  };
  return { ...draft, payloadSha256: computePayloadSha256(draft) };
}

function oauthTokens(): Record<string, readonly string[]> {
  return {
    [EMPTY_TOKEN]: [],
    [READ_TOKEN]: ['bridge.request.read'],
    [WRITE_TOKEN]: ['bridge.request.read', 'bridge.result.write'],
    'result-only-token': ['bridge.result.write'],
  };
}

async function oauthFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), 'vibe-pro-auth-'));
  const store = new MailboxStore({ repoRoot: root, now: () => NOW });
  const tools = createMailboxTools(store, { authMode: 'oauth' }).map((tool) => {
    if (tool.name === 'publish_review_package') {
      return {
        ...tool,
        async invoke(): Promise<unknown> {
          return {
            status: 'result-ready',
            requestId: REQUEST_ID,
            resultId: 'result-auth-test',
          };
        },
      } satisfies McpToolDefinition;
    }
    if (tool.name === 'acknowledge_import') {
      return {
        ...tool,
        async invoke(): Promise<unknown> {
          return { acknowledged: true };
        },
      } satisfies McpToolDefinition;
    }
    return tool;
  });
  const server = await startMcpServer({
    tools,
    connectCode: CONNECT_CODE,
    port: 0,
    host: '127.0.0.1',
    auth: {
      mode: 'oauth',
      introspectToken: createStaticTokenIntrospector(oauthTokens()),
      resource: RESOURCE,
    },
  });
  return { root, store, server };
}

async function noauthFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), 'vibe-pro-noauth-'));
  const store = new MailboxStore({ repoRoot: root, now: () => NOW });
  const server = await startMcpServer({
    tools: createMailboxTools(store),
    connectCode: CONNECT_CODE,
    port: 0,
    host: '127.0.0.1',
  });
  return { root, store, server };
}

async function cleanup(fixture: Fixture): Promise<void> {
  await fixture.server.close();
  await rm(fixture.root, { recursive: true, force: true });
}

async function rpc(
  server: RunningMcpServer,
  method: string,
  params: unknown,
  options: { token?: string; code?: string; id?: number } = {},
): Promise<{ response: Response; value: RpcEnvelope | null }> {
  const query = options.code === undefined ? '' : `?code=${encodeURIComponent(options.code)}`;
  const response = await fetch(`${server.url}/mcp${query}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token === undefined ? {} : { Authorization: `Bearer ${options.token}` }),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: options.id ?? 7, method, params }),
  });
  const text = await response.text();
  return { response, value: text.length === 0 ? null : JSON.parse(text) as RpcEnvelope };
}

function structured(result: Record<string, unknown> | undefined): Record<string, unknown> {
  const value = result?.structuredContent;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  const content = result?.content as Array<{ text: string }> | undefined;
  return JSON.parse(content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

function commandConfig(
  mcp: Partial<ProBridgeConfig['mcp']> = {},
): ProBridgeConfig {
  return {
    ...DEFAULT_PRO_BRIDGE_CONFIG,
    enabled: true,
    transport: 'mcp-mailbox',
    mcp: { ...DEFAULT_PRO_BRIDGE_CONFIG.mcp, ...mcp },
  };
}

function captureIo(): { io: ProBridgeIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      async confirm() { return false; },
    },
  };
}

async function compliantFacadeArguments(
  request: ReviewRequest,
  tool: McpToolDefinition,
): Promise<Record<string, unknown>> {
  const fixtures = await import('./helpers/pro-bridge-result-fixture.js');
  const requestSlug = request.requestId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'request';
  const proposedFolder = `${NOW.toISOString().slice(0, 10)}-${requestSlug}-pro-review`;
  const title = 'OAuth wrapper contract review';
  const built = fixtures.buildCompliantResultBundle({
    requestId: request.requestId,
    folder: proposedFolder,
    repositoryFullName: request.repository.fullName,
    baseSha: request.git.baseSha,
    headSha: request.git.headSha,
    disposition: 'approved',
    title,
  });
  const args: Record<string, unknown> = {
    requestId: request.requestId,
    proposedFolder,
    disposition: 'approved',
    summary: {
      title,
      reviewedRepository: request.repository.fullName,
      reviewedBaseSha: request.git.baseSha,
      reviewedHeadSha: request.git.headSha,
      ...built.findingsSummary,
      limitations: built.reviewerDeclaration.limitations,
    },
    files: built.bundle.files.map((file) => ({
      path: file.path,
      mediaType: file.path.endsWith('.json') ? 'application/json' : 'text/markdown',
      content: file.content,
    })),
    clientPublicationId: `http-wrapper-${requestSlug}`,
    reviewerDeclaration: built.reviewerDeclaration,
  };
  const schema = tool.inputSchema;
  const required = Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === 'string')
    : [];
  assert.deepEqual(
    required.filter((key) => !Object.hasOwn(args, key)),
    [],
    'publish_review_package fixture adapter must cover every required input field',
  );
  return args;
}

describe('pro bridge oauth authorization', () => {
  it('keeps the noauth-local wire byte-compatible without security schemes', async () => {
    const value = await noauthFixture();
    try {
      const listed = await rpc(value.server, 'tools/list', {}, { code: CONNECT_CODE });
      const tools = listed.value?.result?.tools as Array<Record<string, unknown>>;
      assert.equal(tools.every((tool) => !Object.hasOwn(tool, 'securitySchemes')), true);
      const capabilities = tools.find((tool) => tool.name === 'bridge_capabilities')!;
      const properties = (capabilities.outputSchema as {
        properties: Record<string, unknown>;
      }).properties;
      assert.deepEqual(properties.authMode, { type: 'string', const: 'noauth-local' });
    } finally {
      await cleanup(value);
    }
  });

  it('serves oauth tools list with per-tool security schemes', async () => {
    const value = await oauthFixture();
    try {
      const listed = await rpc(value.server, 'tools/list', {}, { token: EMPTY_TOKEN });
      const tools = listed.value?.result?.tools as Array<Record<string, unknown>>;
      assert.equal(tools.length, 14);
      assert.equal(tools.every((tool) => Object.hasOwn(tool, 'securitySchemes')), true);
      const publish = tools.find((tool) => tool.name === 'publish_review_package')!;
      assert.deepEqual(publish.securitySchemes, [{ type: 'oauth2', scopes: ['bridge.result.write'] }]);
      const capabilities = tools.find((tool) => tool.name === 'bridge_capabilities')!;
      assert.deepEqual(capabilities.securitySchemes, [{ type: 'oauth2', scopes: [] }]);
    } finally {
      await cleanup(value);
    }
  });

  it('reports the running auth mode through bridge capabilities', async () => {
    const oauth = await oauthFixture();
    const noauth = await noauthFixture();
    try {
      const oauthCall = await rpc(oauth.server, 'tools/call', {
        name: 'bridge_capabilities', arguments: {},
      }, { token: EMPTY_TOKEN });
      const noauthCall = await rpc(noauth.server, 'tools/call', {
        name: 'bridge_capabilities', arguments: {},
      }, { code: CONNECT_CODE });
      assert.equal(structured(oauthCall.value?.result).authMode, 'oauth');
      assert.equal(structured(noauthCall.value?.result).authMode, 'noauth-local');
    } finally {
      await cleanup(oauth);
      await cleanup(noauth);
    }
  });

  it('rejects missing or unknown bearer tokens with a resource metadata challenge', async () => {
    const value = await oauthFixture();
    try {
      for (const token of [undefined, 'unknown-token']) {
        const response = await rpc(value.server, 'ping', {}, token === undefined ? {} : { token });
        assert.equal(response.response.status, 401);
        assert.equal(
          response.response.headers.get('www-authenticate'),
          'Bearer resource_metadata="https://bridge.example.test/.well-known/oauth-protected-resource"',
        );
      }
    } finally {
      await cleanup(value);
    }
  });

  it('rejects the connect code query path in oauth mode', async () => {
    const value = await oauthFixture();
    try {
      const response = await rpc(value.server, 'ping', {}, { code: CONNECT_CODE });
      assert.equal(response.response.status, 401);
    } finally {
      await cleanup(value);
    }
  });

  it('allows discovery calls with a valid token that has no scopes', async () => {
    const value = await oauthFixture();
    try {
      for (const [method, params] of [
        ['initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }],
        ['ping', {}],
        ['tools/list', {}],
        ['tools/call', { name: 'bridge_capabilities', arguments: {} }],
      ] as const) {
        const response = await rpc(value.server, method, params, { token: EMPTY_TOKEN });
        assert.equal(response.response.status, 200);
        assert.equal(response.value?.error, undefined);
      }
    } finally {
      await cleanup(value);
    }
  });

  it('lets a read scope token read the request but not publish', async () => {
    const value = await oauthFixture();
    try {
      await value.store.createRequest(requestFixture());
      const read = await rpc(value.server, 'tools/call', {
        name: 'get_request', arguments: { requestId: REQUEST_ID },
      }, { token: READ_TOKEN });
      assert.equal(read.value?.error, undefined);
      const publish = await rpc(value.server, 'tools/call', {
        name: 'publish_review_package', arguments: {},
      }, { token: READ_TOKEN });
      assert.equal(publish.value?.error?.code, -32001);
    } finally {
      await cleanup(value);
    }
  });

  it('returns the mcp www authenticate challenge on missing write scope', async () => {
    const value = await oauthFixture();
    try {
      const response = await rpc(value.server, 'tools/call', {
        name: 'publish_review_package', arguments: {},
      }, { token: READ_TOKEN });
      const challenge = 'Bearer error="insufficient_scope", error_description="bridge.result.write is required", scope="bridge.result.write"';
      assert.equal(response.response.status, 200);
      assert.equal(response.value?.error?.data?.['mcp/www_authenticate'], challenge);
      assert.equal(response.value?._meta?.['mcp/www_authenticate'], challenge);
      assert.deepEqual(response.value?.error?.data?.requiredScopes, ['bridge.result.write']);
      assert.deepEqual(response.value?.error?.data?.missingScopes, ['bridge.result.write']);
    } finally {
      await cleanup(value);
    }
  });

  it('publishes successfully after reauthorization with a write scope token', async () => {
    const value = await oauthFixture();
    try {
      const denied = await rpc(value.server, 'tools/call', {
        name: 'publish_review_package', arguments: {},
      }, { token: READ_TOKEN });
      assert.equal(denied.value?.error?.code, -32001);
      const allowed = await rpc(value.server, 'tools/call', {
        name: 'publish_review_package', arguments: {},
      }, { token: WRITE_TOKEN });
      assert.equal(allowed.value?.error, undefined);
      assert.equal(structured(allowed.value?.result).status, 'result-ready');
    } finally {
      await cleanup(value);
    }
  });

  it('enforces the import ack scope on acknowledge import', async () => {
    const value = await oauthFixture();
    try {
      const response = await rpc(value.server, 'tools/call', {
        name: 'acknowledge_import', arguments: {},
      }, { token: 'result-only-token' });
      assert.equal(response.value?.error?.code, -32001);
      assert.equal(
        response.value?.error?.data?.['mcp/www_authenticate'],
        'Bearer error="insufficient_scope", error_description="bridge.import.ack is required", scope="bridge.import.ack"',
      );
    } finally {
      await cleanup(value);
    }
  });

  it('serves oauth protected resource metadata with the five bridge scopes', async () => {
    const value = await oauthFixture();
    try {
      const response = await fetch(`${value.server.url}/.well-known/oauth-protected-resource`);
      assert.equal(response.status, 200);
      const metadata = await response.json() as Record<string, unknown>;
      assert.equal(metadata.resource, RESOURCE);
      assert.deepEqual(metadata.authorization_servers, []);
      assert.deepEqual(metadata.scopes_supported, [
        'bridge.request.read',
        'bridge.request.write',
        'bridge.result.read',
        'bridge.result.write',
        'bridge.import.ack',
      ]);
      assert.deepEqual(metadata.bearer_methods_supported, ['header']);
    } finally {
      await cleanup(value);
    }
  });

  it('keeps protected resource metadata absent in noauth-local mode', async () => {
    const value = await noauthFixture();
    try {
      const response = await fetch(`${value.server.url}/.well-known/oauth-protected-resource`);
      assert.equal(response.status, 404);
    } finally {
      await cleanup(value);
    }
  });

  it('matches static oauth tokens with timing safe comparison and rejects unknown tokens', async () => {
    const introspect = createStaticTokenIntrospector({
      'known-token': ['bridge.request.read'],
      'different-length-token': ['bridge.result.write'],
    });
    assert.deepEqual(await introspect('known-token'), ['bridge.request.read']);
    assert.equal(await introspect('unknown-token'), null);
    assert.equal(await introspect(''), null);
  });

  it('publishes a compliant package through the http tool call wrapper and replays idempotently', async () => {
    const value = await noauthFixture();
    try {
      const request = requestFixture();
      await value.store.createRequest(request);
      const publish = createMailboxTools(value.store).find((tool) => (
        tool.name === 'publish_review_package'
      ))!;
      const args = await compliantFacadeArguments(request, publish);
      const first = await rpc(value.server, 'tools/call', {
        name: 'publish_review_package', arguments: args,
      }, { code: CONNECT_CODE });
      const receipt = structured(first.value?.result);
      assert.equal(receipt.status, 'result-ready');
      assert.equal(receipt.requestId, request.requestId);
      assert.match(String(receipt.resultId), /\S+/);
      assert.match(String(receipt.proposedFolder), /\S+/);
      assert.match(String(receipt.resultManifestSha256), /^[0-9a-f]{64}$/);
      assert.equal(typeof receipt.fileCount, 'number');
      assert.equal(typeof receipt.totalBytes, 'number');
      assert.equal(receipt.revision, 1);
      assert.equal(receipt.imported, false);
      assert.equal(receipt.idempotentReplay, false);

      const replay = await rpc(value.server, 'tools/call', {
        name: 'publish_review_package', arguments: args,
      }, { code: CONNECT_CODE });
      assert.equal(structured(replay.value?.result).idempotentReplay, true);
    } finally {
      await cleanup(value);
    }
  });

  it('returns the chunked upload fallback through the http tool call wrapper', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'vibe-pro-chunk-fallback-'));
    const store = new MailboxStore({ repoRoot: root, now: () => NOW });
    const defaults = DEFAULT_PRO_BRIDGE_CONFIG.mcp.publishLimits as unknown as Record<string, unknown>;
    const reduced = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [
      key,
      typeof value === 'number' ? 1 : value,
    ]));
    const toolOptions = { publishLimits: reduced } as unknown as NonNullable<
      Parameters<typeof createMailboxTools>[1]
    >;
    const tools = createMailboxTools(store, toolOptions);
    const server = await startMcpServer({
      tools,
      connectCode: CONNECT_CODE,
      port: 0,
      host: '127.0.0.1',
    });
    try {
      const request = requestFixture();
      await store.createRequest(request);
      const publish = tools.find((tool) => tool.name === 'publish_review_package')!;
      const args = await compliantFacadeArguments(request, publish);
      const response = await rpc(server, 'tools/call', {
        name: 'publish_review_package', arguments: args,
      }, { code: CONNECT_CODE });
      const fallback = structured(response.value?.result);
      assert.equal(fallback.status, 'chunked-upload-required');
      assert.deepEqual(fallback.requiredNextTools, ['put_result_file', 'finalize_result']);
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('round trips an audit request through the publish facade tool path', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'vibe-pro-facade-e2e-'));
    try {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const tools = createMailboxTools(store);
      const request = requestFixture();
      await store.createRequest(request);
      const publish = tools.find((tool) => tool.name === 'publish_review_package')!;
      const args = await compliantFacadeArguments(request, publish);
      const receipt = await publish.invoke(args) as Record<string, unknown>;
      assert.equal(receipt.status, 'result-ready');

      const io = captureIo();
      const git: GitPort = {
        async run(command) {
          if (command[0] === 'remote') {
            return {
              ok: true,
              stdout: 'https://github.com/owner/repo.git\n',
              stderr: '',
              code: 0,
            };
          }
          if (command[0] === 'rev-parse') {
            return { ok: true, stdout: `${request.git.headSha}\n`, stderr: '', code: 0 };
          }
          return {
            ok: false,
            stdout: '',
            stderr: `unexpected ${command.join(' ')}`,
            code: 1,
          };
        },
      };
      const exit = await runProBridge(['sync', '--latest'], {
        repoRoot: root,
        config: {
          ...commandConfig(),
          resultRoot: 'installed-results',
        },
        io: io.io,
        git,
        stdin: { isTTY: false },
        now: () => NOW,
      });
      assert.equal(exit, 0, io.err.join('\n'));
      const installed = path.join(root, 'installed-results', String(receipt.proposedFolder));
      await access(path.join(installed, 'README.md'));
      const provenance = JSON.parse(await readFile(
        path.join(installed, '.bridge', 'provenance.json'),
        'utf8',
      )) as { resultFilesSha256: string };
      const imported = JSON.parse(await readFile(
        path.join(store.requestsRoot, request.requestId, 'imported.json'),
        'utf8',
      )) as { resultFilesSha256: string };
      assert.equal(imported.resultFilesSha256, provenance.resultFilesSha256);
      assert.equal((await store.getStatus(request.requestId)).state, 'imported');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('mcp subcommand reuses the configured persistent code across restarts', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'vibe-persistent-command-'));
    const capture = captureIo();
    const starts: Array<Parameters<typeof startMcpServer>[0]> = [];
    const persistentCode = 'persistent-code-for-two-restarts-1234';
    try {
      for (let index = 0; index < 2; index += 1) {
        const exit = await runProBridge(['mcp'], {
          repoRoot: root,
          config: commandConfig({ persistentCode, tunnel: 'none' }),
          io: capture.io,
          mcpServer: {
            async start(options) {
              starts.push(options);
              return inertServer(options.port);
            },
          },
          tunnel: {
            async start() {
              return { kind: 'none', publicUrl: null, async stop() {} };
            },
          },
          waitForShutdown: async () => undefined,
          randomToken: () => `ephemeral-${index}`,
        });
        assert.equal(exit, 0, capture.err.join('\n'));
      }
      assert.equal(starts.length, 2);
      assert.equal(starts[0]!.connectCode, persistentCode);
      assert.equal(starts[1]!.connectCode, persistentCode);
      assert.equal(capture.out.some((line) => line.includes('재시작 간 유지')), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('mcp subcommand refuses persistent secrets in the shared config', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'vibe-shared-secret-'));
    const capture = captureIo();
    try {
      await mkdir(path.join(root, '.vibe'), { recursive: true });
      await writeFile(path.join(root, '.vibe', 'config.json'), JSON.stringify({
        proBridge: { mcp: { persistentCode: 'shared-secret', oauthTokens: { token: [] } } },
      }), 'utf8');
      const exit = await runProBridge(['mcp'], {
        repoRoot: root,
        config: commandConfig(),
        io: capture.io,
      });
      assert.equal(exit, 1);
      assert.equal(capture.err.some((line) => line.includes('config.local.json에만')), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rotates the persistent code into the local config with guidance', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'vibe-rotate-code-'));
    const capture = captureIo();
    let starts = 0;
    const rotated = 'rotated-persistent-code-abcdefghijklmnopqrstuvwxyz';
    try {
      await mkdir(path.join(root, '.vibe'), { recursive: true });
      await writeFile(path.join(root, '.vibe', 'config.local.json'), JSON.stringify({
        keep: true,
        proBridge: { enabled: true, mcp: { tunnelUrl: 'https://fixed.example.test' } },
      }), 'utf8');
      const exit = await runProBridge(['mcp', '--rotate-code'], {
        repoRoot: root,
        config: commandConfig({ tunnelUrl: 'https://fixed.example.test' }),
        io: capture.io,
        randomToken: () => rotated,
        mcpServer: {
          async start() {
            starts += 1;
            throw new Error('must not start');
          },
        },
      });
      assert.equal(exit, 0, capture.err.join('\n'));
      assert.equal(starts, 0);
      const local = JSON.parse(await readFile(path.join(root, '.vibe', 'config.local.json'), 'utf8')) as {
        keep: boolean;
        proBridge: { enabled: boolean; mcp: { persistentCode: string; tunnelUrl: string } };
      };
      assert.equal(local.keep, true);
      assert.equal(local.proBridge.enabled, true);
      assert.equal(local.proBridge.mcp.tunnelUrl, 'https://fixed.example.test');
      assert.equal(local.proBridge.mcp.persistentCode, rotated);
      assert.equal(capture.out.some((line) => line.includes('이번 1회')), true);
      assert.equal(capture.out.some((line) => line.includes(rotated)), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('passes the reserved ngrok domain to the tunnel and reports a stable connector url', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'vibe-fixed-ngrok-'));
    const capture = captureIo();
    const persistentCode = 'persistent-code-for-stable-ngrok-domain';
    let staticUrl: string | undefined;
    try {
      const exit = await runProBridge(['mcp'], {
        repoRoot: root,
        config: commandConfig({
          tunnel: 'ngrok',
          tunnelUrl: 'https://fixed.example.test',
          persistentCode,
        }),
        io: capture.io,
        mcpServer: {
          async start(options) {
            return inertServer(options.port);
          },
        },
        tunnel: {
          async start(_kind, _port, ports) {
            staticUrl = ports?.staticUrl;
            return { kind: 'ngrok', publicUrl: 'https://fixed.example.test', async stop() {} };
          },
        },
        waitForShutdown: async () => undefined,
      });
      assert.equal(exit, 0, capture.err.join('\n'));
      assert.equal(staticUrl, 'https://fixed.example.test');
      assert.equal(capture.out.some((line) => line.includes('재등록 불필요')), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('warns that cloudflared ignores the fixed tunnel domain', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'vibe-fixed-cloudflare-'));
    const capture = captureIo();
    try {
      const exit = await runProBridge(['mcp'], {
        repoRoot: root,
        config: commandConfig({ tunnel: 'cloudflared', tunnelUrl: 'https://fixed.example.test' }),
        io: capture.io,
        mcpServer: {
          async start(options) {
            return inertServer(options.port);
          },
        },
        tunnel: {
          async start() {
            return {
              kind: 'cloudflared',
              publicUrl: 'https://quick.trycloudflare.com',
              async stop() {},
            };
          },
        },
        waitForShutdown: async () => undefined,
      });
      assert.equal(exit, 0, capture.err.join('\n'));
      assert.equal(capture.out.some((line) => line.includes('quick tunnel로 계속')), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('starts the oauth server with introspection from configured tokens', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'vibe-oauth-command-'));
    const capture = captureIo();
    let captured: Parameters<typeof startMcpServer>[0] | null = null;
    try {
      const exit = await runProBridge(['mcp'], {
        repoRoot: root,
        config: commandConfig({
          authMode: 'oauth',
          oauthTokens: { 'configured-token': ['bridge.request.read'] },
        }),
        io: capture.io,
        mcpServer: {
          async start(options) {
            captured = options;
            return inertServer(options.port);
          },
        },
        tunnel: {
          async start() { return { kind: 'none', publicUrl: null, async stop() {} }; },
        },
        waitForShutdown: async () => undefined,
      });
      assert.equal(exit, 0, capture.err.join('\n'));
      assert.notEqual(captured, null);
      const started = captured as unknown as Parameters<typeof startMcpServer>[0];
      assert.equal(started.auth?.mode, 'oauth');
      assert.deepEqual(await started.auth?.introspectToken?.('configured-token'), ['bridge.request.read']);
      assert.equal(capture.out.some((line) => line.includes('?code=')), false);

      const missing = captureIo();
      const missingExit = await runProBridge(['mcp'], {
        repoRoot: root,
        config: commandConfig({ authMode: 'oauth', oauthTokens: null }),
        io: missing.io,
      });
      assert.equal(missingExit, 1);
      assert.equal(missing.err.some((line) => line.includes('oauthTokens')), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('flags security schemes that contradict the required scopes in the audit', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'vibe-auth-catalog-'));
    try {
      const store = new MailboxStore({ repoRoot: root, now: () => NOW });
      const noauth = createMailboxTools(store).map(serializeToolDescriptor);
      const oauth = noauth.map((descriptor) => applyAuthProfile(descriptor, 'oauth'));
      const changed = oauth.map((descriptor) => descriptor.name === 'publish_review_package'
        ? { ...descriptor, securitySchemes: [{ type: 'oauth2' as const, scopes: [] }] }
        : descriptor);
      const audit = auditToolCatalog as unknown as (
        descriptors: typeof changed,
      ) => Array<{ rule: string; tool: string }>;
      assert.equal(audit(noauth).some((finding) => finding.rule === 'security-scheme-mismatch'), false);
      const findings = audit(changed);
      assert.equal(findings.some((finding) => (
        finding.rule === 'security-scheme-mismatch'
        && finding.tool === 'publish_review_package'
      )), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('checks oauth protected resource metadata when the server reports oauth mode', async () => {
    const value = await oauthFixture();
    const capture = captureIo();
    try {
      const config = commandConfig({
        authMode: 'oauth',
        oauthTokens: oauthTokens(),
      });
      const exit = await runProBridge(['doctor', `${value.server.url}/mcp`], {
        repoRoot: value.root,
        config,
        io: capture.io,
      });
      assert.equal(exit, 0, capture.err.join('\n'));
      assert.equal(capture.out.includes('[PASS] oauth protected resource metadata'), true);
      assert.equal(capture.out.includes('[PASS] write scope advertised'), true);

      const blocked = captureIo();
      const blockedExit = await runProBridge(['doctor', `${value.server.url}/mcp`], {
        repoRoot: value.root,
        config,
        io: blocked.io,
        fetchPort: async (input, init) => String(input).includes('/.well-known/oauth-protected-resource')
          ? new Response('{"error":"blocked"}\n', {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
            })
          : fetch(input, init),
      });
      assert.equal(blockedExit, 1);
      assert.equal(blocked.out.some((line) => line.startsWith(
        '[FAIL] oauth protected resource metadata unreachable:',
      )), true);
    } finally {
      await cleanup(value);
    }
  });

  it('keeps the noauth metadata skip warning literal', async () => {
    const value = await noauthFixture();
    const capture = captureIo();
    try {
      const exit = await runProBridge([
        'doctor',
        `${value.server.url}/mcp?code=${encodeURIComponent(CONNECT_CODE)}`,
      ], {
        repoRoot: value.root,
        config: commandConfig(),
        io: capture.io,
      });
      assert.equal(exit, 0, capture.err.join('\n'));
      assert.equal(capture.out.includes(
        '[WARN] oauth metadata check skipped (noauth-local profile)',
      ), true);
    } finally {
      await cleanup(value);
    }
  });
});
