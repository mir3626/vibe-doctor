import type { ModelRegistry } from './schemas/model-registry.js';
import type { RoleRef, ResolvedModel, TierRef } from './model-registry.js';
export function resolveModel(registry: ModelRegistry, providerId: string, tier: TierRef['tier']): ResolvedModel;
export function resolveRoleRef(registry: ModelRegistry | null, ref: RoleRef): ResolvedModel;
