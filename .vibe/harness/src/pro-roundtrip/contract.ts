import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  ProRoundtripContractSchema,
  ProRoundtripEventCompleteSchema,
  ProRoundtripFlowSchema,
  type ProRoundtripContract,
  type ProRoundtripEventComplete,
  type ProRoundtripFlow,
} from '../lib/schemas/pro-roundtrip.js';

export interface FlowPathParts {
  date: string;
  sequence: number;
  slug: string;
}

export interface EventPathParts {
  sequence: number;
  actor: ProRoundtripEventComplete['actor'];
  kind: ProRoundtripEventComplete['kind'];
  revision: number;
  eventId: string;
}

const flowPathPattern =
  /^flows\/(?<date>[0-9]{8})\/(?<sequence>[0-9]{3})-(?<slug>[a-z0-9][a-z0-9-]{1,58}[a-z0-9])$/;
const eventPathPattern =
  /^(?<sequence>[0-9]{4})--(?<actor>cli|codex|pro)--(?<kind>[a-z0-9][a-z0-9-]*)--r(?<revision>[0-9]{2})$/;
const allowedKinds = new Set<ProRoundtripEventComplete['kind']>([
  'goal',
  'design',
  'implementation-report',
  'feedback',
  'remediation-report',
  'approval',
  'closed',
]);
const sensitivePathPattern =
  /(^|\/)(\.env(?:\.|$)|.*(?:credential|secret|token|private[-_]?key).*)$/i;
const blockedExtensionPattern = /\.(?:p12|pfx|pem|key|der|keystore)$/i;

export function toPosixPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
}

export function parseFlowPath(value: string): FlowPathParts {
  const normalized = toPosixPath(value);
  const match = flowPathPattern.exec(normalized);
  if (!match?.groups) {
    throw new Error(`invalid flow path: ${value}`);
  }
  return {
    date: match.groups.date ?? '',
    sequence: Number(match.groups.sequence),
    slug: match.groups.slug ?? '',
  };
}

export function parseEventDirectory(value: string): EventPathParts {
  const name = path.posix.basename(toPosixPath(value));
  const match = eventPathPattern.exec(name);
  if (!match?.groups) {
    throw new Error(`invalid event directory: ${value}`);
  }
  const kind = match.groups.kind as ProRoundtripEventComplete['kind'];
  if (!allowedKinds.has(kind)) {
    throw new Error(`unsupported event kind: ${kind}`);
  }
  return {
    sequence: Number(match.groups.sequence),
    actor: match.groups.actor as ProRoundtripEventComplete['actor'],
    kind,
    revision: Number(match.groups.revision),
    eventId: name,
  };
}

export function parseFlowJson(content: string): ProRoundtripFlow {
  return ProRoundtripFlowSchema.parse(JSON.parse(content) as unknown);
}

export function parseContractJson(content: string): ProRoundtripContract {
  return ProRoundtripContractSchema.parse(JSON.parse(content) as unknown);
}

export function parseEventCompleteJson(content: string): ProRoundtripEventComplete {
  return ProRoundtripEventCompleteSchema.parse(JSON.parse(content) as unknown);
}

export function validateFlowBinding(flow: ProRoundtripFlow): void {
  const parts = parseFlowPath(flow.flowPath);
  if (
    parts.date !== flow.date ||
    parts.sequence !== flow.sequence ||
    parts.slug !== flow.slug
  ) {
    throw new Error(`FLOW.json identity does not match flowPath: ${flow.flowPath}`);
  }
  assertUnique('FLOW.json non-goal', flow.nonGoals);
}

export function validateEventBinding(
  flow: ProRoundtripFlow,
  eventDirectory: string,
  event: ProRoundtripEventComplete,
): void {
  const parts = parseEventDirectory(eventDirectory);
  if (event.flowPath !== flow.flowPath) {
    throw new Error(`${event.eventId}: flowPath does not match FLOW.json`);
  }
  if (
    parts.eventId !== event.eventId ||
    parts.sequence !== event.sequence ||
    parts.actor !== event.actor ||
    parts.kind !== event.kind ||
    parts.revision !== event.revision
  ) {
    throw new Error(`${event.eventId}: COMPLETE.json identity does not match its directory`);
  }
  if (event.protocolVersion !== flow.protocol.version) {
    throw new Error(`${event.eventId}: protocol version does not match FLOW.json`);
  }
  if (
    event.repositoryFullName !== flow.repository.fullName ||
    event.codeBranch !== flow.codeBranch
  ) {
    throw new Error(`${event.eventId}: repository binding does not match FLOW.json`);
  }
}

