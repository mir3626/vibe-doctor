import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { getBooleanFlag, getStringFlag, parseArgs, type ParsedArgs } from '../lib/args.js';
import { runMain } from '../lib/cli.js';
import {
  ProRoundtripEventCompleteSchema,
  type ProRoundtripEventComplete,
  type ProRoundtripFlow,
} from '../lib/schemas/pro-roundtrip.js';
import {
  appendSessionLogDecision,
  disableAutoPublish,
  enableAutoPublish,
  readAutoPublishState,
  validateAutoPublishDays,
  validateAutoPublishReason,
} from '../pro-roundtrip/auto-publish.js';
import {
  alignmentBriefPathsFor,
  alignmentBriefSkeleton,
  alignmentBriefStatus,
  assertAlignmentBriefGate,
  collectScopeRulings,
  type AlignmentBriefContext,
} from '../pro-roundtrip/alignment-brief.js';
import {
  parseEventDirectory,
  parseFlowPath,
  validateCoordinatedCloseDeclaration,
  validateReviewAcceptance,
} from '../pro-roundtrip/contract.js';
import {
  allocateFlowPath,
  listFlowPaths,
  loadFlowSnapshot,
  resolveFlowPath,
  slugifyGoal,
  validateSlug,
} from '../pro-roundtrip/flow-store.js';
import { publishAdditions } from '../pro-roundtrip/git-branch-transport.js';
import {
  packetRootFor,
  readPacketState,
  readReportInput,
  syncFlow,
} from '../pro-roundtrip/importer.js';
import { ensureProtocol, loadLocalProtocol, verifyPinnedProtocol } from '../pro-roundtrip/protocol.js';
import { publishAggregateReport, recordSprintReport } from '../pro-roundtrip/report.js';
import {
  inspectBridgeWorktree,
  prepareBridgeWorktree,
  resolveRepositoryRoot,
  runGit,
  type WorktreeContext,
} from '../pro-roundtrip/worktree.js';

function usage(): string {
  return `Usage:
  vibe-pro-go
  vibe-pro-go go [flow] [--date YYYYMMDD] [--slug <slug>]
  vibe-pro-go bootstrap [--repository <owner/repo>] --publish
  vibe-pro-go start design "<goal>" [--slug <slug>] [--timezone <IANA>] [--repository <owner/repo>] --publish
  vibe-pro-go start audit [--goal "<goal>"] [--slug <slug>] [--timezone <IANA>] [--repository <owner/repo>] --publish
  vibe-pro-go status [flow]
  vibe-pro-go sync [flow]
  vibe-pro-go brief [flow]
  vibe-pro-go report [flow] [--evidence <input.json>] [--publish]
  vibe-pro-go continue [flow]
  vibe-pro-go accept-review [flow]
  vibe-pro-go accept-review [flow] --publish --user-approved [--reason "<text>"]
  vibe-pro-go close [flow] --publish
  vibe-pro-go confirm-skip on [--reason "<text>"] [--days <1-365>]
  vibe-pro-go confirm-skip off|status
  vibe-pro-go doctor`;
}

