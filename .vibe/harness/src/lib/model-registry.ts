import path from 'node:path';
import { ZodError } from 'zod';
import { readJson } from './fs.js';
import { paths } from './paths.js';
import { ModelRegistrySchema } from './schemas/model-registry.js';

export type { ModelEntry, ModelRegistry, ProviderRegistryEntry } from './schemas/model-registry.js';
import type { ModelRegistry } from './schemas/model-registry.js';

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

import { resolveRoleRef } from './model-resolution.mjs';
export { resolveModel, resolveRoleRef } from './model-resolution.mjs';

function registryPath(root?: string): string {
  return path.join(root ?? paths.root, '.vibe', 'model-registry.json');
}

function formatAvailable(values: string[]): string {
  return values.length > 0 ? values.join(', ') : 'none';
}

export async function loadRegistry(root?: string): Promise<ModelRegistry> {
  const filePath = registryPath(root);
  const loaded = await readJson<unknown>(filePath);

  try {
    return ModelRegistrySchema.parse(loaded);
  } catch (error) {
    if (error instanceof ZodError) {
      const versionIssue = error.issues.find((issue) => issue.path.includes('schemaVersion'));
      if (versionIssue && typeof loaded === 'object' && loaded !== null && 'schemaVersion' in loaded) {
        const schemaVersion = (loaded as { schemaVersion: unknown }).schemaVersion;
        throw new Error(
          `registry schemaVersion ${String(schemaVersion)} is unsupported; run npm run vibe:sync to refresh the harness registry`,
        );
      }
    }
    throw error;
  }
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
