import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
  type ReviewResultManifest,
} from '../src/pro-bridge/contract.js';
import type { GitPort } from '../src/pro-bridge/goal-source/types.js';
import { importReviewResult } from '../src/pro-bridge/importer.js';
import { MailboxStore } from '../src/pro-bridge/mailbox/store.js';
import { ManualDirectoryTransport } from '../src/pro-bridge/transports/manual.js';
import { serializeVibeBundle } from '../src/pro-bridge/vibe-bundle.js';

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const NOW = new Date('2026-07-15T12:51:00.000Z');
const CURRENT_REPOSITORY = 'owner/repo';
const OTHER_REPOSITORY = 'other/repo';

interface Capture {
  io: ProBridgeIo;
  out: string[];
  err: string[];
  events: Array<{ channel: 'out' | 'err'; line: string }>;
}

interface Provenance {
  requestPayloadSha256: string | null;
  currentRepositoryFullName: string | null;
  requestRepositoryFullName: string | null;
  repositoryIdentityOverride: {
    current: string | null;
    request: string | null;
    flag: string;
  } | null;
  unboundAcceptance: { flag: string; acknowledgedAt: string } | null;
  skippedValidations: string[];
}

function captureIo(): Capture {
  const capture: Capture = {
    out: [],
    err: [],
    events: [],
    io: undefined as unknown as ProBridgeIo,
  };
  capture.io = {
    out(line) {
      capture.out.push(line);
      capture.events.push({ channel: 'out', line });
    },
    err(line) {
      capture.err.push(line);
      capture.events.push({ channel: 'err', line });
    },
    async confirm() {
      return false;
    },
  };
  return capture;
}

function config(transport: 'manual' | 'mcp-mailbox'): ProBridgeConfig {
  return {
    ...DEFAULT_PRO_BRIDGE_CONFIG,
    enabled: true,
    transport,
    resultRoot: 'plans',
    copyInvocation: false,
    openBrowser: false,
  };
}

function repositoryGit(remote: string | null = `https://github.com/${CURRENT_REPOSITORY}.git`): GitPort {
  return {
    async run(args) {
      if (args[0] === 'remote') {
        return remote === null
          ? { ok: false, stdout: '', stderr: 'origin missing', code: 2 }
          : { ok: true, stdout: `${remote}\n`, stderr: '', code: 0 };
      }
      if (args[0] === 'rev-parse') {
        return { ok: true, stdout: `${HEAD_SHA}\n`, stderr: '', code: 0 };
      }
      return { ok: false, stdout: '', stderr: `unexpected ${args.join(' ')}`, code: 1 };
    },
  };
}

