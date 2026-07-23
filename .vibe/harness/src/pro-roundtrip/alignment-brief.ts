import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  ProRoundtripAlignmentBriefSchema,
  type ProRoundtripAlignmentBrief,
  type ProRoundtripContract,
  type ProRoundtripEventComplete,
  type ProRoundtripFindings,
} from '../lib/schemas/pro-roundtrip.js';
import { MAX_PACKET_FILE_BYTES, readFlowFileOnce } from './contract.js';
import type { FlowSnapshot } from './flow-store.js';
import type { RoundtripPacketState } from './importer.js';

export function alignmentBriefPathsFor(
  packetRoot: string,
  eventId: string,
): { directory: string; briefJson: string; briefMd: string } {
  const directory = path.join(packetRoot, 'briefs', eventId);
  return {
    directory,
    briefJson: path.join(directory, 'BRIEF.json'),
    briefMd: path.join(directory, 'BRIEF.md'),
  };
}

export interface AlignmentBriefContext {
  event: ProRoundtripEventComplete;
  contract?: ProRoundtripContract;
  findings?: ProRoundtripFindings;
}

function rosterFor(ctx: AlignmentBriefContext): string[] {
  if (ctx.event.kind === 'design') {
    if (!ctx.contract) {
      return [];
    }
    return [
      ...ctx.contract.requirements.map(({ id }) => id),
      ...ctx.contract.invariants.map(({ id }) => id),
      ...ctx.contract.workflows.map(({ id }) => id),
      ...ctx.contract.nonFunctionalRequirements.map(({ id }) => id),
    ];
  }
  if (ctx.event.kind === 'feedback') {
    return ctx.findings?.findings.map(({ id }) => id) ?? [];
  }
  return [];
}

function setDifference(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((value) => !right.has(value)).sort();
}

