import { createHash } from 'node:crypto';
import { HASH_PROFILE_ORDERED_JSON_V1, hashWithProfile } from '../universal-integrity-core/index.js';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { MAX_PACKET_FILE_BYTES, readFlowFileOnce } from './contract.js';
import path from 'node:path';
import {
  ProRoundtripReportInputSchema,
  type ProRoundtripContract,
  type ProRoundtripEventComplete,
  type ProRoundtripReportInput,
} from '../lib/schemas/pro-roundtrip.js';
import { auditAppendOnlyRange } from './git-branch-transport.js';
import { loadFlowSnapshot, resolveFlowPath, type FlowSnapshot } from './flow-store.js';
import { verifyPinnedProtocol } from './protocol.js';
import {
  prepareBridgeWorktree,
  runGit,
  type WorktreeContext,
} from './worktree.js';

export interface EventReceipt {
  eventId: string;
  sourceBridgeCommitSha: string;
  /**
   * The event's COMPLETE.json blob identity — copied byte-exactly (r10 FND-024).
   * Required in packet-state v2; absent in legacy v1 receipts written before the
   * control-document guarantee existed (prior evidence is never rewritten, INV-014).
   */
  markerBlobSha?: string;
  payloadBlobs: Array<{ path: string; gitBlobSha: string }>;
}

export interface RoundtripPacketState {
  /**
   * r10 FND-024: v2 packets bind the control-document blob identities. v1 packets remain
   * historical-readable exactly as written; every NEW write is v2.
   */
  schemaVersion: 'vibe-pro-packet-state-v1' | 'vibe-pro-packet-state-v2';
  flowPath: string;
  lastAcknowledgedBridgeSha: string;
  designEventId: string | null;
  currentSprintId: string | null;
  codeHeadSha: string;
  latestEventId: string;
  latestEventKind: ProRoundtripEventComplete['kind'];
  /** The FLOW.json blob identity this packet was copied from (r10 FND-024; v2 only). */
  flowBlobSha?: string;
  eventReceipts: EventReceipt[];
  briefRequiredEventIds?: string[];
  updatedAt: string;
}

export interface ProActiveFlowState {
  schemaVersion: 'vibe-pro-active-flow-v1';
  flowPath: string;
  repositoryFullName: string;
  codeBranch: string;
  baseSha: string;
  designEventId: string | null;
  currentSprintId: string | null;
  sprintIds: string[];
  latestEventId: string;
  latestEventKind: ProRoundtripEventComplete['kind'];
  nextActor: ProRoundtripEventComplete['nextActor'];
  nextWriteTarget: string | null;
  autoReportRequired: boolean;
  status: 'active' | 'closed';
  updatedAt: string;
}

export interface SyncResult {
  snapshot: FlowSnapshot;
  packetRoot: string;
  state: RoundtripPacketState;
  importedEventIds: string[];
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export function packetRootFor(repoRoot: string, flowPath: string): string {
  const [, date, flowName] = flowPath.split('/');
  if (!date || !flowName) {
    throw new Error(`invalid packet flow path: ${flowPath}`);
  }
  return path.join(repoRoot, '.vibe', 'agent', 'pro-roundtrip', date, flowName);
}

export function activeFlowPathFor(repoRoot: string): string {
  return path.join(repoRoot, '.vibe', 'agent', 'pro-roundtrip', 'ACTIVE.json');
}

export async function writeTextAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, filePath);
}