function request(input: {
  requestId: string;
  repository?: string;
  origin?: 'cli' | 'web';
}): ReviewRequest {
  const repository = input.repository ?? CURRENT_REPOSITORY;
  const draft: ReviewRequest = {
    schemaVersion: 'vibe-pro-review-request-v1',
    requestId: input.requestId,
    kind: 'goal_audit',
    origin: input.origin ?? 'cli',
    repository: {
      fullName: repository,
      remoteUrl: `https://github.com/${repository}.git`,
      defaultBranch: 'main',
    },
    git: {
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      branch: 'main',
      headVisibleOnGitHub: true,
      compareUrlHint: null,
      patchAttachmentSha256: null,
    },
    goalSource: null,
    userGoal: 'Verify repository authority.',
    reviewPrompt: '# Repository authority review',
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

function resultFiles(): Array<{ path: string; content: string }> {
  return [
    { path: 'README.md', content: '# Identity result\n' },
    { path: 'REVIEW.md', content: '# Review\n\nRepository authority verified.\n' },
    { path: 'FINDINGS.json', content: '{"findings":[]}\n' },
    {
      path: 'prompt/CLI_MAIN_SESSION_PROMPT.md',
      content: '# Implement\n\nWait for explicit user approval.\n',
    },
  ];
}

function bundle(requestId: string, folder: string): string {
  return serializeVibeBundle({ requestId, folder, files: resultFiles() });
}

function manifest(input: ReviewRequest, folder: string): ReviewResultManifest {
  const draft: ReviewResultManifest = {
    schemaVersion: 'vibe-pro-review-result-v1',
    requestId: input.requestId,
    requestPayloadSha256: input.payloadSha256,
    repositoryFullName: input.repository.fullName,
    reviewedBaseSha: input.git.baseSha,
    reviewedHeadSha: input.git.headSha,
    resultKind: 'audit',
    proposedFolder: folder,
    disposition: 'approved',
    files: resultFiles().map((file) => {
      const bytes = Buffer.from(file.content, 'utf8');
      return {
        path: file.path,
        mediaType: file.path.endsWith('.json') ? 'application/json' : 'text/markdown',
        byteLength: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    }),
    findingsSummary: { p0: 0, p1: 0, p2: 0, p3: 0 },
    reviewerDeclaration: {
      surface: 'chatgpt-web',
      requestedMode: 'pro',
      githubConnectorUsed: true,
      limitations: [],
    },
    createdAt: NOW.toISOString(),
    payloadSha256: '0'.repeat(64),
  };
  return { ...draft, payloadSha256: computePayloadSha256(draft) };
}

async function seedReadyResult(
  repoRoot: string,
  input: ReviewRequest,
  folder: string,
): Promise<ReviewResultManifest> {
  const store = new MailboxStore({ repoRoot, now: () => NOW });
  const resultManifest = manifest(input, folder);
  await store.createRequest(input);
  await store.claimRequest(input.requestId);
  await store.beginResult(input.requestId);
  for (const file of resultFiles()) {
    await store.putResultFile(input.requestId, {
      filePath: file.path,
      chunkIndex: 0,
      chunkCount: 1,
      content: file.content,
      chunkSha256: createHash('sha256').update(file.content).digest('hex'),
    });
  }
  await store.finalizeResult(input.requestId, resultManifest);
  return resultManifest;
}

async function makeRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'vibe-pro-identity-'));
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function assertNoInstall(repoRoot: string, folder: string): Promise<void> {
  const installRoot = path.join(repoRoot, 'plans');
  assert.equal(await pathExists(path.join(installRoot, folder)), false);
  const entries = await readdir(installRoot).catch(() => [] as string[]);
  assert.equal(entries.some((entry) => entry.startsWith('.tmp-')), false);
}

async function readProvenance(repoRoot: string, folder: string): Promise<Provenance> {
  return JSON.parse(
    await readFile(path.join(repoRoot, 'plans', folder, '.bridge', 'provenance.json'), 'utf8'),
  ) as Provenance;
}

describe('pro bridge repository identity', () => {
  it('rejects a positional request that belongs to another repository', async () => {
    const repoRoot = await makeRoot();
    const input = request({ requestId: 'AUD-identity-positional', repository: OTHER_REPOSITORY });
    const folder = '2026-07-15-positional-other-repo';
    try {
      await seedReadyResult(repoRoot, input, folder);
      const capture = captureIo();
      const exit = await runProBridge(['sync', input.requestId], {
        repoRoot,
        config: config('mcp-mailbox'),
        io: capture.io,
        git: repositoryGit(),
        stdin: { isTTY: false },
        now: () => NOW,
      });
      assert.equal(exit, 1);
      assert.match(capture.err.join('\n'), /current=owner\/repo.*other\/repo/);
      await assertNoInstall(repoRoot, folder);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('fails closed when the current origin is missing', async () => {
    const repoRoot = await makeRoot();
    const input = request({ requestId: 'AUD-identity-missing' });
    const folder = '2026-07-15-origin-missing';
    try {
      await seedReadyResult(repoRoot, input, folder);
      const capture = captureIo();
      const exit = await runProBridge(['sync', input.requestId], {
        repoRoot,
        config: config('mcp-mailbox'),
        io: capture.io,
        git: repositoryGit(null),
        stdin: { isTTY: false },
        now: () => NOW,
      });
      assert.equal(exit, 1);
      assert.match(capture.err.join('\n'), /origin-missing.*dangerously-override-repository-identity/s);
      await assertNoInstall(repoRoot, folder);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('fails closed when the current origin is unparseable', async () => {
    const repoRoot = await makeRoot();
    const input = request({ requestId: 'AUD-identity-unparseable' });
    const folder = '2026-07-15-origin-unparseable';
    try {
      await seedReadyResult(repoRoot, input, folder);
      const capture = captureIo();
      const exit = await runProBridge(['sync', input.requestId], {
        repoRoot,
        config: config('mcp-mailbox'),
        io: capture.io,
        git: repositoryGit('not-a-repository-url'),
        stdin: { isTTY: false },
        now: () => NOW,
      });
      assert.equal(exit, 1);
      assert.match(capture.err.join('\n'), /origin-unresolvable/);
      await assertNoInstall(repoRoot, folder);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('fails closed when the current origin is not GitHub', async () => {
    const repoRoot = await makeRoot();
    const input = request({ requestId: 'AUD-identity-gitlab' });
    const folder = '2026-07-15-origin-not-github';
    try {
      await seedReadyResult(repoRoot, input, folder);
      const capture = captureIo();
      const exit = await runProBridge(['sync', input.requestId], {
        repoRoot,
        config: config('mcp-mailbox'),
        io: capture.io,
        git: repositoryGit('https://gitlab.com/owner/repo.git'),
        stdin: { isTTY: false },
        now: () => NOW,
      });
      assert.equal(exit, 1);
      assert.match(capture.err.join('\n'), /GitHub 저장소 fullName/);
      await assertNoInstall(repoRoot, folder);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('rejects when request and result agree but the current repository differs', async () => {
    const repoRoot = await makeRoot();
    const input = request({ requestId: 'AUD-identity-internal-agreement', repository: OTHER_REPOSITORY });
    const folder = '2026-07-15-request-result-agree';
    try {
      const resultManifest = await seedReadyResult(repoRoot, input, folder);
      assert.equal(resultManifest.repositoryFullName, input.repository.fullName);
      const capture = captureIo();
      const exit = await runProBridge(['sync', input.requestId], {
        repoRoot,
        config: config('mcp-mailbox'),
        io: capture.io,
        git: repositoryGit(),
        stdin: { isTTY: false },
        now: () => NOW,
      });
      assert.equal(exit, 1);
      assert.match(capture.err.join('\n'), /저장소 정체성 불일치/);
      await assertNoInstall(repoRoot, folder);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('rejects a same-HEAD result from another repository', async () => {
    const repoRoot = await makeRoot();
    const input = request({
      requestId: 'WEB-identity-same-head',
      repository: OTHER_REPOSITORY,
      origin: 'web',
    });
    const folder = '2026-07-15-same-head-other-repo';
    try {
      await seedReadyResult(repoRoot, input, folder);
      const capture = captureIo();
      const exit = await runProBridge(['sync', input.requestId], {
        repoRoot,
        config: config('mcp-mailbox'),
        io: capture.io,
        git: repositoryGit(),
        stdin: { isTTY: false },
        now: () => NOW,
      });
      assert.equal(exit, 1);
      assert.match(capture.err.join('\n'), /저장소 정체성 불일치/);
      assert.doesNotMatch(capture.err.join('\n'), /HEAD 불일치/);
      await assertNoInstall(repoRoot, folder);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('refuses no-op recovery when installed provenance belongs to another repository', async () => {
    const repoRoot = await makeRoot();
    const input = request({ requestId: 'AUD-identity-noop', repository: OTHER_REPOSITORY });
    const folder = '2026-07-15-noop-repository-mismatch';
    const parsedBundle = {
      requestId: input.requestId,
      folder,
      files: resultFiles(),
    };
    try {
      const first = await importReviewResult(
        { kind: 'bundle', bundle: parsedBundle },
        {
          repoRoot,
          installRoot: path.join(repoRoot, 'plans'),
          request: input,
          expectedRepositoryFullName: OTHER_REPOSITORY,
          currentRepositoryFullName: OTHER_REPOSITORY,
          requestRepositoryFullName: OTHER_REPOSITORY,
          now: () => NOW,
        },
      );
      assert.equal(first.status, 'installed');
      const recovered = await importReviewResult(
        { kind: 'bundle', bundle: parsedBundle },
        {
          repoRoot,
          installRoot: path.join(repoRoot, 'plans'),
          request: input,
          expectedRepositoryFullName: CURRENT_REPOSITORY,
          currentRepositoryFullName: CURRENT_REPOSITORY,
          requestRepositoryFullName: OTHER_REPOSITORY,
          now: () => NOW,
        },
      );
      assert.equal(recovered.status, 'invalid');
      if (recovered.status === 'invalid') {
        assert.equal(recovered.errors.some((error) => error.code === 'repository-mismatch'), true);
      }
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('override flag prints both identities before write and records the override in provenance', async () => {
    const repoRoot = await makeRoot();
    const input = request({ requestId: 'AUD-identity-override', repository: OTHER_REPOSITORY });
    const folder = '2026-07-15-repository-override';
    try {
      const manual = new ManualDirectoryTransport({ repoRoot, now: () => NOW });
      await manual.createRequest(input);
      const capture = captureIo();
      const exit = await runProBridge(
        ['sync', '--dangerously-override-repository-identity'],
        {
          repoRoot,
          config: config('manual'),
          io: capture.io,
          git: repositoryGit(),
          clipboard: {
            async copyFile() { return { ok: true, method: 'test', error: null }; },
            async readText() { return { ok: true, text: bundle(input.requestId, folder), error: null }; },
          },
          now: () => NOW,
        },
      );
      assert.equal(exit, 0, capture.err.join('\n'));
      const overrideIndex = capture.events.findIndex((event) => /current=owner\/repo.*other\/repo/.test(event.line));
      const installedIndex = capture.events.findIndex((event) => /설치 완료/.test(event.line));
      assert.equal(overrideIndex >= 0 && overrideIndex < installedIndex, true);
      const provenance = await readProvenance(repoRoot, folder);
      assert.deepEqual(provenance.repositoryIdentityOverride, {
        current: CURRENT_REPOSITORY,
        request: OTHER_REPOSITORY,
        flag: 'dangerously-override-repository-identity',
      });
      assert.equal(provenance.skippedValidations.includes('repository-identity-overridden'), true);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});

describe('pro bridge manual trust and transport seams', () => {
  it('rejects an unbound web-origin bundle by default', async () => {
    const repoRoot = await makeRoot();
    const folder = '2026-07-15-unbound-rejected';
    try {
      const capture = captureIo();
      const exit = await runProBridge(['sync'], {
        repoRoot,
        config: config('manual'),
        io: capture.io,
        git: repositoryGit(),
        clipboard: {
          async copyFile() { return { ok: true, method: 'test', error: null }; },
          async readText() { return { ok: true, text: bundle('web-origin', folder), error: null }; },
        },
        now: () => NOW,
      });
      assert.equal(exit, 1);
      assert.match(capture.err.join('\n'), /accept-unbound-web-origin/);
      for (const validation of [
        'request-metadata-unavailable',
        'result-manifest-unavailable',
        'request-hash-binding-skipped',
        'result-hash-binding-skipped',
        'repository-binding-skipped',
        'reviewed-head-binding-skipped',
        'file-roster-binding-skipped',
        'file-sha-binding-skipped',
        'reviewer-declaration-unavailable',
      ]) {
        assert.match(capture.err.join('\n'), new RegExp(validation));
      }
      await assertNoInstall(repoRoot, folder);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('records explicit unbound acceptance in provenance', async () => {
    const repoRoot = await makeRoot();
    const folder = '2026-07-15-unbound-accepted';
    try {
      const capture = captureIo();
      const exit = await runProBridge(['sync', '--accept-unbound-web-origin'], {
        repoRoot,
        config: config('manual'),
        io: capture.io,
        git: repositoryGit(),
        clipboard: {
          async copyFile() { return { ok: true, method: 'test', error: null }; },
          async readText() { return { ok: true, text: bundle('web-origin', folder), error: null }; },
        },
        now: () => NOW,
      });
      assert.equal(exit, 0, capture.err.join('\n'));
      const provenance = await readProvenance(repoRoot, folder);
      assert.equal(provenance.currentRepositoryFullName, CURRENT_REPOSITORY);
      assert.equal(provenance.requestRepositoryFullName, null);
      assert.deepEqual(provenance.unboundAcceptance, {
        flag: 'accept-unbound-web-origin',
        acknowledgedAt: NOW.toISOString(),
      });
      assert.equal(provenance.skippedValidations.includes('unbound-import-accepted'), true);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('installs a bound web-origin result with repository identity enforced', async () => {
    const repoRoot = await makeRoot();
    const input = request({ requestId: 'WEB-bound-latest', origin: 'web' });
    const folder = '2026-07-15-bound-web-origin';
    try {
      const store = new MailboxStore({ repoRoot, now: () => NOW });
      await store.createRequest(input);
      await writeFile(path.join(repoRoot, 'result.vibe'), bundle('web-origin', folder), 'utf8');
      const capture = captureIo();
      const exit = await runProBridge(['sync', '--latest', '--from', 'result.vibe'], {
        repoRoot,
        config: config('mcp-mailbox'),
        io: capture.io,
        git: repositoryGit(),
        now: () => NOW,
      });
      assert.equal(exit, 0, capture.err.join('\n'));
      const provenance = await readProvenance(repoRoot, folder);
      assert.equal(provenance.currentRepositoryFullName, CURRENT_REPOSITORY);
      assert.equal(provenance.requestRepositoryFullName, CURRENT_REPOSITORY);
      assert.equal(provenance.requestPayloadSha256, input.payloadSha256);
      assert.equal(provenance.unboundAcceptance, null);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('shows skipped validations before any write', async () => {
    const acceptedRoot = await makeRoot();
    const rejectedRoot = await makeRoot();
    const acceptedFolder = '2026-07-15-skipped-before-write';
    const rejectedFolder = '2026-07-15-skipped-default-reject';
    try {
      const accepted = captureIo();
      const acceptedExit = await runProBridge(['sync', '--accept-unbound-web-origin'], {
        repoRoot: acceptedRoot,
        config: config('manual'),
        io: accepted.io,
        git: repositoryGit(),
        clipboard: {
          async copyFile() { return { ok: true, method: 'test', error: null }; },
          async readText() { return { ok: true, text: bundle('web-origin', acceptedFolder), error: null }; },
        },
        now: () => NOW,
      });
      assert.equal(acceptedExit, 0, accepted.err.join('\n'));
      const skippedIndex = accepted.events.findIndex((event) => /생략되는 검증/.test(event.line));
      const installedIndex = accepted.events.findIndex((event) => /설치 완료/.test(event.line));
      assert.equal(skippedIndex >= 0 && skippedIndex < installedIndex, true);

      const rejected = captureIo();
      const rejectedExit = await runProBridge(['sync'], {
        repoRoot: rejectedRoot,
        config: config('manual'),
        io: rejected.io,
        git: repositoryGit(),
        clipboard: {
          async copyFile() { return { ok: true, method: 'test', error: null }; },
          async readText() { return { ok: true, text: bundle('web-origin', rejectedFolder), error: null }; },
        },
        now: () => NOW,
      });
      assert.equal(rejectedExit, 1);
      assert.match(rejected.err.join('\n'), /result-manifest-unavailable/);
      await assertNoInstall(rejectedRoot, rejectedFolder);
    } finally {
      await rm(acceptedRoot, { recursive: true, force: true });
      await rm(rejectedRoot, { recursive: true, force: true });
    }
  });

  it('prints install success before out-of-band acknowledgement completes the request', async () => {
    const repoRoot = await makeRoot();
    const input = request({ requestId: 'AUD-seam-a-mailbox-ack' });
    const folder = '2026-07-15-seam-a-success-first';
    const bundlePath = path.join(repoRoot, 'result.vibe');
    try {
      const store = new MailboxStore({ repoRoot, now: () => NOW });
      await store.createRequest(input);
      await writeFile(bundlePath, bundle(input.requestId, folder), 'utf8');
      const capture = captureIo();
      const exit = await runProBridge(['sync', '--from', 'result.vibe'], {
        repoRoot,
        config: config('mcp-mailbox'),
        io: capture.io,
        git: repositoryGit(),
        now: () => NOW,
      });
      assert.equal(exit, 0, capture.err.join('\n'));
      assert.match(capture.out.join('\n'), /설치 완료/);
      assert.match(capture.out.join('\n'), /nextAction:/);
      assert.doesNotMatch(capture.err.join('\n'), /후처리\(ack\) 실패/);
      const receipt = JSON.parse(await readFile(
        path.join(store.requestsRoot, input.requestId, 'imported.json'),
        'utf8',
      )) as { verification?: string };
      assert.equal((await store.getStatus(input.requestId)).state, 'imported');
      assert.equal(receipt.verification, 'out-of-band');
      await access(path.join(repoRoot, 'plans', folder, 'README.md'));
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('downgrades a genuine ack failure to a warning after successful install', async () => {
    const repoRoot = await makeRoot();
    const input = request({ requestId: 'AUD-seam-a-mailbox-ack-failure' });
    const folder = '2026-07-15-seam-a-ack-warning';
    const bundlePath = path.join(repoRoot, 'result.vibe');
    try {
      const store = new MailboxStore({ repoRoot, now: () => NOW });
      await store.createRequest(input);
      await writeFile(bundlePath, bundle(input.requestId, folder), 'utf8');
      const capture = captureIo();
      const io: ProBridgeIo = {
        ...capture.io,
        out(line) {
          capture.io.out(line);
          if (/설치 완료/.test(line)) {
            rmSync(path.join(store.requestsRoot, input.requestId), { recursive: true, force: true });
          }
        },
      };
      const exit = await runProBridge(['sync', '--from', 'result.vibe'], {
        repoRoot,
        config: config('mcp-mailbox'),
        io,
        git: repositoryGit(),
        now: () => NOW,
      });
      assert.equal(exit, 0, capture.err.join('\n'));
      const successIndex = capture.events.findIndex((event) => /설치 완료/.test(event.line));
      const warningIndex = capture.events.findIndex((event) => /후처리\(ack\) 실패/.test(event.line));
      assert.equal(successIndex >= 0 && warningIndex > successIndex, true);
      assert.match(capture.err.join('\n'), /다음 sync가 동일 provenance를 검증해 다시 종결합니다/);
      await access(path.join(repoRoot, 'plans', folder, 'README.md'));
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('binds a manual bundle to a mailbox-store request by requestId lookup', async () => {
    const repoRoot = await makeRoot();
    const input = request({ requestId: 'AUD-seam-b-cross-transport' });
    const folder = '2026-07-15-seam-b-mailbox-binding';
    try {
      const store = new MailboxStore({ repoRoot, now: () => NOW });
      await store.createRequest(input);
      const capture = captureIo();
      const exit = await runProBridge(['sync'], {
        repoRoot,
        config: config('manual'),
        io: capture.io,
        git: repositoryGit(),
        clipboard: {
          async copyFile() { return { ok: true, method: 'test', error: null }; },
          async readText() { return { ok: true, text: bundle(input.requestId, folder), error: null }; },
        },
        now: () => NOW,
      });
      assert.equal(exit, 0, capture.err.join('\n'));
      const provenance = await readProvenance(repoRoot, folder);
      assert.equal(provenance.requestPayloadSha256, input.payloadSha256);
      assert.equal(provenance.requestRepositoryFullName, CURRENT_REPOSITORY);
      assert.equal(provenance.unboundAcceptance, null);
      const receipt = JSON.parse(await readFile(
        path.join(store.requestsRoot, input.requestId, 'imported.json'),
        'utf8',
      )) as { verification?: string };
      assert.equal(receipt.verification, 'out-of-band');
      assert.equal((await store.getStatus(input.requestId)).state, 'imported');
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
