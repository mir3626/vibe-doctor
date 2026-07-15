import { GoalSourceManifestSchema, type GoalSourceKind, type GoalSourceManifest } from '../../lib/schemas/pro-bridge.js';
import { computePayloadSha256 } from '../contract.js';
import { CodexAppServerGoalProvider } from './codex-app-server.js';
import { GitReconstructionProvider } from './git-reconstruction.js';
import { HandoffHistoryProvider } from './handoff.js';
import type { GoalSourceContext, GoalSourceProvider } from './types.js';
import { VibeGoalIterateProvider } from './vibe-goal-iterate.js';

export interface GoalSourceDiagnostic {
  provider: GoalSourceKind;
  status: 'candidate' | 'no-goal' | 'unavailable' | 'error';
  reason?: string;
}

export interface GoalSourceResolution {
  selected: GoalSourceManifest | null;
  candidates: GoalSourceManifest[];
  diagnostics: GoalSourceDiagnostic[];
}

function defaultProviders(): GoalSourceProvider[] {
  return [
    new CodexAppServerGoalProvider(),
    new VibeGoalIterateProvider(),
    new HandoffHistoryProvider(),
    new GitReconstructionProvider(),
  ];
}

function validatedManifest(manifest: GoalSourceManifest): GoalSourceManifest {
  const withHash = {
    ...manifest,
    payloadSha256: computePayloadSha256(manifest),
  };
  return GoalSourceManifestSchema.parse(withHash);
}

export async function resolveGoalSource(
  ctx: GoalSourceContext,
  opts: { providers?: GoalSourceProvider[]; collectAll?: boolean } = {},
): Promise<GoalSourceResolution> {
  const candidates: GoalSourceManifest[] = [];
  const diagnostics: GoalSourceDiagnostic[] = [];

  for (const provider of opts.providers ?? defaultProviders()) {
    try {
      const outcome = await provider.discover(ctx);
      if (outcome.status === 'candidate') {
        const manifest = validatedManifest(outcome.manifest);
        candidates.push(manifest);
        diagnostics.push({ provider: provider.kind, status: 'candidate' });
        if (!opts.collectAll) {
          break;
        }
      } else {
        diagnostics.push({ provider: provider.kind, status: outcome.status, reason: outcome.reason });
      }
    } catch (error) {
      diagnostics.push({
        provider: provider.kind,
        status: 'error',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { selected: candidates[0] ?? null, candidates, diagnostics };
}
