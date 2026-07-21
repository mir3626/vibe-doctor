// Universal integrity core — final-workflow-evidence-manifest mechanics (design 0100 §8.8,
// hardened by flow-002 r07 FND-020).
//
// Deterministic construction, DERIVATION, and validation of
// `final-workflow-evidence-manifest-v1`. There is ONE pure derivation of the complete
// expected manifest from normalized checkpoint inputs plus exact checkpoint/matrix byte
// hashes; the product builder produces its manifest THROUGH it and the Pro publisher
// independently reconstructs it and requires canonical byte-for-byte equality, so a
// self-consistent rehashed manifest that omits mandatory QA, contract rows, or
// checkpoints can never publish. Pro flow transition authority stays in the harness;
// packet discovery and repository inspection stay in the product script.
import { createHash } from 'node:crypto';
import { HASH_PROFILE_CANONICAL_JSON_V1 } from './hash.js';
import { appendSelfHash, assertSelfHash, stripField } from './self-hash.js';
import { assertExactKeys, assertPlainRecord, assertShapePolicy, isSha256Hex, SHAPE_POLICY_EXACT_KEYS_V1 } from './shape.js';
import { integrityFailure } from './failure.js';

export const FINAL_EVIDENCE_MANIFEST_SCHEMA_VERSION = 'final-workflow-evidence-manifest-v1';

/** The exact field roster of a v1 final evidence manifest (frozen — manifest-vectors.json). */
export const FINAL_EVIDENCE_MANIFEST_ROSTER = Object.freeze([
  'schemaVersion',
  'flowPath',
  'protocolVersion',
  'designEventId',
  'flowBaseSha',
  'finalProductHeadSha',
  'currentReviewedHeadSha',
  'productToCurrentCompareStatus',
  'qaRoster',
  'workflowEvidenceRows',
  'sprintCheckpoints',
  'workflowMatrixSha256',
  'skippedChecks',
  'residualRisks',
  'payloadSha256',
]);

const QA_ITEM_ROSTER = Object.freeze(['command', 'status', 'summary']);
const ROW_ITEM_ROSTER = Object.freeze(['contractId', 'ownerSprintId', 'status', 'rowSha256']);
const CHECKPOINT_ITEM_ROSTER = Object.freeze([
  'sprintId', 'directory', 'checkpointFileSha256', 'evidenceHash', 'recordedAt',
]);

/**
 * ONE pure derivation of the complete expected manifest (r07 FND-020). Everything except
 * the caller-attested repository facts (current reviewed HEAD, product-to-current compare
 * status, skipped checks) is computed from the normalized checkpoint inputs and the exact
 * checkpoint/matrix byte hashes; mandatory commands are enforced HERE, so both the
 * builder and every independent reconstruction fail closed identically.
 * @param {{
 *   flowPath: string,
 *   protocolVersion: string,
 *   designEventId: string,
 *   flowBaseSha: string,
 *   currentReviewedHeadSha: string,
 *   productToCurrentCompareStatus: string,
 *   checkpoints: readonly {
 *     directory: string,
 *     checkpointFileSha256: string,
 *     recordedAt: string,
 *     evidenceHash: string,
 *     input: {
 *       sprintId: string | null,
 *       headSha: string,
 *       finalGatePassed?: boolean,
 *       verification: readonly { command: string, status: string, summary: string }[],
 *       workflowEvidence: readonly Record<string, unknown>[],
 *       risks: readonly string[],
 *     },
 *   }[],
 *   contractRows: readonly { contractId: string, ownerSprintId: string }[],
 *   workflowMatrixSha256: string,
 *   skippedChecks: readonly string[],
 *   mandatoryCommands: readonly string[],
 * }} input
 * @returns {Record<string, unknown>} the complete self-hashed manifest
 */
