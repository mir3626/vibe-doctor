import { z } from 'zod';

const ShaSchema = z.string().regex(/^[0-9a-f]{40}$/);
const NonEmptyStringSchema = z.string().min(1);
const SprintIdSchema = z.string().regex(/^SPR-[0-9]{3}$/);
const FlowPathSchema = z
  .string()
  .regex(/^flows\/[0-9]{8}\/[0-9]{3}-[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/);
const EventIdSchema = z
  .string()
  .regex(/^[0-9]{4}--(cli|codex|pro)--[a-z0-9][a-z0-9-]*--r[0-9]{2}$/);
const SafeRelativePathSchema = z
  .string()
  .regex(/^(?!\/)(?!.*\.\.)[A-Za-z0-9._/-]+$/);
const DateTimeSchema = z.string().datetime({ offset: true });

export const ProRoundtripFlowSchema = z
  .object({
    schemaVersion: z.literal('vibe-pro-flow-v1'),
    flowPath: FlowPathSchema,
    date: z.string().regex(/^[0-9]{8}$/),
    sequence: z.number().int().min(1).max(999),
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/),
    goal: NonEmptyStringSchema,
    nonGoals: z.array(NonEmptyStringSchema),
    repository: z
      .object({
        fullName: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
        remoteUrl: NonEmptyStringSchema,
      })
      .strict(),
    bridgeBranch: z.literal('vibe-pro-bridge'),
    codeBranch: NonEmptyStringSchema,
    baseSha: ShaSchema,
    protocol: z
      .object({
        version: z.string().regex(/^v[1-9][0-9]*$/),
        commitSha: ShaSchema,
        commonHarnessSha256: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .strict(),
    createdAt: DateTimeSchema,
    timezone: NonEmptyStringSchema,
    createdBy: z.enum(['cli', 'pro']),
  })
  .strict();

const RequirementSchema = z
  .object({
    id: z.string().regex(/^REQ-[0-9]{3}$/),
    title: NonEmptyStringSchema,
    statement: NonEmptyStringSchema,
    priority: z.enum(['must', 'should', 'could']),
    acceptanceCriteria: z.array(NonEmptyStringSchema).min(1),
    ownerSprint: SprintIdSchema,
  })
  .strict();

const InvariantSchema = z
  .object({
    id: z.string().regex(/^INV-[0-9]{3}$/),
    statement: NonEmptyStringSchema,
    validation: z.array(NonEmptyStringSchema).min(1),
  })
  .strict();

const WorkflowSchema = z
  .object({
    id: z.string().regex(/^WF-[0-9]{3}$/),
    title: NonEmptyStringSchema,
    steps: z.array(NonEmptyStringSchema).min(2),
    expectedOutcome: NonEmptyStringSchema,
    ownerSprints: z.array(SprintIdSchema).min(1),
  })
  .strict();

const NonFunctionalRequirementSchema = z
  .object({
    id: z.string().regex(/^NFR-[0-9]{3}$/),
    title: NonEmptyStringSchema,
    statement: NonEmptyStringSchema,
    validation: z.array(NonEmptyStringSchema).min(1),
    ownerSprint: SprintIdSchema,
  })
  .strict();

const DecisionSchema = z
  .object({
    id: z.string().regex(/^DEC-[0-9]{3}$/),
    decision: NonEmptyStringSchema,
    rationale: NonEmptyStringSchema,
    alternativesRejected: z.array(NonEmptyStringSchema),
  })
  .strict();

const SprintSchema = z
  .object({
    id: SprintIdSchema,
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/),
    objective: NonEmptyStringSchema,
    owns: z.array(z.string().regex(/^(REQ|NFR)-[0-9]{3}$/)).min(1),
    preserves: z.array(z.string().regex(/^INV-[0-9]{3}$/)).min(1),
    workflowsAffected: z.array(z.string().regex(/^WF-[0-9]{3}$/)).min(1),
    dependsOn: z.array(SprintIdSchema),
    nonGoals: z.array(NonEmptyStringSchema),
    filesLikelyTouched: z.array(NonEmptyStringSchema),
    verification: z.array(NonEmptyStringSchema).min(1),
    cumulativeIntegrationChecks: z.array(NonEmptyStringSchema).min(1),
  })
  .strict();

// FND-023: the design event owns its final-gate QA policy. The roster is immutable via
// the pinned CONTRACT.json blob; the publisher fails closed when the block is absent, so
// there is never a default or harness-side roster.
const FinalGatePolicySchema = z
  .object({
    mandatoryCommands: z.array(NonEmptyStringSchema).min(1),
  })
  .strict();

// Finding-scope discipline: the six impact classes a P0/P1 finding must claim at least
// one of when the design declares a productPlane. The runbook supplies the mechanism;
// the design event supplies the domain.
export const IMPACT_CLASSES = [
  'silent-incorrectness',
  'overstated-validation',
  'real-world-effect',
  'irreproducibility',
  'untrusted-boundary',
  'unrecoverable-loss',
] as const;

const ImpactClassSchema = z.enum(IMPACT_CLASSES);

// Design-authored product-plane declaration: what this flow exists to build, which
// impact classes apply to it, and where input genuinely crosses the trust boundary.
// Optional so historical contracts keep parsing; when present it arms the P0/P1
// impact-class validation on later feedback events.
const ProductPlaneSchema = z
  .object({
    description: NonEmptyStringSchema,
    correctnessCritical: z.array(NonEmptyStringSchema).min(1),
    impactClasses: z.array(ImpactClassSchema).min(1),
    untrustedBoundaries: z.array(NonEmptyStringSchema),
  })
  .strict();

export const ProRoundtripContractSchema = z
  .object({
    schemaVersion: z.literal('vibe-pro-contract-v1'),
    flowPath: FlowPathSchema,
    designEventId: z.string().regex(/^[0-9]{4}--pro--design--r[0-9]{2}$/),
    requirements: z.array(RequirementSchema).min(1),
    invariants: z.array(InvariantSchema).min(1),
    workflows: z.array(WorkflowSchema).min(1),
    nonFunctionalRequirements: z.array(NonFunctionalRequirementSchema),
    decisions: z.array(DecisionSchema),
    sprints: z.array(SprintSchema).min(1).max(12),
    finalGatePolicy: FinalGatePolicySchema.optional(),
    productPlane: ProductPlaneSchema.optional(),
    createdAt: DateTimeSchema,
  })
  .strict();

export const ProRoundtripEventCompleteSchema = z
  .object({
    schemaVersion: z.literal('vibe-pro-event-complete-v1'),
    flowPath: FlowPathSchema,
    eventId: EventIdSchema,
    sequence: z.number().int().min(0).max(9999).multipleOf(10),
    actor: z.enum(['cli', 'codex', 'pro']),
    kind: z.enum([
      'goal',
      'design',
      'implementation-report',
      'feedback',
      'remediation-report',
      'approval',
      'closed',
    ]),
    revision: z.number().int().min(1).max(99),
    previousEventId: EventIdSchema.nullable(),
    supersedesEventId: EventIdSchema.nullable(),
    protocolVersion: z.string().regex(/^v[1-9][0-9]*$/),
    designEventId: z.string().regex(/^[0-9]{4}--pro--design--r[0-9]{2}$/).nullable(),
    sprintId: SprintIdSchema.nullable(),
    repositoryFullName: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
    codeBranch: NonEmptyStringSchema,
    baseSha: ShaSchema,
    headSha: ShaSchema,
    disposition: z.enum([
      'complete',
      'approved',
      'approved-with-deferrals',
      'remediation-required',
      'design-revision-required',
      'blocked',
      'closed',
    ]),
    files: z
      .array(
        z
          .object({
            path: SafeRelativePathSchema,
            mediaType: z.enum(['text/markdown', 'application/json', 'text/plain']),
          })
          .strict(),
      )
      .min(1),
    limitations: z.array(NonEmptyStringSchema),
    createdAt: DateTimeSchema,
    nextActor: z.enum(['cli', 'codex', 'pro', 'user', 'none']),
    nextWriteTarget: SafeRelativePathSchema.nullable(),
  })
  .strict();

const VerificationEvidenceSchema = z
  .object({
    command: NonEmptyStringSchema,
    status: z.enum(['passed', 'failed', 'skipped']),
    summary: NonEmptyStringSchema,
  })
  .strict();

const WorkflowEvidenceSchema = z
  .object({
    contractId: z.string().regex(/^(REQ|INV|WF|NFR)-[0-9]{3}$/),
    implementationEvidence: NonEmptyStringSchema,
    testEvidence: NonEmptyStringSchema,
    integrationEvidence: NonEmptyStringSchema,
    status: z.enum(['complete', 'partial', 'blocked', 'deferred']),
    notes: z.string(),
  })
  .strict();

export const ProRoundtripReportInputSchema = z
  .object({
    schemaVersion: z.literal('vibe-pro-report-input-v1'),
    flowPath: FlowPathSchema,
    designEventId: z.string().regex(/^[0-9]{4}--pro--design--r[0-9]{2}$/).nullable(),
    sprintId: SprintIdSchema.nullable(),
    reportKind: z.enum(['implementation', 'remediation', 'audit']),
    baseSha: ShaSchema,
    headSha: ShaSchema,
    completedContractIds: z.array(z.string().regex(/^(REQ|INV|WF|NFR)-[0-9]{3}$/)),
    changedFiles: z.array(NonEmptyStringSchema),
    verification: z.array(VerificationEvidenceSchema).min(1),
    workflowEvidence: z.array(WorkflowEvidenceSchema),
    sprintGatePassed: z.boolean(),
    cumulativeGatePassed: z.boolean(),
    finalGatePassed: z.boolean(),
    resolvedFindingIds: z.array(NonEmptyStringSchema),
    risks: z.array(NonEmptyStringSchema),
    nextAction: NonEmptyStringSchema,
  })
  .strict();

export const ProRoundtripFindingsSchema = z
  .object({
    schemaVersion: z.literal('vibe-pro-findings-v1'),
    flowPath: FlowPathSchema,
    eventId: z.string().regex(/^[0-9]{4}--pro--feedback--r[0-9]{2}$/),
    reviewedHeadSha: ShaSchema,
    disposition: z.enum([
      'approved',
      'approved-with-deferrals',
      'remediation-required',
      'design-revision-required',
      'blocked',
    ]),
    findings: z.array(
      z
        .object({
          id: z.string().regex(/^FND-[0-9]{3}$/),
          taxonomy: z.enum([
            'implementation-defect',
            'design-defect',
            'missing-test',
            'scope-extension',
            'evidence-missing',
            'backlog-candidate',
          ]),
          severity: z.enum(['P0', 'P1', 'P2', 'P3']),
          contractIds: z.array(z.string().regex(/^(REQ|INV|WF|NFR)-[0-9]{3}$/)),
          summary: NonEmptyStringSchema,
          evidence: NonEmptyStringSchema,
          expectedBehavior: NonEmptyStringSchema,
          // Finding-scope discipline (optional for historical compatibility; the
          // productPlane-armed subset/severity rules live in the flow validator).
          plane: z.enum(['product', 'evidence']).optional(),
          impactClasses: z.array(ImpactClassSchema).optional(),
          threatModel: z
            .object({
              actor: NonEmptyStringSchema,
              requiredCapability: NonEmptyStringSchema,
              productConsequence: NonEmptyStringSchema,
            })
            .strict()
            .optional(),
        })
        .strict()
        .refine(
          (finding) =>
            !(finding.taxonomy === 'backlog-candidate' &&
              ['P0', 'P1'].includes(finding.severity)),
          { message: 'a backlog-candidate finding cannot be P0/P1' },
        ),
    ),
  })
  .strict();

export type ProRoundtripFlow = z.infer<typeof ProRoundtripFlowSchema>;
export type ProRoundtripContract = z.infer<typeof ProRoundtripContractSchema>;
export type ProRoundtripEventComplete = z.infer<typeof ProRoundtripEventCompleteSchema>;
export type ProRoundtripReportInput = z.infer<typeof ProRoundtripReportInputSchema>;
export type ProRoundtripFindings = z.infer<typeof ProRoundtripFindingsSchema>;
