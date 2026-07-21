// Universal integrity core — root export surface (design 0100 §7).
//
// Dependency-free plain ESM consumed by BOTH TypeScript roots through the private
// package.json#imports alias `#universal-integrity-core`. Domain ownership stays in the
// lanes: this module exposes stable mechanics only, with no defaults, no configuration,
// no runtime override, and no domain imports. The deterministic test-only race seam for
// the descriptor reader is intentionally NOT exported here (see file-read-test-seam.js).
export {
  HASH_PROFILES,
  HASH_PROFILE_CANONICAL_JSON_V1,
  HASH_PROFILE_ORDERED_JSON_V1,
  HASH_PROFILE_RAW_BYTES_SHA256_V1,
  canonicalJsonV1,
  orderedJsonV1,
  serializeWithProfile,
  hashWithProfile,
} from './hash.js';
export {
  SHAPE_POLICIES,
  SHAPE_POLICY_EXACT_KEYS_V1,
  SHAPE_POLICY_LEGACY_KNOWN_FIELDS_V1,
  assertPlainRecord,
  assertExactKeys,
  assertShapePolicy,
  isSha256Hex,
} from './shape.js';
export { stripField, appendSelfHash, assertSelfHash } from './self-hash.js';
export {
  TIME_PROFILES,
  TIME_PROFILE_INSTANT_STRICT_V1,
  TIME_PROFILE_LEGACY_DATE_PARSE_V1,
  TIME_PROFILE_CALENDAR_DATE_STRICT_V1,
  TIME_PROFILE_EXPLICIT_GRAMMAR_V1,
  isValidTime,
  parseTime,
  notAfter,
  strictlyBefore,
  monotonicNonDecreasing,
  latestOf,
  withinWindow,
} from './time.js';
export { IntegrityFailure, integrityFailure } from './failure.js';
export { classifyExactReplay, assertExactReplay } from './replay.js';
export {
  FINAL_EVIDENCE_MANIFEST_SCHEMA_VERSION,
  FINAL_EVIDENCE_MANIFEST_ROSTER,
  buildFinalEvidenceManifest,
  deriveFinalEvidenceManifest,
  validateFinalEvidenceManifest,
} from './manifest.js';
export { copyBoundedFileOnce, readBoundedFileOnce } from './file-read.js';
