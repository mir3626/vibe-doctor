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

export interface VibeConfig {
  orchestrator: string;
  harnessVersion?: string;
  harnessVersionInstalled?: string;
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
}

function mergeConfig(base: VibeConfig, override: Partial<VibeConfig>): VibeConfig {
  return {
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
