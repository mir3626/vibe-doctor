import { z } from 'zod';
export { DEFAULT_PUBLISH_LIMITS, type PublishLimits } from '../config.js';
import { IsoDateTimeSchema } from './datetime.js';

export const GitShaSchema = z.string().regex(/^[0-9a-f]{40}$/);
export const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const FindingSeveritySchema = z.enum(['P0', 'P1', 'P2', 'P3']);

const FindingSchema = z
  .object({
    id: z.string().min(1),
    severity: FindingSeveritySchema,
    title: z.string().min(1),
  })
  .passthrough();

export const FindingsFileSchema = z
  .object({
    schemaVersion: z.literal('vibe-goal-audit-findings-v1'),
    requestId: z.string().min(1),
    repository: z
      .object({
        fullName: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
      })
      .passthrough(),
    snapshot: z
      .object({
        baseSha: GitShaSchema,
        headSha: GitShaSchema,
      })
      .passthrough(),
    disposition: z.string().min(1),
    summary: z
      .object({
        P0: z.number().int().min(0),
        P1: z.number().int().min(0),
        P2: z.number().int().min(0),
        P3: z.number().int().min(0),
      })
      .passthrough(),
    reviewerDeclaration: z
      .object({
        surface: z.string(),
        requestedMode: z.string(),
        githubConnectorUsed: z.boolean(),
        limitations: z.array(z.string()),
      })
      .passthrough(),
    P0: z.array(FindingSchema),
    P1: z.array(FindingSchema),
    P2: z.array(FindingSchema),
    P3: z.array(FindingSchema),
  })
  .passthrough();

export const CLI_PROMPT_CONTRACT_REQUIREMENTS = [
  {
    key: 'repository-identity',
    label: 'reviewed repository identity',
    groups: [{
      label: 'repository identity',
      patterns: [/\breviewed repository\b/, /\brepository identity\b/, /\brepository and exact refs\b/],
    }],
  },
  {
    key: 'reviewed-sha',
    label: 'reviewed SHA',
    groups: [{
      label: 'reviewed SHA',
      patterns: [/\breviewed (?:head|sha)\b/, /\bexact refs\b/, /\breview authority\b/],
    }],
  },
  {
    key: 'mandatory-reading',
    label: 'mandatory reading before implementation',
    groups: [{
      label: 'mandatory reading',
      patterns: [/\bmandatory reading\b/, /\brequired reading\b/, /\bmust read\b/],
    }],
  },
  {
    key: 'implementation-order',
    label: 'implementation order',
    groups: [{
      label: 'implementation order',
      patterns: [/\bimplementation order\b/, /\bimplementation sequence\b/, /\bimplementation phases?\b/],
    }],
  },
  {
    key: 'immutable-boundaries',
    label: 'immutable boundaries',
    groups: [{
      label: 'immutable boundaries',
      patterns: [/\bimmutable boundar(?:y|ies)\b/, /\binvariants?\b/, /\bmust remain unchanged\b/],
    }],
  },
  {
    key: 'prohibited-operations',
    label: 'prohibited operations',
    groups: [{
      label: 'prohibited operations',
      patterns: [/\bprohibited operations?\b/, /\bforbidden operations?\b/, /\bdo not\b/],
    }],
  },
  {
    key: 'verification-commands',
    label: 'exact verification commands',
    groups: [{
      label: 'verification commands',
      patterns: [/\bverification commands?\b/, /\bexact verification\b/, /\bverification steps?\b/],
    }],
  },
  {
    key: 'completion-requirements',
    label: 'stop conditions and final report requirements',
    groups: [
      {
        label: 'stop conditions',
        patterns: [/\bstop conditions?\b/, /\bconditions? to stop\b/, /\bstop and report\b/],
      },
      {
        label: 'final report requirements',
        patterns: [/\bfinal report requirements?\b/, /\bimplementation report\b/, /\bcompletion report\b/],
      },
    ],
  },
] as const;

export const FOLDER_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{2,79}$/;

