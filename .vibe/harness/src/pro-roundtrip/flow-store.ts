import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  parseContractJson,
  parseEventCompleteJson,
  parseEventDirectory,
  parseFlowJson,
  parseFlowPath,
  toPosixPath,
  validateContractSemantics,
  validateEventBinding,
  validateEventChain,
  validateEventRoster,
  validateFlowBinding,
} from './contract.js';
import type {
  ProRoundtripContract,
  ProRoundtripEventComplete,
  ProRoundtripFindings,
  ProRoundtripFlow,
} from '../lib/schemas/pro-roundtrip.js';
import { ProRoundtripFindingsSchema } from '../lib/schemas/pro-roundtrip.js';

export interface CompletedEvent {
  directory: string;
  absoluteDirectory: string;
  marker: ProRoundtripEventComplete;
  contract?: ProRoundtripContract;
  findings?: ProRoundtripFindings;
}

export interface FlowSnapshot {
  root: string;
  flow: ProRoundtripFlow;
  events: CompletedEvent[];
  incompleteEventDirectories: string[];
  latestEvent: CompletedEvent;
}

export function slugifyGoal(goal: string): string {
  const slug = goal
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/-+$/, '');
  if (slug.length < 3) {
    throw new Error('goal cannot produce a visible ASCII slug; provide --slug with 3-60 characters');
  }
  return slug;
}

export function validateSlug(slug: string): string {
  const normalized = slug.toLowerCase();
  if (
    normalized.length < 3 ||
    normalized.length > 60 ||
    !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(normalized)
  ) {
    throw new Error('slug must be 3-60 lowercase ASCII kebab-case characters');
  }
  return normalized;
}

export function allocateDailyFlowPath(
  existingDirectoryNames: string[],
  date: string,
  slug: string,
): string {
  if (!/^[0-9]{8}$/.test(date)) {
    throw new Error(`invalid flow date: ${date}`);
  }
  const normalizedSlug = validateSlug(slug);
  let maximum = 0;
  for (const name of existingDirectoryNames) {
    const match = /^(?<sequence>[0-9]{3})-[a-z0-9][a-z0-9-]*$/.exec(name);
    if (match?.groups?.sequence) {
      maximum = Math.max(maximum, Number(match.groups.sequence));
    }
  }
  if (maximum >= 999) {
    throw new Error(`daily flow capacity exhausted for ${date}`);
  }
  return `flows/${date}/${String(maximum + 1).padStart(3, '0')}-${normalizedSlug}`;
}