function output(value: unknown, json = false): void {
  if (json || typeof value !== 'string') {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${value}\n`);
}

export interface ProRoundtripExecutionOptions {
  cwd?: string;
  preparedContext?: WorktreeContext;
  writeOutput?: (value: unknown, json: boolean) => void;
  setExitCode?: (exitCode: number) => void;
}

interface ProRoundtripRuntime {
  cwd: string;
  context: WorktreeContext | undefined;
  writeOutput: (value: unknown, json: boolean) => void;
  setExitCode: (exitCode: number) => void;
}

async function repositoryRoot(runtime: ProRoundtripRuntime): Promise<string> {
  return runtime.context?.repoRoot ?? resolveRepositoryRoot(runtime.cwd);
}

async function bridgeContext(
  runtime: ProRoundtripRuntime,
): Promise<WorktreeContext> {
  runtime.context ??= await prepareBridgeWorktree(runtime.cwd);
  return runtime.context;
}

function emit(runtime: ProRoundtripRuntime, value: unknown, json = false): void {
  runtime.writeOutput(value, json);
}

function canonicalPath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function assertPreparedContext(
  cwd: string,
  context: WorktreeContext | undefined,
): void {
  if (!context) {
    return;
  }
  const repoRoot = canonicalPath(context.repoRoot);
  const relativeCwd = path.relative(repoRoot, canonicalPath(cwd));
  const expectedWorktree = canonicalPath(
    path.join(context.repoRoot, '.vibe', 'worktrees', 'pro-roundtrip'),
  );
  const expectedMarker = canonicalPath(
    path.join(context.repoRoot, '.vibe', 'worktrees', 'pro-roundtrip.owner.json'),
  );
  if (
    relativeCwd.startsWith('..') ||
    path.isAbsolute(relativeCwd) ||
    canonicalPath(context.worktreePath) !== expectedWorktree ||
    canonicalPath(context.markerPath) !== expectedMarker
  ) {
    throw new Error('prepared bridge context does not belong to the requested repository');
  }
}

function projectTimezone(args: ParsedArgs): string {
  const explicit = getStringFlag(args, 'timezone');
  const timezone = explicit ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!timezone) {
    throw new Error('project timezone is unknown; provide --timezone <IANA>');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error(`invalid IANA timezone: ${timezone}`);
  }
  return timezone;
}

function dateInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('year') ?? ''}${values.get('month') ?? ''}${values.get('day') ?? ''}`;
}

function repositoryFullName(remoteUrl: string): string {
  const normalized = remoteUrl.trim().replace(/\.git$/, '');
  const match =
    /github\.com[/:](?<owner>[^/:\s]+)\/(?<repo>[^/\s]+)$/.exec(normalized) ??
    /^(?<owner>[^/\s]+)\/(?<repo>[^/\s]+)$/.exec(normalized);
  if (!match?.groups?.owner || !match.groups.repo) {
    throw new Error(`cannot derive GitHub owner/repo from origin URL: ${remoteUrl}`);
  }
  return `${match.groups.owner}/${match.groups.repo}`;
}

function safeRemoteUrl(remoteUrl: string): string {
  if (/^https?:\/\//i.test(remoteUrl)) {
    const parsed = new URL(remoteUrl);
    if (parsed.username || parsed.password) {
      throw new Error('origin URL contains embedded credentials; refusing to publish it');
    }
  }
  if (/[\r\n]/.test(remoteUrl)) {
    throw new Error('origin URL contains invalid control characters');
  }
  return remoteUrl;
}

function webPrompt(
  fullName: string,
  flowPath: string,
  protocolVersion: string,
  scopeRulings: string[] = [],
): string {
  return `MUST use only the GitHub app's exact-ref fetch/read/compare/create actions.
MUST NOT use Web Search, browser search, generic search results, URL browsing, or the GitHub search index for repository work.
MUST NOT fall back to the default branch.
Fetch ${fullName}@refs/heads/vibe-pro-bridge:protocol/${protocolVersion}/PROTOCOL.json, then read its pinned WEB-RUNBOOK.md and COMMON-HARNESS.md.
Continue flow ${flowPath} from its latest valid COMPLETE.json.
Write only new files under the exact nextWriteTarget, create COMPLETE.json last, keep confirmation visible, and stop if exact-ref access is unavailable.${scopeRulings.length > 0
    ? `\n\nUser scope rulings (binding):\n${scopeRulings.join('\n')}\nDo not reintroduce trimmed or deferred scope. Contest a ruling only through a new P0/P1 finding that declares an intent path (intentIds).`
    : ''}`;
}

async function bootstrapCommand(
  args: ParsedArgs,
  runtime: ProRoundtripRuntime,
): Promise<void> {
  if (!getBooleanFlag(args, 'publish')) {
    throw new Error(
      'bootstrap publishes the pinned protocol namespace to GitHub; obtain user authorization and pass --publish',
    );
  }
  const repoRoot = await repositoryRoot(runtime);
  const remoteUrl = safeRemoteUrl(
    (await runGit(repoRoot, ['remote', 'get-url', 'origin'])).stdout.trim(),
  );
  const explicitRepository = getStringFlag(args, 'repository');
  if (explicitRepository && !/^[^/\s]+\/[^/\s]+$/.test(explicitRepository)) {
    throw new Error('--repository must use owner/repo format');
  }
  let derivedRepository: string | undefined;
  try {
    derivedRepository = repositoryFullName(remoteUrl);
  } catch {
    if (!explicitRepository) {
      throw new Error(
        'origin is not a GitHub URL; provide --repository only for an authorized local/test transport',
      );
    }
  }
  if (
    explicitRepository &&
    derivedRepository &&
    explicitRepository !== derivedRepository
  ) {
    throw new Error(
      `--repository does not match origin: explicit=${explicitRepository} origin=${derivedRepository}`,
    );
  }
  const fullName = explicitRepository ?? derivedRepository;
  if (!fullName) {
    throw new Error('GitHub repository identity is unavailable');
  }
  const codeBranch = (await runGit(repoRoot, ['branch', '--show-current'])).stdout.trim();
  if (!codeBranch) {
    throw new Error('bootstrap requires a named code branch, not detached HEAD');
  }
  await runGit(repoRoot, [
    'fetch',
    'origin',
    `refs/heads/${codeBranch}:refs/remotes/origin/${codeBranch}`,
  ]);
  const localRunbook = await runGit(
    repoRoot,
    ['rev-parse', 'HEAD:bridge-runbook.md'],
    true,
  );
  const remoteRunbook = await runGit(
    repoRoot,
    ['rev-parse', `refs/remotes/origin/${codeBranch}:bridge-runbook.md`],
    true,
  );
  if (
    localRunbook.exitCode !== 0 ||
    remoteRunbook.exitCode !== 0 ||
    localRunbook.stdout.trim() !== remoteRunbook.stdout.trim()
  ) {
    throw new Error(
      `bridge-runbook.md must be committed and pushed unchanged to ${codeBranch} before Web-first bootstrap`,
    );
  }
  const localHead = (await runGit(repoRoot, ['rev-parse', 'HEAD^{commit}'])).stdout.trim();
  const remoteHead = (
    await runGit(repoRoot, [
      'rev-parse',
      `refs/remotes/origin/${codeBranch}^{commit}`,
    ])
  ).stdout.trim();
  if (localHead !== remoteHead) {
    throw new Error(
      `code branch ${codeBranch} must be pushed at the exact local HEAD before Web-first bootstrap`,
    );
  }
  const context = await bridgeContext(runtime);
  emit(runtime, {
    action: 'bootstrap',
    repository: fullName,
    branch: 'vibe-pro-bridge',
    codeBranch,
    protocol: await ensureProtocol({ context, publish: true }),
    webEntry: 'Read ./bridge-runbook.md from the exact code ref with the GitHub app.',
  });
}

async function selectGoFlow(
  args: ParsedArgs,
  runtime: ProRoundtripRuntime,
): Promise<{
  flowPath: string;
  skippedIncompatible: Array<{ flowPath: string; pinnedVersion: string }>;
}> {
  const explicit = args.positionals[1];
  if (explicit) {
    return { flowPath: explicit, skippedIncompatible: [] };
  }
  const requestedDate = getStringFlag(args, 'date');
  if (requestedDate && !/^[0-9]{8}$/.test(requestedDate)) {
    throw new Error('--date must use YYYYMMDD');
  }
  const requestedSlug = getStringFlag(args, 'slug');
  const slug = requestedSlug ? validateSlug(requestedSlug) : undefined;
  const repoRoot = await repositoryRoot(runtime);
  const codeBranch = (await runGit(repoRoot, ['branch', '--show-current'])).stdout.trim();
  if (!codeBranch) {
    throw new Error('go requires a named code branch, not detached HEAD');
  }
  const remoteUrl = safeRemoteUrl(
    (await runGit(repoRoot, ['remote', 'get-url', 'origin'])).stdout.trim(),
  );
  let fullName: string | undefined;
  try {
    fullName = repositoryFullName(remoteUrl);
  } catch {
    // Local integration fixtures may use a non-GitHub origin.
  }
  const context = await bridgeContext(runtime);
  const paths = await listFlowPaths(context.worktreePath);
  const localProtocol = await loadLocalProtocol(repoRoot);
  const skippedIncompatible: Array<{ flowPath: string; pinnedVersion: string }> = [];
  const candidates: Array<{
    flowPath: string;
    latestMarkerCommit: string;
  }> = [];
  for (const flowPath of paths) {
    const parts = parseFlowPath(flowPath);
    if (requestedDate && parts.date !== requestedDate) {
      continue;
    }
    if (slug && parts.slug !== slug) {
      continue;
    }
    const snapshot = await loadFlowSnapshot(context.worktreePath, flowPath);
    if (
      snapshot.flow.codeBranch !== codeBranch ||
      (fullName && snapshot.flow.repository.fullName !== fullName) ||
      snapshot.latestEvent.marker.kind === 'closed'
    ) {
      continue;
    }
    if (snapshot.flow.protocol.version !== localProtocol.version) {
      skippedIncompatible.push({
        flowPath,
        pinnedVersion: snapshot.flow.protocol.version,
      });
      continue;
    }
    const markerPath =
      `${flowPath}/${snapshot.latestEvent.directory}/COMPLETE.json`;
    const latestMarkerCommit = (
      await runGit(context.worktreePath, [
        'log',
        '-1',
        '--format=%H',
        'HEAD',
        '--',
        markerPath,
      ])
    ).stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(latestMarkerCommit)) {
      throw new Error(`cannot resolve latest event commit for ${flowPath}`);
    }
    candidates.push({ flowPath, latestMarkerCommit });
  }
  if (candidates.length > 0) {
    const bridgeHistory = (
      await runGit(context.worktreePath, ['rev-list', 'HEAD'])
    ).stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    const rank = new Map(bridgeHistory.map((commit, index) => [commit, index]));
    candidates.sort(
      (left, right) =>
        (rank.get(left.latestMarkerCommit) ?? Number.MAX_SAFE_INTEGER) -
          (rank.get(right.latestMarkerCommit) ?? Number.MAX_SAFE_INTEGER) ||
        right.flowPath.localeCompare(left.flowPath),
    );
    return { flowPath: candidates[0]?.flowPath ?? '', skippedIncompatible };
  }
  const selector = [
    `repository=${fullName ?? '<local-origin>'}`,
    `codeBranch=${codeBranch}`,
    requestedDate ? `date=${requestedDate}` : null,
    slug ? `slug=${slug}` : null,
  ]
    .filter(Boolean)
    .join(' ');
  if (skippedIncompatible.length > 0) {
    const list = skippedIncompatible
      .map(({ flowPath, pinnedVersion }) => `${flowPath} (protocol ${pinnedVersion})`)
      .join(', ');
    throw new Error(
      `no operable non-closed Pro flow matches ${selector}; skipped ${skippedIncompatible.length} on a superseded protocol generation (local ${localProtocol.version}): ${list}. Finish/close each with the harness generation that created it, or start a new flow.`,
    );
  }
  throw new Error(`no non-closed Pro flow matches ${selector}`);
}