export function deriveFinalEvidenceManifest(input) {
  if (!Array.isArray(input.checkpoints) || input.checkpoints.length === 0) {
    throw integrityFailure('UIC_MANIFEST_NO_CHECKPOINTS', 'final evidence manifest has no checkpoints');
  }
  for (let index = 1; index < input.checkpoints.length; index += 1) {
    if (input.checkpoints[index].recordedAt < input.checkpoints[index - 1].recordedAt) {
      throw integrityFailure(
        'UIC_MANIFEST_CHECKPOINT_ORDER',
        'final evidence manifest checkpoints are not recordedAt-ordered',
      );
    }
  }
  const finalCheckpoint = input.checkpoints[input.checkpoints.length - 1];
  const finalProductHeadSha = finalCheckpoint.input.headSha;
  if (input.checkpoints.some(({ input: item }) => item.headSha !== finalProductHeadSha) &&
      finalCheckpoint.input.finalGatePassed !== true) {
    throw integrityFailure(
      'UIC_MANIFEST_FINAL_GATE_MISSING',
      'final evidence manifest last checkpoint does not carry a passed final gate',
    );
  }

  /** @type {{ command: string, status: string, summary: string }[]} */
  const qaRoster = [];
  const qaSeen = new Set();
  for (const { input: item } of input.checkpoints) {
    for (const verification of item.verification) {
      const key = JSON.stringify([verification.command, verification.status, verification.summary]);
      if (qaSeen.has(key)) continue;
      qaSeen.add(key);
      qaRoster.push({
        command: verification.command,
        status: verification.status,
        summary: verification.summary,
      });
    }
  }
  for (const command of input.mandatoryCommands) {
    const entries = qaRoster.filter((item) => item.command === command);
    if (entries.length === 0) {
      throw integrityFailure(
        'UIC_MANIFEST_MANDATORY_COMMAND_MISSING',
        `final evidence manifest mandatory QA command is missing: ${command}`,
      );
    }
    if (entries.some(({ status }) => status !== 'passed')) {
      throw integrityFailure(
        'UIC_MANIFEST_MANDATORY_COMMAND_NOT_PASSED',
        `final evidence manifest mandatory QA command is not uniformly passed: ${command}`,
      );
    }
    if (input.skippedChecks.some((item) => item.includes(command))) {
      throw integrityFailure(
        'UIC_MANIFEST_MANDATORY_COMMAND_SKIPPED',
        `final evidence manifest mandatory QA command may not be skipped: ${command}`,
      );
    }
  }

  /** @type {Map<string, Record<string, unknown>>} */
  const merged = new Map();
  for (const { input: item } of input.checkpoints) {
    for (const row of item.workflowEvidence) {
      merged.set(/** @type {string} */ (row.contractId), row);
    }
  }
  const workflowEvidenceRows = input.contractRows.map(({ contractId, ownerSprintId }) => {
    const row = merged.get(contractId);
    if (row === undefined || row.status !== 'complete') {
      throw integrityFailure(
        'UIC_MANIFEST_EVIDENCE_ROW_MISSING',
        `final evidence manifest workflow evidence is missing or incomplete for ${contractId}`,
      );
    }
    return {
      contractId,
      ownerSprintId,
      status: /** @type {string} */ (row.status),
      rowSha256: createHash('sha256').update(JSON.stringify(row)).digest('hex'),
    };
  });

  const residualRisks = [...new Set(
    input.checkpoints.flatMap(({ input: item }) => [...item.risks]),
  )];

  return buildFinalEvidenceManifest({
    schemaVersion: FINAL_EVIDENCE_MANIFEST_SCHEMA_VERSION,
    flowPath: input.flowPath,
    protocolVersion: input.protocolVersion,
    designEventId: input.designEventId,
    flowBaseSha: input.flowBaseSha,
    finalProductHeadSha,
    currentReviewedHeadSha: input.currentReviewedHeadSha,
    productToCurrentCompareStatus: input.productToCurrentCompareStatus,
    qaRoster,
    workflowEvidenceRows,
    sprintCheckpoints: input.checkpoints.map(({ directory, checkpointFileSha256, recordedAt, evidenceHash, input: item }) => ({
      sprintId: item.sprintId,
      directory,
      checkpointFileSha256,
      evidenceHash,
      recordedAt,
    })),
    workflowMatrixSha256: input.workflowMatrixSha256,
    skippedChecks: [...input.skippedChecks],
    residualRisks,
  });
}

