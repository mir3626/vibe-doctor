import {
  GIT_SHA_PATTERN,
  buildGitBackedManifest,
  extractReferencedPaths,
  readGitCommits,
  readRepoText,
  resolveHeadSha,
  type GoalSourceContext,
  type GoalSourceProvider,
  type ProviderOutcome,
} from './types.js';

function markdownSection(text: string, title: string): string {
  const headings = [...text.matchAll(/^##\s+(?:\d+\.\s*)?(.+)$/gm)];
  const index = headings.findIndex((heading) => heading[1]!.trim().toLowerCase() === title.toLowerCase());
  if (index < 0) {
    return '';
  }
  const start = (headings[index]!.index ?? 0) + headings[index]![0].length;
  const end = headings[index + 1]?.index ?? text.length;
  return text.slice(start, end).trim();
}

function recentNarrativeEntries(text: string | null): string[] {
  if (text === null) {
    return [];
  }
  return text
    .split(/\r?\n/)
    .filter((line) => /^- \S+ \[(?:checkpoint|decision)\]/.test(line))
    .slice(0, 5)
    .map((line) => line.replace(/^- \S+ (?:\[[^\]]+\])+\s*/, '').trim())
    .filter((line) => line.length > 0);
}

function meaningful(text: string): boolean {
  return (
    text.length > 0 &&
    !/PROJECT NOT INITIALIZED|template placeholder|new downstream project/i.test(text)
  );
}

export class HandoffHistoryProvider implements GoalSourceProvider {
  readonly kind = 'handoff-reconstruction' as const;

  async discover(ctx: GoalSourceContext): Promise<ProviderOutcome> {
    const [handoffText, sessionText] = await Promise.all([
      readRepoText(ctx, '.vibe/agent/handoff.md'),
      readRepoText(ctx, '.vibe/agent/session-log.md'),
    ]);
    if (handoffText === null) {
      return { status: 'no-goal', reason: 'handoff-missing' };
    }

    const status = markdownSection(handoffText, 'Status');
    const nextAction = markdownSection(handoffText, 'Next Action');
    const entries = recentNarrativeEntries(sessionText);
    const narrative = [nextAction, status, ...entries].filter(meaningful);
    if (narrative.length === 0) {
      return { status: 'no-goal', reason: 'handoff-has-no-project-goal' };
    }

    const headSha = await resolveHeadSha(ctx);
    if (headSha === null) {
      return { status: 'unavailable', reason: 'git-head-unavailable' };
    }
    const commits = await readGitCommits(ctx, 20);
    const chronological = [...commits.slice(0, 10)].reverse();
    const oldest = chronological[0];
    const baseSha = oldest?.parents[0] && GIT_SHA_PATTERN.test(oldest.parents[0]) ? oldest.parents[0] : headSha;
    const combined = narrative.join('\n\n');
    const manifest = await buildGitBackedManifest(ctx, {
      source: {
        kind: this.kind,
        confidence: 'reconstructed',
        threadId: null,
        iterationId: null,
        goalText: combined.slice(0, 12_000),
        goalStatus: null,
      },
      baseSha,
      headSha,
      commitShas: chronological.map((commit) => commit.sha),
      designRefs: extractReferencedPaths(combined, 'docs/'),
      implementationRefs: extractReferencedPaths(combined).filter(
        (filePath) => filePath.startsWith('.vibe/') || filePath.startsWith('src/'),
      ),
      unresolved: ['reconstructed-from-handoff', 'goal-boundaries-ambiguous'],
    });
    return { status: 'candidate', manifest };
  }
}