export async function allocateFlowPath(
  bridgeRoot: string,
  date: string,
  slug: string,
): Promise<string> {
  const dateDirectory = path.join(bridgeRoot, 'flows', date);
  let names: string[] = [];
  try {
    names = (await readdir(dateDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw error;
    }
  }
  return allocateDailyFlowPath(names, date, slug);
}

export async function listFlowPaths(bridgeRoot: string): Promise<string[]> {
  const flowsRoot = path.join(bridgeRoot, 'flows');
  let dateEntries;
  try {
    dateEntries = await readdir(flowsRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const flows: string[] = [];
  for (const dateEntry of dateEntries) {
    if (!dateEntry.isDirectory() || !/^[0-9]{8}$/.test(dateEntry.name)) {
      continue;
    }
    const directories = await readdir(path.join(flowsRoot, dateEntry.name), {
      withFileTypes: true,
    });
    for (const directory of directories) {
      if (!directory.isDirectory()) {
        continue;
      }
      const candidate = `flows/${dateEntry.name}/${directory.name}`;
      try {
        parseFlowPath(candidate);
        flows.push(candidate);
      } catch {
        // Invalid directories are ignored here and surfaced when explicitly selected.
      }
    }
  }
  return flows.sort();
}

export async function resolveFlowPath(
  bridgeRoot: string,
  requested?: string,
): Promise<string> {
  if (requested) {
    const normalized = toPosixPath(requested);
    parseFlowPath(normalized);
    return normalized;
  }
  const flows = await listFlowPaths(bridgeRoot);
  const latest = flows.at(-1);
  if (!latest) {
    throw new Error('no roundtrip flow exists on vibe-pro-bridge');
  }
  return latest;
}

export async function loadFlowSnapshot(
  bridgeRoot: string,
  flowPath: string,
): Promise<FlowSnapshot> {
  const normalizedFlowPath = toPosixPath(flowPath);
  parseFlowPath(normalizedFlowPath);
  const root = path.join(bridgeRoot, ...normalizedFlowPath.split('/'));
  const flow = parseFlowJson(await readFile(path.join(root, 'FLOW.json'), 'utf8'));
  validateFlowBinding(flow);
  if (flow.flowPath !== normalizedFlowPath) {
    throw new Error('requested flow path does not match FLOW.json');
  }

  const entries = await readdir(root, { withFileTypes: true });
  const events: CompletedEvent[] = [];
  const incompleteEventDirectories: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    try {
      parseEventDirectory(entry.name);
    } catch {
      continue;
    }
    const absoluteDirectory = path.join(root, entry.name);
    let markerContent: string;
    try {
      markerContent = await readFile(path.join(absoluteDirectory, 'COMPLETE.json'), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        incompleteEventDirectories.push(entry.name);
        continue;
      }
      throw error;
    }
    const marker = parseEventCompleteJson(markerContent);
    validateEventBinding(flow, entry.name, marker);
    await validateEventRoster(absoluteDirectory, marker);
    const completed: CompletedEvent = {
      directory: entry.name,
      absoluteDirectory,
      marker,
    };
    if (marker.kind === 'design') {
      const contract = parseContractJson(
        await readFile(path.join(absoluteDirectory, 'CONTRACT.json'), 'utf8'),
      );
      validateContractSemantics(flow, marker, contract);
      completed.contract = contract;
    }
    if (marker.kind === 'feedback') {
      const findings = ProRoundtripFindingsSchema.parse(
        JSON.parse(await readFile(path.join(absoluteDirectory, 'FINDINGS.json'), 'utf8')) as unknown,
      );
      if (
        findings.flowPath !== flow.flowPath ||
        findings.eventId !== marker.eventId ||
        findings.reviewedHeadSha !== marker.headSha ||
        findings.disposition !== marker.disposition
      ) {
        throw new Error(`${marker.eventId}: FINDINGS.json binding does not match COMPLETE.json`);
      }
      const findingIds = findings.findings.map(({ id }) => id);
      if (new Set(findingIds).size !== findingIds.length) {
        throw new Error(`${marker.eventId}: duplicate finding ID`);
      }
      completed.findings = findings;
    }
    events.push(completed);
  }
  events.sort(
    (left, right) =>
      left.marker.sequence - right.marker.sequence ||
      left.marker.revision - right.marker.revision,
  );
  validateEventChain(events.map(({ marker }) => marker));
  let activeContract: ProRoundtripContract | undefined;
  for (const event of events) {
    if (event.contract) {
      activeContract = event.contract;
    }
    if (event.findings) {
      const contractIds = activeContract
        ? new Set([
            ...activeContract.requirements.map(({ id }) => id),
            ...activeContract.invariants.map(({ id }) => id),
            ...activeContract.workflows.map(({ id }) => id),
            ...activeContract.nonFunctionalRequirements.map(({ id }) => id),
          ])
        : new Set<string>();
      for (const finding of event.findings.findings) {
        if (!activeContract && finding.contractIds.length > 0) {
          throw new Error(`${finding.id}: audit finding cannot reference an absent contract`);
        }
        for (const contractId of finding.contractIds) {
          if (!contractIds.has(contractId)) {
            throw new Error(`${finding.id}: unknown contract ID ${contractId}`);
          }
        }
      }
    }
  }
  const latestEvent = events.at(-1);
  if (!latestEvent) {
    throw new Error(`${flowPath}: no valid completed events`);
  }
  return {
    root,
    flow,
    events,
    incompleteEventDirectories: incompleteEventDirectories.sort(),
    latestEvent,
  };
}

export function nextEventTarget(snapshot: FlowSnapshot): {
  actor: ProRoundtripEventComplete['nextActor'];
  target: string | null;
} {
  return {
    actor: snapshot.latestEvent.marker.nextActor,
    target: snapshot.latestEvent.marker.nextWriteTarget,
  };
}
