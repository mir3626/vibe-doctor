import { z } from 'zod';

export const IterationExecutionBindingSchema = z.discriminatedUnion('executionLane', [
  z
    .object({
      executionLane: z.literal('standalone-goal-iterate'),
      proFlowPath: z.null(),
    })
    .strict(),
  z
    .object({
      executionLane: z.literal('pro-roundtrip'),
      proFlowPath: z.string().regex(/^flows\/[0-9]{8}\/[0-9]{3}-[a-z0-9][a-z0-9-]*$/),
    })
    .strict(),
]);

export const IterationEntrySchema = z
  .object({
    id: z.string(),
    label: z.string(),
    startedAt: z.string(),
    completedAt: z.string().nullable(),
    goal: z.string(),
    plannedSprints: z.array(z.string()),
    completedSprints: z.array(z.string()),
    milestoneProgress: z.record(z.number()),
    summary: z.string(),
    executionBinding: IterationExecutionBindingSchema.optional(),
  })
  .passthrough();

export const IterationHistorySchema = z
  .object({
    $schema: z.string().optional(),
    currentIteration: z.string().nullable(),
    iterations: z.array(IterationEntrySchema),
  })
  .passthrough();

export type IterationEntry = z.infer<typeof IterationEntrySchema>;
export type IterationHistory = z.infer<typeof IterationHistorySchema>;
export type IterationExecutionBinding = z.infer<typeof IterationExecutionBindingSchema>;
