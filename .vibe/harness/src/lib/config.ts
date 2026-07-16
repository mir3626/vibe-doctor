import { readJson } from './fs.js';
import { paths } from './paths.js';

/** Limits shared by the publishLimits configuration, tool contract, and store. */
export interface PublishLimits {
  maxFiles: number;
  maxTotalBytes: number;
  maxFileBytes: number;
}

export const DEFAULT_PUBLISH_LIMITS: PublishLimits = {
  maxFiles: 32,
  maxTotalBytes: 131_072,
  maxFileBytes: 49_152,
};

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
  policy?: 'automatic' | 'custom' | 'off';
  dir: string;
  path?: string;
  limitGzipKB: number;
  excludeExt: string[];
  rationale?: string;
  replacementEvidence?: string;
  resolvedBy?: 'user' | 'agent';
  resolvedAt?: string;
}

export interface BrowserSmokeConfig {
  enabled: boolean;
  configPath: string;
  dist?: string;
}

export interface AuditConfig {
  everyN?: number;
  projectRoots?: string[];
  prototypeLocThreshold?: number;
}

export interface ProBridgeMcpConfig {
  port: number;
  tunnel: string;
  authMode: string;
  oauthTokens: Record<string, readonly string[]> | null;
  persistentCode: string | null;
  tunnelUrl: string | null;
  publishLimits: PublishLimits;
}

export interface ProBridgeWorkspaceAgentConfig {
  enabled: boolean;
  triggerCommand: string[];
}

export interface ProBridgeApiConfig {
  enabled: boolean;
  model: string;
  effort: string;
  maxInputTokens: number;
  priceInputPerMTok: number;
  priceOutputPerMTok: number;
  pollIntervalMs: number;
}

export interface ProBridgeApplyConfig {
  envId: string | null;
}

export interface ProBridgeRangeDiffBudget {
  maxBytes: number;
}

export interface ProBridgeConfig {
  enabled: boolean;
  transport: string;
  resultRoot: string;
  requestTtlHours: number;
  maxPatchBytes: number;
  rangeDiffBudget: ProBridgeRangeDiffBudget;
  openBrowser: boolean;
  copyInvocation: boolean;
  githubRequired: boolean;
  mcp: ProBridgeMcpConfig;
  workspaceAgent: ProBridgeWorkspaceAgentConfig;
  api: ProBridgeApiConfig;
  apply: ProBridgeApplyConfig;
}

export type ProBridgeConfigInput = Partial<
  Omit<ProBridgeConfig, 'mcp' | 'workspaceAgent' | 'api' | 'apply' | 'rangeDiffBudget'>
> & {
  mcp?: Partial<Omit<ProBridgeMcpConfig, 'publishLimits'>> & {
    publishLimits?: Partial<PublishLimits>;
  };
  workspaceAgent?: Partial<ProBridgeWorkspaceAgentConfig>;
  api?: Partial<ProBridgeApiConfig>;
  apply?: Partial<ProBridgeApplyConfig>;
  rangeDiffBudget?: Partial<ProBridgeRangeDiffBudget>;
};

export const DEFAULT_PRO_BRIDGE_MCP_CONFIG: ProBridgeMcpConfig = {
  port: 18488,
  tunnel: 'none',
  authMode: 'noauth-local',
  oauthTokens: null,
  persistentCode: null,
  tunnelUrl: null,
  publishLimits: DEFAULT_PUBLISH_LIMITS,
};

export const DEFAULT_PRO_BRIDGE_WORKSPACE_AGENT_CONFIG: ProBridgeWorkspaceAgentConfig = {
  enabled: false,
  triggerCommand: [],
};

export const DEFAULT_PRO_BRIDGE_API_CONFIG: ProBridgeApiConfig = {
  enabled: false,
  model: '',
  effort: 'high',
  maxInputTokens: 200_000,
  priceInputPerMTok: 0,
  priceOutputPerMTok: 0,
  pollIntervalMs: 5_000,
};

export const DEFAULT_PRO_BRIDGE_APPLY_CONFIG: ProBridgeApplyConfig = {
  envId: null,
};

export const DEFAULT_PRO_BRIDGE_RANGE_DIFF_BUDGET: ProBridgeRangeDiffBudget = {
  maxBytes: 2 * 1024 * 1024,
};

export const DEFAULT_PRO_BRIDGE_CONFIG: ProBridgeConfig = {
  enabled: false,
  transport: 'manual',
  resultRoot: 'docs/plans',
  requestTtlHours: 72,
  maxPatchBytes: 1_048_576,
  rangeDiffBudget: DEFAULT_PRO_BRIDGE_RANGE_DIFF_BUDGET,
  openBrowser: true,
  copyInvocation: true,
  githubRequired: true,
  mcp: DEFAULT_PRO_BRIDGE_MCP_CONFIG,
  workspaceAgent: DEFAULT_PRO_BRIDGE_WORKSPACE_AGENT_CONFIG,
  api: DEFAULT_PRO_BRIDGE_API_CONFIG,
  apply: DEFAULT_PRO_BRIDGE_APPLY_CONFIG,
};

