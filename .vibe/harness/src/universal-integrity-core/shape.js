// Universal integrity core — plain-object and exact-key-roster mechanics (design 0100 §8.2).
//
// Every adapter names a shape policy explicitly. `exact-keys-v1` is for contracts that
// already enforce exact keys and for every new contract; `legacy-known-fields-v1` is ONLY
// for an existing version whose current validator accepts additional fields — under that
// policy the core asserts plain-record shape and leaves field checks to the lane, so a
// migration can never silently tighten a frozen contract.
import { integrityFailure } from './failure.js';

export const SHAPE_POLICY_EXACT_KEYS_V1 = 'exact-keys-v1';
export const SHAPE_POLICY_LEGACY_KNOWN_FIELDS_V1 = 'legacy-known-fields-v1';

export const SHAPE_POLICIES = Object.freeze([
  SHAPE_POLICY_EXACT_KEYS_V1,
  SHAPE_POLICY_LEGACY_KNOWN_FIELDS_V1,
]);

/**
 * Reject null, arrays, class instances, and non-object values where a lane requires
 * plain JSON data. Accepts objects whose prototype is Object.prototype or null.
 * @param {unknown} value
 * @param {string} label
 * @returns {asserts value is Record<string, unknown>}
 */
export function assertPlainRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw integrityFailure('UIC_SHAPE_NOT_PLAIN_RECORD', `${label} is not an object`, {
      subjectKind: label,
    });
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw integrityFailure('UIC_SHAPE_NOT_PLAIN_RECORD', `${label} is not an object`, {
      subjectKind: label,
    });
  }
}

/**
 * Sorted exact-roster comparison (the frozen mechanics of the repository's existing
 * assertExactKeys implementations — see shape-vectors.json).
 * @param {unknown} value
 * @param {readonly string[]} expected
 * @param {string} label
 * @returns {asserts value is Record<string, unknown>}
 */
export function assertExactKeys(value, expected, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw integrityFailure('UIC_SHAPE_NOT_PLAIN_RECORD', `${label} is not an object`, {
      subjectKind: label,
    });
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw integrityFailure(
      'UIC_SHAPE_ROSTER_MISMATCH',
      `${label} has an unexpected field roster`,
      { subjectKind: label },
    );
  }
}

/**
 * Apply a NAMED shape policy. Exact-keys enforces the full roster; the legacy policy
 * asserts plain-record shape only (lane validators keep their frozen permissive checks).
 * @param {unknown} value
 * @param {readonly string[]} roster
 * @param {string} policy
 * @param {string} label
 * @returns {asserts value is Record<string, unknown>}
 */
export function assertShapePolicy(value, roster, policy, label) {
  if (!SHAPE_POLICIES.includes(policy)) {
    throw integrityFailure(
      'UIC_SHAPE_POLICY_UNKNOWN',
      `shape policy must be one of ${SHAPE_POLICIES.join(', ')}`,
      { subjectKind: label },
    );
  }
  if (policy === SHAPE_POLICY_EXACT_KEYS_V1) {
    assertExactKeys(value, roster, label);
    return;
  }
  assertPlainRecord(value, label);
}

/**
 * @param {unknown} value
 * @returns {value is string} lowercase 64-hex SHA-256
 */
export function isSha256Hex(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}
