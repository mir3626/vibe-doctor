import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  computePayloadSha256,
  type ReviewRequest,
  type ReviewResultManifest,
} from '../src/pro-bridge/contract.js';
import {
  computeResultFilesSha256,
  importReviewResult,
  type ImportContext,
  type ImporterFileInput,
  type ImportOutcome,
} from '../src/pro-bridge/importer.js';
import { buildReviewRequest } from '../src/pro-bridge/prompt-composer.js';
import type { ScopeResolution } from '../src/pro-bridge/scope-resolver.js';
import {
  parseVibeBundle,
  serializeVibeBundle,
  type VibeBundle,
} from '../src/pro-bridge/vibe-bundle.js';

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const OTHER_SHA = 'c'.repeat(40);
const FOLDER = '2026-07-15-example-goal-pro-review';
const NOW = new Date('2026-07-15T08:00:00.000Z');

async function makeRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'vibe-pro-import-'));
}

function auditFiles(readme = '# Imported review\n'): ImporterFileInput[] {
  return [
    { path: 'README.md', content: readme },
    { path: 'REVIEW.md', content: '# Review\n\nNo critical findings.\n' },
    { path: 'FINDINGS.json', content: '{"findings":[]}\n' },
    {
      path: 'prompt/CLI_MAIN_SESSION_PROMPT.md',
      content: '# Implement\n\nRead the review, verify HEAD, implement in order, and stop on mismatch.\n',
    },
  ];
}

function bundle(files = auditFiles(), requestId = 'web-origin', folder = FOLDER): VibeBundle {
  return {
    requestId,
    folder,
    files: files.map((file) => ({
      path: file.path,
      content: typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content),
    })),
  };
}

function context(root: string, overrides: Partial<ImportContext> = {}): ImportContext {
  return {
    repoRoot: root,
    installRoot: path.join(root, 'plans'),
    resultKind: 'audit',
    now: () => NOW,
    ...overrides,
  };
}

function validScope(): ScopeResolution {
  return {
    repository: {
      fullName: 'owner/repo',
      remoteUrl: 'https://github.com/owner/repo.git',
      defaultBranch: 'main',
    },
    git: {
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      branch: 'main',
      baseVisibility: 'remote',
      headVisibility: 'remote',
      headVisibleOnGitHub: true,
      compareUrlHint: `https://github.com/owner/repo/compare/${BASE_SHA}...${HEAD_SHA}`,
    },
    visibilityCase: 'github-range',
    blockedReasons: [],
    patch: null,
    warnings: ['visibility-from-local-remote-refs'],
  };
}

function reviewRequest(): ReviewRequest {
  return buildReviewRequest({
    kind: 'goal_audit',
    userGoal: 'Audit the bridge core.',
    goalSource: null,
    scope: validScope(),
    requestId: 'AUD-20260715-abc123',
    now: () => NOW,
    random: () => 'abc123',
  });
}

function bytesFor(file: ImporterFileInput): Uint8Array {
  return typeof file.content === 'string'
    ? Buffer.from(file.content, 'utf8')
    : file.content;
}