/** r04 FND-022: atomically write EXACT raw bytes without any string round-tripping. */
export async function writeBytesAtomic(filePath: string, bytes: Buffer): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporary, bytes);
  await rename(temporary, filePath);
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readPacketState(
  repoRoot: string,
  flowPath: string,
): Promise<RoundtripPacketState | null> {
  const filePath = path.join(packetRootFor(repoRoot, flowPath), 'STATE.json');
  if (!(await exists(filePath))) {
    return null;
  }
  const parsed = JSON.parse((await readFlowFileOnce(
    path.dirname(filePath), path.basename(filePath), MAX_PACKET_FILE_BYTES, 'STATE.json',
  )).toString('utf8')) as RoundtripPacketState;
  const isV2 = parsed.schemaVersion === 'vibe-pro-packet-state-v2';
  if (
    (parsed.schemaVersion !== 'vibe-pro-packet-state-v1' && !isV2) ||
    parsed.flowPath !== flowPath ||
    !/^[0-9a-f]{40}$/.test(parsed.lastAcknowledgedBridgeSha) ||
    !/^[0-9a-f]{40}$/.test(parsed.codeHeadSha) ||
    !/^[0-9]{4}--(cli|codex|pro)--[a-z0-9][a-z0-9-]*--r[0-9]{2}$/.test(
      parsed.latestEventId,
    ) ||
    (parsed.designEventId !== null &&
      !/^[0-9]{4}--pro--design--r[0-9]{2}$/.test(parsed.designEventId)) ||
    (parsed.currentSprintId !== null && !/^SPR-[0-9]{3}$/.test(parsed.currentSprintId)) ||
    // r10 FND-024: v2 packets MUST bind the FLOW.json blob identity.
    (isV2 && !/^[0-9a-f]{40}$/.test(parsed.flowBlobSha ?? '')) ||
    !Array.isArray(parsed.eventReceipts) ||
    (parsed.briefRequiredEventIds !== undefined &&
      (!Array.isArray(parsed.briefRequiredEventIds) ||
        new Set(parsed.briefRequiredEventIds).size !== parsed.briefRequiredEventIds.length ||
        parsed.briefRequiredEventIds.some(
          (eventId) =>
            typeof eventId !== 'string' ||
            !/^[0-9]{4}--(cli|codex|pro)--[a-z0-9][a-z0-9-]*--r[0-9]{2}$/.test(eventId),
        )))
  ) {
    throw new Error(`invalid local packet state: ${filePath}`);
  }
  const receiptIds = new Set<string>();
  for (const receipt of parsed.eventReceipts) {
    if (
      receiptIds.has(receipt.eventId) ||
      !/^[0-9a-f]{40}$/.test(receipt.sourceBridgeCommitSha) ||
      // r10 FND-024: a receipt records what was verified AT IMPORT TIME. Receipts
      // created by this code always bind the COMPLETE.json blob identity (and
      // copyImportedEvent fails closed on any mismatch before publication); receipts
      // carried over from imports that predate the guarantee legitimately lack it and
      // are never rewritten (INV-014). Validate the format whenever the field exists.
      (receipt.markerBlobSha !== undefined &&
        !/^[0-9a-f]{40}$/.test(receipt.markerBlobSha)) ||
      !Array.isArray(receipt.payloadBlobs) ||
      receipt.payloadBlobs.some(
        (blob) =>
          typeof blob.path !== 'string' ||
          !/^[0-9a-f]{40}$/.test(blob.gitBlobSha),
      )
    ) {
      throw new Error(`invalid local event receipt: ${filePath}`);
    }
    receiptIds.add(receipt.eventId);
  }
  if (!receiptIds.has(parsed.latestEventId)) {
    throw new Error(`local packet latest event has no immutable receipt: ${filePath}`);
  }
  return parsed;
}

export async function readActiveFlowState(
  repoRoot: string,
): Promise<ProActiveFlowState | null> {
  const filePath = activeFlowPathFor(repoRoot);
  if (!(await exists(filePath))) {
    return null;
  }
  const parsed = JSON.parse((await readFlowFileOnce(
    path.dirname(filePath), path.basename(filePath), MAX_PACKET_FILE_BYTES, 'active flow state',
  )).toString('utf8')) as ProActiveFlowState;
  if (
    parsed.schemaVersion !== 'vibe-pro-active-flow-v1' ||
    typeof parsed.flowPath !== 'string' ||
    typeof parsed.repositoryFullName !== 'string' ||
    typeof parsed.codeBranch !== 'string' ||
    !/^[0-9a-f]{40}$/.test(parsed.baseSha) ||
    !Array.isArray(parsed.sprintIds) ||
    !['active', 'closed'].includes(parsed.status)
  ) {
    throw new Error(`invalid active Pro flow state: ${filePath}`);
  }
  return parsed;
}

