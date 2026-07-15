import { IterationHistorySchema } from '../../lib/schemas/iteration-history.js';
import { SprintStatusSchema } from '../../lib/schemas/sprint-status.js';
import {
  GIT_SHA_PATTERN,
  buildGitBackedManifest,
  extractReferencedPaths,
  listRepoFiles,
  readGitCommits,
  readRepoText,
  resolveHeadSha,
  uniqueSorted,
  type GoalSourceContext,
  type GoalSourceProvider,
  type ProviderOutcome,
} from './types.js';

interface RoadmapSprint {
  id: string;
  goal: string;
}

interface RoadmapIteration {
  number: number;
  label: string;
  text: string;
  sprints: RoadmapSprint[];
}

function parseRoadmap(text: string): RoadmapIteration[] {
  const headings = [...text.matchAll(/^## Iteration (\d+) — (.+)$/gm)];
  return headings.map((heading, index) => {
    const start = heading.index ?? 0;
    const end = headings[index + 1]?.index ?? text.length;
    const section = text.slice(start, end);
    const sprintMatches = [...section.matchAll(/^- \*\*id\*\*: `([^`]+)`$/gm)];
    const sprints = sprintMatches.map((match, sprintIndex) => {
      const sprintStart = match.index ?? 0;
      const sprintEnd = sprintMatches[sprintIndex + 1]?.index ?? section.length;
      const sprintText = section.slice(sprintStart, sprintEnd);
      return {
        id: match[1]!,
        goal: /^\s+- \*\*목표\*\*: (.+)$/m.exec(sprintText)?.[1]?.trim() ?? '',
      };
    });
    return {
      number: Number(heading[1]),
      label: heading[2]!.trim(),
      text: section,
      sprints,
    };
  });
}

function parseDecisionAnchors(text: string | null, searchTerms: string[]): Date[] {
  if (text === null) {
    return [];
  }
  return text
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = /^- (\d{4}-\d{2}-\d{2}T\S+) \[[^\]]+\](?:\[[^\]]+\])* (.+)$/.exec(line);
      if (!match || !searchTerms.some((term) => match[2]!.includes(term))) {
        return [];
      }
      const date = new Date(match[1]!);
      return Number.isNaN(date.getTime()) ? [] : [date];
    });
}

async function promptReferences(ctx: GoalSourceContext, sprintIds: string[]): Promise<string[]> {
  const candidates = [
    ...(await listRepoFiles(ctx, '.vibe/archive/prompts')),
    ...(await listRepoFiles(ctx, 'docs/prompts')),
  ];
  return candidates.filter((filePath) => {
    const fileName = filePath.split('/').at(-1) ?? '';
    return sprintIds.some(
      (sprintId) => fileName.startsWith(`${sprintId}-`) || fileName.startsWith(`sprint-${sprintId}-`),
    );
  });
}

export class VibeGoalIterateProvider implements GoalSourceProvider {
  readonly kind = 'vibe-goal-iterate' as const;

  async discover(ctx: GoalSourceContext): Promise<ProviderOutcome> {
    const [roadmapText, statusText, historyText, sessionText, archivePaths] = await Promise.all([
      readRepoText(ctx, 'docs/plans/sprint-roadmap.md'),
      readRepoText(ctx, '.vibe/agent/sprint-status.json'),
      readRepoText(ctx, '.vibe/agent/iteration-history.json'),
      readRepoText(ctx, '.vibe/agent/session-log.md'),
      listRepoFiles(ctx, 'docs/plans/archive/roadmaps'),
    ]);
    if (roadmapText === null) {
      return { status: 'no-goal', reason: 'sprint-roadmap-missing' };
    }

    const archivedRoadmaps = await Promise.all(
      archivePaths
        .filter((filePath) => filePath.endsWith('.md'))
        .map((filePath) => readRepoText(ctx, filePath)),
    );
    const combinedRoadmap = [...archivedRoadmaps.filter((text): text is string => text !== null), roadmapText].join(
      '\n\n',
    );
    const status = statusText === null ? null : SprintStatusSchema.safeParse(JSON.parse(statusText));
    const history = historyText === null ? null : IterationHistorySchema.safeParse(JSON.parse(historyText));
    const statusSprints = status?.success ? status.data.sprints : [];
    const historyIterations = history?.success ? history.data.iterations : [];
    const iterations = parseRoadmap(combinedRoadmap);
    const selected = [...iterations]
      .sort((left, right) => right.number - left.number)
      .find((iteration) => {
        const ids = new Set(iteration.sprints.map((sprint) => sprint.id));
        return (
          statusSprints.some((sprint) => ids.has(sprint.id)) ||
          historyIterations.some((entry) => entry.plannedSprints.some((sprintId) => ids.has(sprintId)))
        );
      });
    if (!selected || selected.sprints.length === 0) {
      return { status: 'no-goal', reason: 'no-coherent-vibe-iteration' };
    }

    const headSha = await resolveHeadSha(ctx);
    if (headSha === null) {
      return { status: 'unavailable', reason: 'git-head-unavailable' };
    }

    const sprintIds = selected.sprints.map((sprint) => sprint.id);
    const selectedHistory = historyIterations.find(
      (entry) =>
        entry.label === selected.label || entry.plannedSprints.some((sprintId) => sprintIds.includes(sprintId)),
    );
    const selectedStatus = statusSprints.find((sprint) => sprintIds.includes(sprint.id));
    const searchTerms = [selected.label, ...sprintIds];
    const anchors = parseDecisionAnchors(sessionText, searchTerms);
    const commits = await readGitCommits(ctx, 100);
    let related = commits.filter((commit) => {
      const message = `${commit.subject}\n${commit.body}`;
      return searchTerms.some((term) => message.includes(term));
    });
    if (related.length === 0 && anchors.length > 0) {
      const earliest = Math.min(...anchors.map((anchor) => anchor.getTime()));
      related = commits.filter((commit) => {
        const committedAt = new Date(commit.committedAt).getTime();
        return Number.isFinite(committedAt) && committedAt >= earliest;
      });
    }

    const chronological = [...related].reverse();
    const oldest = chronological[0];
    const baseSha = oldest?.parents[0] && GIT_SHA_PATTERN.test(oldest.parents[0]) ? oldest.parents[0] : headSha;
    const unresolved = related.length === 0 ? ['no-commits-correlated'] : [];
    const fallbackGoal = selected.sprints
      .map((sprint) => `${sprint.id}: ${sprint.goal}`)
      .filter((line) => !line.endsWith(': '))
      .join('\n');
    const goalText = selectedHistory?.goal.trim() || fallbackGoal || selected.label;

    const manifest = await buildGitBackedManifest(ctx, {
      source: {
        kind: this.kind,
        confidence: 'high',
        threadId: null,
        iterationId: selectedHistory?.id ?? null,
        goalText,
        goalStatus: selectedStatus?.status ?? null,
      },
      baseSha,
      headSha,
      commitShas: chronological.map((commit) => commit.sha),
      designRefs: extractReferencedPaths(selected.text, 'docs/'),
      implementationRefs: await promptReferences(ctx, sprintIds),
      unresolved,
    });
    return { status: 'candidate', manifest };
  }
}