function resultManifest(
  files: ImporterFileInput[],
  request: ReviewRequest,
  overrides: Partial<ReviewResultManifest> = {},
): ReviewResultManifest {
  const manifestWithoutHash: ReviewResultManifest = {
    schemaVersion: 'vibe-pro-review-result-v1',
    requestId: request.requestId,
    requestPayloadSha256: request.payloadSha256,
    repositoryFullName: request.repository.fullName,
    reviewedBaseSha: request.git.baseSha,
    reviewedHeadSha: request.git.headSha,
    resultKind: 'audit',
    proposedFolder: FOLDER,
    disposition: 'approved-with-remediation',
    files: files.map((file) => {
      const bytes = bytesFor(file);
      return {
        path: file.path,
        mediaType: file.path.endsWith('.json') ? 'application/json' : 'text/markdown',
        byteLength: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    }),
    findingsSummary: { p0: 0, p1: 0, p2: 1, p3: 0 },
    reviewerDeclaration: {
      surface: 'chatgpt-web',
      requestedMode: 'pro',
      githubConnectorUsed: true,
      limitations: [],
    },
    createdAt: NOW.toISOString(),
    payloadSha256: '0'.repeat(64),
    ...overrides,
  };
  return {
    ...manifestWithoutHash,
    payloadSha256: computePayloadSha256(manifestWithoutHash),
  };
}

function rehashManifest(manifest: ReviewResultManifest): ReviewResultManifest {
  return { ...manifest, payloadSha256: computePayloadSha256(manifest) };
}

function errorCodes(outcome: ImportOutcome): string[] {
  assert.equal(outcome.status, 'invalid');
  return outcome.status === 'invalid' ? outcome.errors.map((error) => error.code) : [];
}

describe('result importer', () => {
  it('installs a valid audit bundle atomically into the install root', async () => {
    const root = await makeRoot();
    try {
      const outcome = await importReviewResult({ kind: 'bundle', bundle: bundle() }, context(root));
      assert.equal(outcome.status, 'installed');
      const installed = path.join(root, 'plans', FOLDER);
      assert.deepEqual(
        (await readdir(installed)).sort(),
        ['.bridge', 'FINDINGS.json', 'README.md', 'REVIEW.md', 'prompt'].sort(),
      );
      assert.equal((await readdir(path.join(root, 'plans'))).some((name) => name.startsWith('.tmp-')), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('writes provenance receipt with hash bindings', async () => {
    const root = await makeRoot();
    try {
      const files = auditFiles();
      const request = reviewRequest();
      const manifest = resultManifest(files, request);
      const outcome = await importReviewResult(
        { kind: 'bundle', bundle: bundle(files, request.requestId) },
        context(root, {
          request,
          resultManifest: manifest,
          expectedRepositoryFullName: 'owner/repo',
        }),
      );
      assert.equal(outcome.status, 'installed');
      const receipt = JSON.parse(
        await readFile(path.join(root, 'plans', FOLDER, '.bridge/provenance.json'), 'utf8'),
      ) as Record<string, unknown>;
      assert.equal(receipt.requestPayloadSha256, request.payloadSha256);
      assert.equal(receipt.resultPayloadSha256, manifest.payloadSha256);
      assert.equal(receipt.resultFilesSha256, computeResultFilesSha256(files));
      assert.equal(receipt.reviewedHeadSha, HEAD_SHA);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns next action text and never starts implementation', async () => {
    const root = await makeRoot();
    try {
      const outcome = await importReviewResult({ kind: 'bundle', bundle: bundle() }, context(root));
      assert.equal(outcome.status, 'installed');
      if (outcome.status === 'installed') {
        assert.match(outcome.nextAction, new RegExp(`Read: docs/plans/${FOLDER}/README\\.md`));
        assert.match(outcome.nextAction, /prompt\/CLI_MAIN_SESSION_PROMPT\.md/);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('round trips a composed contract through bundle and atomic import', async () => {
    const root = await makeRoot();
    try {
      const files = auditFiles();
      const request = reviewRequest();
      assert.deepEqual(request.outputContract.requiredFiles, files.map((file) => file.path));
      const wire = serializeVibeBundle(bundle(files, request.requestId));
      const parsed = parseVibeBundle(wire);
      assert.equal(parsed.ok, true);
      if (!parsed.ok) {
        return;
      }
      const manifest = resultManifest(files, request);
      const outcome = await importReviewResult(
        { kind: 'bundle', bundle: parsed.bundle },
        context(root, {
          request,
          resultManifest: manifest,
          expectedRepositoryFullName: request.repository.fullName,
        }),
      );
      assert.equal(outcome.status, 'installed');
      assert.equal(await readFile(path.join(root, 'plans', FOLDER, 'README.md'), 'utf8'), files[0]!.content);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects path escape attempts', async () => {
    const root = await makeRoot();
    try {
      const files = [
        ...auditFiles(),
        { path: '../escape', content: 'escape' },
        { path: 'foo/./bar', content: 'dot segment' },
        { path: 'README.md', content: 'duplicate' },
      ];
      const outcome = await importReviewResult(
        { kind: 'files', requestId: 'web-origin', folder: FOLDER, files },
        context(root),
      );
      const codes = errorCodes(outcome);
      assert.equal(codes.filter((code) => code === 'unsafe-path').length >= 2, true);
      assert.equal(codes.includes('duplicate-path'), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects absolute and drive letter paths', async () => {
    const root = await makeRoot();
    try {
      for (const filePath of ['/absolute.md', 'C:/escape.md']) {
        const outcome = await importReviewResult(
          {
            kind: 'files',
            requestId: 'web-origin',
            folder: FOLDER,
            files: [...auditFiles(), { path: filePath, content: 'escape' }],
          },
          context(root),
        );
        assert.equal(errorCodes(outcome).includes('unsafe-path'), true);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects paths outside the allowlist', async () => {
    const root = await makeRoot();
    try {
      for (const filePath of ['src/evil.ts', '.github/workflows/x.yml']) {
        const outcome = await importReviewResult(
          {
            kind: 'files',
            requestId: 'web-origin',
            folder: FOLDER,
            files: [...auditFiles(), { path: filePath, content: 'nope' }],
          },
          context(root),
        );
        assert.equal(errorCodes(outcome).includes('path-not-allowed'), true);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects reserved provenance path', async () => {
    const root = await makeRoot();
    try {
      const outcome = await importReviewResult(
        {
          kind: 'files',
          requestId: 'web-origin',
          folder: FOLDER,
          files: [...auditFiles(), { path: '.bridge/provenance.json', content: '{}' }],
        },
        context(root),
      );
      assert.equal(errorCodes(outcome).includes('reserved-path'), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects non utf8 and control character content', async () => {
    const root = await makeRoot();
    try {
      const nonUtf8 = await importReviewResult(
        {
          kind: 'files',
          requestId: 'web-origin',
          folder: FOLDER,
          files: [...auditFiles(), { path: 'source/bad.txt', content: new Uint8Array([0xc3, 0x28]) }],
        },
        context(root),
      );
      assert.equal(errorCodes(nonUtf8).includes('invalid-utf8'), true);
      const control = await importReviewResult(
        {
          kind: 'files',
          requestId: 'web-origin',
          folder: FOLDER,
          files: [...auditFiles(), { path: 'source/control.txt', content: 'bad\u0001value' }],
        },
        context(root),
      );
      assert.equal(errorCodes(control).includes('unsafe-control-characters'), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects repository mismatch', async () => {
    const root = await makeRoot();
    try {
      const files = auditFiles();
      const request = reviewRequest();
      const outcome = await importReviewResult(
        { kind: 'bundle', bundle: bundle(files, request.requestId) },
        context(root, {
          request,
          resultManifest: resultManifest(files, request),
          expectedRepositoryFullName: 'other/repo',
        }),
      );
      assert.equal(errorCodes(outcome).includes('repository-mismatch'), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects reviewed head mismatch', async () => {
    const root = await makeRoot();
    try {
      const files = auditFiles();
      const request = reviewRequest();
      const manifest = resultManifest(files, request, { reviewedHeadSha: OTHER_SHA });
      const outcome = await importReviewResult(
        { kind: 'bundle', bundle: bundle(files, request.requestId) },
        context(root, { request, resultManifest: manifest }),
      );
      assert.equal(errorCodes(outcome).includes('reviewed-head-mismatch'), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects request binding hash mismatch', async () => {
    const root = await makeRoot();
    try {
      const files = auditFiles();
      const request = reviewRequest();
      const manifest = resultManifest(files, request, { requestPayloadSha256: 'f'.repeat(64) });
      const outcome = await importReviewResult(
        { kind: 'bundle', bundle: bundle(files, request.requestId) },
        context(root, { request, resultManifest: manifest }),
      );
      assert.equal(errorCodes(outcome).includes('request-hash-mismatch'), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects per file sha mismatch', async () => {
    const root = await makeRoot();
    try {
      const files = auditFiles();
      const request = reviewRequest();
      const manifest = resultManifest(files, request);
      manifest.files[0] = { ...manifest.files[0]!, sha256: 'f'.repeat(64) };
      const outcome = await importReviewResult(
        { kind: 'bundle', bundle: bundle(files, request.requestId) },
        context(root, { request, resultManifest: rehashManifest(manifest) }),
      );
      assert.equal(errorCodes(outcome).includes('file-sha-mismatch'), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects incomplete file roster', async () => {
    const root = await makeRoot();
    try {
      const files = auditFiles();
      const request = reviewRequest();
      const manifest = resultManifest(files, request);
      manifest.files = manifest.files.slice(0, -1);
      const outcome = await importReviewResult(
        { kind: 'bundle', bundle: bundle(files, request.requestId) },
        context(root, { request, resultManifest: rehashManifest(manifest) }),
      );
      assert.equal(errorCodes(outcome).includes('file-roster-mismatch'), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects missing required prompt file', async () => {
    const root = await makeRoot();
    try {
      const files = auditFiles().filter((file) => file.path !== 'prompt/CLI_MAIN_SESSION_PROMPT.md');
      const outcome = await importReviewResult(
        { kind: 'files', requestId: 'web-origin', folder: FOLDER, files },
        context(root),
      );
      assert.equal(errorCodes(outcome).includes('missing-required-file'), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects empty implementation prompt', async () => {
    const root = await makeRoot();
    try {
      const files = auditFiles().map((file) =>
        file.path === 'prompt/CLI_MAIN_SESSION_PROMPT.md' ? { ...file, content: '  \n' } : file,
      );
      const outcome = await importReviewResult(
        { kind: 'files', requestId: 'web-origin', folder: FOLDER, files },
        context(root),
      );
      assert.equal(errorCodes(outcome).includes('empty-prompt'), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects unparsable findings json', async () => {
    const root = await makeRoot();
    try {
      const files = auditFiles().map((file) =>
        file.path === 'FINDINGS.json' ? { ...file, content: '{broken' } : file,
      );
      const outcome = await importReviewResult(
        { kind: 'files', requestId: 'web-origin', folder: FOLDER, files },
        context(root),
      );
      assert.equal(errorCodes(outcome).includes('findings-parse-error'), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('enforces size and count limits', async () => {
    const root = await makeRoot();
    try {
      const files = auditFiles();
      const tooMany = await importReviewResult(
        { kind: 'files', requestId: 'web-origin', folder: FOLDER, files },
        context(root, { limits: { maxFiles: 3 } }),
      );
      assert.equal(errorCodes(tooMany).includes('too-many-files'), true);
      const tooLarge = await importReviewResult(
        { kind: 'files', requestId: 'web-origin', folder: FOLDER, files },
        context(root, { limits: { maxFileBytes: 8 } }),
      );
      assert.equal(errorCodes(tooLarge).includes('file-too-large'), true);
      const tooLargeTotal = await importReviewResult(
        { kind: 'files', requestId: 'web-origin', folder: FOLDER, files },
        context(root, { limits: { maxTotalBytes: 16 } }),
      );
      assert.equal(errorCodes(tooLargeTotal).includes('total-too-large'), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('treats identical result hash reinstall as no-op', async () => {
    const root = await makeRoot();
    try {
      const first = await importReviewResult({ kind: 'bundle', bundle: bundle() }, context(root));
      const second = await importReviewResult({ kind: 'bundle', bundle: bundle() }, context(root));
      assert.equal(first.status, 'installed');
      assert.deepEqual(second, { status: 'no-op', folder: FOLDER });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses different result hash without approval and installs rev2 with approval', async () => {
    const root = await makeRoot();
    try {
      await importReviewResult({ kind: 'bundle', bundle: bundle() }, context(root));
      const changed = bundle(auditFiles('# Changed review\n'));
      const refused = await importReviewResult({ kind: 'bundle', bundle: changed }, context(root));
      assert.equal(refused.status, 'refused');
      if (refused.status === 'refused') {
        assert.equal(refused.code, 'existing-folder-conflict');
      }
      const approved = await importReviewResult(
        { kind: 'bundle', bundle: changed },
        context(root, { approveRevision: true }),
      );
      assert.equal(approved.status, 'installed');
      if (approved.status === 'installed') {
        assert.equal(approved.folder, `${FOLDER}-rev2`);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('cleans staging directory when a late failure occurs before rename', async () => {
    const root = await makeRoot();
    try {
      const installRoot = path.join(root, 'plans');
      const files = [
        ...auditFiles(),
        { path: '.bridge/conflict', content: 'file first' },
        { path: '.bridge/conflict/nested.md', content: 'then directory' },
      ];
      await assert.rejects(() =>
        importReviewResult(
          { kind: 'files', requestId: 'web-origin', folder: FOLDER, files },
          context(root),
        ),
      );
      const roster = await readdir(installRoot);
      assert.equal(roster.some((name) => name.startsWith('.tmp-')), false);
      assert.equal(roster.includes(FOLDER), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('records skipped validations when manifests are absent', async () => {
    const root = await makeRoot();
    try {
      const outcome = await importReviewResult({ kind: 'bundle', bundle: bundle() }, context(root));
      assert.equal(outcome.status, 'installed');
      if (outcome.status === 'installed') {
        assert.equal(outcome.skippedValidations.includes('request-metadata-unavailable'), true);
        assert.equal(outcome.skippedValidations.includes('result-manifest-unavailable'), true);
        assert.equal(outcome.skippedValidations.includes('file-sha-binding-skipped'), true);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('accepts files array input equivalently to bundle input', async () => {
    const root = await makeRoot();
    try {
      const outcome = await importReviewResult(
        { kind: 'files', requestId: 'web-origin', folder: FOLDER, files: auditFiles() },
        context(root),
      );
      assert.equal(outcome.status, 'installed');
      assert.equal(await readFile(path.join(root, 'plans', FOLDER, 'REVIEW.md'), 'utf8'), auditFiles()[1]!.content);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('exposes the result files sha in the installed outcome', async () => {
    const root = await makeRoot();
    try {
      const files = auditFiles();
      const outcome = await importReviewResult(
        { kind: 'files', requestId: 'web-origin', folder: FOLDER, files },
        context(root),
      );
      assert.equal(outcome.status, 'installed');
      if (outcome.status === 'installed') {
        assert.match(outcome.resultFilesSha256, /^[0-9a-f]{64}$/);
        const provenance = JSON.parse(await readFile(
          path.join(outcome.installedPath, '.bridge/provenance.json'),
          'utf8',
        )) as { resultFilesSha256: string };
        assert.equal(outcome.resultFilesSha256, provenance.resultFilesSha256);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('records acknowledged validations in the provenance receipt', async () => {
    const root = await makeRoot();
    try {
      const outcome = await importReviewResult(
        { kind: 'bundle', bundle: bundle() },
        context(root, {
          acknowledgedValidations: [
            'local-head-mismatch-acknowledged',
            'explicit-review-override',
          ],
        }),
      );
      assert.equal(outcome.status, 'installed');
      if (outcome.status === 'installed') {
        const provenance = JSON.parse(await readFile(
          path.join(outcome.installedPath, '.bridge/provenance.json'),
          'utf8',
        )) as { skippedValidations: string[] };
        assert.equal(outcome.skippedValidations.includes('local-head-mismatch-acknowledged'), true);
        assert.deepEqual(
          outcome.skippedValidations,
          [...outcome.skippedValidations].sort(),
        );
        assert.deepEqual(provenance.skippedValidations, outcome.skippedValidations);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
