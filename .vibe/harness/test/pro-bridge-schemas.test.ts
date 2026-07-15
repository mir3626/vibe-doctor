import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import {
  CLI_PROMPT_CONTRACT_REQUIREMENTS,
  FindingsFileSchema,
  GoalSourceManifestSchema,
  ReviewRequestSchema,
  ReviewResultManifestSchema,
} from '../src/lib/schemas/pro-bridge.js';
import {
  canTransition,
  computePayloadSha256,
  type GoalSourceManifest,
  type ReviewRequest,
  type ReviewResultManifest,
} from '../src/pro-bridge/contract.js';

const SHA_0 = '0'.repeat(40);
const SHA_1 = '1'.repeat(40);
const HASH_2 = '2'.repeat(64);
const HASH_3 = '3'.repeat(64);

function goalSourceFixture(): GoalSourceManifest {
  return {
    schemaVersion: 'vibe-goal-source-v1',
    repository: {
      root: '/workspace/example',
      remoteUrl: 'https://github.com/owner/repo',
      fullName: 'owner/repo',
    },
    source: {
      kind: 'codex-goal',
      confidence: 'exact',
      threadId: 'thread-1',
      iterationId: null,
      goalText: 'Review the implemented bridge contract.',
      goalStatus: 'completed',
    },
    designRefs: ['docs/plans/web-pro-bridge/design.md'],
    implementationRefs: ['docs/prompts/sprint-vpb-01-contracts-discovery.md'],
    baseSha: SHA_0,
    headSha: SHA_1,
    commitShas: [SHA_1],
    scope: {
      changedFiles: ['src/example.ts', 'test/example.test.ts'],
      codeFiles: ['src/example.ts'],
      testFiles: ['test/example.test.ts'],
      migrationFiles: [],
      docsFiles: [],
      scopeGlobs: ['src/**', 'test/**'],
    },
    dirtyState: {
      staged: [],
      unstaged: [],
      untracked: [],
      patchSha256: null,
    },
    unresolved: [],
    payloadSha256: HASH_2,
  };
}

function reviewRequestFixture(): ReviewRequest {
  return {
    schemaVersion: 'vibe-pro-review-request-v1',
    requestId: 'AUD-20260715-abc123',
    kind: 'goal_audit',
    origin: 'cli',
    repository: {
      fullName: 'owner/repo',
      remoteUrl: 'https://github.com/owner/repo',
      defaultBranch: 'main',
    },
    git: {
      baseSha: SHA_0,
      headSha: SHA_1,
      branch: 'main',
      headVisibleOnGitHub: true,
      compareUrlHint: null,
      patchAttachmentSha256: null,
    },
    // The package example contains an intentionally incomplete goalSource sketch.
    // This fixture embeds the complete authoritative GoalSourceManifest contract.
    goalSource: goalSourceFixture(),
    userGoal: 'Review the last implemented goal.',
    reviewPrompt: 'Use the connected GitHub repository and review the exact range.',
    outputContract: {
      requiredFiles: [
        'README.md',
        'REVIEW.md',
        'FINDINGS.json',
        'prompt/CLI_MAIN_SESSION_PROMPT.md',
      ],
    },
    createdAt: '2026-07-15T00:00:00.000Z',
    expiresAt: '2026-07-18T00:00:00.000Z',
    payloadSha256: HASH_2,
  };
}

function reviewResultFixture(): ReviewResultManifest {
  return {
    schemaVersion: 'vibe-pro-review-result-v1',
    requestId: 'AUD-20260715-abc123',
    requestPayloadSha256: HASH_2,
    repositoryFullName: 'owner/repo',
    reviewedBaseSha: SHA_0,
    reviewedHeadSha: SHA_1,
    resultKind: 'audit',
    proposedFolder: '2026-07-15-example-goal-pro-review',
    disposition: 'remediation-required',
    files: [
      {
        path: 'README.md',
        mediaType: 'text/markdown',
        byteLength: 100,
        sha256: HASH_3,
      },
      {
        path: 'prompt/CLI_MAIN_SESSION_PROMPT.md',
        mediaType: 'text/markdown',
        byteLength: 100,
        sha256: '4'.repeat(64),
      },
    ],
    findingsSummary: { p0: 1, p1: 2, p2: 0, p3: 0 },
    reviewerDeclaration: {
      surface: 'chatgpt-web',
      requestedMode: 'pro',
      githubConnectorUsed: true,
      limitations: [],
    },
    createdAt: '2026-07-15T01:00:00.000Z',
    payloadSha256: '5'.repeat(64),
  };
}