function resolveProBridgeMcpConfigBase(
  base: ProBridgeConfigInput['mcp'],
  override: ProBridgeConfigInput['mcp'],
): ProBridgeMcpConfig {
  const resolved = {
    port: override?.port ?? base?.port ?? DEFAULT_PRO_BRIDGE_MCP_CONFIG.port,
    tunnel: override?.tunnel ?? base?.tunnel ?? DEFAULT_PRO_BRIDGE_MCP_CONFIG.tunnel,
  } as ProBridgeMcpConfig;
  const publishLimits: PublishLimits = {
    maxFiles:
      override?.publishLimits?.maxFiles
      ?? base?.publishLimits?.maxFiles
      ?? DEFAULT_PRO_BRIDGE_MCP_CONFIG.publishLimits.maxFiles,
    maxTotalBytes:
      override?.publishLimits?.maxTotalBytes
      ?? base?.publishLimits?.maxTotalBytes
      ?? DEFAULT_PRO_BRIDGE_MCP_CONFIG.publishLimits.maxTotalBytes,
    maxFileBytes:
      override?.publishLimits?.maxFileBytes
      ?? base?.publishLimits?.maxFileBytes
      ?? DEFAULT_PRO_BRIDGE_MCP_CONFIG.publishLimits.maxFileBytes,
  };
  return {
    ...resolved,
    publishLimits,
  };
}

function resolveProBridgeMcpConfig(
  base: ProBridgeConfigInput['mcp'],
  override: ProBridgeConfigInput['mcp'],
): ProBridgeMcpConfig {
  const resolved = resolveProBridgeMcpConfigBase(base, override);
  return {
    ...resolved,
    publishLimits: resolved.publishLimits,
    authMode:
      override?.authMode ?? base?.authMode ?? DEFAULT_PRO_BRIDGE_MCP_CONFIG.authMode,
    oauthTokens:
      override?.oauthTokens ?? base?.oauthTokens ?? DEFAULT_PRO_BRIDGE_MCP_CONFIG.oauthTokens,
    persistentCode:
      override?.persistentCode
      ?? base?.persistentCode
      ?? DEFAULT_PRO_BRIDGE_MCP_CONFIG.persistentCode,
    tunnelUrl:
      override?.tunnelUrl ?? base?.tunnelUrl ?? DEFAULT_PRO_BRIDGE_MCP_CONFIG.tunnelUrl,
  };
}

export function resolveProBridgeConfig(
  base?: ProBridgeConfigInput,
  override?: ProBridgeConfigInput,
): ProBridgeConfig {
  return {
    enabled: override?.enabled ?? base?.enabled ?? DEFAULT_PRO_BRIDGE_CONFIG.enabled,
    transport: override?.transport ?? base?.transport ?? DEFAULT_PRO_BRIDGE_CONFIG.transport,
    resultRoot: override?.resultRoot ?? base?.resultRoot ?? DEFAULT_PRO_BRIDGE_CONFIG.resultRoot,
    requestTtlHours:
      override?.requestTtlHours
      ?? base?.requestTtlHours
      ?? DEFAULT_PRO_BRIDGE_CONFIG.requestTtlHours,
    maxPatchBytes:
      override?.maxPatchBytes ?? base?.maxPatchBytes ?? DEFAULT_PRO_BRIDGE_CONFIG.maxPatchBytes,
    rangeDiffBudget: {
      maxBytes:
        override?.rangeDiffBudget?.maxBytes
        ?? base?.rangeDiffBudget?.maxBytes
        ?? DEFAULT_PRO_BRIDGE_RANGE_DIFF_BUDGET.maxBytes,
    },
    openBrowser:
      override?.openBrowser ?? base?.openBrowser ?? DEFAULT_PRO_BRIDGE_CONFIG.openBrowser,
    copyInvocation:
      override?.copyInvocation
      ?? base?.copyInvocation
      ?? DEFAULT_PRO_BRIDGE_CONFIG.copyInvocation,
    // Phase 1 always uses scope-resolver as the GitHub visibility authority.
    githubRequired:
      override?.githubRequired
      ?? base?.githubRequired
      ?? DEFAULT_PRO_BRIDGE_CONFIG.githubRequired,
    mcp: resolveProBridgeMcpConfig(base?.mcp, override?.mcp),
    workspaceAgent: {
      enabled:
        override?.workspaceAgent?.enabled
        ?? base?.workspaceAgent?.enabled
        ?? DEFAULT_PRO_BRIDGE_WORKSPACE_AGENT_CONFIG.enabled,
      triggerCommand:
        override?.workspaceAgent?.triggerCommand
        ?? base?.workspaceAgent?.triggerCommand
        ?? DEFAULT_PRO_BRIDGE_WORKSPACE_AGENT_CONFIG.triggerCommand,
    },
    api: {
      enabled:
        override?.api?.enabled ?? base?.api?.enabled ?? DEFAULT_PRO_BRIDGE_API_CONFIG.enabled,
      model: override?.api?.model ?? base?.api?.model ?? DEFAULT_PRO_BRIDGE_API_CONFIG.model,
      effort: override?.api?.effort ?? base?.api?.effort ?? DEFAULT_PRO_BRIDGE_API_CONFIG.effort,
      maxInputTokens:
        override?.api?.maxInputTokens
        ?? base?.api?.maxInputTokens
        ?? DEFAULT_PRO_BRIDGE_API_CONFIG.maxInputTokens,
      priceInputPerMTok:
        override?.api?.priceInputPerMTok
        ?? base?.api?.priceInputPerMTok
        ?? DEFAULT_PRO_BRIDGE_API_CONFIG.priceInputPerMTok,
      priceOutputPerMTok:
        override?.api?.priceOutputPerMTok
        ?? base?.api?.priceOutputPerMTok
        ?? DEFAULT_PRO_BRIDGE_API_CONFIG.priceOutputPerMTok,
      pollIntervalMs:
        override?.api?.pollIntervalMs
        ?? base?.api?.pollIntervalMs
        ?? DEFAULT_PRO_BRIDGE_API_CONFIG.pollIntervalMs,
    },
    apply: {
      envId:
        override?.apply?.envId ?? base?.apply?.envId ?? DEFAULT_PRO_BRIDGE_APPLY_CONFIG.envId,
    },
  };
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
    self?: boolean;
  };
  sprintRoles: SprintRoles;
  sprint: SprintConfig;
  providers: Record<string, ProviderRunner>;
  qa?: {
    preferScripts?: string[];
  };
  bundle?: BundleConfig;
  browserSmoke?: BrowserSmokeConfig;
  audit?: AuditConfig;
  proBridge?: ProBridgeConfig;
}

