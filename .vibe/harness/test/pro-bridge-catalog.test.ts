import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';
import { MailboxStore } from '../src/pro-bridge/mailbox/store.js';
import {
  MAILBOX_TOOL_NAMES,
  TOOL_CATALOG_VERSION,
  auditToolCatalog,
  buildCatalogSnapshot,
  createMailboxTools,
  serializeToolDescriptor,
} from '../src/pro-bridge/mailbox/tools.js';

const NOW = new Date('2026-07-16T00:00:00.000Z');

function tools(options: Parameters<typeof createMailboxTools>[1] = {}) {
  return createMailboxTools(
    new MailboxStore({ repoRoot: path.join(tmpdir(), 'vibe-pro-catalog-static'), now: () => NOW }),
    { now: () => NOW, ...options },
  );
}

function descriptors() {
  return tools().map(serializeToolDescriptor);
}

const approved = {
  create_request: [false, false, false, true, ['bridge.request.write']],
  create_design_request: [false, false, false, true, ['bridge.request.write']],
  list_pending_requests: [true, false, false, true, ['bridge.request.read']],
  get_request: [true, false, false, true, ['bridge.request.read']],
  claim_request: [false, false, false, undefined, ['bridge.request.write']],
  publish_review_package: [false, false, false, true, ['bridge.result.write']],
  begin_result: [false, false, false, true, ['bridge.result.write']],
  put_result_file: [false, false, false, true, ['bridge.result.write']],
  finalize_result: [false, false, false, true, ['bridge.result.write']],
  get_result_manifest: [true, false, false, true, ['bridge.result.read']],
  get_result_file: [true, false, false, true, ['bridge.result.read']],
  bridge_capabilities: [true, false, false, true, []],
  acknowledge_import: [false, false, false, true, ['bridge.import.ack']],
  cancel_request: [false, true, false, true, ['bridge.request.write']],
} as const;

