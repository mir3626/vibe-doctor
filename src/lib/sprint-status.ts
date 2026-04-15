import path from 'node:path';
import { readJson, writeJson } from './fs.js';
import { paths } from './paths.js';

export interface PendingRisk {
  id: string;
  raisedBy: string;
  targetSprint: string;
  text: string;
  status: 'open' | 'acknowledged' | 'resolved';
  createdAt: string;
  resolvedAt?: string;
}

export interface VerificationCommand {
  id: string;
  command: string;
  expectExitCode: number;
  expectStdoutContains?: string;
  introducedInSprint?: string;
  runOutsideSandbox?: boolean;
}

export interface ActualLoc {
  added: number;
  deleted: number;
  net: number;
  filesChanged: number;
}

export interface SprintEntry {
  id: string;
  name: string;
  status: 'planned' | 'in_progress' | 'passed' | 'failed' | 'skipped';
  startedAt?: string;
  completedAt?: string;
  planPromptPath?: string;
  generatorReportPath?: string;
  evaluatorVerdict?: 'pass' | 'fail' | 'skipped';
  addedVerificationCommands?: VerificationCommand[];
  deviations?: string[];
  actualLoc?: ActualLoc;
}

export interface HandoffBlock {
  currentSprintId: string;
  lastActionSummary: string;
  openIssues?: string[];
  orchestratorContextBudget: 'low' | 'medium' | 'high';
  preferencesActive: string[];
  handoffDocPath?: string;
  updatedAt?: string;
}

export interface SandboxNote {
  command: string;
  reason: string;
  runOutsideSandbox?: boolean;
}

export interface SprintStatus {
  $schema?: string;
  schemaVersion: string;
  project: {
    name: string;
    createdAt: string;
    runtime?: string;
    framework?: string;
  };
  sprints: SprintEntry[];
  verificationCommands: VerificationCommand[];
  handoff?: HandoffBlock;
  sandboxNotes?: SandboxNote[];
  pendingRisks: PendingRisk[];
  lastSprintScope: string[];
  lastSprintScopeGlob: string[];
  sprintsSinceLastAudit: number;
  stateUpdatedAt: string;
  verifiedAt?: string;
}

function resolveRoot(root?: string): string {
  return root ?? paths.root;
}

function sprintStatusPath(root?: string): string {
  return path.join(resolveRoot(root), '.vibe', 'agent', 'sprint-status.json');
}

function normalizeScopeEntry(entry: string): string {
  return entry.replace(/\\/g, '/');
}

function mergeScopeEntries(existing: string[], incoming: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const rawEntry of [...existing, ...incoming]) {
    const entry = normalizeScopeEntry(rawEntry);
    if (seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    merged.push(entry);
  }

  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isActualLoc(value: unknown): value is ActualLoc {
  return (
    isRecord(value) &&
    typeof value.added === 'number' &&
    typeof value.deleted === 'number' &&
    typeof value.net === 'number' &&
    typeof value.filesChanged === 'number'
  );
}

function isVerificationCommand(value: unknown): value is VerificationCommand {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.command === 'string' &&
    typeof value.expectExitCode === 'number' &&
    (value.expectStdoutContains === undefined || typeof value.expectStdoutContains === 'string') &&
    (value.introducedInSprint === undefined || typeof value.introducedInSprint === 'string') &&
    (value.runOutsideSandbox === undefined || typeof value.runOutsideSandbox === 'boolean')
  );
}

function isSprintEntry(value: unknown): value is SprintEntry {
  if (!isRecord(value)) {
    return false;
  }

  const validStatus =
    value.status === 'planned' ||
    value.status === 'in_progress' ||
    value.status === 'passed' ||
    value.status === 'failed' ||
    value.status === 'skipped';
  const validVerdict =
    value.evaluatorVerdict === undefined ||
    value.evaluatorVerdict === 'pass' ||
    value.evaluatorVerdict === 'fail' ||
    value.evaluatorVerdict === 'skipped';

  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    validStatus &&
    (value.startedAt === undefined || typeof value.startedAt === 'string') &&
    (value.completedAt === undefined || typeof value.completedAt === 'string') &&
    (value.planPromptPath === undefined || typeof value.planPromptPath === 'string') &&
    (value.generatorReportPath === undefined || typeof value.generatorReportPath === 'string') &&
    validVerdict &&
    (value.addedVerificationCommands === undefined ||
      (Array.isArray(value.addedVerificationCommands) &&
        value.addedVerificationCommands.every(isVerificationCommand))) &&
    (value.deviations === undefined || isStringArray(value.deviations)) &&
    (value.actualLoc === undefined || isActualLoc(value.actualLoc))
  );
}