function assertUnique(label: string, values: string[]): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
}

export function validateContractSemantics(
  flow: ProRoundtripFlow,
  event: ProRoundtripEventComplete,
  contract: ProRoundtripContract,
): void {
  if (contract.flowPath !== flow.flowPath || contract.designEventId !== event.eventId) {
    throw new Error('CONTRACT.json is not bound to its flow and design event');
  }
  if (event.kind !== 'design' || event.actor !== 'pro') {
    throw new Error('CONTRACT.json may only be imported from a Pro design event');
  }

  const requirementIds = contract.requirements.map(({ id }) => id);
  const invariantIds = contract.invariants.map(({ id }) => id);
  const workflowIds = contract.workflows.map(({ id }) => id);
  const nfrIds = contract.nonFunctionalRequirements.map(({ id }) => id);
  const decisionIds = contract.decisions.map(({ id }) => id);
  const sprintIds = contract.sprints.map(({ id }) => id);
  for (const [label, values] of [
    ['requirement ID', requirementIds],
    ['invariant ID', invariantIds],
    ['workflow ID', workflowIds],
    ['NFR ID', nfrIds],
    ['decision ID', decisionIds],
    ['Sprint ID', sprintIds],
  ] as const) {
    assertUnique(label, values);
  }
  assertUnique('contract ID', [
    ...requirementIds,
    ...invariantIds,
    ...workflowIds,
    ...nfrIds,
    ...decisionIds,
    ...sprintIds,
  ]);

  const sprintSet = new Set(sprintIds);
  const invariantSet = new Set(invariantIds);
  const workflowSet = new Set(workflowIds);
  const ownableSet = new Set([...requirementIds, ...nfrIds]);

  for (const requirement of contract.requirements) {
    if (!sprintSet.has(requirement.ownerSprint)) {
      throw new Error(`${requirement.id}: unknown owner Sprint ${requirement.ownerSprint}`);
    }
  }
  for (const nfr of contract.nonFunctionalRequirements) {
    if (!sprintSet.has(nfr.ownerSprint)) {
      throw new Error(`${nfr.id}: unknown owner Sprint ${nfr.ownerSprint}`);
    }
  }
  for (const workflow of contract.workflows) {
    assertUnique(`${workflow.id} owner Sprint`, workflow.ownerSprints);
    for (const sprintId of workflow.ownerSprints) {
      if (!sprintSet.has(sprintId)) {
        throw new Error(`${workflow.id}: unknown owner Sprint ${sprintId}`);
      }
    }
  }

  const ownership = new Map<string, string>();
  for (const sprint of contract.sprints) {
    assertUnique(`${sprint.id} owns`, sprint.owns);
    assertUnique(`${sprint.id} preserves`, sprint.preserves);
    assertUnique(`${sprint.id} workflowsAffected`, sprint.workflowsAffected);
    assertUnique(`${sprint.id} dependsOn`, sprint.dependsOn);
    assertUnique(`${sprint.id} non-goal`, sprint.nonGoals);
    assertUnique(`${sprint.id} likely file`, sprint.filesLikelyTouched);
    if (sprint.dependsOn.includes(sprint.id)) {
      throw new Error(`${sprint.id}: Sprint cannot depend on itself`);
    }
    for (const ownedId of sprint.owns) {
      if (!ownableSet.has(ownedId)) {
        throw new Error(`${sprint.id}: unknown owned ID ${ownedId}`);
      }
      const previousOwner = ownership.get(ownedId);
      if (previousOwner) {
        throw new Error(`${ownedId}: owned by both ${previousOwner} and ${sprint.id}`);
      }
      ownership.set(ownedId, sprint.id);
    }
    for (const invariantId of sprint.preserves) {
      if (!invariantSet.has(invariantId)) {
        throw new Error(`${sprint.id}: unknown invariant ${invariantId}`);
      }
    }
    for (const workflowId of sprint.workflowsAffected) {
      if (!workflowSet.has(workflowId)) {
        throw new Error(`${sprint.id}: unknown workflow ${workflowId}`);
      }
    }
    for (const dependency of sprint.dependsOn) {
      if (!sprintSet.has(dependency)) {
        throw new Error(`${sprint.id}: unknown dependency ${dependency}`);
      }
    }
  }
  for (const id of ownableSet) {
    if (!ownership.has(id)) {
      throw new Error(`${id}: not owned by any Sprint`);
    }
  }

  const dependencies = new Map(contract.sprints.map((sprint) => [sprint.id, sprint.dependsOn]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (sprintId: string): void => {
    if (visiting.has(sprintId)) {
      throw new Error(`Sprint dependency cycle includes ${sprintId}`);
    }
    if (visited.has(sprintId)) {
      return;
    }
    visiting.add(sprintId);
    for (const dependency of dependencies.get(sprintId) ?? []) {
      visit(dependency);
    }
    visiting.delete(sprintId);
    visited.add(sprintId);
  };
  for (const sprintId of sprintIds) {
    visit(sprintId);
  }
}

export function assertSafePayloadPath(relativePath: string): string {
  const normalized = toPosixPath(relativePath);
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    normalized.split('/').includes('..') ||
    !/^[A-Za-z0-9._/-]+$/.test(normalized) ||
    sensitivePathPattern.test(normalized) ||
    blockedExtensionPattern.test(normalized)
  ) {
    throw new Error(`unsafe payload path: ${relativePath}`);
  }
  return normalized;
}

async function listPayloadFiles(root: string, relative = ''): Promise<string[]> {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const child = relative.length > 0 ? path.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listPayloadFiles(root, child)));
      continue;
    }
    if (entry.isFile() && entry.name !== 'COMPLETE.json') {
      files.push(toPosixPath(child));
    }
  }
  return files.sort();
}