function renderSprintEnvelope(
  flowPath: string,
  designEventId: string,
  contract: ProRoundtripContract,
  sprint: ProRoundtripContract['sprints'][number],
  previousEvidence: string[],
): string {
  return `# ${sprint.id}: ${sprint.objective}

## Binding

- Flow: \`${flowPath}\`
- Design event: \`${designEventId}\`
- Sprint: \`${sprint.id}\`

## Contract scope

- Owns: ${sprint.owns.map((id) => `\`${id}\``).join(', ')}
- Preserves: ${sprint.preserves.map((id) => `\`${id}\``).join(', ')}
- Workflows affected: ${sprint.workflowsAffected.map((id) => `\`${id}\``).join(', ')}
- Depends on: ${sprint.dependsOn.length > 0 ? sprint.dependsOn.map((id) => `\`${id}\``).join(', ') : 'none'}

## Previous evidence

${previousEvidence.length > 0 ? previousEvidence.map((item) => `- ${item}`).join('\n') : '- none'}

## Allowed scope

${sprint.filesLikelyTouched.length > 0 ? sprint.filesLikelyTouched.map((item) => `- ${item}`).join('\n') : '- derive the minimum scope from the design'}

## Non-goals

${sprint.nonGoals.map((item) => `- ${item}`).join('\n')}

## Verification

${sprint.verification.map((item) => `- ${item}`).join('\n')}

## Cumulative integration gate

${sprint.cumulativeIntegrationChecks.map((item) => `- ${item}`).join('\n')}

## Blocked handling

