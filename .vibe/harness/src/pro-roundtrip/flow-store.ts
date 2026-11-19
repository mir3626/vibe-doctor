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
  validateCoordinatedCloseDeclaration,
  validateEventBinding,
  validateEventChain,
  validateEventRoster,
  validateFindingScopeDiscipline,
  validateFlowBinding,
  validateReviewAcceptance,
} from './contract.js';
import type {
  ProRoundtripContract,
  ProRoundtripEventComplete,
  ProRoundtripFindings,
  ProRoundtripFlow,
  ProRoundtripOperatorClose,
} from '../lib/schemas/pro-roundtrip.js';
import {
  ProRoundtripFindingsSchema,
  ProRoundtripOperatorCloseSchema,
} from '../lib/schemas/pro-roundtrip.js';
import { readGitObjects, runGit, runGitBinary } from './worktree.js';

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

export const OPERATOR_CLOSE_FILENAME = 'OPERATOR-CLOSE.json';

export interface OperatorCloseSnapshot {
  record: ProRoundtripOperatorClose;
  blob: ExactBlob;
  commitSha: string;
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

interface PinnedBridgeBlobReader {
  bridgeHeadSha: string;
  readExactBlob: (posixPath: string) => Promise<ExactBlob>;
  /** Paths below the prefetched directory; see PrefetchedDirectory. */
  listedPaths: string[] | null;
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

/**
 * readExactBlob's facts for many objects from one Git call (see readGitObjects). Only a record
 * that passes every check of the per-file path below is returned; anything else is left out
 * and read through that path, which reports the error it has always reported.
 */
async function readExactBlobsBatch(
  bridgeRoot: string,
  specs: readonly string[],
  maxContentBytes: number,
): Promise<Map<string, ExactBlob>> {
  const blobs = new Map<string, ExactBlob>();
  for (const [spec, record] of await readGitObjects(bridgeRoot, specs, maxContentBytes)) {
    if (record.type === 'blob' && record.bytes.length <= MAX_PACKET_FILE_BYTES) {
      blobs.set(spec, { blobSha: record.objectId, byteSize: record.bytes.length, bytes: record.bytes });
    }
  }
  return blobs;
}

const PREFETCH_MAX_BYTES = 4 * MAX_PACKET_FILE_BYTES;

interface PrefetchedDirectory {
  blobs: Map<string, ExactBlob>;
  /** Every path below the directory, or null when the listing cannot stand in for `ls-tree --name-only`. */
  paths: string[] | null;
}

/**
 * One listing and one batch call for everything below one directory of the pinned commit.
 * A blob the listing cannot vouch for, or a directory over the prefetch bound, is read through
 * the per-file path. The paths are offered only when each uses characters Git prints unquoted
 * and untrimmed, so they are exactly what the `ls-tree --name-only` calls would print.
 */
async function prefetchDirectory(
  bridgeRoot: string,
  commitSha: string,
  posixDirectory: string,
): Promise<PrefetchedDirectory> {
  const blobs = new Map<string, ExactBlob>();
  const listing = await runGit(
    bridgeRoot,
    ['ls-tree', '-r', '-l', '-z', commitSha, '--', `${posixDirectory}/`],
    true,
  );
  if (listing.exitCode !== 0) {
    return { blobs, paths: null };
  }
  const blobShaByPath = new Map<string, string>();
  const byteSizeBySha = new Map<string, number>();
  let paths: string[] | null = [];
  for (const entry of listing.stdout.split('\0').filter(Boolean)) {
    const match = /^\d+ ([a-z]+) ([a-f0-9]{40}) +(\d+|-)\t(.+)$/su.exec(entry);
    if (!match || !/^[A-Za-z0-9._/-]+$/u.test(match[4] ?? '')) {
      paths = null;
    }
    paths?.push(match?.[4] ?? '');
    if (match?.[1] === 'blob' && Number(match[3]) <= MAX_PACKET_FILE_BYTES) {
      blobShaByPath.set(match[4] ?? '', match[2] ?? '');
      byteSizeBySha.set(match[2] ?? '', Number(match[3]));
    }
  }
  const contentBytes = [...byteSizeBySha.values()].reduce((total, size) => total + size, 0);
  if (contentBytes <= PREFETCH_MAX_BYTES) {
    const read = await readExactBlobsBatch(bridgeRoot, [...byteSizeBySha.keys()], contentBytes);
    for (const [posixPath, blobSha] of blobShaByPath) {
      const blob = read.get(blobSha);
      if (blob?.blobSha === blobSha && blob.byteSize === byteSizeBySha.get(blobSha)) {
        blobs.set(posixPath, blob);
      }
    }
  }
  return { blobs, paths };
}

async function pinBridgeBlobReader(
  bridgeRoot: string,
  directory?: string,
): Promise<PinnedBridgeBlobReader> {
  const bridgeHeadSha = (await runGit(bridgeRoot, ['rev-parse', 'HEAD^{commit}'])).stdout.trim();
  const prefetched: PrefetchedDirectory = directory
    ? await prefetchDirectory(bridgeRoot, bridgeHeadSha, directory)
    : { blobs: new Map(), paths: null };
  const readExactBlob = async (posixPath: string): Promise<ExactBlob> => {
    const spec = `${bridgeHeadSha}:${posixPath}`;
    const known = prefetched.blobs.get(posixPath)
      ?? (await readExactBlobsBatch(bridgeRoot, [spec], MAX_PACKET_FILE_BYTES)).get(spec);
    if (known) {
      // Each read hands out its own bytes, as the per-file path does.
      return { ...known, bytes: Buffer.from(known.bytes) };
    }
    const blobSha = (await runGit(bridgeRoot, ['rev-parse', spec])).stdout.trim();
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
    const bytes = await runGitBinary(bridgeRoot, ['cat-file', 'blob', blobSha], MAX_PACKET_FILE_BYTES + 1);
    if (bytes.length !== declaredSize) {
      throw new Error(`pro roundtrip blob size mismatch: ${posixPath}`);
    }
    return { blobSha, byteSize: declaredSize, bytes };
  };
  return { bridgeHeadSha, readExactBlob, listedPaths: prefetched.paths };
}

async function readPinnedFlowDefinition(
  reader: PinnedBridgeBlobReader,
  normalizedFlowPath: string,
): Promise<{ flow: ProRoundtripFlow; flowBlob: ExactBlob }> {
  const flowBlob = await reader.readExactBlob(`${normalizedFlowPath}/FLOW.json`);
  const flow = parseFlowJson(decodeExactBlobText(flowBlob, `${normalizedFlowPath}/FLOW.json`));
  validateFlowBinding(flow);
  if (flow.flowPath !== normalizedFlowPath) {
    throw new Error('requested flow path does not match FLOW.json');
  }
  return { flow, flowBlob };
}

/**
 * Reads only the immutable FLOW.json authority at one pinned bridge commit. Auto-selection
 * uses this cheap boundary to exclude flows owned by another repository or code branch
 * before validating their complete event history. Explicit selection and matching flows
 * still pass through loadFlowSnapshot and therefore fail closed on any malformed event.
 */
export async function loadFlowDefinition(
  bridgeRoot: string,
  flowPath: string,
): Promise<ProRoundtripFlow> {
  const normalizedFlowPath = toPosixPath(flowPath);
  parseFlowPath(normalizedFlowPath);
  const reader = await pinBridgeBlobReader(bridgeRoot);
  return (await readPinnedFlowDefinition(reader, normalizedFlowPath)).flow;
}

export async function loadOperatorClose(
  bridgeRoot: string,
  flowPath: string,
  knownFlow?: ProRoundtripFlow,
): Promise<OperatorCloseSnapshot | null> {
  const normalizedFlowPath = toPosixPath(flowPath);
  parseFlowPath(normalizedFlowPath);
  const reader = await pinBridgeBlobReader(bridgeRoot);
  const flow = knownFlow ?? (
    await readPinnedFlowDefinition(reader, normalizedFlowPath)
  ).flow;
  const relativePath = `${normalizedFlowPath}/${OPERATOR_CLOSE_FILENAME}`;
  const history = (
    await runGit(
      bridgeRoot,
      ['log', '--format=%H', reader.bridgeHeadSha, '--', relativePath],
    )
  ).stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  if (history.length === 0) {
    // A path that exists at a commit has at least one history entry, so none means absent.
    return null;
  }
  const present = await runGit(
    bridgeRoot,
    ['cat-file', '-e', `${reader.bridgeHeadSha}:${relativePath}`],
    true,
  );
  if (present.exitCode !== 0) {
    throw new Error(`operator close record was removed from the append-only bridge: ${relativePath}`);
  }

  const blob = await reader.readExactBlob(relativePath);
  let record: ProRoundtripOperatorClose;
  try {
    record = ProRoundtripOperatorCloseSchema.parse(
      JSON.parse(decodeExactBlobText(blob, relativePath)) as unknown,
    );
  } catch (error) {
    throw new Error(
      `invalid operator close record ${relativePath}: ${
        error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    record.flowPath !== flow.flowPath ||
    record.repositoryFullName !== flow.repository.fullName ||
    record.codeBranch !== flow.codeBranch ||
    record.baseSha !== flow.baseSha
  ) {
    throw new Error(`operator close binding does not match FLOW.json: ${relativePath}`);
  }

  if (history.length !== 1 || !/^[0-9a-f]{40}$/.test(history[0] ?? '')) {
    throw new Error(`operator close record is not one immutable addition: ${relativePath}`);
  }
  const commitSha = history[0] ?? '';
  const changes = (
    await runGit(bridgeRoot, [
      'diff-tree',
      '--no-commit-id',
      '--name-status',
      '-r',
      commitSha,
    ])
  ).stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  if (changes.length !== 1 || changes[0] !== `A\t${relativePath}`) {
    throw new Error(`operator close commit is not an isolated append: ${relativePath}`);
  }
  const parentSha = (
    await runGit(bridgeRoot, ['rev-parse', `${commitSha}^`])
  ).stdout.trim();
  if (parentSha !== record.sourceBridgeSha) {
    throw new Error(
      `operator close source bridge mismatch: record=${record.sourceBridgeSha} parent=${parentSha}`,
    );
  }
  const flowAtSource = await runGit(
    bridgeRoot,
    ['cat-file', '-e', `${record.sourceBridgeSha}:${normalizedFlowPath}/FLOW.json`],
    true,
  );
  if (flowAtSource.exitCode !== 0) {
    throw new Error(`operator close source does not contain FLOW.json: ${relativePath}`);
  }
  const flowBlobAtSource = (
    await runGit(
      bridgeRoot,
      ['rev-parse', `${record.sourceBridgeSha}:${normalizedFlowPath}/FLOW.json`],
    )
  ).stdout.trim();
  const flowBlobAtHead = (
    await runGit(
      bridgeRoot,
      ['rev-parse', `${reader.bridgeHeadSha}:${normalizedFlowPath}/FLOW.json`],
    )
  ).stdout.trim();
  if (flowBlobAtSource !== flowBlobAtHead) {
    throw new Error(`operator-closed FLOW.json changed after terminal publication: ${relativePath}`);
  }
  return { record, blob, commitSha };
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
  const { bridgeHeadSha, readExactBlob, listedPaths } = await pinBridgeBlobReader(bridgeRoot, normalizedFlowPath);
  const readBlobText = async (posixPath: string, label = posixPath): Promise<string> =>
    decodeExactBlobText(await readExactBlob(posixPath), label);
  const { flow, flowBlob } = await readPinnedFlowDefinition(
    { bridgeHeadSha, readExactBlob, listedPaths },
    normalizedFlowPath,
  );

  // Event directories and every payload byte come from the pinned commit's tree.
  const listTree = async (posixDirectory: string, recursive: boolean): Promise<string[]> =>
    listedPaths
      ? [...new Set(listedPaths
        .filter((posixPath) => posixPath.startsWith(posixDirectory))
        .map((posixPath) => (recursive
          ? posixPath
          : posixDirectory + (posixPath.slice(posixDirectory.length).split('/')[0] ?? ''))))]
      : (await runGit(bridgeRoot, [
        'ls-tree', ...(recursive ? ['-r'] : []), '--name-only', bridgeHeadSha, posixDirectory,
      ])).stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  const eventDirectoryNames = (await listTree(`${normalizedFlowPath}/`, false))
    .map((line) => line.slice(normalizedFlowPath.length + 1))
    .filter((name) => name.length > 0 && !name.includes('/'))
    .sort();
  const listEventFiles = async (eventName: string): Promise<string[]> =>
    (await listTree(`${normalizedFlowPath}/${eventName}/`, true))
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
    if (marker.kind === 'approval') {
      validateCoordinatedCloseDeclaration(marker);
    }
    if (marker.kind === 'closed' && marker.authorizedByEventId && marker.authorizedByFlowPath) {
      // By-reference close: the authorization lives in the primary flow's approval.
      // Read that approval from the SAME pinned bridge commit (never the worktree) and
      // require it to declare this flow as a member at this exact boundary.
      const referenceLabel = `${marker.authorizedByFlowPath}/${marker.authorizedByEventId}/COMPLETE.json`;
      let approval: ProRoundtripEventComplete;
      try {
        approval = parseEventCompleteJson(await readBlobText(referenceLabel));
      } catch (error) {
        throw new Error(
          `${marker.eventId}: cannot resolve authorizing approval ${referenceLabel}: ${
            error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (
        approval.kind !== 'approval' ||
        approval.eventId !== marker.authorizedByEventId ||
        approval.flowPath !== marker.authorizedByFlowPath
      ) {
        throw new Error(`${marker.eventId}: referenced event is not the declared approval`);
      }
      validateCoordinatedCloseDeclaration(approval);
      const declaration = approval.coordinatedClose;
      if (!declaration) {
        throw new Error(`${marker.eventId}: referenced approval declares no coordinatedClose`);
      }
      const member = declaration.flows.find((entry) => entry.flowPath === flow.flowPath);
      if (!member) {
        throw new Error(`${marker.eventId}: this flow is not a member of the referenced coordination set`);
      }
      if (member.approvedBoundarySha !== marker.headSha) {
        throw new Error(`${marker.eventId}: close HEAD does not match the approved boundary`);
      }
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
  let previousCompletedEvent: CompletedEvent | undefined;
  for (const event of events) {
    if (event.contract) {
      activeContract = event.contract;
    }
    if (event.marker.kind === 'approval') {
      validateReviewAcceptance(
        event.marker,
        previousCompletedEvent?.marker,
        previousCompletedEvent?.findings?.findings,
      );
    }
    if (event.findings) {
      // Finding-scope discipline is armed by the ACTIVE design as of this feedback
      // event, so historical findings recorded before a productPlane existed stay valid.
      validateFindingScopeDiscipline(
        event.findings.findings,
        activeContract?.productPlane,
      );
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
    previousCompletedEvent = event;
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