export async function validateEventRoster(
  eventDirectory: string,
  event: ProRoundtripEventComplete,
  maxPayloadBytes = 1_048_576,
): Promise<void> {
  const declared = event.files.map(({ path: filePath }) => assertSafePayloadPath(filePath)).sort();
  assertUnique(`${event.eventId} file roster`, declared);
  const requiredByKind: Record<ProRoundtripEventComplete['kind'], string[]> = {
    goal: ['GOAL.md'],
    design: ['CONTRACT.json', 'DESIGN.md', 'SPRINTS.md'],
    'implementation-report': ['REPORT.md', 'WORKFLOW-MATRIX.md'],
    feedback: ['FEEDBACK.md', 'FINDINGS.json'],
    'remediation-report': ['REPORT.md'],
    approval: ['APPROVAL.md'],
    closed: ['SUMMARY.md'],
  };
  for (const required of requiredByKind[event.kind]) {
    if (!declared.includes(required)) {
      throw new Error(`${event.eventId}: required payload is missing: ${required}`);
    }
  }
  const actual = await listPayloadFiles(eventDirectory);
  if (declared.length !== actual.length || declared.some((value, index) => value !== actual[index])) {
    throw new Error(
      `${event.eventId}: file roster mismatch; declared=${declared.join(',')} actual=${actual.join(',')}`,
    );
  }
  for (const relativePath of actual) {
    const file = await stat(path.join(eventDirectory, relativePath));
    if (file.size > maxPayloadBytes) {
      throw new Error(`${event.eventId}: payload exceeds ${maxPayloadBytes} bytes: ${relativePath}`);
    }
    const declaration = event.files.find(({ path: filePath }) => filePath === relativePath);
    if (!declaration) {
      throw new Error(`${event.eventId}: missing declaration for ${relativePath}`);
    }
    if (
      (declaration.mediaType === 'application/json' && !relativePath.endsWith('.json')) ||
      (declaration.mediaType === 'text/markdown' && !relativePath.endsWith('.md'))
    ) {
      throw new Error(`${event.eventId}: media type does not match ${relativePath}`);
    }
    let content: string;
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(
        await readFile(path.join(eventDirectory, relativePath)),
      );
    } catch {
      throw new Error(`${event.eventId}: payload is not valid UTF-8: ${relativePath}`);
    }
    if (content.includes('\u0000')) {
      throw new Error(`${event.eventId}: payload contains NUL bytes: ${relativePath}`);
    }
    if (declaration.mediaType === 'application/json') {
      try {
        JSON.parse(content);
      } catch {
        throw new Error(`${event.eventId}: invalid JSON payload: ${relativePath}`);
      }
    }
  }
}

