export interface HarnessProfile {
  profile: 'astra' | 'legacy'; requestedModel: string | null;
  effectiveModel: null; effectiveEffort: null; reason: string;
}
export interface ProfileRegistry { schemaVersion?: number; providers?: Record<string, { knownModels?: Record<string, { apiId: string; harnessProfile?: string }> }> }
export function resolveHarnessProfile(options?: { model?: string | undefined; provider?: string | undefined; override?: string | undefined; registry?: ProfileRegistry | undefined }): HarnessProfile;
export function runtimeHarnessProfile(env?: NodeJS.ProcessEnv, root?: string): HarnessProfile;
export function codexInvocationProfile(args: string[], env?: NodeJS.ProcessEnv, registry?: ProfileRegistry): HarnessProfile & { requestedEffort: string | null };
