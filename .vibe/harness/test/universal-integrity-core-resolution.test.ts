import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// The universal integrity core is VENDORED inside the harness (plain dependency-free ESM
// + checked .d.ts). Shared-module ownership boundary (workflow-integrity §11): a
// downstream that owns an equivalent module KEEPS it and its alias, importing only the
// documented cross-boundary symbols (deriveFinalEvidenceManifest here) from this vendored
// copy; a downstream with no such module aliases #universal-integrity-core to this path.
// This test freezes the canonical divergence vector and the fail-closed profile contract
// from the harness side.
import { canonicalJsonV1, hashWithProfile } from '../src/universal-integrity-core/index.js';

describe('universal-integrity-core harness resolution', () => {
  it('resolves the vendored module and reproduces the frozen canonical divergence vector', () => {
    const divergence = { b: 1, a: 2 };
    assert.equal(canonicalJsonV1(divergence), '{"a":2,"b":1}');
    assert.equal(
      hashWithProfile('canonical-json-v1', divergence) === hashWithProfile('ordered-json-v1', divergence),
      false,
    );
  });

  it('fails closed on an unknown profile from the harness root too', () => {
    assert.throws(
      () => hashWithProfile('sha256' as never, { a: 1 }),
      /hash profile must be one of/u,
    );
  });
});
