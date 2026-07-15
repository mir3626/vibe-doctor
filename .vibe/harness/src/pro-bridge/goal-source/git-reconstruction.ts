import {
  GIT_SHA_PATTERN,
  buildGitBackedManifest,
  extractReferencedPaths,
  readGitCommits,
  uniqueSorted,
  type GitCommit,
  type GoalSourceContext,
  type GoalSourceProvider,
  type ProviderOutcome,
} from './types.js';

const IMPLEMENTATION_SUBJECT = /^(?:feat|fix|refactor|perf|test|build)(?:\([^)]*\))?:/i;
const NON_IMPLEMENTATION_SUBJECT = /^(?:docs|chore|style|release|merge)(?:\([^)]*\))?:/i;
const MAX_CLUSTER_GAP_MS = 72 * 60 * 60 * 1000;

function isImplementationCommit(commit: GitCommit): boolean {
  return IMPLEMENTATION_SUBJECT.test(commit.subject) || !NON_IMPLEMENTATION_SUBJECT.test(commit.subject);
}

function recentImplementationCluster(commits: GitCommit[]): {
  cluster: GitCommit[];
  skippedRecent: boolean;
  stoppedAtGap: boolean;
} {
  const cluster: GitCommit[] = [];
  let skippedRecent = false;
  let stoppedAtGap = false;
  let newestAcceptedTime: number | null = null;

  for (const commit of commits) {
    if (!isImplementationCommit(commit)) {
      if (cluster.length === 0) {
        skippedRecent = true;
        continue;
      }
      break;
    }
    const committedAt = new Date(commit.committedAt).getTime();
    if (
      newestAcceptedTime !== null &&
      Number.isFinite(committedAt) &&
      newestAcceptedTime - committedAt > MAX_CLUSTER_GAP_MS
    ) {
      stoppedAtGap = true;
      break;
    }
    if (Number.isFinite(committedAt)) {
      newestAcceptedTime = newestAcceptedTime ?? committedAt;
    }
    cluster.push(commit);
  }
  return { cluster, skippedRecent, stoppedAtGap };
}

export class GitReconstructionProvider implements GoalSourceProvider {
  readonly kind = 'git-reconstruction' as const;

  async discover(ctx: GoalSourceContext): Promise<ProviderOutcome> {
    const commits = await readGitCommits(ctx, 50);
    if (commits.length === 0) {
      return { status: 'no-goal', reason: 'git-history-empty' };
    }
    const { cluster, skippedRecent, stoppedAtGap } = recentImplementationCluster(commits);
    if (cluster.length === 0) {
      return { status: 'no-goal', reason: 'no-recent-implementation-cluster' };
    }

    const chronological = [...cluster].reverse();
    const oldest = chronological[0]!;
    const newest = cluster[0]!;
    const baseSha = oldest.parents[0] && GIT_SHA_PATTERN.test(oldest.parents[0]) ? oldest.parents[0] : oldest.sha;
    const unresolved = ['reconstructed-from-git-history'];
    if (skippedRecent) {
      unresolved.push('unrelated-recent-commits-excluded');
    }
    if (stoppedAtGap) {
      unresolved.push('commit-time-boundary');
    }
    const commitNarrative = chronological.map((commit) => commit.subject).join('; ');
    const referencedDocs = uniqueSorted(
      cluster.flatMap((commit) => extractReferencedPaths(`${commit.subject}\n${commit.body}`, 'docs/')),
    );

    const manifest = await buildGitBackedManifest(ctx, {
      source: {
        kind: this.kind,
        confidence: 'reconstructed',
        threadId: null,
        iterationId: null,
        goalText: commitNarrative,
        goalStatus: null,
      },
      baseSha,
      headSha: newest.sha,
      commitShas: chronological.map((commit) => commit.sha),
      designRefs: referencedDocs,
      implementationRefs: [],
      unresolved,
    });
    manifest.designRefs = uniqueSorted([
      ...manifest.designRefs,
      ...manifest.scope.docsFiles.filter((filePath) => filePath.startsWith('docs/plans/')),
    ]);
    return { status: 'candidate', manifest };
  }
}