describe('Pro Bridge tool catalog', () => {
  it('declares the approved annotation matrix on every tool', () => {
    for (const tool of tools()) {
      const [readOnlyHint, destructiveHint, openWorldHint, idempotentHint] = approved[tool.name as keyof typeof approved];
      assert.deepEqual(tool.annotations, {
        readOnlyHint,
        destructiveHint,
        openWorldHint,
        ...(idempotentHint === undefined ? {} : { idempotentHint }),
      });
    }
  });

  it('declares model and app visibility and scope metadata on every tool', () => {
    for (const tool of tools()) {
      assert.deepEqual(tool._meta.ui.visibility, ['model', 'app']);
      assert.deepEqual(
        tool._meta['vibe/requiredScopes'],
        approved[tool.name as keyof typeof approved][4],
      );
    }
  });

  it('declares an output schema on every tool with object or union shape', () => {
    for (const tool of tools()) {
      const anyOf = Array.isArray(tool.outputSchema.anyOf) ? tool.outputSchema.anyOf : [];
      assert.ok(tool.outputSchema.type === 'object' || anyOf.length > 0, tool.name);
    }
  });

  it('accepts real tool results with each declared output schema', async () => {
    const catalog = tools();
    const pending = catalog.find((tool) => tool.name === 'list_pending_requests')!;
    assert.deepEqual(await pending.invoke({}), { requests: [] });
    const capabilities = catalog.find((tool) => tool.name === 'bridge_capabilities')!;
    assert.equal((await capabilities.invoke({}) as { toolCatalogVersion: string }).toolCatalogVersion, '2');
    for (const tool of catalog) {
      assert.equal(typeof tool.invoke, 'function');
      assert.ok(tool.outputSchema);
    }
  });

  it('starts every tool description with the use-this contract', () => {
    for (const tool of tools()) {
      assert.match(tool.description, /^Use this (when|only|after)/, tool.name);
    }
  });

  it('keeps the pinned description literals for the terminal tools', () => {
    const byName = new Map(tools().map((tool) => [tool.name, tool.description]));
    assert.ok(byName.get('acknowledge_import')?.startsWith('Use this after the local CLI importer has successfully installed and verified the exact result package. Do not use it merely because a Web review finished.'));
    assert.ok(byName.get('cancel_request')?.startsWith('Use this only when the user explicitly asks to cancel a non-terminal request. Do not use it to restart, revise, or replace a review.'));
    for (const name of ['publish_review_package', 'begin_result', 'put_result_file', 'finalize_result']) {
      assert.match(byName.get(name) ?? '', /^Use this (when|only|after)/, name);
    }
    assert.match(byName.get('finalize_result') ?? '', /requestPayloadSha256 and payloadSha256 fields may be omitted; the server fills and verifies both hashes/);
  });

  it('reports bridge capabilities with catalog version limits and scopes', async () => {
    const capabilityTool = tools({
      publishLimits: { maxFiles: 7, maxTotalBytes: 8_000, maxFileBytes: 900 },
    }).find((tool) => tool.name === 'bridge_capabilities')!;
    const result = await capabilityTool.invoke({}) as Record<string, unknown>;
    assert.equal(result.protocolVersion, 'vibe-pro-bridge-v1');
    assert.equal(result.toolCatalogVersion, String(TOOL_CATALOG_VERSION));
    assert.deepEqual(result.normalPackageLimits, {
      maxFiles: 7,
      maxTotalBytes: 8_000,
      maxSingleFileBytes: 900,
    });
    assert.deepEqual(result.requiredScopes, {
      reviewRead: ['bridge.request.read'],
      resultWrite: ['bridge.result.write'],
      importAck: ['bridge.result.read', 'bridge.import.ack'],
    });
  });

  it('derives the server build sha from the injected option', async () => {
    const injected = tools({ serverBuildSha: 'a'.repeat(40) })
      .find((tool) => tool.name === 'bridge_capabilities')!;
    const fallback = tools().find((tool) => tool.name === 'bridge_capabilities')!;
    assert.equal((await injected.invoke({}) as { serverBuildSha: string }).serverBuildSha, 'a'.repeat(40));
    assert.equal((await fallback.invoke({}) as { serverBuildSha: string }).serverBuildSha, 'unknown');
  });

  it('passes the deterministic catalog audit with zero findings', () => {
    assert.deepEqual(auditToolCatalog(descriptors()), []);
    assert.deepEqual(descriptors().map((tool) => tool.name), [...MAILBOX_TOOL_NAMES]);
  });

  it('fails the catalog audit on each seeded misclassification', () => {
    const seeds: Array<[string, string, (tool: Record<string, unknown>) => void]> = [
      ['create_request', 'missing-annotations', (tool) => { delete tool.annotations; }],
      ['create_request', 'write-tool-readonly', (tool) => { (tool.annotations as Record<string, unknown>).readOnlyHint = true; }],
      ['create_request', 'destructive-misclassified', (tool) => { (tool.annotations as Record<string, unknown>).destructiveHint = true; }],
      ['create_request', 'missing-output-schema', (tool) => { delete tool.outputSchema; }],
      ['create_request', 'missing-model-visibility', (tool) => { (tool._meta as { ui: { visibility: string[] } }).ui.visibility = []; }],
      ['create_request', 'missing-auth-scope-meta', (tool) => { delete (tool._meta as Record<string, unknown>)['vibe/requiredScopes']; }],
      ['begin_result', 'missing-fallback-restriction', (tool) => { tool.description = 'Use this only for fallback uploads.'; }],
    ];
    for (const [name, rule, mutate] of seeds) {
      const seeded = structuredClone(descriptors()) as unknown as Array<Record<string, unknown>>;
      mutate(seeded.find((tool) => tool.name === name)!);
      assert.ok(auditToolCatalog(seeded).some((finding) => finding.tool === name && finding.rule === rule), rule);
    }
  });

  it('matches the committed catalog snapshot fixture', async () => {
    const fixturePath = path.join(
      process.cwd(),
      '.vibe/harness/test/fixtures/pro-bridge-catalog-snapshot.json',
    );
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as unknown;
    assert.deepEqual(buildCatalogSnapshot(descriptors()), fixture);
  });
});
