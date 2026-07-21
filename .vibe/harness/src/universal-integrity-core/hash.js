// Universal integrity core — explicit hash profiles (design 0100 §8.1).
//
// The repository intentionally contains THREE distinct byte contracts. A caller must name
// one; there is no default, and an unknown profile fails closed. The canonical profile
// reproduces the historical src/research-snapshot/fingerprints.ts behavior byte-for-byte
// (sorted keys, Date→ISO, Set/Map encodings, -0 normalization, rejection of undefined,
// non-finite numbers, cycles, and unsupported values — with the SAME error messages, now
// carried as IntegrityFailure with additive codes). The ordered profile hashes the exact
// native JSON.stringify output and must never sort or normalize. The raw profile accepts
// bytes only; text callers convert explicitly first.
import { createHash } from 'node:crypto';
import { integrityFailure } from './failure.js';

export const HASH_PROFILE_CANONICAL_JSON_V1 = 'canonical-json-v1';
export const HASH_PROFILE_ORDERED_JSON_V1 = 'ordered-json-v1';
export const HASH_PROFILE_RAW_BYTES_SHA256_V1 = 'raw-bytes-sha256-v1';

export const HASH_PROFILES = Object.freeze([
  HASH_PROFILE_CANONICAL_JSON_V1,
  HASH_PROFILE_ORDERED_JSON_V1,
  HASH_PROFILE_RAW_BYTES_SHA256_V1,
]);

/** @param {unknown} profile @returns {asserts profile is string} */
function assertKnownProfile(profile) {
  if (!HASH_PROFILES.includes(/** @type {string} */ (profile))) {
    throw integrityFailure(
      'UIC_HASH_PROFILE_UNKNOWN',
      `hash profile must be one of ${HASH_PROFILES.join(', ')}`,
      { operation: 'hashWithProfile' },
    );
  }
}

/**
 * Exact historical canonicalization (frozen byte contract — see hash-vectors.json).
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJsonV1(value) {
  return JSON.stringify(canonicalize(value, new Set()));
}

/**
 * Exact native-order serialization (frozen byte contract — see hash-vectors.json).
 * Builders using this profile must construct fields in the frozen schema order.
 * @param {unknown} value
 * @returns {string}
 */
export function orderedJsonV1(value) {
  return JSON.stringify(value);
}

/**
 * Serialize under an explicit JSON profile. The raw profile has no serialization.
 * @param {string} profile
 * @param {unknown} value
 * @returns {string}
 */
export function serializeWithProfile(profile, value) {
  assertKnownProfile(profile);
  if (profile === HASH_PROFILE_CANONICAL_JSON_V1) return canonicalJsonV1(value);
  if (profile === HASH_PROFILE_ORDERED_JSON_V1) return orderedJsonV1(value);
  throw integrityFailure(
    'UIC_HASH_PROFILE_NOT_SERIALIZABLE',
    'raw-bytes-sha256-v1 has no serialization; supply bytes to hashWithProfile',
    { operation: 'serializeWithProfile' },
  );
}

/**
 * Hash under an explicit profile. JSON profiles accept any supported value; the raw
 * profile accepts Uint8Array/Buffer bytes ONLY (explicit encoding is the caller's job).
 * @param {string} profile
 * @param {unknown} value
 * @returns {string} lowercase hex SHA-256
 */
export function hashWithProfile(profile, value) {
  assertKnownProfile(profile);
  if (profile === HASH_PROFILE_RAW_BYTES_SHA256_V1) {
    if (!(value instanceof Uint8Array)) {
      throw integrityFailure(
        'UIC_HASH_RAW_REQUIRES_BYTES',
        'raw-bytes-sha256-v1 accepts Uint8Array/Buffer bytes only',
        { operation: 'hashWithProfile' },
      );
    }
    return createHash('sha256').update(value).digest('hex');
  }
  return createHash('sha256').update(serializeWithProfile(profile, value), 'utf8').digest('hex');
}

/**
 * @param {unknown} value
 * @param {Set<object>} ancestors
 * @returns {unknown}
 */
function canonicalize(value, ancestors) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw integrityFailure('UIC_CANONICAL_NONFINITE', 'canonical JSON rejects NaN and Infinity');
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw integrityFailure('UIC_CANONICAL_INVALID_DATE', 'canonical JSON rejects invalid dates');
    }
    return value.toISOString();
  }
  if (typeof value !== 'object') {
    throw integrityFailure('UIC_CANONICAL_UNSUPPORTED', `canonical JSON rejects ${typeof value}`);
  }
  if (ancestors.has(value)) {
    throw integrityFailure('UIC_CANONICAL_CYCLE', 'canonical JSON rejects cyclic values');
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => canonicalize(item, ancestors));
    if (value instanceof Set) {
      return {
        $set: [...value]
          .map((item) => canonicalize(item, ancestors))
          .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
      };
    }
    if (value instanceof Map) {
      const entries = [...value.entries()].map(([key, entryValue]) => [
        canonicalize(key, ancestors),
        canonicalize(entryValue, ancestors),
      ]);
      entries.sort((left, right) => JSON.stringify(left[0]).localeCompare(JSON.stringify(right[0])));
      return { $map: entries };
    }
    const record = /** @type {Record<string, unknown>} */ (value);
    /** @type {Record<string, unknown>} */
    const result = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) {
        throw integrityFailure('UIC_CANONICAL_UNDEFINED', `canonical JSON rejects undefined at ${key}`);
      }
      result[key] = canonicalize(record[key], ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}