function nextInstruction(
  snapshot: Awaited<ReturnType<typeof syncFlow>>['snapshot'],
  currentSprintId: string | null,
): string {
  const marker = snapshot.latestEvent.marker;
  if (marker.nextActor === 'pro') {
    return 'Send webPrompt to Web Pro and wait for its completed GitHub event.';
  }
  if (marker.nextActor === 'codex' && marker.kind === 'design' && currentSprintId) {
    return `Implement ${currentSprintId} now from its immutable SPRINT.md; record its checkpoint automatically, then continue remaining Sprints.`;
  }
  if (marker.nextActor === 'codex' && marker.kind === 'feedback') {
    return 'Remediate only validated actionable finding IDs, record remediation evidence, and prepare the Pro report automatically.';
  }
  if (marker.nextActor === 'codex') {
    return 'Prepare the complete Pro implementation report and workflow matrix automatically; request authorization only for publish.';
  }
  if (marker.nextActor === 'cli' && marker.kind === 'approval') {
    return 'Verify the approved HEAD and final matrix, then request authorization for close --publish.';
  }
  return `Continue as ${marker.nextActor} at ${marker.nextWriteTarget ?? 'no write target'}.`;
}

async function goCommand(
  args: ParsedArgs,
  runtime: ProRoundtripRuntime,
): Promise<void> {
  const { flowPath, skippedIncompatible } = await selectGoFlow(args, runtime);
  const context = await bridgeContext(runtime);
  const synced = await syncFlow(flowPath, { context });
  const marker = synced.snapshot.latestEvent.marker;
  const contract = [...synced.snapshot.events].reverse().find((event) => event.contract)
    ?.contract;
  const currentSprint = contract?.sprints.find(
    ({ id }) => id === synced.state.currentSprintId,
  );
  const scopeRulings = await collectScopeRulings(synced.packetRoot);
  const briefStatus = await alignmentBriefStatus(
    synced.packetRoot,
    synced.snapshot,
    synced.state,
  );
  emit(runtime, {
    action: 'go',
    flowPath,
    autoPublish: (await readAutoPublishState(context.repoRoot)).autoPublish,
    selection: args.positionals[1] ? 'explicit' : 'latest-non-closed-current-repo-branch',
    skippedIncompatibleFlows: skippedIncompatible,
    packetRoot: synced.packetRoot,
    handoffPath: path.join(synced.packetRoot, 'HANDOFF.md'),
    sprintEnvelopePath: currentSprint
      ? path.join(
          synced.packetRoot,
          'sprints',
          `${currentSprint.id}-${currentSprint.slug}`,
          'SPRINT.md',
        )
      : null,
    latestEventId: marker.eventId,
    latestEventKind: marker.kind,
    currentSprintId: synced.state.currentSprintId,
    nextActor: marker.nextActor,
    nextWriteTarget: marker.nextWriteTarget,
    autoReportRequired:
      marker.nextActor === 'codex' && ['design', 'feedback'].includes(marker.kind),
    alignmentBrief: briefStatus,
    instruction: nextInstruction(synced.snapshot, synced.state.currentSprintId),
    webPrompt:
      marker.nextActor === 'pro'
        ? webPrompt(
            synced.snapshot.flow.repository.fullName,
            flowPath,
            synced.snapshot.flow.protocol.version,
            scopeRulings,
          )
        : null,
  });
}

