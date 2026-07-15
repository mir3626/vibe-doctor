import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  computePayloadSha256,
  type ReviewRequest,
  type ReviewResultManifest,
} from '../src/pro-bridge/contract.js';
import { startMcpServer, type RunningMcpServer } from '../src/pro-bridge/mailbox/server.js';
import { MailboxStore } from '../src/pro-bridge/mailbox/store.js';
import { createMailboxTools } from '../src/pro-bridge/mailbox/tools.js';

const TOKEN = 'server-test-token';
const NOW = new Date('2026-07-15T08:00:00.000Z');
const REQUEST_ID = 'AUD-20260715-server01';
const FOLDER = '2026-07-15-server-round-trip-pro-review';

interface RpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

function reviewRequest(): ReviewRequest {
  const draft: ReviewRequest = {
    schemaVersion: 'vibe-pro-review-request-v1', requestId: REQUEST_ID, kind: 'goal_audit', origin: 'cli',
    repository: { fullName: 'owner/repo', remoteUrl: 'https://github.com/owner/repo.git', defaultBranch: 'main' },
    git: {
      baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40), branch: 'main',
      headVisibleOnGitHub: true, compareUrlHint: null, patchAttachmentSha256: null,
    },
    goalSource: null, userGoal: 'Audit MCP HTTP.', reviewPrompt: '# Audit MCP HTTP',
    outputContract: { requiredFiles: ['README.md', 'REVIEW.md', 'FINDINGS.json', 'prompt/CLI_MAIN_SESSION_PROMPT.md'] },
    createdAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
    payloadSha256: '0'.repeat(64),
  };
  return { ...draft, payloadSha256: computePayloadSha256(draft) };
}

function packageFiles(): Array<{ path: string; content: string }> {
  return [
    { path: 'README.md', content: '# MCP server result\n' },
    { path: 'REVIEW.md', content: '# Review\n\nServer round trip passed.\n' },
    { path: 'FINDINGS.json', content: '{"findings":[]}\n' },
    { path: 'prompt/CLI_MAIN_SESSION_PROMPT.md', content: '# Next\n\nWait for approval.\n' },
  ];
}

function resultManifest(request: ReviewRequest): ReviewResultManifest {
  const files = packageFiles();
  const draft: ReviewResultManifest = {
    schemaVersion: 'vibe-pro-review-result-v1', requestId: request.requestId,
    requestPayloadSha256: request.payloadSha256, repositoryFullName: request.repository.fullName,
    reviewedBaseSha: request.git.baseSha, reviewedHeadSha: request.git.headSha, resultKind: 'audit',
    proposedFolder: FOLDER, disposition: 'approved',
    files: files.map((file) => {
      const bytes = Buffer.from(file.content, 'utf8');
      return {
        path: file.path,
        mediaType: file.path.endsWith('.json') ? 'application/json' : 'text/markdown',
        byteLength: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    }),
    findingsSummary: { p0: 0, p1: 0, p2: 0, p3: 0 },
    reviewerDeclaration: { surface: 'chatgpt-web', requestedMode: 'pro', githubConnectorUsed: true, limitations: [] },
    createdAt: NOW.toISOString(), payloadSha256: '0'.repeat(64),
  };
  return { ...draft, payloadSha256: computePayloadSha256(draft) };
}

async function fixture(log?: (line: string) => void): Promise<{
  root: string;
  store: MailboxStore;
  server: RunningMcpServer;
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'vibe-mcp-server-'));
  const store = new MailboxStore({ repoRoot: root, now: () => NOW });
  const server = await startMcpServer({
    tools: createMailboxTools(store), token: TOKEN, port: 0, host: '127.0.0.1',
    ...(log === undefined ? {} : { log }),
  });
  return { root, store, server };
}

async function cleanup(value: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  await value.server.close();
  await rm(value.root, { recursive: true, force: true });
}