function isHandoffBlock(value: unknown): value is HandoffBlock {
  if (!isRecord(value)) {
    return false;
  }

  const validBudget =
    value.orchestratorContextBudget === 'low' ||
    value.orchestratorContextBudget === 'medium' ||
    value.orchestratorContextBudget === 'high';

  return (
    typeof value.currentSprintId === 'string' &&
    typeof value.lastActionSummary === 'string' &&
    validBudget &&
    isStringArray(value.preferencesActive) &&
    (value.openIssues === undefined || isStringArray(value.openIssues)) &&
    (value.handoffDocPath === undefined || typeof value.handoffDocPath === 'string') &&
    (value.updatedAt === undefined || typeof value.updatedAt === 'string')
  );
}

function isSandboxNote(value: unknown): value is SandboxNote {
  return (
    isRecord(value) &&
    typeof value.command === 'string' &&
    typeof value.reason === 'string' &&
    (value.runOutsideSandbox === undefined || typeof value.runOutsideSandbox === 'boolean')
  );
}

export function isPendingRisk(value: unknown): value is PendingRisk {
  const validStatus =
    isRecord(value) &&
    (value.status === 'open' || value.status === 'acknowledged' || value.status === 'resolved');

  return (
    validStatus &&
    typeof value.id === 'string' &&
    typeof value.raisedBy === 'string' &&
    typeof value.targetSprint === 'string' &&
    typeof value.text === 'string' &&
    typeof value.createdAt === 'string' &&
    (value.resolvedAt === undefined || typeof value.resolvedAt === 'string')
  );
}

export function isSprintStatus(value: unknown): value is SprintStatus {
  if (!isRecord(value)) {
    return false;
  }

  const validProject =
    isRecord(value.project) &&
    typeof value.project.name === 'string' &&
    typeof value.project.createdAt === 'string' &&
    (value.project.runtime === undefined || typeof value.project.runtime === 'string') &&
    (value.project.framework === undefined || typeof value.project.framework === 'string');

  return (
    (value.$schema === undefined || typeof value.$schema === 'string') &&
    typeof value.schemaVersion === 'string' &&
    validProject &&
    Array.isArray(value.sprints) &&
    value.sprints.every(isSprintEntry) &&
    Array.isArray(value.verificationCommands) &&
    value.verificationCommands.every(isVerificationCommand) &&
    (value.handoff === undefined || isHandoffBlock(value.handoff)) &&
    (value.sandboxNotes === undefined ||
      (Array.isArray(value.sandboxNotes) && value.sandboxNotes.every(isSandboxNote))) &&
    (value.pendingRisks === undefined ||
      (Array.isArray(value.pendingRisks) && value.pendingRisks.every(isPendingRisk))) &&
    (value.lastSprintScope === undefined || isStringArray(value.lastSprintScope)) &&
    (value.lastSprintScopeGlob === undefined || isStringArray(value.lastSprintScopeGlob)) &&
    (value.sprintsSinceLastAudit === undefined || typeof value.sprintsSinceLastAudit === 'number') &&
    (value.stateUpdatedAt === undefined || typeof value.stateUpdatedAt === 'string') &&
    (value.verifiedAt === undefined || typeof value.verifiedAt === 'string')
  );
}

function clonePendingRisk(risk: PendingRisk): PendingRisk {
  return risk.resolvedAt === undefined ? { ...risk } : { ...risk, resolvedAt: risk.resolvedAt };
}

function cloneVerificationCommand(command: VerificationCommand): VerificationCommand {
  return {
    ...command,
    ...(command.expectStdoutContains === undefined
      ? {}
      : { expectStdoutContains: command.expectStdoutContains }),
    ...(command.introducedInSprint === undefined
      ? {}
      : { introducedInSprint: command.introducedInSprint }),
    ...(command.runOutsideSandbox === undefined
      ? {}
      : { runOutsideSandbox: command.runOutsideSandbox }),
  };
}