async function startCommand(
  args: ParsedArgs,
  runtime: ProRoundtripRuntime,
): Promise<void> {
  const mode = args.positionals[1];
  if (mode !== 'design' && mode !== 'audit') {
    throw new Error(`start requires design or audit\n${usage()}`);
  }
  if (!getBooleanFlag(args, 'publish')) {
    throw new Error('start publishes to GitHub; obtain user authorization and pass --publish');
  }
  const repoRoot = await repositoryRoot(runtime);
  const goal =
    mode === 'design'
      ? args.positionals.slice(2).join(' ').trim()
      : getStringFlag(args, 'goal', 'Audit the current code branch against its intended workflow.');
  if (!goal) {
    throw new Error('start design requires a non-empty goal');
  }
  const timezone = projectTimezone(args);
  const date = dateInTimezone(new Date(), timezone);
  const slugFlag = getStringFlag(args, 'slug');
  const slug = slugFlag ? validateSlug(slugFlag) : slugifyGoal(goal);
  const codeBranch = (await runGit(repoRoot, ['branch', '--show-current'])).stdout.trim();
  if (!codeBranch) {
    throw new Error('start requires a named code branch, not detached HEAD');
  }
  const baseSha = (await runGit(repoRoot, ['rev-parse', 'HEAD^{commit}'])).stdout.trim();
  const remoteUrl = safeRemoteUrl(
    (await runGit(repoRoot, ['remote', 'get-url', 'origin'])).stdout.trim(),
  );
  const explicitRepository = getStringFlag(args, 'repository');
  if (explicitRepository && !/^[^/\s]+\/[^/\s]+$/.test(explicitRepository)) {
    throw new Error('--repository must use owner/repo format');
  }
  let derivedRepository: string | undefined;
  try {
    derivedRepository = repositoryFullName(remoteUrl);
  } catch {
    if (!explicitRepository) {
      throw new Error(
        `origin is not a GitHub URL; provide --repository only for an authorized local/test transport`,
      );
    }
  }
  if (
    explicitRepository &&
    derivedRepository &&
    explicitRepository !== derivedRepository
  ) {
    throw new Error(
      `--repository does not match origin: explicit=${explicitRepository} origin=${derivedRepository}`,
    );
  }
  const fullName = explicitRepository ?? derivedRepository;
  if (!fullName) {
    throw new Error('GitHub repository identity is unavailable');
  }
  const context = await bridgeContext(runtime);
  const protocol = await ensureProtocol({ context, publish: true });

  let published:
    | { flowPath: string; bridgeCommitSha: string; attempts: number }
    | undefined;
  let lastError: unknown;
  for (let allocationAttempt = 1; allocationAttempt <= 3; allocationAttempt += 1) {
    const flowPath = await allocateFlowPath(context.worktreePath, date, slug);
    const flow: ProRoundtripFlow = {
      schemaVersion: 'vibe-pro-flow-v1',
      flowPath,
      date,
      sequence: Number(path.posix.basename(flowPath).slice(0, 3)),
      slug,
      goal,
      nonGoals: [
        'Do not use a custom MCP server, tunnel, browser DOM automation, or copied credentials.',
        'Do not write to the default branch or create a PR for the exchange lane.',
      ],
      repository: { fullName, remoteUrl },
      bridgeBranch: 'vibe-pro-bridge',
      codeBranch,
      baseSha,
      protocol: {
        version: protocol.version,
        commitSha: protocol.commitSha,
        commonHarnessSha256: protocol.commonHarnessSha256,
      },
      createdAt: new Date().toISOString(),
      timezone,
      createdBy: 'cli',
    };
    const goalEventId = '0000--cli--goal--r01';
    const goalRoot = `${flowPath}/${goalEventId}`;
    const nextTarget =
      mode === 'design'
        ? `${flowPath}/0100--pro--design--r01`
        : `${flowPath}/0100--codex--implementation-report--r01`;
    const goalDocument = `# Goal

## Mode

${mode}

## Goal

${goal}

## Binding

- Repository: \`${fullName}\`
- Code branch: \`${codeBranch}\`
- Base SHA: \`${baseSha}\`
- Timezone: \`${timezone}\`
- Protocol: \`${protocol.version}@${protocol.commitSha}\`

## Non-goals

${flow.nonGoals.map((item) => `- ${item}`).join('\n')}
`;
    const marker: ProRoundtripEventComplete = {
      schemaVersion: 'vibe-pro-event-complete-v1',
      flowPath,
      eventId: goalEventId,
      sequence: 0,
      actor: 'cli',
      kind: 'goal',
      revision: 1,
      previousEventId: null,
      supersedesEventId: null,
      protocolVersion: protocol.version,
      designEventId: null,
      sprintId: null,
      repositoryFullName: fullName,
      codeBranch,
      baseSha,
      headSha: baseSha,
      disposition: 'complete',
      files: [{ path: 'GOAL.md', mediaType: 'text/markdown' }],
      limitations: [],
      createdAt: new Date().toISOString(),
      nextActor: mode === 'design' ? 'pro' : 'codex',
      nextWriteTarget: nextTarget,
    };
    const files = new Map<string, string>([
      [`${flowPath}/FLOW.json`, `${JSON.stringify(flow, null, 2)}\n`],
      [`${goalRoot}/GOAL.md`, goalDocument],
      [`${goalRoot}/COMPLETE.json`, `${JSON.stringify(marker, null, 2)}\n`],
    ]);
    try {
      const result = await publishAdditions(
        files,
        `docs(pro-go): start ${path.posix.basename(flowPath)}`,
        { context },
      );
      published = {
        flowPath,
        bridgeCommitSha: result.bridgeCommitSha,
        attempts: result.attempts,
      };
      break;
    } catch (error) {
      lastError = error;
      if (!/append-only collision/.test(error instanceof Error ? error.message : String(error))) {
        throw error;
      }
    }
  }
  if (!published) {
    throw new Error(`flow allocation failed after 3 attempts: ${String(lastError)}`);
  }
  emit(runtime, {
    action: 'start',
    mode,
    ...published,
    protocolBootstrapped: protocol.bootstrapped,
    nextActor: mode === 'design' ? 'pro' : 'codex',
    webPrompt:
      mode === 'design'
        ? webPrompt(fullName, published.flowPath, protocol.version, [])
        : null,
  });
}

async function loadRemoteSnapshot(
  runtime: ProRoundtripRuntime,
  requested?: string,
) {
  const context = await bridgeContext(runtime);
  const flowPath = await resolveFlowPath(context.worktreePath, requested);
  const snapshot = await loadFlowSnapshot(context.worktreePath, flowPath);
  await verifyPinnedProtocol(context.repoRoot, context.worktreePath, snapshot.flow.protocol);
  return { context, snapshot };
}

async function statusCommand(
  args: ParsedArgs,
  runtime: ProRoundtripRuntime,
): Promise<void> {
  const { context, snapshot } = await loadRemoteSnapshot(runtime, args.positionals[1]);
  const localState = await readPacketState(context.repoRoot, snapshot.flow.flowPath);
  const briefStatus = await alignmentBriefStatus(
    packetRootFor(context.repoRoot, snapshot.flow.flowPath),
    snapshot,
    localState,
  );
  emit(runtime, {
    flowPath: snapshot.flow.flowPath,
    autoPublish: (await readAutoPublishState(context.repoRoot)).autoPublish,
    goal: snapshot.flow.goal,
    codeBranch: snapshot.flow.codeBranch,
    baseSha: snapshot.flow.baseSha,
    bridgeHeadSha: context.remoteTip,
    latestEvent: snapshot.latestEvent.marker,
    completedEvents: snapshot.events.map(({ marker }) => marker.eventId),
    incompleteEvents: snapshot.incompleteEventDirectories,
    alignmentBrief: briefStatus,
    localPacket: localState
      ? {
          latestEventId: localState.latestEventId,
          currentSprintId: localState.currentSprintId,
          codeHeadSha: localState.codeHeadSha,
          acknowledgedBridgeSha: localState.lastAcknowledgedBridgeSha,
        }
      : null,
  });
}

function alignmentContextForSnapshot(
  snapshot: Awaited<ReturnType<typeof loadFlowSnapshot>>,
): AlignmentBriefContext {
  const latest = snapshot.latestEvent;
  if (latest.marker.kind === 'design') {
    return {
      event: latest.marker,
      ...(latest.contract ? { contract: latest.contract } : {}),
    };
  }
  if (latest.marker.kind === 'feedback') {
    const design = snapshot.events.find(
      ({ marker }) => marker.eventId === latest.marker.designEventId,
    );
    return {
      event: latest.marker,
      ...(design?.contract ? { contract: design.contract } : {}),
      ...(latest.findings ? { findings: latest.findings } : {}),
    };
  }
  return { event: latest.marker };
}

async function briefCommand(
  args: ParsedArgs,
  runtime: ProRoundtripRuntime,
): Promise<void> {
  const { context, snapshot } = await loadRemoteSnapshot(runtime, args.positionals[1]);
  const marker = snapshot.latestEvent.marker;
  if (
    marker.actor !== 'pro' ||
    (marker.kind !== 'design' && marker.kind !== 'feedback')
  ) {
    throw new Error('brief requires the latest completed event to be a Pro design or feedback');
  }
  const state = await readPacketState(context.repoRoot, snapshot.flow.flowPath);
  const packetRoot = packetRootFor(context.repoRoot, snapshot.flow.flowPath);
  const ctx = alignmentContextForSnapshot(snapshot);
  const status = await alignmentBriefStatus(packetRoot, snapshot, state);
  const paths = alignmentBriefPathsFor(packetRoot, marker.eventId);
  const roster =
    marker.kind === 'design'
      ? [
          ...(ctx.contract?.requirements.map(({ id }) => id) ?? []),
          ...(ctx.contract?.invariants.map(({ id }) => id) ?? []),
          ...(ctx.contract?.workflows.map(({ id }) => id) ?? []),
          ...(ctx.contract?.nonFunctionalRequirements.map(({ id }) => id) ?? []),
        ]
      : (ctx.findings?.findings.map(({ id }) => id) ?? []);
  emit(runtime, {
    action: 'brief',
    flowPath: snapshot.flow.flowPath,
    eventId: marker.eventId,
    eventKind: marker.kind,
    required: status.requiredForEventId === marker.eventId,
    status: status.status,
    detail: status.detail,
    roster,
    intents: ctx.contract?.intents?.map(({ id, statement }) => ({ id, statement })) ?? [],
    briefJsonPath: paths.briefJson,
    briefMdPath: paths.briefMd,
    skeleton: alignmentBriefSkeleton(ctx),
    guidance:
      'Author BRIEF.md in the session language and BRIEF.json from a fresh evaluator context reading GOAL/intents plus the Pro document; the harness validates structure only. Briefs propose; users decide.',
  });
}

