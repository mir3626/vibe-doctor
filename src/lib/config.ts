import { readJson } from './fs.js';
import { paths } from './paths.js';

export interface ProviderRunner {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface VibeConfig {
  defaultCoder: string;
  challenger: string;
  reviewer: string;
  providers: Record<string, ProviderRunner>;
  qa?: {
    preferScripts?: string[];
  };
}

function mergeConfig(base: VibeConfig, override: Partial<VibeConfig>): VibeConfig {
  return {
    ...base,
    ...override,
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
