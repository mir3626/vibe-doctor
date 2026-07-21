// Universal integrity core — self-hash composition and verification (design 0100 §8.3).
//
// The core appends or verifies ONE named hash field, but it never infers an unsigned
// payload: each lane supplies its exact unsigned projection, so schema order, excluded
// metadata, and domain checks stay visible in lane code. The fixed verification sequence
// is: shape policy → hash-field syntax → lane-owned unsigned projection → explicit
// profile hash → constant-order compare. Lane-owned domain and relational checks follow
// in the lane. Stored IDs, database columns, or a boolean `valid` flag never substitute
// for this sequence.
import { integrityFailure } from './failure.js';
import { hashWithProfile } from './hash.js';
import { assertShapePolicy, isSha256Hex } from './shape.js';

/**
 * The common lane projection helper: remove exactly the named hash field. Lanes pass it
 * EXPLICITLY as their projection when (and only when) their unsigned payload is the
 * value minus its self-hash field.
 * @param {Record<string, unknown>} value
 * @param {string} field
 * @returns {Record<string, unknown>}
 */
export function stripField(value, field) {
  const { [field]: _stripped, ...rest } = value;
  return rest;
}

/**
 * @param {Record<string, unknown>} unsigned
 * @param {string} hashField
 * @param {import('./hash.js').HashProfile} profile
 * @returns {Record<string, unknown>} unsigned plus the appended self-hash field
 */
export function appendSelfHash(unsigned, hashField, profile) {
  if (Object.prototype.hasOwnProperty.call(unsigned, hashField)) {
    throw integrityFailure(
      'UIC_SELF_HASH_FIELD_PRESENT',
      `self-hash field ${hashField} is already present on the unsigned payload`,
    );
  }
  return { ...unsigned, [hashField]: hashWithProfile(profile, unsigned) };
}

/**
 * Verify one named self-hash over the lane-supplied unsigned projection.
 * @param {{
 *   value: unknown,
 *   hashField: string,
 *   profile: import('./hash.js').HashProfile,
 *   projectUnsigned: (value: Record<string, unknown>) => unknown,
 *   roster: readonly string[],
 *   shapePolicy: import('./shape.js').ShapePolicy,
 *   label: string,
 * }} input
 * @returns {string} the verified hash value
 */
export function assertSelfHash(input) {
  assertShapePolicy(input.value, input.roster, input.shapePolicy, input.label);
  const record = /** @type {Record<string, unknown>} */ (input.value);
  const stored = record[input.hashField];
  if (!isSha256Hex(stored)) {
    throw integrityFailure(
      'UIC_SELF_HASH_FIELD_INVALID',
      `${input.label} ${input.hashField} is not a lowercase SHA-256`,
      { subjectKind: input.label },
    );
  }
  const derived = hashWithProfile(input.profile, input.projectUnsigned(record));
  if (derived !== stored) {
    throw integrityFailure(
      'UIC_SELF_HASH_MISMATCH',
      `${input.label} ${input.hashField} does not match its canonical payload`,
      { subjectKind: input.label, subjectHashOrId: /** @type {string} */ (stored) },
    );
  }
  return derived;
}