async function syncCommand(
  args: ParsedArgs,
  runtime: ProRoundtripRuntime,
): Promise<void> {
  const result = await syncFlow(args.positionals[1], {
    context: await bridgeContext(runtime),
  });
  emit(runtime, {
    flowPath: result.snapshot.flow.flowPath,
    packetRoot: result.packetRoot,
    importedEventIds: result.importedEventIds,
    latestEventId: result.state.latestEventId,
    designEventId: result.state.designEventId,
    currentSprintId: result.state.currentSprintId,
    codeHeadSha: result.state.codeHeadSha,
    nextActor: result.snapshot.latestEvent.marker.nextActor,
    nextWriteTarget: result.snapshot.latestEvent.marker.nextWriteTarget,
  });
}

async function reportCommand(
  args: ParsedArgs,
  runtime: ProRoundtripRuntime,
): Promise<void> {
  const context = await bridgeContext(runtime);
  let synced = await syncFlow(args.positionals[1], { context });
  await assertAlignmentBriefGate(
    synced.packetRoot,
    synced.snapshot,
    synced.state,
    'report',
  );
  const evidencePath = getStringFlag(args, 'evidence');
  let checkpointPath: string | null = null;
  if (evidencePath) {
    const input = await readReportInput(path.resolve(runtime.cwd, evidencePath));
    const repoRoot = await repositoryRoot(runtime);
    checkpointPath = await recordSprintReport(
      repoRoot,
      synced.snapshot,
      input,
    );
    synced = await syncFlow(synced.snapshot.flow.flowPath, { context });
  }
  let publication = null;
  if (getBooleanFlag(args, 'publish')) {
    const repoRoot = await repositoryRoot(runtime);
    publication = await publishAggregateReport(repoRoot, synced.snapshot, {
      context,
    });
    synced = await syncFlow(synced.snapshot.flow.flowPath, { context });
  }
  emit(runtime, {
    flowPath: synced.snapshot.flow.flowPath,
    checkpointPath,
    published: publication,
    currentSprintId: synced.state.currentSprintId,
    latestEventId: synced.state.latestEventId,
    nextActor: synced.snapshot.latestEvent.marker.nextActor,
    nextWriteTarget: synced.snapshot.latestEvent.marker.nextWriteTarget,
  });
}

async function continueCommand(
  args: ParsedArgs,
  runtime: ProRoundtripRuntime,
): Promise<void> {
  const { context, snapshot } = await loadRemoteSnapshot(runtime, args.positionals[1]);
  if (snapshot.latestEvent.marker.nextActor === 'pro') {
    const scopeRulings = await collectScopeRulings(
      packetRootFor(context.repoRoot, snapshot.flow.flowPath),
    );
    emit(
      runtime,
      webPrompt(
        snapshot.flow.repository.fullName,
        snapshot.flow.flowPath,
        snapshot.flow.protocol.version,
        scopeRulings,
      ),
    );
    return;
  }
  emit(
    runtime,
    `Run $vibe-pro-go for ${snapshot.flow.flowPath}; it will sync and continue as ${snapshot.latestEvent.marker.nextActor} at ${snapshot.latestEvent.marker.nextWriteTarget ?? 'no target'}.`,
  );
}

const acceptReviewConfirmation =
  'Re-run with --publish --user-approved after the user explicitly confirms accepting every listed finding as a deferral. proGoAutoPublish never covers this confirmation.';

function buildReviewAcceptanceMarker(
  snapshot: Awaited<ReturnType<typeof loadFlowSnapshot>>,
  reason: string,
): {
  marker: ProRoundtripEventComplete;
  findings: NonNullable<typeof snapshot.latestEvent.findings>['findings'];
} {
  const feedbackEvent = snapshot.latestEvent;
  const feedback = feedbackEvent.marker;
  const findings = feedbackEvent.findings?.findings;
  if (!findings) {
    throw new Error(`${feedback.eventId}: feedback findings are unavailable`);
  }
  const sequence = feedback.sequence + 100;
  if (sequence >= 9900) {
    throw new Error('no approval sequence is available');
  }
  const revision =
    snapshot.events.filter(({ marker }) => marker.kind === 'approval').length + 1;
  const approvalEventId =
    `${String(sequence).padStart(4, '0')}--cli--approval--r${String(revision).padStart(2, '0')}`;
  const acceptedFindingIds = findings.map(({ id }) => id).sort();
  const disposition =
    acceptedFindingIds.length === 0 ? 'approved' : 'approved-with-deferrals';
  return {
    findings,
    marker: {
      schemaVersion: 'vibe-pro-event-complete-v1',
      flowPath: snapshot.flow.flowPath,
      eventId: approvalEventId,
      sequence,
      actor: 'cli',
      kind: 'approval',
      revision,
      previousEventId: feedback.eventId,
      supersedesEventId: null,
      protocolVersion: snapshot.flow.protocol.version,
      designEventId: feedback.designEventId,
      sprintId: null,
      repositoryFullName: snapshot.flow.repository.fullName,
      codeBranch: snapshot.flow.codeBranch,
      baseSha: snapshot.flow.baseSha,
      headSha: feedback.headSha,
      disposition,
      files: [{ path: 'APPROVAL.md', mediaType: 'text/markdown' }],
      limitations: [],
      createdAt: new Date().toISOString(),
      nextActor: 'cli',
      nextWriteTarget: `${snapshot.flow.flowPath}/9900--cli--closed--r01`,
      reviewAcceptance: {
        authorizedBy: 'user',
        acceptedFindingIds,
        reason,
      },
    },
  };
}