export type VibeConfigOverride = Partial<
  Omit<
    VibeConfig,
    'sprintRoles' | 'sprint' | 'providers' | 'qa' | 'bundle' | 'browserSmoke' | 'audit' | 'proBridge'
  >
> & {
  sprintRoles?: Partial<SprintRoles>;
  sprint?: Partial<SprintConfig>;
  providers?: Record<string, ProviderRunner>;
  qa?: Partial<NonNullable<VibeConfig['qa']>>;
  bundle?: Partial<BundleConfig>;
  browserSmoke?: Partial<BrowserSmokeConfig>;
  audit?: Partial<AuditConfig>;
  proBridge?: ProBridgeConfigInput;
};

function resolveBundleConfig(
  base: Partial<BundleConfig> | undefined,
  override: Partial<BundleConfig> | undefined,
): BundleConfig {
  const dir = override?.dir ?? base?.dir ?? 'dist';
  const resolved: BundleConfig = {
    enabled: override?.enabled ?? base?.enabled ?? false,
    dir,
    path: override?.path ?? base?.path ?? dir,
    limitGzipKB: override?.limitGzipKB ?? base?.limitGzipKB ?? 80,
    excludeExt: override?.excludeExt ?? base?.excludeExt ?? ['.map'],
  };
  const policy = override?.policy ?? base?.policy;
  const rationale = override?.rationale ?? base?.rationale;
  const replacementEvidence = override?.replacementEvidence ?? base?.replacementEvidence;
  const resolvedBy = override?.resolvedBy ?? base?.resolvedBy;
  const resolvedAt = override?.resolvedAt ?? base?.resolvedAt;
  if (policy !== undefined) {
    resolved.policy = policy;
  }
  if (rationale !== undefined) {
    resolved.rationale = rationale;
  }
  if (replacementEvidence !== undefined) {
    resolved.replacementEvidence = replacementEvidence;
  }
  if (resolvedBy !== undefined) {
    resolved.resolvedBy = resolvedBy;
  }
  if (resolvedAt !== undefined) {
    resolved.resolvedAt = resolvedAt;
  }
  return resolved;
}

function resolveBrowserSmokeConfig(
  base: Partial<BrowserSmokeConfig> | undefined,
  override: Partial<BrowserSmokeConfig> | undefined,
): BrowserSmokeConfig {
  return {
    enabled: override?.enabled ?? base?.enabled ?? false,
    configPath: override?.configPath ?? base?.configPath ?? '.vibe/smoke.config.js',
    dist: override?.dist ?? base?.dist ?? 'dist',
  };
}

function mergeConfig(base: VibeConfig, override: VibeConfigOverride): VibeConfig {
  const {
    sprintRoles,
    sprint,
    providers,
    qa,
    bundle,
    browserSmoke,
    audit,
    proBridge,
    ...overrideRest
  } = override;
  const merged: VibeConfig = {
    ...base,
    ...overrideRest,
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

  if (base.bundle || bundle) {
    merged.bundle = resolveBundleConfig(base.bundle, bundle);
  }

  if (base.browserSmoke || browserSmoke) {
    merged.browserSmoke = resolveBrowserSmokeConfig(base.browserSmoke, browserSmoke);
  }

  if (base.audit || audit) {
    merged.audit = {
      ...(base.audit ?? {}),
      ...(audit ?? {}),
    };
  }

  if (base.proBridge || proBridge) {
    merged.proBridge = resolveProBridgeConfig(base.proBridge, proBridge);
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