async function rpc(
  server: RunningMcpServer,
  body: unknown,
  options: { token?: string; query?: boolean; origin?: string } = {},
): Promise<{ response: Response; value: RpcResponse | null }> {
  const token = options.token ?? TOKEN;
  const response = await fetch(
    `${server.url}/mcp${options.query ? `?token=${encodeURIComponent(token)}` : ''}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.query ? {} : { Authorization: `Bearer ${token}` }),
        ...(options.origin === undefined ? {} : { Origin: options.origin }),
      },
      body: JSON.stringify(body),
    },
  );
  const text = await response.text();
  return { response, value: text ? JSON.parse(text) as RpcResponse : null };
}

async function callTool(
  server: RunningMcpServer,
  id: number,
  name: string,
  args: unknown,
): Promise<Record<string, unknown>> {
  const response = await rpc(server, {
    jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args },
  });
  assert.equal(response.response.status, 200);
  assert.equal(response.value?.error, undefined);
  const result = response.value?.result;
  assert.equal(result?.isError, false);
  const content = result?.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0]!.text) as Record<string, unknown>;
}

describe('mcp mailbox http server', () => {
  it('completes the initialize handshake over streamable http', async () => {
    const value = await fixture();
    try {
      const response = await rpc(value.server, {
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
      });
      assert.equal(response.value?.result?.protocolVersion, '2025-06-18');
      assert.deepEqual(response.value?.result?.capabilities, { tools: {} });
      assert.deepEqual(response.value?.result?.serverInfo, { name: 'vibe-pro-bridge', version: '1' });
    } finally { await cleanup(value); }
  });

  it('rejects requests without a valid bearer token', async () => {
    const value = await fixture();
    try {
      for (const headers of [{}, { Authorization: 'Bearer wrong-token' }]) {
        const response = await fetch(`${value.server.url}/mcp`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
        });
        assert.equal(response.status, 401);
        assert.equal(response.headers.get('www-authenticate'), 'Bearer');
      }
    } finally { await cleanup(value); }
  });

  it('accepts the token from the authorization header or the query string', async () => {
    const value = await fixture();
    try {
      const body = { jsonrpc: '2.0', id: 1, method: 'ping' };
      assert.equal((await rpc(value.server, body)).value?.error, undefined);
      assert.equal((await rpc(value.server, body, { query: true })).value?.error, undefined);
    } finally { await cleanup(value); }
  });

  it('lists the mailbox tools over tools list', async () => {
    const value = await fixture();
    try {
      const response = await rpc(value.server, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
      const tools = response.value?.result?.tools as Array<{ inputSchema: { type: string } }>;
      assert.equal(tools.length, 11);
      assert.equal(tools.every((tool) => tool.inputSchema.type === 'object'), true);
    } finally { await cleanup(value); }
  });

  it('returns method not found for unknown json rpc methods', async () => {
    const value = await fixture();
    try {
      const response = await rpc(value.server, { jsonrpc: '2.0', id: 1, method: 'resources/list' });
      assert.equal(response.value?.error?.code, -32601);
    } finally { await cleanup(value); }
  });

  it('acknowledges notifications with http 202', async () => {
    const value = await fixture();
    try {
      const response = await rpc(value.server, {
        jsonrpc: '2.0', method: 'notifications/initialized', params: {},
      });
      assert.equal(response.response.status, 202);
      assert.equal(response.value, null);
    } finally { await cleanup(value); }
  });

  it('rejects non post methods on the mcp endpoint', async () => {
    const value = await fixture();
    try {
      const response = await fetch(`${value.server.url}/mcp?token=${TOKEN}`);
      assert.equal(response.status, 405);
      assert.equal(response.headers.get('allow'), 'POST');
    } finally { await cleanup(value); }
  });

  it('rejects browser origin requests', async () => {
    const value = await fixture();
    try {
      const response = await rpc(
        value.server,
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { origin: 'https://example.com' },
      );
      assert.equal(response.response.status, 403);
    } finally { await cleanup(value); }
  });

  it('round trips a chunked upload from claim to result manifest through tools call', async () => {
    const value = await fixture();
    try {
      const request = reviewRequest();
      const files = packageFiles();
      const manifest = resultManifest(request);
      await callTool(value.server, 1, 'create_request', { request });
      await callTool(value.server, 2, 'claim_request', { requestId: request.requestId });
      await callTool(value.server, 3, 'begin_result', { requestId: request.requestId });
      let id = 4;
      for (const file of files) {
        if (file.path === 'README.md') {
          const parts = [file.content.slice(0, 8), file.content.slice(8)];
          for (const index of [1, 0]) {
            await callTool(value.server, id++, 'put_result_file', {
              requestId: request.requestId, filePath: file.path, chunkIndex: index, chunkCount: 2,
              content: parts[index], chunkSha256: createHash('sha256').update(parts[index]!).digest('hex'),
            });
          }
        } else {
          await callTool(value.server, id++, 'put_result_file', {
            requestId: request.requestId, filePath: file.path, chunkIndex: 0, chunkCount: 1,
            content: file.content, chunkSha256: createHash('sha256').update(file.content).digest('hex'),
          });
        }
      }
      const finalized = await callTool(value.server, id++, 'finalize_result', {
        requestId: request.requestId, manifest,
      });
      assert.match(String(finalized.resultFilesSha256), /^[0-9a-f]{64}$/);
      const received = await callTool(value.server, id, 'get_result_manifest', { requestId: request.requestId });
      assert.deepEqual(received.manifest, manifest);
    } finally { await cleanup(value); }
  });

  it('masks the token in server logs', async () => {
    const lines: string[] = [];
    const value = await fixture((line) => lines.push(line));
    try {
      await rpc(value.server, { jsonrpc: '2.0', id: 1, method: 'ping' }, { query: true });
      assert.equal(lines.some((line) => line.includes(TOKEN)), false);
      assert.equal(lines.some((line) => line.includes('?token=')), false);
    } finally { await cleanup(value); }
  });
});