async function acceptReviewCommand(
  args: ParsedArgs,
  runtime: ProRoundtripRuntime,
): Promise<void> {
  const { context, snapshot } = await loadRemoteSnapshot(runtime, args.positionals[1]);
  const packetState = await readPacketState(context.repoRoot, snapshot.flow.flowPath);
  await assertAlignmentBriefGate(
    packetRootFor(context.repoRoot, snapshot.flow.flowPath),
    snapshot,
    packetState,
    'accept-review',
  );
  const feedback = snapshot.latestEvent.marker;
  if (feedback.kind !== 'feedback' || feedback.actor !== 'pro') {
    throw new Error('accept-review requires the latest completed event to be a Pro feedback');
  }
  const publishing = getBooleanFlag(args, 'publish');
  if (
    publishing &&
    !getBooleanFlag(args, 'user-approved')
  ) {
    throw new Error(
      'accept-review records a user decision; pass --user-approved only after the user explicitly confirms accepting every listed finding as a deferral. The proGoAutoPublish directive never covers this confirmation.',
    );
  }

  if (!publishing) {
    const reason = validateAutoPublishReason(
      getStringFlag(
        args,
        'reason',
        'user directive: accept review findings as deferrals',
      ) ?? '',
    );
    const { marker, findings } = buildReviewAcceptanceMarker(snapshot, reason);
    const blockers: string[] = [];
    try {
      validateReviewAcceptance(marker, feedback, findings);
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : String(error));
    }
    const eligible = blockers.length === 0;
    emit(runtime, {
      action: 'accept-review',
      flowPath: snapshot.flow.flowPath,
      feedbackEventId: feedback.eventId,
      reviewedHeadSha: feedback.headSha,
      disposition: marker.disposition,
      eligible,
      blockers,
      findings: [...findings]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(({ id, severity, taxonomy, summary }) => ({ id, severity, taxonomy, summary })),
      recommendation: eligible
        ? 'Publish only after the user explicitly accepts every listed finding as a deferral.'
        : 'Do not publish this acceptance until every blocker is resolved.',
      requiredConfirmation: acceptReviewConfirmation,
      autoPublish: (await readAutoPublishState(context.repoRoot)).autoPublish,
    });
    return;
  }

  const codeHead = (await runGit(
    context.repoRoot,
    ['rev-parse', 'HEAD^{commit}'],
  )).stdout.trim();
  if (codeHead !== feedback.headSha) {
    throw new Error(`accepted HEAD is stale: feedback=${feedback.headSha} current=${codeHead}`);
  }
  if (!packetState || packetState.latestEventId !== feedback.eventId) {
    throw new Error('sync the feedback event before accepting');
  }
  if (feedback.sequence + 100 >= 9900) {
    throw new Error('no approval sequence is available');
  }
  const closeDirectory = '9900--cli--closed--r01';
  if (snapshot.incompleteEventDirectories.includes(closeDirectory)) {
    throw new Error(`close target collision: ${closeDirectory}`);
  }
  const reason = validateAutoPublishReason(
    getStringFlag(
      args,
      'reason',
      'user directive: accept review findings as deferrals',
    ) ?? '',
  );
  const { marker: candidate, findings } = buildReviewAcceptanceMarker(snapshot, reason);
  // The chain grammar validates kind transitions but never binds a successor to the
  // previous event's declared nextWriteTarget; feedback -> approval lives in transitions.
  const marker = ProRoundtripEventCompleteSchema.parse(
    JSON.parse(JSON.stringify(candidate)) as unknown,
  );
  validateReviewAcceptance(marker, feedback, findings);

  const acceptedFindingIds = marker.reviewAcceptance?.acceptedFindingIds ?? [];
  const deferrals = [...findings]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(
      ({ id, severity, taxonomy, summary }) =>
        `- \`${id}\` [${severity}/${taxonomy}] ${summary}`,
    );
  const approvalDocument = `# Approved (user-accepted review)

- Flow: \`${snapshot.flow.flowPath}\`
- Goal: ${snapshot.flow.goal}
- Accepted feedback event: \`${feedback.eventId}\`
- Approved code HEAD: \`${feedback.headSha}\`
- Authorized by: user (CLI acceptance)
- Reason: ${reason}

## Deferrals (restated from the accepted review)

${deferrals.length > 0 ? deferrals.join('\n') : '- none'}

These findings land in the durable backlog as deferrals. Multi-flow coordination remains
a Pro decision surface.
`;
  const approvalRoot = `${snapshot.flow.flowPath}/${marker.eventId}`;
  const publication = await publishAdditions(
    new Map([
      [`${approvalRoot}/APPROVAL.md`, approvalDocument],
      [`${approvalRoot}/COMPLETE.json`, `${JSON.stringify(marker, null, 2)}\n`],
    ]),
    `docs(pro-go): user-accepted review close ${path.posix.basename(snapshot.flow.flowPath)}`,
    { context },
  );
  await appendSessionLogDecision(
    context.repoRoot,
    `- ${new Date().toISOString()} [decision][review-accepted] flow=${snapshot.flow.flowPath} event=${marker.eventId} findings=${acceptedFindingIds.join(',') || 'none'} reason=${reason}`,
  );
  const synced = await syncFlow(snapshot.flow.flowPath, { context });
  emit(runtime, {
    action: 'accept-review',
    publication,
    flowPath: snapshot.flow.flowPath,
    approvalEventId: marker.eventId,
    disposition: marker.disposition,
    acceptedFindingIds,
    latestEventId: synced.state.latestEventId,
    nextAction: 'close --publish',
  });
}

