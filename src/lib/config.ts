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

export interface DashboardConfig {
  enabled: boolean;
  port: number;
  host: '127.0.0.1' | 'localhost';
  autoStart: boolean;
  notificationLevel: 'urgent' | 'all';
  retentionDays: number;
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
  bundle?: BundleConfig;
  browserSmoke?: BrowserSmokeConfig;
  dashboard?: DashboardConfig;
}

type VibeConfigOverride = Omit<
  Partial<VibeConfig>,
  'sprintRoles' | 'sprint' | 'providers' | 'qa' | 'bundle' | 'browserSmoke' | 'dashboard'
> & {
  sprintRoles?: Partial<SprintRoles>;
  sprint?: Partial<SprintConfig>;
  providers?: Record<string, ProviderRunner>;
  qa?: Partial<NonNullable<VibeConfig['qa']>>;
  bundle?: Partial<BundleConfig>;
  browserSmoke?: Partial<BrowserSmokeConfig>;
  dashboard?: Partial<DashboardConfig>;
};

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

function mergeConfig(base: VibeConfig, override: VibeConfigOverride): VibeConfig {
  const {
    sprintRoles,
    sprint,
    providers,
    qa,
    bundle: bundleOverride,
    browserSmoke: browserSmokeOverride,
    dashboard: dashboardOverride,
    ...topLevelOverride
  } = override;
  const merged: VibeConfig = {
    ...base,
    ...topLevelOverride,
    sprintRoles: {
      ...base.sprintRoles,
      ...(sprintRoles ?? {}),
    },
    sprint: {
      ...base.sprint,
      ...(sprint ?? {}),
    },
    providers: {
      ...base.providers,
      ...(providers ?? {}),
    },
    qa: {
      ...(base.qa ?? {}),
      ...(qa ?? {}),
    },
  };

  const bundle = mergeOptionalObject(base.bundle, bundleOverride);
  if (bundle) {
    merged.bundle = bundle;
  }

  const browserSmoke = mergeOptionalObject(base.browserSmoke, browserSmokeOverride);
  if (browserSmoke) {
    merged.browserSmoke = browserSmoke;
  }

  const dashboard = mergeOptionalObject(base.dashboard, dashboardOverride);
  if (dashboard) {
    merged.dashboard = dashboard;
  }

  return merged;
}

export async function loadConfig(): Promise<VibeConfig> {
  const shared = await readJson<VibeConfig>(paths.sharedConfig);

  try {
    const local = await readJson<VibeConfigOverride>(paths.localConfig);
    return mergeConfig(shared, local);
  } catch {
    return shared;
  }
}

export { mergeConfig };
