import { readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  MAX_PACKET_FILE_BYTES,
  readFlowFileOnce,
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
import { runGit, runGitBinary } from './worktree.js';

export interface CompletedEvent {
  directory: string;
  absoluteDirectory: string;
  marker: ProRoundtripEventComplete;
  /** Immutable payload reader bound to the snapshot's pinned bridge commit (r08 FND-019). */
  readPayload: (relativePosixPath: string) => Promise<Buffer>;
  /** Exact immutable blob record (raw bytes + object identity) for copy + receipt (r04 FND-022). */
  readPayloadExact: (relativePosixPath: string) => Promise<ExactBlob>;
  /** The event's COMPLETE.json exact blob — copied byte-exactly and receipted (r10 FND-024). */
  markerBlob: ExactBlob;
  contract?: ProRoundtripContract;
  findings?: ProRoundtripFindings;
}

export interface FlowSnapshot {
  root: string;
  /** The exact bridge commit every event byte of this snapshot was read from (r08 FND-019). */
  bridgeHeadSha: string;
  flow: ProRoundtripFlow;
  /** The flow-root FLOW.json exact blob — copied byte-exactly and receipted (r10 FND-024). */
  flowBlob: ExactBlob;
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

/** An exact immutable Git blob record (r04 FND-022): raw bytes plus their object identity. */
export interface ExactBlob {
  blobSha: string;
  byteSize: number;
  bytes: Buffer;
}

/**
 * r04 FND-022: fatal UTF-8 decode of exact blob bytes for text payloads. Invalid UTF-8
 * and NUL fail closed BEFORE any parse or copy; no replacement characters are ever
 * introduced.
 */
export function decodeExactBlobText(blob: ExactBlob, label: string): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(blob.bytes);
  } catch {
    throw new Error(`${label}: payload is not valid UTF-8`);
  }
  if (text.includes('\u0000')) {
    throw new Error(`${label}: payload contains NUL bytes`);
  }
  return text;
}

