import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  DEFAULT_PRO_BRIDGE_API_CONFIG,
  type ProBridgeApiConfig,
} from '../src/lib/config.js';
import {
  computePayloadSha256,
  type ReviewRequest,
} from '../src/pro-bridge/contract.js';
import { MailboxStore } from '../src/pro-bridge/mailbox/store.js';
import {
  estimateReviewCost,
  ResponsesApiExecutionError,
  ResponsesApiTransport,
} from '../src/pro-bridge/transports/responses-api.js';
import { WorkspaceAgentTransport } from '../src/pro-bridge/transports/workspace-agent.js';
import { serializeVibeBundle } from '../src/pro-bridge/vibe-bundle.js';

const NOW = new Date('2026-07-15T08:00:00.000Z');
const HEAD_SHA = 'b'.repeat(40);

function request(requestId: string, goal = 'Design optional automation.'): ReviewRequest {
  const draft: ReviewRequest = {
    schemaVersion: 'vibe-pro-review-request-v1',
    requestId,
    kind: 'feature_design',
    origin: 'cli',
    repository: {
      fullName: 'owner/repo',
      remoteUrl: 'https://github.com/owner/repo.git',
      defaultBranch: 'main',
    },
    git: {
      baseSha: HEAD_SHA,
      headSha: HEAD_SHA,
      branch: 'main',
      headVisibleOnGitHub: true,
      compareUrlHint: null,
      patchAttachmentSha256: null,
    },
    goalSource: null,
    userGoal: goal,
    reviewPrompt: `# Optional automation\n\n${goal}`,
    outputContract: {
      requiredFiles: [
        'README.md',
        'DESIGN.md',
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

function apiConfig(overrides: Partial<ProBridgeApiConfig> = {}): ProBridgeApiConfig {
  return {
    ...DEFAULT_PRO_BRIDGE_API_CONFIG,
    enabled: true,
    model: 'frontier-test',
    priceInputPerMTok: 2,
    priceOutputPerMTok: 8,
    pollIntervalMs: 0,
    ...overrides,
  };
}

function resultBundle(requestId: string): string {
  return serializeVibeBundle({
    requestId,
    folder: '2026-07-15-optional-automation-design',
    files: [
      { path: 'README.md', content: '# Optional automation\n' },
      { path: 'DESIGN.md', content: '# Design\n\nUse the shared mailbox.\n' },
      {
        path: 'FINDINGS.json',
        content: JSON.stringify({
          disposition: 'approved',
          findings: [{ priority: 'P2', summary: 'Keep status authoritative.' }],
        }),
      },
      {
        path: 'prompt/CLI_MAIN_SESSION_PROMPT.md',
        content: '# Implement\n\nPreserve mailbox lifecycle invariants.\n',
      },
    ],
  });
}

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'vibe-pro-adapters-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('workspace agent transport', () => {
  it('triggers the external agent command once for a ready request', async () => {
    await withRoot(async (root) => {
      const calls: string[][] = [];
      const transport = new WorkspaceAgentTransport({
        repoRoot: root,
        now: () => NOW,
        triggerCommand: ['agent-cli', '--request', '{requestId}'],
        trigger: {
          async run(argv) {
            calls.push(argv);
            return { ok: true, code: 0, stdout: 'accepted', stderr: '' };
          },
        },
      });
      const input = request('DES-20260715-workspace1');
      await transport.createRequest(input);
      assert.deepEqual(await transport.trigger(input.requestId), {
        triggered: true,
        reason: 'trigger accepted; poll bridge status for completion',
      });
      assert.deepEqual(calls, [['agent-cli', '--request', input.requestId]]);
    });
  });

  it('skips duplicate triggers after the request leaves the ready state', async () => {
    await withRoot(async (root) => {
      let calls = 0;
      const transport = new WorkspaceAgentTransport({
        repoRoot: root,
        now: () => NOW,
        triggerCommand: ['agent-cli'],
        trigger: {
          async run() {
            calls += 1;
            return { ok: true, code: 0, stdout: '', stderr: '' };
          },
        },
      });
      const input = request('DES-20260715-workspace2');
      await transport.createRequest(input);
      await new MailboxStore({ repoRoot: root, now: () => NOW }).claimRequest(input.requestId);
      const result = await transport.trigger(input.requestId);
      assert.equal(result.triggered, false);
      assert.match(result.reason, /already claimed/);
      assert.equal(calls, 0);
    });
  });

  it('never reads results from the trigger response', async () => {
    await withRoot(async (root) => {
      const transport = new WorkspaceAgentTransport({
        repoRoot: root,
        now: () => NOW,
        triggerCommand: ['agent-cli'],
        trigger: {
          async run() {
            return {
              ok: true,
              code: 0,
              stdout: JSON.stringify({ state: 'result-ready', manifest: { payloadSha256: 'fake' } }),
              stderr: '',
            };
          },
        },
      });
      const input = request('DES-20260715-workspace3');
      await transport.createRequest(input);
      await transport.trigger(input.requestId);
      assert.equal((await transport.getRequestStatus(input.requestId)).state, 'ready');
      assert.equal(await transport.getResultManifest(input.requestId), null);
    });
  });
});

describe('responses api transport', () => {
  it('estimates the review cost deterministically before any network call', () => {
    let fetchCalls = 0;
    const input = request('DES-20260715-cost');
    const config = apiConfig();
    const estimate = estimateReviewCost(input, config);
    const submittedPrompt = [
      input.reviewPrompt,
      '',
      'Return exactly one VIBE-BUNDLE v1 block.',
      `Echo requestId: ${input.requestId}.`,
      `Include every required file: ${input.outputContract.requiredFiles.join(', ')}.`,
    ].join('\n');
    const inputTokens = Math.ceil(Buffer.byteLength(submittedPrompt, 'utf8') / 4);
    assert.equal(estimate.inputTokens, inputTokens);
    assert.equal(estimate.outputTokens, 30_000);
    assert.equal(
      estimate.usd,
      (inputTokens * config.priceInputPerMTok + 30_000 * config.priceOutputPerMTok) / 1_000_000,
    );
    assert.equal(fetchCalls, 0);
  });

  it('refuses a request whose estimated input exceeds the configured limit', () => {
    const estimate = estimateReviewCost(
      request('DES-20260715-limit', 'x'.repeat(4_000)),
      apiConfig({ maxInputTokens: 1 }),
    );
    assert.equal(estimate.exceedsLimit, true);
  });

  it('round trips a background response into a mailbox result with a forced surface', async () => {
    await withRoot(async (root) => {
      const input = request('DES-20260715-response1');
      const responses = [
        jsonResponse({ id: 'resp_1', status: 'queued' }),
        jsonResponse({ id: 'resp_1', status: 'in_progress' }),
        jsonResponse({ id: 'resp_1', status: 'completed', output_text: resultBundle(input.requestId) }),
      ];
      const fakeFetch = (async () => responses.shift()!) as typeof fetch;
      const transport = new ResponsesApiTransport({
        repoRoot: root,
        now: () => NOW,
        apiKey: 'test-key',
        api: apiConfig(),
        ports: { fetch: fakeFetch, async sleep() {} },
      });
      await transport.createRequest(input);
      assert.deepEqual(await transport.execute(input.requestId), { resultReady: true, attempts: 1 });
      const manifest = await transport.getResultManifest(input.requestId);
      assert.equal(manifest?.reviewerDeclaration.surface, 'responses-api');
      assert.equal(manifest?.reviewerDeclaration.githubConnectorUsed, false);
      assert.equal((await transport.getRequestStatus(input.requestId)).state, 'result-ready');
    });
  });

  it('retries a failed submission at most once', async () => {
    await withRoot(async (root) => {
      const input = request('DES-20260715-response2');
      let submissions = 0;
      const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        if (init?.method === 'POST') {
          submissions += 1;
          if (submissions === 1) return jsonResponse({ error: 'temporary' }, 500);
          return jsonResponse({
            id: 'resp_retry',
            status: 'completed',
            output_text: resultBundle(input.requestId),
          });
        }
        throw new Error('unexpected poll');
      }) as typeof fetch;
      const transport = new ResponsesApiTransport({
        repoRoot: root,
        now: () => NOW,
        apiKey: 'test-key',
        api: apiConfig(),
        ports: { fetch: fakeFetch, async sleep() {} },
      });
      await transport.createRequest(input);
      assert.deepEqual(await transport.execute(input.requestId), { resultReady: true, attempts: 2 });
      assert.equal(submissions, 2);
    });

    await withRoot(async (root) => {
      const input = request('DES-20260715-response3');
      let submissions = 0;
      const fakeFetch = (async () => {
        submissions += 1;
        return jsonResponse({ error: 'temporary' }, 503);
      }) as typeof fetch;
      const transport = new ResponsesApiTransport({
        repoRoot: root,
        now: () => NOW,
        apiKey: 'test-key',
        api: apiConfig(),
        ports: { fetch: fakeFetch, async sleep() {} },
      });
      await transport.createRequest(input);
      await assert.rejects(
        transport.execute(input.requestId),
        (error: unknown) => error instanceof ResponsesApiExecutionError && error.attempts === 2,
      );
      assert.equal(submissions, 2);
    });
  });

  it('does not mark the request result ready when the api fails', async () => {
    await withRoot(async (root) => {
      const input = request('DES-20260715-response4');
      const fakeFetch = (async () => jsonResponse({ error: 'unavailable' }, 503)) as typeof fetch;
      const transport = new ResponsesApiTransport({
        repoRoot: root,
        now: () => NOW,
        apiKey: 'test-key',
        api: apiConfig(),
        ports: { fetch: fakeFetch, async sleep() {} },
      });
      await transport.createRequest(input);
      await assert.rejects(transport.execute(input.requestId), ResponsesApiExecutionError);
      assert.notEqual((await transport.getRequestStatus(input.requestId)).state, 'result-ready');
      assert.equal(await transport.getResultManifest(input.requestId), null);
    });
  });
});
