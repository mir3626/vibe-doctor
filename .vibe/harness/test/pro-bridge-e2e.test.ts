import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { runProBridge, type ProBridgeIo } from '../src/commands/pro-bridge.js';
import { DEFAULT_PRO_BRIDGE_CONFIG } from '../src/lib/config.js';
import {
  type GoalSourceManifest,
} from '../src/pro-bridge/contract.js';
import { resolveGoalSource } from '../src/pro-bridge/goal-source/resolver.js';
import type {
  GitPort,
  GoalSourceProvider,
} from '../src/pro-bridge/goal-source/types.js';
import { buildReviewRequest } from '../src/pro-bridge/prompt-composer.js';
import type { ScopeResolution } from '../src/pro-bridge/scope-resolver.js';
import { ManualDirectoryTransport } from '../src/pro-bridge/transports/manual.js';
import { serializeVibeBundle } from '../src/pro-bridge/vibe-bundle.js';

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const NOW = new Date('2026-07-15T08:00:00.000Z');
const REQUEST_ID = 'AUD-20260715-e2e123';
const RESULT_FOLDER = '2026-07-15-manual-round-trip-pro-review';

function syntheticGoal(repoRoot: string): GoalSourceManifest {
  return {
    schemaVersion: 'vibe-goal-source-v1',
    repository: {
      root: repoRoot,
      remoteUrl: 'https://github.com/owner/repo.git',
      fullName: 'owner/repo',
    },
    source: {
      kind: 'codex-goal',
      confidence: 'exact',
      threadId: 'thread-e2e',
      iterationId: null,
      goalText: 'Audit the completed manual Pro Bridge transport.',
      goalStatus: 'completed',
    },
    designRefs: ['docs/plans/web-pro-bridge/design.md'],
    implementationRefs: ['docs/prompts/sprint-vpb-03-manual-transport-skills.md'],
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    commitShas: [HEAD_SHA],
    scope: {
      changedFiles: ['.vibe/harness/src/pro-bridge/transports/manual.ts'],
      codeFiles: ['.vibe/harness/src/pro-bridge/transports/manual.ts'],
      testFiles: [],
      migrationFiles: [],
      docsFiles: [],
      scopeGlobs: ['.vibe/harness/src/pro-bridge/**'],
    },
    dirtyState: {
      staged: [],
      unstaged: [],
      untracked: [],
      patchSha256: null,
    },
    unresolved: [],
    payloadSha256: '0'.repeat(64),
  };
}

function githubScope(): ScopeResolution {
  return {
    repository: {
      fullName: 'owner/repo',
      remoteUrl: 'https://github.com/owner/repo.git',
      defaultBranch: 'main',
    },
    git: {
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      branch: 'feature/manual-transport',
      baseVisibility: 'remote',
      headVisibility: 'remote',
      headVisibleOnGitHub: true,
      compareUrlHint: `https://github.com/owner/repo/compare/${BASE_SHA}...${HEAD_SHA}`,
    },
    visibilityCase: 'github-range',
    blockedReasons: [],
    patch: null,
    warnings: [],
  };
}

const unusedGit: GitPort = {
  async run() {
    return { ok: false, stdout: '', stderr: 'not used by synthetic provider', code: 1 };
  },
};

function goalProvider(repoRoot: string): GoalSourceProvider {
  return {
    kind: 'codex-goal',
    async discover() {
      return { status: 'candidate', manifest: syntheticGoal(repoRoot) };
    },
  };
}

function resultBundleText(requestId: string): string {
  return serializeVibeBundle({
    requestId,
    folder: RESULT_FOLDER,
    files: [
      { path: 'README.md', content: '# Manual round trip' },
      { path: 'REVIEW.md', content: '# Review\n\nThe manual transport is coherent.' },
      { path: 'FINDINGS.json', content: '{"p0":[],"p1":[],"p2":[],"p3":[]}' },
      {
        path: 'prompt/CLI_MAIN_SESSION_PROMPT.md',
        content: '# Next goal\n\nApply the approved follow-up only after user confirmation.',
      },
    ],
  });
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
      async confirm() {
        return false;
      },
    },
  };
}

async function executeRoundTrip(repoRoot: string): Promise<{
  transport: ManualDirectoryTransport;
  installedPath: string;
  requestId: string;
}> {
  const resolution = await resolveGoalSource(
    { repoRoot, git: unusedGit, now: () => NOW },
    { providers: [goalProvider(repoRoot)] },
  );
  assert.ok(resolution.selected);

  const request = buildReviewRequest({
    kind: 'goal_audit',
    userGoal: resolution.selected.source.goalText,
    goalSource: resolution.selected,
    scope: githubScope(),
    requestId: REQUEST_ID,
    now: () => NOW,
    ttlDays: 3,
  });
  const transport = new ManualDirectoryTransport({ repoRoot, now: () => NOW });
  const handle = await transport.createRequest(request);

  assert.equal(handle.requestId, REQUEST_ID);
  assert.deepEqual(JSON.parse(await readFile(handle.requestPath, 'utf8')), request);
  assert.equal(await readFile(handle.promptPath, 'utf8'), request.reviewPrompt);
  await access(path.join(handle.requestDir, 'status.json'));

  const bundleText = resultBundleText(request.requestId);
  const captured = captureIo();
  const exitCode = await runProBridge(['sync'], {
    repoRoot,
    config: {
      ...DEFAULT_PRO_BRIDGE_CONFIG,
      enabled: true,
      resultRoot: 'installed-results',
    },
    io: captured.io,
    clipboard: {
      async copyFile() {
        return { ok: true, method: 'fake', error: null };
      },
      async readText() {
        return { ok: true, text: bundleText, error: null };
      },
    },
    now: () => NOW,
  });
  assert.equal(exitCode, 0, captured.err.join('\n'));

  return {
    transport,
    installedPath: path.join(repoRoot, 'installed-results', RESULT_FOLDER),
    requestId: request.requestId,
  };
}

describe('pro bridge manual round trip', () => {
  it('round trips an audit request from goal scope to an installed result package', async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'vibe-pro-bridge-e2e-'));
    try {
      const result = await executeRoundTrip(repoRoot);
      for (const filePath of [
        'README.md',
        'REVIEW.md',
        'FINDINGS.json',
        'prompt/CLI_MAIN_SESSION_PROMPT.md',
      ]) {
        await access(path.join(result.installedPath, filePath));
      }

      const provenance = JSON.parse(
        await readFile(path.join(result.installedPath, '.bridge', 'provenance.json'), 'utf8'),
      ) as {
        requestId: string;
        requestPayloadSha256: string | null;
        transport: string;
        skippedValidations: string[];
      };
      assert.equal(provenance.requestId, result.requestId);
      assert.match(provenance.requestPayloadSha256 ?? '', /^[0-9a-f]{64}$/);
      assert.equal(provenance.transport, 'manual');
      assert.ok(provenance.skippedValidations.includes('result-manifest-unavailable'));
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('acknowledges import and closes the outbox request', async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'vibe-pro-bridge-ack-'));
    try {
      const result = await executeRoundTrip(repoRoot);
      const status = await result.transport.getRequestStatus(result.requestId);
      assert.equal(status.state, 'imported');

      const imported = JSON.parse(
        await readFile(
          path.join(result.transport.outboxRoot, result.requestId, 'imported.json'),
          'utf8',
        ),
      ) as { requestId: string; folder: string; installedPath: string };
      assert.equal(imported.requestId, result.requestId);
      assert.equal(imported.folder, RESULT_FOLDER);
      assert.equal(imported.installedPath, result.installedPath);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
