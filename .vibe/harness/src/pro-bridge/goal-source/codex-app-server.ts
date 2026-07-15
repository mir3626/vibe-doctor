import type { GoalSourceContext, GoalSourceProvider, ProviderOutcome } from './types.js';

export class CodexAppServerGoalProvider implements GoalSourceProvider {
  readonly kind = 'codex-goal' as const;

  async discover(_ctx: GoalSourceContext): Promise<ProviderOutcome> {
    // Availability decision (2026-07): Codex CLI v0.144.3 was observed, but the
    // `codex app-server` JSON-RPC surface was not verified. The provider therefore
    // remains formally unavailable with the stable reason below. It must not inspect
    // private model reasoning; only explicit goal metadata, user messages, tool results,
    // and committed artifacts may be used after the documented handshake is verified.
    // See docs/context/pro-bridge-setup.md. Adapter implementation is a separate Sprint.
    return { status: 'unavailable', reason: 'codex-app-server-api-unverified' };
  }
}