function rejects(schema: { safeParse(value: unknown): { success: boolean } }, value: unknown): void {
  assert.equal(schema.safeParse(value).success, false);
}

describe('pro-bridge schemas', () => {
  it('parses authoritative goal, request, and result fixtures', () => {
    assert.deepEqual(GoalSourceManifestSchema.parse(goalSourceFixture()), goalSourceFixture());
    assert.deepEqual(ReviewRequestSchema.parse(reviewRequestFixture()), reviewRequestFixture());
    assert.deepEqual(ReviewResultManifestSchema.parse(reviewResultFixture()), reviewResultFixture());
  });

  it('rejects invalid versions, hashes, enums, counts, folders, and paths', () => {
    rejects(GoalSourceManifestSchema, { ...goalSourceFixture(), schemaVersion: 'vibe-goal-source-v2' });
    rejects(GoalSourceManifestSchema, { ...goalSourceFixture(), baseSha: 'short' });
    rejects(GoalSourceManifestSchema, { ...goalSourceFixture(), payloadSha256: 'not-a-sha256' });
    rejects(ReviewRequestSchema, { ...reviewRequestFixture(), kind: 'security_review' });
    rejects(ReviewResultManifestSchema, { ...reviewResultFixture(), disposition: 'ignored' });
    rejects(ReviewResultManifestSchema, {
      ...reviewResultFixture(),
      findingsSummary: { p0: -1, p1: 0, p2: 0, p3: 0 },
    });
    rejects(ReviewResultManifestSchema, { ...reviewResultFixture(), proposedFolder: 'Bad Folder' });
    rejects(ReviewResultManifestSchema, {
      ...reviewResultFixture(),
      files: [{ ...reviewResultFixture().files[0], path: '../escape.md' }],
    });
  });

  it('accepts the checked-in remediation package under the versioned findings contract', async () => {
    const packageRoot = 'docs/plans/2026-07-15-web-pro-bridge-goal-audit-pro-review';
    const findings = FindingsFileSchema.parse(JSON.parse(await readFile(
      `${packageRoot}/FINDINGS.json`,
      'utf8',
    )) as unknown);
    const prompt = await readFile(`${packageRoot}/prompt/CLI_MAIN_SESSION_PROMPT.md`, 'utf8');
    const normalized = prompt
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[`*_>#~[\]()]/g, ' ')
      .replace(/[\u2013\u2014:|/\\-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    assert.equal(prompt.includes(findings.repository.fullName), true);
    assert.equal(prompt.includes(findings.snapshot.headSha), true);
    for (const requirement of CLI_PROMPT_CONTRACT_REQUIREMENTS) {
      for (const group of requirement.groups) {
        assert.equal(
          group.patterns.some((pattern) => pattern.test(normalized)),
          true,
          `${requirement.key}:${group.label}`,
        );
      }
    }
  });

  it('computes a deterministic payload hash independent of key order and the hash field', () => {
    const left = { z: [3, { b: 2, a: 1 }], a: 'value', payloadSha256: 'f'.repeat(64) };
    const right = { payloadSha256: '0'.repeat(64), a: 'value', z: [3, { a: 1, b: 2 }] };
    const withoutHash = { a: 'value', z: [3, { a: 1, b: 2 }] };
    assert.equal(computePayloadSha256(left), computePayloadSha256(right));
    assert.equal(computePayloadSha256(left), computePayloadSha256(withoutHash));
    assert.match(computePayloadSha256(left), /^[0-9a-f]{64}$/);
  });

  it('enforces the request lifecycle direction and terminal states', () => {
    assert.equal(canTransition('draft', 'ready'), true);
    assert.equal(canTransition('ready', 'claimed'), true);
    assert.equal(canTransition('reviewing', 'failed'), true);
    assert.equal(canTransition('claimed', 'ready'), false);
    assert.equal(canTransition('imported', 'failed'), false);
    assert.equal(canTransition('cancelled', 'ready'), false);
  });
});
