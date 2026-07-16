import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  GoldenPromptDatasetSchema,
  type GoldenPromptDataset,
} from '../src/lib/schemas/pro-bridge.js';
import { composeReviewPrompt } from '../src/pro-bridge/prompt-composer.js';
import { MailboxStore } from '../src/pro-bridge/mailbox/store.js';
import {
  WEB_PUBLICATION_PROMPT,
  createMailboxTools,
  serializeToolDescriptor,
} from '../src/pro-bridge/mailbox/tools.js';

const DATASET_PATH = fileURLToPath(new URL('./fixtures/golden-prompts/dataset.json', import.meta.url));

async function dataset(): Promise<GoldenPromptDataset> {
  return GoldenPromptDatasetSchema.parse(JSON.parse(await readFile(DATASET_PATH, 'utf8')));
}

async function withCatalog<T>(
  callback: (catalog: ReturnType<typeof serializeToolDescriptor>[]) => T | Promise<T>,
): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), 'vibe-golden-catalog-'));
  try {
    const store = new MailboxStore({
      repoRoot: root,
      now: () => new Date('2026-07-16T12:00:00.000Z'),
    });
    return await callback(createMailboxTools(store).map(serializeToolDescriptor));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('pro bridge golden prompt dataset', () => {
  it('parses the committed golden prompt dataset with the strict schema', async () => {
    const parsed = await dataset();
    assert.equal(parsed.cases.length >= 15, true);
    assert.equal(new Set(parsed.cases.map((entry) => entry.id)).size, parsed.cases.length);
    for (const category of ['direct', 'indirect', 'fallback', 'negative', 'cancel'] as const) {
      assert.equal(parsed.cases.filter((entry) => entry.category === category).length >= 3, true);
    }
  });

  it('keeps the five canonical golden prompts from the acceptance plan verbatim', async () => {
    const parsed = await dataset();
    const canonical = new Map([
      ['direct', 'Review request AUD-123 and save the completed package for CLI import.'],
      ['indirect', 'Finish this Vibe review and make the result available to my CLI.'],
      ['fallback', 'Resume upload session UPL-123 using the returned chunk plan.'],
      ['negative', 'Explain what request AUD-123 is asking for.'],
      ['cancel', 'Cancel request AUD-123.'],
    ]);
    for (const [category, prompt] of canonical) {
      const matches = parsed.cases.filter((entry) => entry.prompt === prompt);
      assert.equal(matches.length, 1);
      assert.equal(matches[0]!.category, category);
      assert.equal(matches[0]!.source, 'acceptance-plan');
    }
  });

  it('binds every golden case tool reference to a model visible catalog tool', async () => {
    const parsed = await dataset();
    await withCatalog((catalog) => {
      const byName = new Map(catalog.map((tool) => [tool.name, tool]));
      for (const entry of parsed.cases) {
        for (const name of [...entry.expectedTools, ...entry.forbiddenTools]) {
          assert.equal(byName.has(name), true, `${entry.id}: unknown tool ${name}`);
        }
        for (const name of entry.expectedTools) {
          const visibility = byName.get(name)!._meta.ui.visibility;
          assert.equal(visibility.includes('model'), true, `${entry.id}: ${name} is not model-visible`);
        }
      }
    });
  });

  it('enforces publish expectations per golden category', async () => {
    const parsed = await dataset();
    for (const entry of parsed.cases) {
      if (entry.category === 'direct' || entry.category === 'indirect') {
        assert.equal(entry.expectedTools.includes('publish_review_package'), true);
        assert.equal(entry.forbiddenTools.includes('publish_review_package'), false);
        assert.equal(entry.expectedFinalStatus, 'result-ready');
      } else if (entry.category === 'fallback') {
        assert.equal(entry.expectedTools.includes('put_result_file'), true);
        assert.equal(entry.expectedTools.includes('finalize_result'), true);
        assert.equal(entry.expectedFinalStatus, 'result-ready');
      } else {
        assert.equal(entry.expectedFinalStatus, null);
      }
    }
  });

  it('forbids publication tools in negative and cancel golden cases', async () => {
    const parsed = await dataset();
    await withCatalog((catalog) => {
      const byName = new Map(catalog.map((tool) => [tool.name, tool]));
      for (const entry of parsed.cases.filter((value) => value.category === 'negative')) {
        for (const name of ['publish_review_package', 'begin_result', 'put_result_file', 'finalize_result']) {
          assert.equal(entry.forbiddenTools.includes(name), true, `${entry.id}: ${name}`);
        }
        for (const name of entry.expectedTools) {
          assert.equal(byName.get(name)!.annotations?.readOnlyHint, true, `${entry.id}: ${name}`);
        }
      }
      for (const entry of parsed.cases.filter((value) => value.category === 'cancel')) {
        assert.equal(entry.expectedTools.includes('cancel_request'), true);
        assert.equal(entry.forbiddenTools.includes('publish_review_package'), true);
      }
    });
  });

  it('embeds the completion invariant in the web publication prompt templates', async () => {
    const parsed = await dataset();
    assert.equal(WEB_PUBLICATION_PROMPT[0], parsed.completionInvariant);
    const composed = composeReviewPrompt({
      kind: 'goal_audit',
      userGoal: 'Audit the current goal.',
      goalSource: null,
      scope: {
        repository: {
          remoteUrl: 'https://github.com/owner/repo.git',
          fullName: 'owner/repo',
          defaultBranch: 'main',
        },
        git: {
          baseSha: 'a'.repeat(40),
          headSha: 'b'.repeat(40),
          branch: 'main',
          baseVisibility: 'remote',
          headVisibility: 'remote',
          headVisibleOnGitHub: true,
          compareUrlHint: null,
        },
        visibilityCase: 'github-range',
        patch: null,
        blockedReasons: [],
        warnings: [],
      },
      requestId: 'AUD-20260716-golden',
      now: () => new Date('2026-07-16T12:00:00.000Z'),
    });
    assert.equal(composed.includes(parsed.completionInvariant), true);
  });
});
