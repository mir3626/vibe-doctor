import { readJson } from './fs.js';
import { paths } from './paths.js';

export interface ProviderRunner {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export type SprintRoleDefinition =
  | string
  | {
      provider: string;
      tier: 'flagship' | 'performant' | 'efficient';
    };

export interface SprintRoles {
  planner: SprintRoleDefinition;
  generator: SprintRoleDefinition;
  evaluator: SprintRoleDefinition;
}

export interface SprintConfig {
  unit: string;
  subAgentPerRole: boolean;
  freshContextPerSprint: boolean;
}

export interface BundleConfig {
  enabled: boolean;
  dir: string;
  limitGzipKB: number;
  excludeExt: string[];
}

export interface BrowserSmokeConfig {
  enabled: boolean;
  configPath: string;
}

export interface VibeConfig {
  orchestrator: string;
  harnessVersion?: string;
  harnessVersionInstalled?: string;
  mode?: 'human' | 'agent';
  upstream?: {
    type: 'git' | 'local';
    url: string;
    ref?: string;
  };
  sprintRoles: SprintRoles;
  sprint: SprintConfig;
  providers: Record<string, ProviderRunner>;
  qa?: {
    preferScripts?: string[];
  };
  bundle?: BundleConfig;
  browserSmoke?: BrowserSmokeConfig;
}

function mergeOptionalObject<T extends object>(
  base?: T,
  override?: Partial<T>,
): T | undefined {
  if (!base && !override) {
    return undefined;
  }

  return {
    ...(base ?? {}),
    ...(override ?? {}),
  } as T;
}

function mergeConfig(base: VibeConfig, override: Partial<VibeConfig>): VibeConfig {
  const merged: VibeConfig = {
    ...base,
    ...override,
    sprintRoles: {
      ...base.sprintRoles,
      ...(override.sprintRoles ?? {}),
    },
    sprint: {
      ...base.sprint,
      ...(override.sprint ?? {}),
    },
    providers: {
      ...base.providers,
      ...(override.providers ?? {}),
    },
    qa: {
      ...(base.qa ?? {}),
      ...(override.qa ?? {}),
    },
  };

  const bundle = mergeOptionalObject(base.bundle, override.bundle);
  if (bundle) {
    merged.bundle = bundle;
  }

  const browserSmoke = mergeOptionalObject(base.browserSmoke, override.browserSmoke);
  if (browserSmoke) {
    merged.browserSmoke = browserSmoke;
  }

  return merged;
}

export async function loadConfig(): Promise<VibeConfig> {
  const shared = await readJson<VibeConfig>(paths.sharedConfig);

  try {
    const local = await readJson<Partial<VibeConfig>>(paths.localConfig);
    return mergeConfig(shared, local);
  } catch {
    return shared;
  }
}

export { mergeConfig };