export function validateAlignmentBrief(
  brief: ProRoundtripAlignmentBrief,
  ctx: AlignmentBriefContext,
): void {
  if (
    brief.flowPath !== ctx.event.flowPath ||
    brief.eventId !== ctx.event.eventId ||
    brief.eventKind !== ctx.event.kind
  ) {
    throw new Error(
      `alignment brief is not bound to ${ctx.event.flowPath}/${ctx.event.eventId}`,
    );
  }

  const entryIds = new Set<string>();
  for (const entry of brief.entries) {
    if (entryIds.has(entry.itemId)) {
      throw new Error(`duplicate brief entry: ${entry.itemId}`);
    }
    entryIds.add(entry.itemId);
  }

  const expectedIds = new Set(rosterFor(ctx));
  if (ctx.event.kind === 'design' || ctx.event.kind === 'feedback') {
    const missing = setDifference(expectedIds, entryIds);
    const extra = setDifference(entryIds, expectedIds);
    if (missing.length > 0 || extra.length > 0) {
      const subject =
        ctx.event.kind === 'design' ? 'every contract item exactly' : 'every finding exactly';
      throw new Error(
        `alignment brief must cover ${subject}; missing=${missing.join(',') || 'none'} extra=${extra.join(',') || 'none'}`,
      );
    }
  }

  if (ctx.contract?.intents) {
    const declaredIntentIds = new Set(ctx.contract.intents.map(({ id }) => id));
    for (const entry of brief.entries) {
      for (const intentId of entry.intentIds ?? []) {
        if (!declaredIntentIds.has(intentId)) {
          throw new Error(`${entry.itemId}: unknown intent ID ${intentId}`);
        }
      }
    }
  } else {
    for (const entry of brief.entries) {
      if (entry.intentIds !== undefined) {
        throw new Error(
          `${entry.itemId}: intent claims require the contract to declare intents`,
        );
      }
    }
  }

  const referencedItemIds = [
    ...brief.proposal.trim,
    ...brief.proposal.defer,
    ...brief.proposal.userDecisionNeeded,
    ...brief.decisions.rulings.map(({ itemId }) => itemId),
  ];
  for (const itemId of referencedItemIds) {
    if (!entryIds.has(itemId)) {
      throw new Error(
        `${itemId}: proposal or decision references an item outside this brief`,
      );
    }
  }

  if (brief.proposal.userDecisionNeeded.length > 0) {
    const ruledItemIds = new Set(brief.decisions.rulings.map(({ itemId }) => itemId));
    if (
      brief.decisions.confirmedBy !== 'user' ||
      brief.proposal.userDecisionNeeded.some((itemId) => !ruledItemIds.has(itemId))
    ) {
      throw new Error(
        `alignment brief gate: user decision pending for ${[...brief.proposal.userDecisionNeeded]
          .sort()
          .join(',')}`,
      );
    }
  }
  if (
    brief.proposal.recommendation === 'return-to-pro' &&
    brief.decisions.confirmedBy !== 'user'
  ) {
    throw new Error(
      'alignment brief proposes return-to-pro; a user ruling (decisions.confirmedBy) is required to proceed',
    );
  }
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

export async function readValidAlignmentBrief(
  packetRoot: string,
  ctx: AlignmentBriefContext,
): Promise<ProRoundtripAlignmentBrief> {
  const paths = alignmentBriefPathsFor(packetRoot, ctx.event.eventId);
  let briefBytes: Buffer;
  try {
    briefBytes = await readFlowFileOnce(
      paths.directory,
      'BRIEF.json',
      MAX_PACKET_FILE_BYTES,
      'alignment brief BRIEF.json',
    );
  } catch (error) {
    if (isMissingFile(error)) {
      throw new Error('brief is missing');
    }
    throw error;
  }
  const brief = ProRoundtripAlignmentBriefSchema.parse(
    JSON.parse(briefBytes.toString('utf8')) as unknown,
  );
  validateAlignmentBrief(brief, ctx);

  let briefMarkdown: string;
  try {
    briefMarkdown = (
      await readFlowFileOnce(
        paths.directory,
        'BRIEF.md',
        MAX_PACKET_FILE_BYTES,
        'alignment brief BRIEF.md',
      )
    ).toString('utf8');
  } catch (error) {
    if (isMissingFile(error)) {
      throw new Error(`alignment brief BRIEF.md is missing or empty: ${paths.briefMd}`);
    }
    throw error;
  }
  if (briefMarkdown.trim().length === 0) {
    throw new Error(`alignment brief BRIEF.md is missing or empty: ${paths.briefMd}`);
  }
  return brief;
}

function governingContext(snapshot: FlowSnapshot): AlignmentBriefContext {
  const event = snapshot.latestEvent;
  if (event.marker.kind === 'design') {
    return { event: event.marker, ...(event.contract ? { contract: event.contract } : {}) };
  }
  if (event.marker.kind === 'feedback') {
    const design = snapshot.events.find(
      ({ marker }) => marker.eventId === event.marker.designEventId,
    );
    return {
      event: event.marker,
      ...(design?.contract ? { contract: design.contract } : {}),
      ...(event.findings ? { findings: event.findings } : {}),
    };
  }
  return { event: event.marker };
}

function requiredEventId(
  snapshot: FlowSnapshot,
  state: RoundtripPacketState | null,
): string | null {
  const marker = snapshot.latestEvent.marker;
  if (
    marker.actor === 'pro' &&
    (marker.kind === 'design' || marker.kind === 'feedback') &&
    (state?.briefRequiredEventIds ?? []).includes(marker.eventId)
  ) {
    return marker.eventId;
  }
  return null;
}

export async function assertAlignmentBriefGate(
  packetRoot: string,
  snapshot: FlowSnapshot,
  state: RoundtripPacketState | null,
  commandName: string,
): Promise<void> {
  const eventId = requiredEventId(snapshot, state);
  if (!eventId) {
    return;
  }
  const paths = alignmentBriefPathsFor(packetRoot, eventId);
  try {
    await readValidAlignmentBrief(packetRoot, governingContext(snapshot));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `alignment brief gate: ${commandName} is blocked until a valid alignment brief exists for ${eventId}.\n` +
        `Expected: ${paths.briefJson} (+ BRIEF.md).\n` +
        `Run: npm run vibe:pro-go -- brief ${snapshot.flow.flowPath}  (prints the required item roster, declared intents, and a skeleton).\n` +
        `Detail: ${detail}`,
    );
  }
}

export interface AlignmentBriefStatus {
  requiredForEventId: string | null;
  status: 'not-required' | 'missing' | 'invalid' | 'valid';
  briefPath: string;
  detail: string;
}