const transitions = new Map<ProRoundtripEventComplete['kind'], Set<ProRoundtripEventComplete['kind']>>([
  ['goal', new Set(['design', 'implementation-report'])],
  ['design', new Set(['implementation-report'])],
  ['implementation-report', new Set(['feedback'])],
  ['feedback', new Set(['remediation-report', 'design', 'approval'])],
  ['remediation-report', new Set(['feedback'])],
  ['approval', new Set(['closed'])],
  ['closed', new Set()],
]);

export function validateEventChain(events: ProRoundtripEventComplete[]): void {
  const byId = new Map<string, ProRoundtripEventComplete>();
  let previous: ProRoundtripEventComplete | undefined;
  let activeDesignEventId: string | null = null;
  let auditFlow = false;
  for (const event of events) {
    if (byId.has(event.eventId)) {
      throw new Error(`duplicate event ID: ${event.eventId}`);
    }
    if (previous === undefined) {
      if (event.kind !== 'goal' || event.previousEventId !== null) {
        throw new Error(`${event.eventId}: first completed event must be a root goal`);
      }
    } else {
      if (event.previousEventId !== previous.eventId) {
        throw new Error(`${event.eventId}: previousEventId must reference ${previous.eventId}`);
      }
      if (!transitions.get(previous.kind)?.has(event.kind)) {
        throw new Error(`invalid event transition: ${previous.kind} -> ${event.kind}`);
      }
      if (event.sequence <= previous.sequence && event.eventId !== previous.eventId) {
        throw new Error(`${event.eventId}: event sequence must increase`);
      }
    }
    if (event.supersedesEventId !== null) {
      const superseded = byId.get(event.supersedesEventId);
      if (!superseded || superseded.kind !== event.kind) {
        throw new Error(`${event.eventId}: invalid supersedesEventId`);
      }
    }
    if (event.kind === 'design') {
      if (event.designEventId !== event.eventId) {
        throw new Error(`${event.eventId}: design event must bind designEventId to itself`);
      }
      activeDesignEventId = event.eventId;
      auditFlow = false;
    } else if (event.kind === 'implementation-report' && previous?.kind === 'goal') {
      if (event.designEventId !== null) {
        throw new Error(`${event.eventId}: audit report after goal must have designEventId=null`);
      }
      auditFlow = true;
    } else if (event.kind !== 'goal') {
      if (auditFlow) {
        if (event.designEventId !== null) {
          throw new Error(`${event.eventId}: audit flow must keep designEventId=null`);
        }
      } else if (event.designEventId !== activeDesignEventId || activeDesignEventId === null) {
        throw new Error(`${event.eventId}: event is not bound to the active design revision`);
      }
    }

    if (event.nextActor === 'none') {
      if (event.nextWriteTarget !== null || event.kind !== 'closed') {
        throw new Error(`${event.eventId}: only a closed event may have no next actor`);
      }
    } else if (event.nextActor === 'user') {
      if (event.nextWriteTarget !== null) {
        throw new Error(`${event.eventId}: a user handoff must not invent a write target`);
      }
    } else {
      if (!event.nextWriteTarget?.startsWith(`${event.flowPath}/`)) {
        throw new Error(`${event.eventId}: next write target is outside the flow`);
      }
      const next = parseEventDirectory(event.nextWriteTarget);
      if (next.actor !== event.nextActor) {
        throw new Error(`${event.eventId}: next actor does not match next write target`);
      }
      if (!transitions.get(event.kind)?.has(next.kind)) {
        throw new Error(`${event.eventId}: next write target has invalid kind ${next.kind}`);
      }
      if (next.sequence <= event.sequence) {
        throw new Error(`${event.eventId}: next write target sequence must increase`);
      }
    }
    byId.set(event.eventId, event);
    previous = event;
  }
}

export async function readValidatedJson<T>(
  filePath: string,
  parser: (content: string) => T,
): Promise<T> {
  return parser(await readFile(filePath, 'utf8'));
}