function cloneSprintEntry(entry: SprintEntry): SprintEntry {
  return {
    ...entry,
    ...(entry.startedAt === undefined ? {} : { startedAt: entry.startedAt }),
    ...(entry.completedAt === undefined ? {} : { completedAt: entry.completedAt }),
    ...(entry.planPromptPath === undefined ? {} : { planPromptPath: entry.planPromptPath }),
    ...(entry.generatorReportPath === undefined
      ? {}
      : { generatorReportPath: entry.generatorReportPath }),
    ...(entry.evaluatorVerdict === undefined ? {} : { evaluatorVerdict: entry.evaluatorVerdict }),
    ...(entry.addedVerificationCommands === undefined
      ? {}
      : {
          addedVerificationCommands: entry.addedVerificationCommands.map(cloneVerificationCommand),
        }),
    ...(entry.deviations === undefined ? {} : { deviations: [...entry.deviations] }),
    ...(entry.actualLoc === undefined ? {} : { actualLoc: { ...entry.actualLoc } }),
  };
}

function cloneHandoffBlock(handoff: HandoffBlock): HandoffBlock {
  return {
    ...handoff,
    ...(handoff.openIssues === undefined ? {} : { openIssues: [...handoff.openIssues] }),
    ...(handoff.handoffDocPath === undefined ? {} : { handoffDocPath: handoff.handoffDocPath }),
    ...(handoff.updatedAt === undefined ? {} : { updatedAt: handoff.updatedAt }),
  };
}

function cloneSandboxNote(note: SandboxNote): SandboxNote {
  return note.runOutsideSandbox === undefined ? { ...note } : { ...note, runOutsideSandbox: note.runOutsideSandbox };
}

function nextStateUpdatedAt(
  partial: Partial<SprintStatus> & {
    project: SprintStatus['project'];
  },
): string {
  if (isIsoDateString(partial.stateUpdatedAt)) {
    return partial.stateUpdatedAt;
  }

  if (isIsoDateString(partial.handoff?.updatedAt)) {
    return partial.handoff.updatedAt;
  }

  if (isIsoDateString(partial.project.createdAt)) {
    return partial.project.createdAt;
  }

  return new Date().toISOString();
}

export function withDefaults(
  partial: Partial<SprintStatus> & {
    schemaVersion: string;
    project: SprintStatus['project'];
    sprints: SprintEntry[];
    verificationCommands: VerificationCommand[];
  },
): SprintStatus {
  return {
    ...partial,
    project: {
      ...partial.project,
      ...(partial.project.runtime === undefined ? {} : { runtime: partial.project.runtime }),
      ...(partial.project.framework === undefined ? {} : { framework: partial.project.framework }),
    },
    sprints: partial.sprints.map(cloneSprintEntry),
    verificationCommands: partial.verificationCommands.map(cloneVerificationCommand),
    ...(partial.handoff === undefined ? {} : { handoff: cloneHandoffBlock(partial.handoff) }),
    ...(partial.sandboxNotes === undefined
      ? {}
      : { sandboxNotes: partial.sandboxNotes.map(cloneSandboxNote) }),
    pendingRisks: (partial.pendingRisks ?? []).map(clonePendingRisk),
    lastSprintScope: [...(partial.lastSprintScope ?? [])],
    lastSprintScopeGlob: [...(partial.lastSprintScopeGlob ?? [])],
    sprintsSinceLastAudit: partial.sprintsSinceLastAudit ?? 0,
    stateUpdatedAt: nextStateUpdatedAt(partial),
    ...(partial.verifiedAt === undefined ? {} : { verifiedAt: partial.verifiedAt }),
  };
}

async function loadStatusForMutation(root?: string): Promise<SprintStatus> {
  return loadSprintStatus(root);
}

async function persistStatus(
  status: SprintStatus,
  updateStateUpdatedAt: boolean,
  root?: string,
): Promise<void> {
  const nextStatus = withDefaults(status);
  if (updateStateUpdatedAt) {
    nextStatus.stateUpdatedAt = new Date().toISOString();
  }
  await writeJson(sprintStatusPath(root), nextStatus);
}

