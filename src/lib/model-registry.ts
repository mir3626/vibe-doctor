import path from 'node:path';
import { readJson } from './fs.js';
import { paths } from './paths.js';

export interface ModelEntry {
  apiId: string;
  release: string;
}

export interface ProviderRegistryEntry {
  tiers: Partial<Record<'flagship' | 'performant' | 'efficient', string>>;
  knownModels: Record<string, ModelEntry>;
}

export interface ModelRegistry {
  schemaVersion: number;
  updatedAt: string;
  source: string;
  providers: Record<string, ProviderRegistryEntry>;
}

export type TierRef = {
  provider: string;
  tier: 'flagship' | 'performant' | 'efficient';
};

export type RoleRef = string | TierRef;

export interface ResolvedModel {
  provider: string;
  tier?: 'flagship' | 'performant' | 'efficient';
  familyAlias: string;
  apiId: string;
  legacy: boolean;
}

const TIER_ORDER: TierRef['tier'][] = ['flagship', 'performant', 'efficient'];

function registryPath(root?: string): string {
  return path.join(root ?? paths.root, '.vibe', 'model-registry.json');
}

function formatAvailable(values: string[]): string {
  return values.length > 0 ? values.join(', ') : 'none';
}

function availableProviders(registry: ModelRegistry): string[] {
  return Object.keys(registry.providers).sort();
}

function availableTiers(provider: ProviderRegistryEntry): TierRef['tier'][] {
  return TIER_ORDER.filter((tier) => typeof provider.tiers[tier] === 'string');
}

export async function loadRegistry(root?: string): Promise<ModelRegistry> {
  const filePath = registryPath(root);
  const registry = await readJson<ModelRegistry>(filePath);

  if (registry.schemaVersion !== 1) {
    throw new Error(
      `registry schemaVersion ${String(registry.schemaVersion)} is unsupported; run npm run vibe:sync to refresh the harness registry`,
    );
  }

  return registry;
}

export function resolveModel(
  registry: ModelRegistry,
  providerId: string,
  tier: TierRef['tier'],
): ResolvedModel {
  const provider = registry.providers[providerId];
  if (!provider) {
    throw new Error(
      `registry: unknown provider "${providerId}" (available: ${formatAvailable(availableProviders(registry))})`,
    );
  }

  const familyAlias = provider.tiers[tier];
  if (!familyAlias) {
    throw new Error(
      `registry: provider "${providerId}" has no tier "${tier}" (available: ${formatAvailable(availableTiers(provider))})`,
    );
  }

  const model = provider.knownModels[familyAlias];
  if (!model) {
    throw new Error(
      `registry: provider "${providerId}" tier "${tier}" points to unknown family alias "${familyAlias}"`,
    );
  }

  return {
    provider: providerId,
    tier,
    familyAlias,
    apiId: model.apiId,
    legacy: false,
  };
}

export function resolveRoleRef(registry: ModelRegistry | null, ref: RoleRef): ResolvedModel {
  if (typeof ref === 'string') {
    return {
      provider: ref,
      familyAlias: ref,
      apiId: ref,
      legacy: true,
    };
  }

  if (!registry) {
    throw new Error(
      `registry: provider "${ref.provider}" tier "${ref.tier}" requires .vibe/model-registry.json`,
    );
  }

  return resolveModel(registry, ref.provider, ref.tier);
}

export function resolveFromConfig(
  sprintRoles: Record<string, RoleRef>,
  roleName: string,
  registry: ModelRegistry | null,
): ResolvedModel {
  const ref = sprintRoles[roleName];
  if (!ref) {
    const available = Object.keys(sprintRoles).sort();
    throw new Error(`unknown role "${roleName}" (available: ${formatAvailable(available)})`);
  }

  return resolveRoleRef(registry, ref);
}