async function closeCommand(
  args: ParsedArgs,
  runtime: ProRoundtripRuntime,
): Promise<void> {
  if (!getBooleanFlag(args, 'publish')) {
    throw new Error('close publishes to GitHub; obtain user authorization and pass --publish');
  }
  const { context, snapshot } = await loadRemoteSnapshot(runtime, args.positionals[1]);
  await assertAlignmentBriefGate(
    packetRootFor(context.repoRoot, snapshot.flow.flowPath),
    snapshot,
    await readPacketState(context.repoRoot, snapshot.flow.flowPath),
    'close',
  );
  const latest = snapshot.latestEvent.marker;

  // Resolve the governing approval. A closed latest event is only acceptable for the
  // idempotent completion of a coordination set whose primary was already closed.
  let approval: ProRoundtripEventComplete;
  if (latest.kind === 'approval') {
    approval = latest;
  } else if (latest.kind === 'closed') {
    const approvalEvent = [...snapshot.events]
      .reverse()
      .find((event) => event.marker.kind === 'approval');
    if (!approvalEvent?.marker.coordinatedClose) {
      throw new Error('flow is already closed');
    }
    approval = approvalEvent.marker;
  } else {
    throw new Error('close requires the latest completed event to be a Pro approval');
  }

  if (!approval.coordinatedClose) {
    await closeSingleFlow(runtime, context, snapshot);
    return;
  }

  // Coordinated cross-flow close: the approval declares the set; enforce it atomically.
  validateCoordinatedCloseDeclaration(approval);
  const declaration = approval.coordinatedClose;
  if (declaration.primaryFlowPath !== snapshot.flow.flowPath) {
    throw new Error(
      `coordinated close must be invoked on the primary flow ${declaration.primaryFlowPath}`,
    );
  }
  const memberFlowPaths = declaration.flows.map(({ flowPath }) => flowPath);
  const files = new Map<string, string>();
  const closingNow: string[] = [];
  const alreadyClosed: string[] = [];
  for (const member of declaration.flows) {
    const isPrimary = member.flowPath === declaration.primaryFlowPath;
    const memberSnapshot = isPrimary
      ? snapshot
      : await loadFlowSnapshot(context.worktreePath, member.flowPath);
    const memberLatest = memberSnapshot.latestEvent.marker;
    if (memberLatest.kind === 'closed') {
      // Idempotent set completion: an already-closed member satisfies its part of the
      // joint invariant; only the remainder is closed (in one commit).
      alreadyClosed.push(member.flowPath);
      continue;
    }
    let target: string;
    let previousEventId: string;
    let designEventId: string | null;
    if (isPrimary) {
      if (memberLatest.eventId !== approval.eventId) {
        throw new Error('primary flow latest event must be the coordinating approval');
      }
      const codeHead = (await runGit(context.repoRoot, ['rev-parse', 'HEAD^{commit}'])).stdout.trim();
      if (approval.headSha !== codeHead) {
        throw new Error(
          `approval HEAD is stale: approval=${approval.headSha} current=${codeHead}`,
        );
      }
      const state = await readPacketState(context.repoRoot, snapshot.flow.flowPath);
      if (!state || state.latestEventId !== approval.eventId) {
        throw new Error('sync the approval event before closing');
      }
      const matrixPath = path.join(
        packetRootFor(context.repoRoot, snapshot.flow.flowPath),
        'FINAL-WORKFLOW-MATRIX.md',
      );
      if (!(await stat(matrixPath).then(() => true, () => false))) {
        throw new Error('FINAL-WORKFLOW-MATRIX.md is missing from the durable packet');
      }
      const matrix = await readFile(matrixPath, 'utf8');
      if (/\|\s*(missing|partial|blocked)\s*\|/i.test(matrix)) {
        throw new Error('final workflow matrix contains an incomplete or blocked row');
      }
      const declaredTarget = approval.nextWriteTarget;
      if (!declaredTarget) {
        throw new Error('approval event has no close write target');
      }
      target = declaredTarget;
      previousEventId = approval.eventId;
      designEventId = state.designEventId;
    } else {
      if (!['implementation-report', 'remediation-report'].includes(memberLatest.kind)) {
        throw new Error(
          `${member.flowPath}: latest event is not a closeable implementation boundary (${memberLatest.kind})`,
        );
      }
      if (memberLatest.headSha !== member.approvedBoundarySha) {
        throw new Error(
          `${member.flowPath}: implementation boundary does not match the approved boundary`,
        );
      }
      if (memberLatest.sequence >= 9900) {
        throw new Error(`${member.flowPath}: no close sequence is available`);
      }
      const closeDirectory = '9900--cli--closed--r01';
      if (memberSnapshot.incompleteEventDirectories.includes(closeDirectory)) {
        throw new Error(`${member.flowPath}: close target collision: ${closeDirectory}`);
      }
      target = `${member.flowPath}/${closeDirectory}`;
      previousEventId = memberLatest.eventId;
      designEventId =
        [...memberSnapshot.events].reverse().find((event) => event.marker.kind === 'design')
          ?.marker.eventId ?? null;
    }
    const eventParts = parseEventDirectory(path.posix.basename(target));
    if (eventParts.kind !== 'closed' || eventParts.actor !== 'cli') {
      throw new Error(`close target is not a CLI close event: ${target}`);
    }
    const summary = `# Closed (coordinated)

- Flow: \`${member.flowPath}\`
- Goal: ${memberSnapshot.flow.goal}
- Joint approval: \`${approval.eventId}\` in \`${declaration.primaryFlowPath}\`
- Approved boundary: \`${member.approvedBoundarySha}\`
- Coordinated with: ${memberFlowPaths
      .filter((flowPath) => flowPath !== member.flowPath)
      .map((flowPath) => `\`${flowPath}\``)
      .join(', ')}

The append-only archive is closed under the joint-close invariant. No default-branch
write or PR was created by this command.
`;
    const marker: ProRoundtripEventComplete = {
      schemaVersion: 'vibe-pro-event-complete-v1',
      flowPath: member.flowPath,
      eventId: eventParts.eventId,
      sequence: eventParts.sequence,
      actor: 'cli',
      kind: 'closed',
      revision: eventParts.revision,
      previousEventId,
      supersedesEventId: null,
      protocolVersion: memberSnapshot.flow.protocol.version,
      designEventId,
      sprintId: null,
      repositoryFullName: memberSnapshot.flow.repository.fullName,
      codeBranch: memberSnapshot.flow.codeBranch,
      baseSha: memberSnapshot.flow.baseSha,
      headSha: member.approvedBoundarySha,
      disposition: 'closed',
      files: [{ path: 'SUMMARY.md', mediaType: 'text/markdown' }],
      limitations: memberLatest.limitations,
      createdAt: new Date().toISOString(),
      nextActor: 'none',
      nextWriteTarget: null,
      coordinatedWith: memberFlowPaths.filter((flowPath) => flowPath !== member.flowPath),
      ...(isPrimary
        ? {}
        : {
            authorizedByFlowPath: declaration.primaryFlowPath,
            authorizedByEventId: approval.eventId,
          }),
    };
    files.set(`${target}/SUMMARY.md`, summary);
    files.set(`${target}/COMPLETE.json`, `${JSON.stringify(marker, null, 2)}\n`);
    closingNow.push(member.flowPath);
  }

  if (closingNow.length === 0) {
    emit(runtime, {
      flowPath: snapshot.flow.flowPath,
      status: 'closed',
      coordinatedClose: { closed: [], alreadyClosed },
    });
    return;
  }
  // One append-only bridge commit closes every remaining member — all or none.
  const publication = await publishAdditions(files, 'docs(pro-go): close coordinated flows', {
    context,
  });
  const synced = await syncFlow(snapshot.flow.flowPath, { context });
  emit(runtime, {
    publication,
    flowPath: snapshot.flow.flowPath,
    status: 'closed',
    latestEventId: synced.state.latestEventId,
    coordinatedClose: { closed: closingNow, alreadyClosed },
  });
}

async function closeSingleFlow(
  runtime: ProRoundtripRuntime,
  context: WorktreeContext,
  snapshot: Awaited<ReturnType<typeof loadFlowSnapshot>>,
): Promise<void> {
  if (snapshot.latestEvent.marker.kind !== 'approval') {
    throw new Error('close requires the latest completed event to be a Pro approval');
  }
  const codeHead = (await runGit(context.repoRoot, ['rev-parse', 'HEAD^{commit}'])).stdout.trim();
  if (snapshot.latestEvent.marker.headSha !== codeHead) {
    throw new Error(
      `approval HEAD is stale: approval=${snapshot.latestEvent.marker.headSha} current=${codeHead}`,
    );
  }
  const state = await readPacketState(context.repoRoot, snapshot.flow.flowPath);
  if (!state || state.latestEventId !== snapshot.latestEvent.marker.eventId) {
    throw new Error('sync the approval event before closing');
  }
  const matrixPath = path.join(
    packetRootFor(context.repoRoot, snapshot.flow.flowPath),
    'FINAL-WORKFLOW-MATRIX.md',
  );
  if (!(await stat(matrixPath).then(() => true, () => false))) {
    throw new Error('FINAL-WORKFLOW-MATRIX.md is missing from the durable packet');
  }
  const matrix = await readFile(matrixPath, 'utf8');
  if (/\|\s*(missing|partial|blocked)\s*\|/i.test(matrix)) {
    throw new Error('final workflow matrix contains an incomplete or blocked row');
  }
  const target = snapshot.latestEvent.marker.nextWriteTarget;
  if (!target) {
    throw new Error('approval event has no close write target');
  }
  const eventDirectory = path.posix.basename(target);
  const eventParts = parseEventDirectory(eventDirectory);
  if (eventParts.kind !== 'closed' || eventParts.actor !== 'cli') {
    throw new Error(`approval next target is not a CLI close event: ${target}`);
  }
  const summary = `# Closed