export async function alignmentBriefStatus(
  packetRoot: string,
  snapshot: FlowSnapshot,
  state: RoundtripPacketState | null,
): Promise<AlignmentBriefStatus> {
  const eventId = requiredEventId(snapshot, state);
  const inspectedEventId = eventId ?? snapshot.latestEvent.marker.eventId;
  const briefPath = alignmentBriefPathsFor(packetRoot, inspectedEventId).briefJson;
  if (!eventId) {
    return {
      requiredForEventId: null,
      status: 'not-required',
      briefPath,
      detail: 'latest event does not require an alignment brief',
    };
  }
  try {
    await readValidAlignmentBrief(packetRoot, governingContext(snapshot));
    return {
      requiredForEventId: eventId,
      status: 'valid',
      briefPath,
      detail: 'alignment brief is valid',
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      requiredForEventId: eventId,
      status: detail === 'brief is missing' ? 'missing' : 'invalid',
      briefPath,
      detail,
    };
  }
}

export async function collectScopeRulings(packetRoot: string): Promise<string[]> {
  const briefsRoot = path.join(packetRoot, 'briefs');
  let directories: Dirent[];
  try {
    directories = await readdir(briefsRoot, { withFileTypes: true });
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    throw error;
  }

  const rulings: Array<{
    eventId: string;
    itemId: string;
    ruling: 'trim' | 'defer';
    note?: string;
  }> = [];
  for (const directory of directories.filter((entry) => entry.isDirectory())) {
    const bytes = await readFlowFileOnce(
      path.join(briefsRoot, directory.name),
      'BRIEF.json',
      MAX_PACKET_FILE_BYTES,
      'alignment brief BRIEF.json',
    );
    const brief = ProRoundtripAlignmentBriefSchema.parse(
      JSON.parse(bytes.toString('utf8')) as unknown,
    );
    if (brief.eventId !== directory.name) {
      throw new Error(
        `alignment brief eventId does not match its directory: ${directory.name}`,
      );
    }
    for (const ruling of brief.decisions.rulings) {
      if (ruling.ruling === 'trim' || ruling.ruling === 'defer') {
        rulings.push({
          eventId: brief.eventId,
          itemId: ruling.itemId,
          ruling: ruling.ruling,
          ...(ruling.note !== undefined ? { note: ruling.note } : {}),
        });
      }
    }
  }
  return rulings
    .sort(
      (left, right) =>
        left.eventId.localeCompare(right.eventId) ||
        left.itemId.localeCompare(right.itemId),
    )
    .map(
      ({ eventId, itemId, ruling, note }) =>
        `- ${eventId} ${itemId}: ${ruling}${note !== undefined ? ` — ${note}` : ''}`,
    );
}

export function alignmentBriefSkeleton(ctx: AlignmentBriefContext) {
  const contractHasIntents = Boolean(ctx.contract?.intents);
  const contractItems = ctx.contract
    ? [
        ...ctx.contract.requirements,
        ...ctx.contract.invariants,
        ...ctx.contract.workflows,
        ...ctx.contract.nonFunctionalRequirements,
      ]
    : [];
  const contractIntentIdsById = new Map(
    contractItems.map(({ id, intentIds }) => [id, intentIds] as const),
  );
  const findingsById = new Map(
    (ctx.findings?.findings ?? []).map((finding) => [finding.id, finding] as const),
  );
  const intentFieldsFor = (
    itemId: string,
  ): { intentIds: string[] } | { noIntentPath: true } => {
    if (!contractHasIntents) {
      return { noIntentPath: true };
    }
    if (ctx.event.kind === 'design') {
      const intentIds = contractIntentIdsById.get(itemId);
      if (!intentIds || intentIds.length === 0) {
        throw new Error(`${itemId}: intentIds are required when the contract declares intents`);
      }
      return { intentIds: [...intentIds] };
    }
    const intentIds = [
      ...new Set(
        (findingsById.get(itemId)?.contractIds ?? []).flatMap(
          (contractId) => contractIntentIdsById.get(contractId) ?? [],
        ),
      ),
    ].sort();
    return intentIds.length > 0 ? { intentIds } : { noIntentPath: true };
  };
  return {
    schemaVersion: 'vibe-pro-alignment-brief-v1',
    flowPath: ctx.event.flowPath,
    eventId: ctx.event.eventId,
    eventKind: ctx.event.kind,
    authoredAt: ctx.event.createdAt,
    entries: rosterFor(ctx).map((itemId) => ({
      itemId,
      classification: 'core',
      purpose: '<explain in user language>',
      ...intentFieldsFor(itemId),
    })),
    proposal: {
      recommendation: 'proceed',
      trim: [],
      defer: [],
      userDecisionNeeded: [],
    },
    decisions: {
      rulings: [],
      confirmedBy: null,
    },
  };
}