Stop rather than broadening scope. Record the blocked item, reason, and required scope expansion.
Bind every checkpoint to this design event, Sprint ID, and the exact code HEAD.
`;
}

async function eventReceipt(
  worktreePath: string,
  snapshot: FlowSnapshot,
  event: FlowSnapshot['events'][number],
): Promise<EventReceipt> {
  const markerRelative = `${snapshot.flow.flowPath}/${event.directory}/COMPLETE.json`;
  const commit = await runGit(worktreePath, [
    'log',
    '-1',
    '--format=%H',
    'HEAD',
    '--',
    markerRelative,
  ]);
  const sourceBridgeCommitSha = commit.stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(sourceBridgeCommitSha)) {
    throw new Error(`${event.marker.eventId}: cannot resolve source bridge commit`);
  }
  const markerBlob = await runGit(worktreePath, [
    'rev-parse',
    `${sourceBridgeCommitSha}:${markerRelative}`,
  ]);
  const markerBlobSha = markerBlob.stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(markerBlobSha)) {
    throw new Error(`${event.marker.eventId}: cannot resolve COMPLETE.json blob identity`);
  }
  const payloadBlobs = [];
  for (const file of event.marker.files) {
    const relativePath = `${snapshot.flow.flowPath}/${event.directory}/${file.path}`;
    const blob = await runGit(worktreePath, [
      'rev-parse',
      `${sourceBridgeCommitSha}:${relativePath}`,
    ]);
    payloadBlobs.push({ path: file.path, gitBlobSha: blob.stdout.trim() });
  }
  return { eventId: event.marker.eventId, sourceBridgeCommitSha, markerBlobSha, payloadBlobs };
}

async function copyImportedEvent(
  packetRoot: string,
  event: FlowSnapshot['events'][number],
  receipt: EventReceipt,
): Promise<void> {
  const targetRoot = path.join(packetRoot, 'events', event.directory);
  const receiptBlobs = new Map(receipt.payloadBlobs.map((blob) => [blob.path, blob.gitBlobSha]));
  for (const file of event.marker.files) {
    const target = path.join(targetRoot, ...file.path.split('/'));
    // r08 FND-019 / r04 FND-022: the bridge event payload is copied as the EXACT raw
    // blob bytes from the snapshot's pinned bridge commit (no string round-trip), and the
    // copied blob SHA must equal the receipt's blob SHA — a disagreement between the
    // accessor blob and the receipted blob fails before packet publication.
    const exact = await event.readPayloadExact(file.path);
    if (exact.blobSha !== receiptBlobs.get(file.path)) {
      throw new Error(`${event.marker.eventId}: payload blob identity disagrees with the receipt: ${file.path}`);
    }
    await writeBytesAtomic(target, exact.bytes);
  }
  // r10 FND-024: COMPLETE.json is a CONTROL DOCUMENT — copy its exact pinned blob bytes
  // (never a re-serialization of the parsed marker) and require the copied blob identity
  // to equal the receipted one before any state/receipt publication.
  if (event.markerBlob.blobSha !== receipt.markerBlobSha) {
    throw new Error(`${event.marker.eventId}: COMPLETE.json blob identity disagrees with the receipt`);
  }
  await writeBytesAtomic(path.join(targetRoot, 'COMPLETE.json'), event.markerBlob.bytes);
}

function latestDesign(snapshot: FlowSnapshot): FlowSnapshot['events'][number] | undefined {
  return [...snapshot.events].reverse().find((event) => event.marker.kind === 'design');
}

function currentSprintId(
  contract: ProRoundtripContract | undefined,
  packetRoot: string,
): Promise<string | null> | string | null {
  if (!contract) {
    return null;
  }
  return (async () => {
    for (const sprint of contract.sprints) {
      const checkpoint = path.join(packetRoot, 'sprints', `${sprint.id}-${sprint.slug}`, 'CHECKPOINT.json');
      if (!(await exists(checkpoint))) {
        return sprint.id;
      }
    }
    return null;
  })();
}

function requiresExactCurrentHead(kind: ProRoundtripEventComplete['kind']): boolean {
  return ['design', 'feedback', 'approval'].includes(kind);
}

async function validateImmutableFlowHistory(
  worktreePath: string,
  snapshot: FlowSnapshot,
): Promise<void> {
  const requiredPaths = new Set<string>([
    `${snapshot.flow.flowPath}/FLOW.json`,
    ...snapshot.events.flatMap((event) => [
      ...event.marker.files.map(
        (file) => `${snapshot.flow.flowPath}/${event.directory}/${file.path}`,
      ),
      `${snapshot.flow.flowPath}/${event.directory}/COMPLETE.json`,
    ]),
  ]);
  const history = await runGit(worktreePath, [
    'log',
    '--format=',
    '--name-status',
    '--find-renames',
    'HEAD',
    '--',
    snapshot.flow.flowPath,
  ]);
  const entriesByPath = new Map<string, string[]>();
  for (const entry of history.stdout.trim().split(/\r?\n/).filter(Boolean)) {
    const [, ...changedPaths] = entry.split('\t');
    for (const changedPath of changedPaths) {
      if (!requiredPaths.has(changedPath)) {
        continue;
      }
      const entries = entriesByPath.get(changedPath) ?? [];
      entries.push(entry);
      entriesByPath.set(changedPath, entries);
    }
  }
  for (const relativePath of requiredPaths) {
    const entries = entriesByPath.get(relativePath) ?? [];
    const expected = `A\t${relativePath}`;
    if (entries.length !== 1 || entries[0] !== expected) {
      throw new Error(
        `append-only history violation: ${relativePath}; history=${entries.join('|') || '<none>'}`,
      );
    }
  }
}

export async function syncFlow(
  requestedFlow?: string,
  options: { cwd?: string; context?: WorktreeContext } = {},
): Promise<SyncResult> {
  const context = options.context ?? await prepareBridgeWorktree(options.cwd);
  const flowPath = await resolveFlowPath(context.worktreePath, requestedFlow);
  const previousState = await readPacketState(context.repoRoot, flowPath);
  if (previousState && previousState.lastAcknowledgedBridgeSha !== context.remoteTip) {
    const ancestor = await runGit(
      context.worktreePath,
      [
        'merge-base',
        '--is-ancestor',
        previousState.lastAcknowledgedBridgeSha,
        context.remoteTip,
      ],
      true,
    );
    if (ancestor.exitCode !== 0) {
      throw new Error('bridge history was rewritten after the last acknowledged commit');
    }
    const audit = await auditAppendOnlyRange(
      context.worktreePath,
      previousState.lastAcknowledgedBridgeSha,
      context.remoteTip,
      flowPath,
    );
    if (!audit.ok) {
      throw new Error(
        `append-only audit failed: ${audit.violations
          .map(({ status, path: filePath }) => `${status}:${filePath}`)
          .join(', ')}`,
      );
    }
  }

  const snapshot = await loadFlowSnapshot(context.worktreePath, flowPath);
  await validateImmutableFlowHistory(context.worktreePath, snapshot);
  await verifyPinnedProtocol(context.repoRoot, context.worktreePath, snapshot.flow.protocol);
  const codeBranch = (await runGit(context.repoRoot, ['branch', '--show-current'])).stdout.trim();
  const codeHeadSha = (await runGit(context.repoRoot, ['rev-parse', 'HEAD^{commit}'])).stdout.trim();
  if (codeBranch !== snapshot.flow.codeBranch) {
    throw new Error(
      `code branch mismatch: flow=${snapshot.flow.codeBranch} current=${codeBranch || '<detached>'}`,
    );
  }
  if (
    requiresExactCurrentHead(snapshot.latestEvent.marker.kind) &&
    previousState?.latestEventId !== snapshot.latestEvent.marker.eventId &&
    snapshot.latestEvent.marker.headSha !== codeHeadSha
  ) {
    throw new Error(
      `stale reviewed HEAD: event=${snapshot.latestEvent.marker.headSha} current=${codeHeadSha}`,
    );
  }

  const packetRoot = packetRootFor(context.repoRoot, flowPath);
  const knownReceipts = new Map(
    (previousState?.eventReceipts ?? []).map((receipt) => [receipt.eventId, receipt]),
  );
  const importedEventIds: string[] = [];
  for (const event of snapshot.events) {
    if (!knownReceipts.has(event.marker.eventId)) {
      const receipt = await eventReceipt(context.worktreePath, snapshot, event);
      // r04 FND-022: copy the EXACT raw blob bytes and require every copied blob SHA to
      // equal the receipt's blob SHA before the receipt is recorded — the bytes
      // validated, the bytes copied, and the bytes receipted are one and the same.
      await copyImportedEvent(packetRoot, event, receipt);
      knownReceipts.set(
        event.marker.eventId,
        receipt,
      );
      importedEventIds.push(event.marker.eventId);
    }
  }
  // r10 FND-024: FLOW.json is a CONTROL DOCUMENT — the packet carries its exact pinned
  // blob bytes, and the packet state receipts that blob identity.
  await writeBytesAtomic(path.join(packetRoot, 'FLOW.json'), snapshot.flowBlob.bytes);

  const design = latestDesign(snapshot);
  const contract = design?.contract;
  if (design && contract) {
    const previousEvidence: string[] = [];
    for (const sprint of contract.sprints) {
      const sprintRoot = path.join(packetRoot, 'sprints', `${sprint.id}-${sprint.slug}`);
      await writeTextAtomic(
        path.join(sprintRoot, 'SPRINT.md'),
        renderSprintEnvelope(
          flowPath,
          design.marker.eventId,
          contract,
          sprint,
          previousEvidence,
        ),
      );
      previousEvidence.push(`${sprint.id} checkpoint at sprints/${sprint.id}-${sprint.slug}`);
    }
  }

  const nextSprintId = await currentSprintId(contract, packetRoot);
  // Only events imported after this feature arms them. Previously receipted events remain
  // exempt, while a from-scratch import conservatively arms every imported Pro document.
  const importedEventIdSet = new Set(importedEventIds);
  const newlyRequiredBriefEventIds = snapshot.events
    .filter(
      ({ marker }) =>
        importedEventIdSet.has(marker.eventId) &&
        marker.actor === 'pro' &&
        (marker.kind === 'design' || marker.kind === 'feedback'),
    )
    .map(({ marker }) => marker.eventId);
  const briefRequiredEventIds = [
    ...new Set([
      ...(previousState?.briefRequiredEventIds ?? []),
      ...newlyRequiredBriefEventIds,
    ]),
  ].sort();
  const state: RoundtripPacketState = {
    schemaVersion: 'vibe-pro-packet-state-v2',
    flowPath,
    lastAcknowledgedBridgeSha: context.remoteTip,
    designEventId: design?.marker.eventId ?? null,
    currentSprintId: nextSprintId,
    codeHeadSha,
    latestEventId: snapshot.latestEvent.marker.eventId,
    latestEventKind: snapshot.latestEvent.marker.kind,
    flowBlobSha: snapshot.flowBlob.blobSha,
    eventReceipts: [...knownReceipts.values()],
    briefRequiredEventIds,
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(path.join(packetRoot, 'STATE.json'), state);
  await writeTextAtomic(
    path.join(packetRoot, 'HANDOFF.md'),
    `# Pro Go Handoff