- Flow: \`${snapshot.flow.flowPath}\`
- Goal: ${snapshot.flow.goal}
- Approved design: ${state.designEventId ? `\`${state.designEventId}\`` : 'audit flow'}
- Approved code HEAD: \`${codeHead}\`
- Approval event: \`${snapshot.latestEvent.marker.eventId}\`

The append-only archive is closed. No default-branch write or PR was created by this command.
`;
  const marker: ProRoundtripEventComplete = {
    schemaVersion: 'vibe-pro-event-complete-v1',
    flowPath: snapshot.flow.flowPath,
    eventId: eventParts.eventId,
    sequence: eventParts.sequence,
    actor: 'cli',
    kind: 'closed',
    revision: eventParts.revision,
    previousEventId: snapshot.latestEvent.marker.eventId,
    supersedesEventId: null,
    protocolVersion: snapshot.flow.protocol.version,
    designEventId: state.designEventId,
    sprintId: null,
    repositoryFullName: snapshot.flow.repository.fullName,
    codeBranch: snapshot.flow.codeBranch,
    baseSha: snapshot.flow.baseSha,
    headSha: codeHead,
    disposition: 'closed',
    files: [{ path: 'SUMMARY.md', mediaType: 'text/markdown' }],
    limitations: snapshot.latestEvent.marker.limitations,
    createdAt: new Date().toISOString(),
    nextActor: 'none',
    nextWriteTarget: null,
  };
  const files = new Map<string, string>([
    [`${target}/SUMMARY.md`, summary],
    [`${target}/COMPLETE.json`, `${JSON.stringify(marker, null, 2)}\n`],
  ]);
  const publication = await publishAdditions(files, 'docs(pro-go): close flow', {
    context,
  });
  const synced = await syncFlow(snapshot.flow.flowPath, { context });
  emit(runtime, {
    publication,
    flowPath: snapshot.flow.flowPath,
    status: 'closed',
    latestEventId: synced.state.latestEventId,
  });
}

async function confirmSkipCommand(
  args: ParsedArgs,
  runtime: ProRoundtripRuntime,
): Promise<void> {
  const repoRoot = await repositoryRoot(runtime);
  const mode = args.positionals[1] ?? 'status';
  if (mode === 'status') {
    const state = await readAutoPublishState(repoRoot);
    emit(runtime, {
      action: 'confirm-skip',
      mode,
      autoPublish: state.autoPublish,
      expired: state.expired,
      directive: state.directive,
    });
    return;
  }
  if (mode === 'on') {
    const reason = validateAutoPublishReason(
      getStringFlag(args, 'reason', 'user directive: skip per-publish confirmation') ?? '',
    );
    const rawDays = getStringFlag(args, 'days');
    const directive = await enableAutoPublish(repoRoot, {
      reason,
      ...(rawDays === undefined ? {} : { days: validateAutoPublishDays(rawDays) }),
    });
    emit(runtime, { action: 'confirm-skip', mode, autoPublish: true, directive });
    return;
  }
  if (mode === 'off') {
    const { directive, changed } = await disableAutoPublish(repoRoot);
    emit(runtime, { action: 'confirm-skip', mode, autoPublish: false, changed, directive });
    return;
  }
  throw new Error(`confirm-skip requires on, off, or status\n${usage()}`);
}

async function doctorCommand(runtime: ProRoundtripRuntime): Promise<void> {
  const inspection = await inspectBridgeWorktree(runtime.cwd);
  const checks: Array<{ id: string; status: 'ok' | 'fail' | 'manual'; detail: string }> = [];
  checks.push({
    id: 'bridge-branch',
    status: inspection.branchExists ? 'ok' : 'fail',
    detail: inspection.branchExists
      ? 'origin/vibe-pro-bridge exists'
      : 'branch creation requires explicit user authorization',
  });
  checks.push({
    id: 'worktree-ownership',
    status:
      inspection.worktreeExists === inspection.markerExists &&
      (inspection.clean === null || inspection.clean)
        ? 'ok'
        : 'fail',
    detail: `worktree=${inspection.worktreeExists} marker=${inspection.markerExists} clean=${inspection.clean}`,
  });
  try {
    const local = await loadLocalProtocol(inspection.repoRoot);
    checks.push({
      id: 'local-protocol',
      status: 'ok',
      detail: `${local.version} commonHarnessSha256=${local.commonHarnessSha256}`,
    });
  } catch (error) {
    checks.push({
      id: 'local-protocol',
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  checks.push({
    id: 'web-pro-m0',
    status: 'manual',
    detail:
      'Must be run in the actual Web Pro session: private repo read, non-default branch nested create, re-read/commit SHA, no default-branch/PR mutation, ~100 KiB UTF-8, sequential create convergence, confirmation UI.',
  });
  emit(runtime, {
    ok: checks.every(({ status }) => status !== 'fail'),
    checks,
  });
  if (checks.some(({ status }) => status === 'fail')) {
    runtime.setExitCode(1);
  }
}

export async function executeProRoundtrip(
  argv: string[],
  options: ProRoundtripExecutionOptions = {},
): Promise<void> {
  const runtime: ProRoundtripRuntime = {
    cwd: path.resolve(options.cwd ?? process.cwd()),
    context: options.preparedContext,
    writeOutput: options.writeOutput ?? output,
    setExitCode:
      options.setExitCode ??
      ((exitCode) => {
        process.exitCode = exitCode;
      }),
  };
  assertPreparedContext(runtime.cwd, runtime.context);
  const args = parseArgs(argv);
  const command = args.positionals[0] ?? 'go';
  if (command === 'help' || getBooleanFlag(args, 'help')) {
    emit(runtime, usage());
    return;
  }
  if (command === 'go') {
    await goCommand(args, runtime);
    return;
  }
  if (command === 'bootstrap') {
    await bootstrapCommand(args, runtime);
    return;
  }
  if (command === 'start') {
    await startCommand(args, runtime);
    return;
  }
  if (command === 'status') {
    await statusCommand(args, runtime);
    return;
  }
  if (command === 'sync') {
    await syncCommand(args, runtime);
    return;
  }
  if (command === 'brief') {
    await briefCommand(args, runtime);
    return;
  }
  if (command === 'report') {
    await reportCommand(args, runtime);
    return;
  }
  if (command === 'continue') {
    await continueCommand(args, runtime);
    return;
  }
  if (command === 'accept-review') {
    await acceptReviewCommand(args, runtime);
    return;
  }
  if (command === 'close') {
    await closeCommand(args, runtime);
    return;
  }
  if (command === 'confirm-skip') {
    await confirmSkipCommand(args, runtime);
    return;
  }
  if (command === 'doctor') {
    await doctorCommand(runtime);
    return;
  }
  throw new Error(`unknown command: ${command}\n${usage()}`);
}

async function main(): Promise<void> {
  await executeProRoundtrip(process.argv.slice(2));
}

runMain(main, import.meta.url);
