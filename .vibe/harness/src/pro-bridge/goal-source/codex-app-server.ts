import type { GoalSourceContext, GoalSourceProvider, ProviderOutcome } from './types.js';

export class CodexAppServerGoalProvider implements GoalSourceProvider {
  readonly kind = 'codex-goal' as const;

  async discover(_ctx: GoalSourceContext): Promise<ProviderOutcome> {
    // TODO(vpb-app-server): list threads, filter by repository cwd/gitInfo, rank by goal time,
    // call thread/goal/get, and read turns only for the selected candidate.
    // Do not parse private model reasoning. Use only user messages, goal metadata, tool results,
    // and committed artifacts.
    return { status: 'unavailable', reason: 'codex-app-server-api-unverified' };
  }
}