- Flow: \`${flowPath}\`
- Latest completed event: \`${state.latestEventId}\`
- Design event: ${state.designEventId ? `\`${state.designEventId}\`` : 'none (audit flow)'}
- Current Sprint: ${state.currentSprintId ? `\`${state.currentSprintId}\`` : 'none'}
- Code HEAD: \`${state.codeHeadSha}\`
- Bridge HEAD: \`${state.lastAcknowledgedBridgeSha}\`
- Exact next action: ${snapshot.latestEvent.marker.nextActor} writes to \`${snapshot.latestEvent.marker.nextWriteTarget ?? 'none'}\`

Re-run \`npm run vibe:pro-go -- go ${flowPath}\` before continuing after a context switch.
`,
  );
  await writeJsonAtomic(activeFlowPathFor(context.repoRoot), {
    schemaVersion: 'vibe-pro-active-flow-v1',
    flowPath,
    repositoryFullName: snapshot.flow.repository.fullName,
    codeBranch: snapshot.flow.codeBranch,
    baseSha: snapshot.flow.baseSha,
    designEventId: state.designEventId,
    currentSprintId: state.currentSprintId,
    sprintIds: contract?.sprints.map(({ id }) => id) ?? [],
    latestEventId: state.latestEventId,
    latestEventKind: state.latestEventKind,
    nextActor: snapshot.latestEvent.marker.nextActor,
    nextWriteTarget: snapshot.latestEvent.marker.nextWriteTarget,
    autoReportRequired:
      snapshot.latestEvent.marker.nextActor === 'codex' &&
      ['design', 'feedback'].includes(snapshot.latestEvent.marker.kind),
    status: snapshot.latestEvent.marker.kind === 'closed' ? 'closed' : 'active',
    updatedAt: new Date().toISOString(),
  } satisfies ProActiveFlowState);
  return { snapshot, packetRoot, state, importedEventIds };
}

export async function readReportInput(filePath: string): Promise<ProRoundtripReportInput> {
  return ProRoundtripReportInputSchema.parse(JSON.parse((await readFlowFileOnce(
    path.dirname(filePath), path.basename(filePath), MAX_PACKET_FILE_BYTES, 'report evidence',
  )).toString('utf8')) as unknown);
}

// SPR-003 (universal-integrity-core): stableEvidenceHash is the shared ordered-json-v1
// profile — a compatibility wrapper preserving the exact historical bytes and name.
export function stableEvidenceHash(input: ProRoundtripReportInput): string {
  return hashWithProfile(HASH_PROFILE_ORDERED_JSON_V1, input);
}