export async function loadFlowSnapshot(
  bridgeRoot: string,
  flowPath: string,
): Promise<FlowSnapshot> {
  const normalizedFlowPath = toPosixPath(flowPath);
  parseFlowPath(normalizedFlowPath);
  const root = path.join(bridgeRoot, ...normalizedFlowPath.split('/'));
  // r08 FND-019 / r04 FND-022: every event byte of the snapshot is read from the
  // IMMUTABLE Git object store at ONE pinned bridge commit through a BINARY-SAFE path —
  // the transport never trusts mutable worktree files, and blob bytes are preserved
  // exactly (the object SHA + declared size are verified; no UTF-8 normalization occurs
  // before validation, copy, or receipt binding).
  const bridgeHeadSha = (await runGit(bridgeRoot, ['rev-parse', 'HEAD^{commit}'])).stdout.trim();
  const readExactBlob = async (posixPath: string): Promise<ExactBlob> => {
    const spec = `${bridgeHeadSha}:${posixPath}`;
    // Resolve the exact blob object SHA and its declared byte size (bounded ASCII text).
    const blobSha = (await runGit(bridgeRoot, ['rev-parse', `${spec}`])).stdout.trim();
    if (!/^[a-f0-9]{40}$/u.test(blobSha)) {
      throw new Error(`pro roundtrip blob object is not a Git blob: ${posixPath}`);
    }
    const objectType = (await runGit(bridgeRoot, ['cat-file', '-t', blobSha])).stdout.trim();
    if (objectType !== 'blob') {
      throw new Error(`pro roundtrip object is not a blob: ${posixPath}`);
    }
    const declaredSize = Number((await runGit(bridgeRoot, ['cat-file', '-s', blobSha])).stdout.trim());
    if (!Number.isSafeInteger(declaredSize) || declaredSize < 0 || declaredSize > MAX_PACKET_FILE_BYTES) {
      throw new Error(`pro roundtrip blob exceeds the fixed byte bound: ${posixPath}`);
    }
    // Fetch the raw blob content through the binary path (never a text encoding).
    const bytes = await runGitBinary(bridgeRoot, ['cat-file', 'blob', blobSha], MAX_PACKET_FILE_BYTES + 1);
    if (bytes.length !== declaredSize) {
      throw new Error(`pro roundtrip blob size mismatch: ${posixPath}`);
    }
    return { blobSha, byteSize: declaredSize, bytes };
  };
  const readBlobText = async (posixPath: string, label = posixPath): Promise<string> =>
    decodeExactBlobText(await readExactBlob(posixPath), label);
  const flowBlob = await readExactBlob(`${normalizedFlowPath}/FLOW.json`);
  const flow = parseFlowJson(decodeExactBlobText(flowBlob, `${normalizedFlowPath}/FLOW.json`));
  validateFlowBinding(flow);
  if (flow.flowPath !== normalizedFlowPath) {
    throw new Error('requested flow path does not match FLOW.json');
  }

  // Event directories and every payload byte come from the pinned commit's tree.
  const treeListing = (await runGit(bridgeRoot, [
    'ls-tree', '--name-only', bridgeHeadSha, `${normalizedFlowPath}/`,
  ])).stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  const eventDirectoryNames = treeListing
    .map((line) => line.slice(normalizedFlowPath.length + 1))
    .filter((name) => name.length > 0 && !name.includes('/'))
    .sort();
  const listEventFiles = async (eventName: string): Promise<string[]> =>
    (await runGit(bridgeRoot, [
      'ls-tree', '-r', '--name-only', bridgeHeadSha, `${normalizedFlowPath}/${eventName}/`,
    ])).stdout.split('\n').map((line) => line.trim()).filter(Boolean)
      .map((line) => line.slice(`${normalizedFlowPath}/${eventName}/`.length))
      .filter((name) => name.length > 0 && name !== 'COMPLETE.json')
      .sort();
  const events: CompletedEvent[] = [];
  const incompleteEventDirectories: string[] = [];
  for (const entryName of eventDirectoryNames) {
    try {
      parseEventDirectory(entryName);
    } catch {
      continue;
    }
    const absoluteDirectory = path.join(root, entryName);
    const readPayloadExact = (relativePosixPath: string): Promise<ExactBlob> =>
      readExactBlob(`${normalizedFlowPath}/${entryName}/${relativePosixPath}`);
    // r04 FND-022: the roster validator consumes the RAW blob bytes (its own fatal UTF-8
    // check runs on exactly these bytes); the importer copies the same exact bytes.
    const readPayload = async (relativePosixPath: string): Promise<Buffer> =>
      (await readPayloadExact(relativePosixPath)).bytes;
    let markerBlob: ExactBlob;
    try {
      markerBlob = await readExactBlob(`${normalizedFlowPath}/${entryName}/COMPLETE.json`);
    } catch {
      incompleteEventDirectories.push(entryName);
      continue;
    }
    const marker = parseEventCompleteJson(
      decodeExactBlobText(markerBlob, `${normalizedFlowPath}/${entryName}/COMPLETE.json`),
    );
    validateEventBinding(flow, entryName, marker);
    await validateEventRoster(absoluteDirectory, marker, undefined, {
      list: () => listEventFiles(entryName),
      read: readPayload,
    });
    const completed: CompletedEvent = {
      directory: entryName,
      absoluteDirectory,
      marker,
      readPayload,
      readPayloadExact,
      markerBlob,
    };
    if (marker.kind === 'design') {
      const contract = parseContractJson(
        await readBlobText(`${normalizedFlowPath}/${entryName}/CONTRACT.json`),
      );
      validateContractSemantics(flow, marker, contract);
      completed.contract = contract;
    }
    if (marker.kind === 'feedback') {
      const findings = ProRoundtripFindingsSchema.parse(
        JSON.parse(await readBlobText(`${normalizedFlowPath}/${entryName}/FINDINGS.json`)) as unknown,
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
    bridgeHeadSha,
    flowBlob,
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
