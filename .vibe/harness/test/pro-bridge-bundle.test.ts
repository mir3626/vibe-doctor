import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checkRequiredFiles,
  parseVibeBundle,
  serializeVibeBundle,
  VibeBundleSerializeError,
  type VibeBundle,
  type VibeBundleParseErrorCode,
} from '../src/pro-bridge/vibe-bundle.js';
import { buildCompliantResultBundle } from './helpers/pro-bridge-result-fixture.js';

const bundleFixture: VibeBundle = buildCompliantResultBundle({
  requestId: 'AUD-20260715-abc123',
  folder: '2026-07-15-example-goal-pro-review',
  repositoryFullName: 'owner/repo',
  title: 'Review package',
  readmeContent: '# Review package',
  primaryContent: '# Review\n\nNo critical findings.',
}).bundle;

function textBundle(overrides: {
  requestId?: string;
  folder?: string;
  files?: number;
  blocks?: string;
  includeEnd?: boolean;
} = {}): string {
  return [
    'VIBE-BUNDLE v1',
    `requestId: ${overrides.requestId ?? 'AUD-20260715-abc123'}`,
    `folder: ${overrides.folder ?? '2026-07-15-example-goal-pro-review'}`,
    `files: ${overrides.files ?? 1}`,
    overrides.blocks ?? '==== VIBE:FILE README.md ====\n# Package',
    overrides.includeEnd === false ? '' : '==== VIBE:END ====',
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}

function assertError(input: string, code: VibeBundleParseErrorCode): void {
  const result = parseVibeBundle(input);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, code);
  }
}

describe('vibe-bundle v1 parser', () => {
  it('parses LF and CRLF four-file bundles and preserves file content', () => {
    const serialized = serializeVibeBundle(bundleFixture);
    for (const text of [serialized, serialized.replaceAll('\n', '\r\n')]) {
      const parsed = parseVibeBundle(text);
      assert.equal(parsed.ok, true);
      if (parsed.ok) {
        assert.deepEqual(parsed.bundle, bundleFixture);
      }
    }
  });

  it('ignores leading clipboard noise and accepts web-origin request ids', () => {
    const parsed = parseVibeBundle(`Copied from ChatGPT\n${textBundle({ requestId: 'web-origin' })}`);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.bundle.requestId, 'web-origin');
    }
  });

  it('reports missing sentinel and file-count mismatches by error code', () => {
    assertError(textBundle({ includeEnd: false }), 'missing-end-sentinel');
    assertError(textBundle({ files: 2 }), 'file-count-mismatch');
  });

  it('rejects traversal, absolute, and backslash file paths', () => {
    for (const filePath of ['../escape.md', '/absolute.md', 'C:/absolute.md', 'nested\\file.md']) {
      assertError(
        textBundle({ blocks: `==== VIBE:FILE ${filePath} ====\ncontent` }),
        'unsafe-file-path',
      );
    }
  });

  it('rejects duplicate file paths, invalid folders, and absent headers', () => {
    assertError(
      textBundle({
        files: 2,
        blocks: [
          '==== VIBE:FILE README.md ====',
          'first',
          '==== VIBE:FILE README.md ====',
          'second',
        ].join('\n'),
      }),
      'duplicate-file-path',
    );
    assertError(textBundle({ folder: 'Invalid Folder' }), 'invalid-folder');
    assertError('requestId: none\n==== VIBE:END ====', 'missing-header');
  });

  it('round-trips serialized bundles and rejects control-line collisions', () => {
    const serialized = serializeVibeBundle(bundleFixture);
    const parsed = parseVibeBundle(serialized);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.deepEqual(parsed.bundle, bundleFixture);
    }

    assert.throws(
      () =>
        serializeVibeBundle({
          ...bundleFixture,
          files: [{ path: 'README.md', content: 'safe\n==== VIBE:END ====\ntruncated' }],
        }),
      (error: unknown) =>
        error instanceof VibeBundleSerializeError && error.code === 'separator-collision',
    );
  });

  it('reports required audit and design package files independently', () => {
    assert.deepEqual(checkRequiredFiles(['README.md', 'REVIEW.md'], 'audit'), {
      ok: false,
      missing: ['FINDINGS.json', 'prompt/CLI_MAIN_SESSION_PROMPT.md'],
    });
    assert.deepEqual(
      checkRequiredFiles(
        ['README.md', 'DESIGN.md', 'FINDINGS.json', 'prompt/CLI_MAIN_SESSION_PROMPT.md'],
        'design',
      ),
      { ok: true, missing: [] },
    );
  });
});
