import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runProBridge, type ProBridgeIo } from '../src/commands/pro-bridge.js';
import { MailboxStore } from '../src/pro-bridge/mailbox/store.js';
import {
  TOOL_CATALOG_VERSION,
  buildCatalogSnapshot,
  createMailboxTools,
  serializeToolDescriptor,
} from '../src/pro-bridge/mailbox/tools.js';

const NOW = new Date('2026-07-16T00:00:00.000Z');
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function captureIo(): { io: ProBridgeIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { out: (line) => out.push(line), err: (line) => err.push(line), confirm: async () => false },
  };
}

function catalog(repoRoot: string) {
  return createMailboxTools(new MailboxStore({ repoRoot, now: () => NOW }), { now: () => NOW });
}

function rpcFetch(
  repoRoot: string,
  options: {
    omitPublish?: boolean;
    catalogVersion?: string;
    mutate?: (descriptors: Array<Record<string, unknown>>) => void;
  } = {},
): typeof fetch {
  return (async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      id: number;
      method: string;
      params?: { name?: string };
    };
    let result: unknown;
    if (body.method === 'initialize') {
      result = {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'test', version: String(TOOL_CATALOG_VERSION) },
      };
    } else if (body.method === 'tools/list') {
      const descriptors = catalog(repoRoot)
        .filter((tool) => !options.omitPublish || tool.name !== 'publish_review_package')
        .map(serializeToolDescriptor) as unknown as Array<Record<string, unknown>>;
      options.mutate?.(descriptors);
      result = { tools: descriptors };
    } else if (body.method === 'tools/call' && body.params?.name === 'bridge_capabilities') {
      result = {
        content: [{
          type: 'text',
          text: JSON.stringify({ toolCatalogVersion: options.catalogVersion ?? '2' }),
        }],
        structuredContent: { toolCatalogVersion: options.catalogVersion ?? '2' },
        isError: false,
      };
    } else {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { message: 'unknown' } }), { status: 200 });
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

async function withRoot(run: (repoRoot: string) => Promise<void>): Promise<void> {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'vibe-pro-doctor-'));
  try {
    await run(repoRoot);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
}

describe('Pro Bridge doctor', () => {
  it('passes the doctor against a live compliant server', async () => {
    await withRoot(async (repoRoot) => {
      const capture = captureIo();
      const exit = await runProBridge(['doctor', 'http://127.0.0.1:18488/mcp?code=test'], {
        repoRoot,
        io: capture.io,
        fetchPort: rpcFetch(repoRoot),
        now: () => NOW,
      });
      assert.equal(exit, 0, capture.err.join('\n'));
      assert.ok(capture.out.includes('[PASS] publish_review_package'));
    });
  });

  it('fails the doctor when the publish tool is missing', async () => {
    await withRoot(async (repoRoot) => {
      const capture = captureIo();
      const exit = await runProBridge(['doctor', 'http://127.0.0.1/mcp?code=test'], {
        repoRoot,
        io: capture.io,
        fetchPort: rpcFetch(repoRoot, { omitPublish: true }),
        now: () => NOW,
      });
      assert.equal(exit, 1);
      assert.ok(capture.err.includes('[FAIL] publish_review_package missing'));
    });
  });

  it('warns on a tool catalog version mismatch with a refresh action', async () => {
    await withRoot(async (repoRoot) => {
      const capture = captureIo();
      const exit = await runProBridge(['doctor', 'http://127.0.0.1/mcp?code=test'], {
        repoRoot,
        io: capture.io,
        fetchPort: rpcFetch(repoRoot, { catalogVersion: '1' }),
        now: () => NOW,
      });
      assert.equal(exit, 0, capture.err.join('\n'));
      assert.ok(capture.out.includes('[WARN] server catalog v1, skill expects v2'));
      assert.ok(capture.out.includes('[ACTION] redeploy and Refresh the ChatGPT developer-mode app'));
    });
  });

  it('fails the doctor when the endpoint is unreachable', async () => {
    await withRoot(async (repoRoot) => {
      const capture = captureIo();
      const fetchPort = (async () => { throw new Error('connection refused'); }) as typeof fetch;
      const exit = await runProBridge(['doctor', 'http://127.0.0.1:1/mcp'], {
        repoRoot,
        io: capture.io,
        fetchPort,
        now: () => NOW,
      });
      assert.equal(exit, 1);
      assert.match(capture.err.join('\n'), /\[FAIL] MCP endpoint unreachable: connection refused/);
    });
  });

  it('fails the doctor when served annotations drift from the expected catalog', async () => {
    await withRoot(async (repoRoot) => {
      const capture = captureIo();
      const exit = await runProBridge(['doctor', 'http://127.0.0.1/mcp'], {
        repoRoot,
        io: capture.io,
        fetchPort: rpcFetch(repoRoot, {
          mutate: (served) => {
            const create = served.find((tool) => tool.name === 'create_request')!;
            create.annotations = {
              ...(create.annotations as Record<string, unknown>),
              readOnlyHint: true,
            };
          },
        }),
        now: () => NOW,
      });
      assert.equal(exit, 1);
      assert.match(capture.err.join('\n'), /create_request: annotations mismatch|write-tool-readonly/);
    });
  });

  it('runs the catalog audit subcommand cleanly against the committed snapshot', async () => {
    const capture = captureIo();
    const exit = await runProBridge(['catalog-audit'], {
      repoRoot: REPO_ROOT,
      io: capture.io,
      now: () => NOW,
    });
    assert.equal(exit, 0, capture.err.join('\n'));
    assert.match(capture.out.join('\n'), /\[PASS] catalog audit: 14 tools, 0 findings, snapshot match/);
  });

  it('fails the catalog audit subcommand when the snapshot drifts', async () => {
    await withRoot(async (repoRoot) => {
      const snapshot = path.join(repoRoot, 'drift.json');
      await writeFile(snapshot, '{"schemaVersion":"drift"}\n', 'utf8');
      const capture = captureIo();
      const exit = await runProBridge(['catalog-audit', '--snapshot', snapshot], {
        repoRoot,
        io: capture.io,
        now: () => NOW,
      });
      assert.equal(exit, 1);
      assert.match(capture.err.join('\n'), /snapshot mismatch/);
    });
  });

  it('writes the exact catalog snapshot when requested', async () => {
    await withRoot(async (repoRoot) => {
      const snapshotPath = path.join(repoRoot, 'snapshot.json');
      const capture = captureIo();
      const exit = await runProBridge([
        'catalog-audit', '--write-snapshot', '--snapshot', snapshotPath,
      ], { repoRoot, io: capture.io, now: () => NOW });
      assert.equal(exit, 0, capture.err.join('\n'));
      const expected = buildCatalogSnapshot(catalog(repoRoot).map(serializeToolDescriptor));
      assert.deepEqual(JSON.parse(await readFile(snapshotPath, 'utf8')), expected);
    });
  });
});