export function isSafeRelativePath(filePath: string): boolean {
  if (
    filePath.length === 0 ||
    filePath.startsWith('/') ||
    filePath.startsWith('./') ||
    filePath.includes('\\') ||
    /^[A-Za-z]:/.test(filePath)
  ) {
    return false;
  }

  const segments = filePath.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

const RepositoryIdentitySchema = z
  .object({
    root: z.string(),
    remoteUrl: z.string().nullable(),
    fullName: z.string().nullable(),
  })
  .strict();

export const GoalSourceKindSchema = z.enum([
  'codex-goal',
  'vibe-goal-iterate',
  'handoff-reconstruction',
  'git-reconstruction',
]);

export const GoalSourceConfidenceSchema = z.enum(['exact', 'high', 'reconstructed']);

const GoalSourceDescriptorSchema = z
  .object({
    kind: GoalSourceKindSchema,
    confidence: GoalSourceConfidenceSchema,
    threadId: z.string().nullable(),
    iterationId: z.string().nullable(),
    goalText: z.string().min(1),
    goalStatus: z.string().nullable(),
  })
  .strict();

export const GoalSourceScopeSchema = z
  .object({
    changedFiles: z.array(z.string()),
    codeFiles: z.array(z.string()),
    testFiles: z.array(z.string()),
    migrationFiles: z.array(z.string()),
    docsFiles: z.array(z.string()),
    scopeGlobs: z.array(z.string()),
  })
  .strict();

export const GoalSourceDirtyStateSchema = z
  .object({
    staged: z.array(z.string()),
    unstaged: z.array(z.string()),
    untracked: z.array(z.string()),
    patchSha256: Sha256HexSchema.nullable(),
  })
  .strict();

export const GoalSourceManifestSchema = z
  .object({
    schemaVersion: z.literal('vibe-goal-source-v1'),
    repository: RepositoryIdentitySchema,
    source: GoalSourceDescriptorSchema,
    designRefs: z.array(z.string()),
    implementationRefs: z.array(z.string()),
    baseSha: GitShaSchema,
    headSha: GitShaSchema,
    commitShas: z.array(GitShaSchema),
    scope: GoalSourceScopeSchema,
    dirtyState: GoalSourceDirtyStateSchema,
    unresolved: z.array(z.string()),
    payloadSha256: Sha256HexSchema,
  })
  .strict();

export const ReviewKindSchema = z.enum([
  'goal_audit',
  'feature_design',
  'architecture_review',
  'implementation_review',
]);

export const ReviewOriginSchema = z.enum(['cli', 'web', 'workspace-agent', 'api']);

export const ReviewOutputContractSchema = z
  .object({
    requiredFiles: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const ReviewRequestSchema = z
  .object({
    schemaVersion: z.literal('vibe-pro-review-request-v1'),
    requestId: z.string().min(1),
    kind: ReviewKindSchema,
    origin: ReviewOriginSchema,
    repository: z
      .object({
        fullName: z.string(),
        remoteUrl: z.string(),
        defaultBranch: z.string().nullable(),
      })
      .strict(),
    git: z
      .object({
        baseSha: GitShaSchema,
        headSha: GitShaSchema,
        branch: z.string().nullable(),
        headVisibleOnGitHub: z.boolean(),
        compareUrlHint: z.string().nullable(),
        patchAttachmentSha256: Sha256HexSchema.nullable(),
      })
      .strict(),
    goalSource: GoalSourceManifestSchema.nullable(),
    userGoal: z.string(),
    reviewPrompt: z.string(),
    outputContract: ReviewOutputContractSchema,
    createdAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    payloadSha256: Sha256HexSchema,
  })
  .strict();

export const ReviewResultKindSchema = z.enum(['audit', 'design']);
export const ReviewDispositionSchema = z.enum([
  'approved',
  'approved-with-remediation',
  'remediation-required',
  'blocked',
]);

export const ReviewResultFileSchema = z
  .object({
    path: z.string().refine(isSafeRelativePath, 'Expected a safe relative path'),
    mediaType: z.enum(['text/markdown', 'application/json']),
    byteLength: z.number().int().min(0),
    sha256: Sha256HexSchema,
  })
  .strict();

export const ReviewResultManifestSchema = z
  .object({
    schemaVersion: z.literal('vibe-pro-review-result-v1'),
    requestId: z.string(),
    requestPayloadSha256: Sha256HexSchema,
    repositoryFullName: z.string(),
    reviewedBaseSha: GitShaSchema,
    reviewedHeadSha: GitShaSchema,
    resultKind: ReviewResultKindSchema,
    proposedFolder: z.string().regex(FOLDER_NAME_PATTERN),
    disposition: ReviewDispositionSchema,
    files: z.array(ReviewResultFileSchema),
    findingsSummary: z
      .object({
        p0: z.number().int().min(0),
        p1: z.number().int().min(0),
        p2: z.number().int().min(0),
        p3: z.number().int().min(0),
      })
      .strict(),
    reviewerDeclaration: z
      .object({
        surface: z.enum(['chatgpt-web', 'workspace-agent', 'responses-api']),
        requestedMode: z.enum(['pro', 'frontier', 'unspecified']),
        githubConnectorUsed: z.boolean(),
        limitations: z.array(z.string()),
      })
      .strict(),
    createdAt: IsoDateTimeSchema,
    payloadSha256: Sha256HexSchema,
  })
  .strict();

export type GoalSourceKind = z.infer<typeof GoalSourceKindSchema>;
export type GoalSourceConfidence = z.infer<typeof GoalSourceConfidenceSchema>;
export type GoalSourceScope = z.infer<typeof GoalSourceScopeSchema>;
export type GoalSourceDirtyState = z.infer<typeof GoalSourceDirtyStateSchema>;
export type GoalSourceManifest = z.infer<typeof GoalSourceManifestSchema>;
export type ReviewKind = z.infer<typeof ReviewKindSchema>;
export type ReviewOrigin = z.infer<typeof ReviewOriginSchema>;
export type ReviewOutputContract = z.infer<typeof ReviewOutputContractSchema>;
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;
export type ReviewResultKind = z.infer<typeof ReviewResultKindSchema>;
export type ReviewDisposition = z.infer<typeof ReviewDispositionSchema>;
export type ReviewResultFile = z.infer<typeof ReviewResultFileSchema>;
export type ReviewResultManifest = z.infer<typeof ReviewResultManifestSchema>;
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;
export type FindingsFile = z.infer<typeof FindingsFileSchema>;