export async function loadSprintStatus(root?: string): Promise<SprintStatus> {
  const filePath = sprintStatusPath(root);
  const loaded = await readJson<unknown>(filePath);
  if (!isSprintStatus(loaded)) {
    throw new Error(`Invalid sprint status at ${filePath}`);
  }

  return withDefaults(loaded);
}

export async function saveSprintStatus(status: SprintStatus, root?: string): Promise<void> {
  await persistStatus(status, true, root);
}

export async function appendPendingRisk(
  risk: Omit<PendingRisk, 'createdAt' | 'status'> & { status?: PendingRisk['status'] },
  root?: string,
): Promise<PendingRisk> {
  const status = await loadStatusForMutation(root);
  if (status.pendingRisks.some((entry) => entry.id === risk.id)) {
    throw new Error(`pendingRisk id already exists: ${risk.id}`);
  }

  const nextRisk: PendingRisk = {
    ...risk,
    status: risk.status ?? 'open',
    createdAt: new Date().toISOString(),
  };
  status.pendingRisks.push(nextRisk);
  await saveSprintStatus(status, root);
  return nextRisk;
}

export async function resolvePendingRisk(id: string, root?: string): Promise<PendingRisk | null> {
  const status = await loadStatusForMutation(root);
  const risk = status.pendingRisks.find((entry) => entry.id === id);
  if (!risk) {
    return null;
  }

  risk.status = 'resolved';
  risk.resolvedAt = new Date().toISOString();
  await saveSprintStatus(status, root);
  return clonePendingRisk(risk);
}

export async function incrementAuditCounter(root?: string): Promise<number> {
  const status = await loadStatusForMutation(root);
  status.sprintsSinceLastAudit += 1;
  await saveSprintStatus(status, root);
  return status.sprintsSinceLastAudit;
}

export async function resetAuditCounter(root?: string): Promise<void> {
  const status = await loadStatusForMutation(root);
  status.sprintsSinceLastAudit = 0;
  await saveSprintStatus(status, root);
}

export async function touchStateUpdated(root?: string): Promise<string> {
  const status = await loadStatusForMutation(root);
  const nextIso = new Date().toISOString();
  status.stateUpdatedAt = nextIso;
  await persistStatus(status, false, root);
  return nextIso;
}

export async function markVerified(root?: string): Promise<string> {
  const status = await loadStatusForMutation(root);
  const nextIso = new Date().toISOString();
  status.verifiedAt = nextIso;
  await persistStatus(status, false, root);
  return nextIso;
}

export async function extendLastSprintScope(
  scopePaths: string[],
  globs?: string[],
  root?: string,
): Promise<{ lastSprintScope: string[]; lastSprintScopeGlob: string[] }> {
  if (scopePaths.length === 0 && globs === undefined) {
    const status = await loadSprintStatus(root);
    return {
      lastSprintScope: [...status.lastSprintScope],
      lastSprintScopeGlob: [...status.lastSprintScopeGlob],
    };
  }

  const status = await loadStatusForMutation(root);
  const nextScope = mergeScopeEntries(status.lastSprintScope, scopePaths);
  const nextGlobs =
    globs === undefined
      ? [...status.lastSprintScopeGlob]
      : mergeScopeEntries(status.lastSprintScopeGlob, globs);

  if (
    nextScope.length === status.lastSprintScope.length &&
    nextGlobs.length === status.lastSprintScopeGlob.length &&
    nextScope.every((entry, index) => entry === status.lastSprintScope[index]) &&
    nextGlobs.every((entry, index) => entry === status.lastSprintScopeGlob[index])
  ) {
    return {
      lastSprintScope: [...status.lastSprintScope],
      lastSprintScopeGlob: [...status.lastSprintScopeGlob],
    };
  }

  status.lastSprintScope = nextScope;
  status.lastSprintScopeGlob = nextGlobs;
  await saveSprintStatus(status, root);

  return {
    lastSprintScope: [...status.lastSprintScope],
    lastSprintScopeGlob: [...status.lastSprintScopeGlob],
  };
}