/**
 * Append the canonical self-hash to an unsigned manifest.
 * @param {Record<string, unknown>} unsigned
 * @returns {Record<string, unknown>}
 */
export function buildFinalEvidenceManifest(unsigned) {
  const manifest = appendSelfHash(unsigned, 'payloadSha256', HASH_PROFILE_CANONICAL_JSON_V1);
  validateFinalEvidenceManifest(manifest);
  return manifest;
}

/**
 * Validate roster, nested item rosters/types/uniqueness/order, scalar/hash syntax, and
 * the canonical self-hash of a manifest value (typically parsed from published bytes —
 * the caller supplies the parse and any lane-specific binding checks such as
 * current-HEAD, checkpoint-byte, or full-derivation comparisons).
 * @param {unknown} value
 * @returns {string} the verified payloadSha256
 */
export function validateFinalEvidenceManifest(value) {
  assertShapePolicy(value, FINAL_EVIDENCE_MANIFEST_ROSTER, SHAPE_POLICY_EXACT_KEYS_V1,
    'final evidence manifest');
  const manifest = /** @type {Record<string, unknown>} */ (value);
  if (manifest.schemaVersion !== FINAL_EVIDENCE_MANIFEST_SCHEMA_VERSION) {
    throw integrityFailure(
      'UIC_MANIFEST_SCHEMA_MISMATCH',
      'final evidence manifest schema version mismatch',
    );
  }
  for (const field of ['flowPath', 'protocolVersion', 'designEventId', 'productToCurrentCompareStatus']) {
    if (typeof manifest[field] !== 'string' || manifest[field].length === 0) {
      throw integrityFailure('UIC_MANIFEST_FIELD_INVALID', `final evidence manifest ${field} is not nonempty text`);
    }
  }
  for (const field of ['flowBaseSha', 'finalProductHeadSha', 'currentReviewedHeadSha']) {
    const head = manifest[field];
    if (typeof head !== 'string' || !/^[a-f0-9]{40}$/u.test(head)) {
      throw integrityFailure('UIC_MANIFEST_HEAD_INVALID', `final evidence manifest ${field} is not a commit SHA`);
    }
  }
  if (!isSha256Hex(manifest.workflowMatrixSha256)) {
    throw integrityFailure(
      'UIC_MANIFEST_MATRIX_HASH_INVALID',
      'final evidence manifest workflowMatrixSha256 is not a lowercase SHA-256',
    );
  }
  for (const field of ['qaRoster', 'workflowEvidenceRows', 'sprintCheckpoints', 'skippedChecks', 'residualRisks']) {
    if (!Array.isArray(manifest[field])) {
      throw integrityFailure('UIC_MANIFEST_FIELD_INVALID', `final evidence manifest ${field} is not an array`);
    }
  }
  // r07 FND-020: nested item rosters, scalar types, uniqueness, and order are validated
  // recursively — a structurally plausible but malformed nested item cannot self-hash
  // its way past validation.
  for (const field of ['skippedChecks', 'residualRisks']) {
    for (const item of /** @type {unknown[]} */ (manifest[field])) {
      if (typeof item !== 'string' || item.length === 0) {
        throw integrityFailure('UIC_MANIFEST_FIELD_INVALID', `final evidence manifest ${field} item is not nonempty text`);
      }
    }
  }
  for (const item of /** @type {unknown[]} */ (manifest.qaRoster)) {
    assertPlainRecord(item, 'final evidence manifest qaRoster item');
    assertExactKeys(item, QA_ITEM_ROSTER, 'final evidence manifest qaRoster item');
    const qa = /** @type {Record<string, unknown>} */ (item);
    for (const field of QA_ITEM_ROSTER) {
      if (typeof qa[field] !== 'string' || qa[field].length === 0) {
        throw integrityFailure('UIC_MANIFEST_FIELD_INVALID', `final evidence manifest qaRoster ${field} is not nonempty text`);
      }
    }
  }
  const contractIds = new Set();
  for (const item of /** @type {unknown[]} */ (manifest.workflowEvidenceRows)) {
    assertPlainRecord(item, 'final evidence manifest evidence row');
    assertExactKeys(item, ROW_ITEM_ROSTER, 'final evidence manifest evidence row');
    const row = /** @type {Record<string, unknown>} */ (item);
    for (const field of ['contractId', 'ownerSprintId', 'status']) {
      if (typeof row[field] !== 'string' || row[field].length === 0) {
        throw integrityFailure('UIC_MANIFEST_FIELD_INVALID', `final evidence manifest evidence row ${field} is not nonempty text`);
      }
    }
    if (!isSha256Hex(row.rowSha256)) {
      throw integrityFailure('UIC_MANIFEST_FIELD_INVALID', 'final evidence manifest evidence row hash is not a lowercase SHA-256');
    }
    if (contractIds.has(row.contractId)) {
      throw integrityFailure('UIC_MANIFEST_ROW_DUPLICATE', `final evidence manifest evidence row is duplicated: ${row.contractId}`);
    }
    contractIds.add(row.contractId);
  }
  const checkpointDirectories = new Set();
  let previousRecordedAt = '';
  for (const item of /** @type {unknown[]} */ (manifest.sprintCheckpoints)) {
    assertPlainRecord(item, 'final evidence manifest checkpoint');
    assertExactKeys(item, CHECKPOINT_ITEM_ROSTER, 'final evidence manifest checkpoint');
    const checkpoint = /** @type {Record<string, unknown>} */ (item);
    for (const field of ['directory', 'recordedAt']) {
      if (typeof checkpoint[field] !== 'string' || checkpoint[field].length === 0) {
        throw integrityFailure('UIC_MANIFEST_FIELD_INVALID', `final evidence manifest checkpoint ${field} is not nonempty text`);
      }
    }
    if (checkpoint.sprintId !== null &&
        (typeof checkpoint.sprintId !== 'string' || checkpoint.sprintId.length === 0)) {
      throw integrityFailure('UIC_MANIFEST_FIELD_INVALID', 'final evidence manifest checkpoint sprintId is invalid');
    }
    if (!isSha256Hex(checkpoint.checkpointFileSha256) || !isSha256Hex(checkpoint.evidenceHash)) {
      throw integrityFailure('UIC_MANIFEST_FIELD_INVALID', 'final evidence manifest checkpoint hash is not a lowercase SHA-256');
    }
    if (checkpointDirectories.has(checkpoint.directory)) {
      throw integrityFailure('UIC_MANIFEST_CHECKPOINT_DUPLICATE', `final evidence manifest checkpoint is duplicated: ${checkpoint.directory}`);
    }
    checkpointDirectories.add(checkpoint.directory);
    if (/** @type {string} */ (checkpoint.recordedAt) < previousRecordedAt) {
      throw integrityFailure('UIC_MANIFEST_CHECKPOINT_ORDER', 'final evidence manifest checkpoints are not recordedAt-ordered');
    }
    previousRecordedAt = /** @type {string} */ (checkpoint.recordedAt);
  }
  if (manifest.sprintCheckpoints.length === 0) {
    throw integrityFailure('UIC_MANIFEST_NO_CHECKPOINTS', 'final evidence manifest has no checkpoints');
  }
  return assertSelfHash({
    value: manifest,
    hashField: 'payloadSha256',
    profile: HASH_PROFILE_CANONICAL_JSON_V1,
    projectUnsigned: (record) => stripField(record, 'payloadSha256'),
    roster: FINAL_EVIDENCE_MANIFEST_ROSTER,
    shapePolicy: SHAPE_POLICY_EXACT_KEYS_V1,
    label: 'final evidence manifest',
  });
}
