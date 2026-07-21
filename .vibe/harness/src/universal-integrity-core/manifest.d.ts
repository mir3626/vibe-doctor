export declare const FINAL_EVIDENCE_MANIFEST_SCHEMA_VERSION: 'final-workflow-evidence-manifest-v1';
export declare const FINAL_EVIDENCE_MANIFEST_ROSTER: readonly string[];

export interface FinalEvidenceManifestCheckpointInput {
  directory: string;
  checkpointFileSha256: string;
  recordedAt: string;
  evidenceHash: string;
  input: {
    sprintId: string | null;
    headSha: string;
    finalGatePassed?: boolean;
    verification: readonly { command: string; status: string; summary: string }[];
    workflowEvidence: readonly Record<string, unknown>[];
    risks: readonly string[];
  };
}

/**
 * ONE pure derivation of the complete expected manifest (r07 FND-020): the builder
 * produces its manifest through it and the publisher independently reconstructs it and
 * requires byte-for-byte equality. Mandatory commands are enforced here.
 */
export declare function deriveFinalEvidenceManifest(input: {
  flowPath: string;
  protocolVersion: string;
  designEventId: string;
  flowBaseSha: string;
  currentReviewedHeadSha: string;
  productToCurrentCompareStatus: string;
  checkpoints: readonly FinalEvidenceManifestCheckpointInput[];
  contractRows: readonly { contractId: string; ownerSprintId: string }[];
  workflowMatrixSha256: string;
  skippedChecks: readonly string[];
  mandatoryCommands: readonly string[];
}): Record<string, unknown> & { payloadSha256: string };

export declare function buildFinalEvidenceManifest(
  unsigned: Record<string, unknown>,
): Record<string, unknown>;

export declare function validateFinalEvidenceManifest(value: unknown): string;
