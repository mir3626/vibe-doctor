import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  ProRoundtripContract,
  ProRoundtripEventComplete,
  ProRoundtripReportInput,
} from '../lib/schemas/pro-roundtrip.js';
import { ProRoundtripReportInputSchema } from '../lib/schemas/pro-roundtrip.js';
import { parseEventDirectory } from './contract.js';
import { publishAdditions, type PublishResult } from './git-branch-transport.js';
import {
  packetRootFor,
  readPacketState,
  stableEvidenceHash,
  writeJsonAtomic,
  writeTextAtomic,
} from './importer.js';
import type { FlowSnapshot } from './flow-store.js';
import { runGit } from './worktree.js';

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

function latestContract(snapshot: FlowSnapshot): ProRoundtripContract | undefined {
  return [...snapshot.events].reverse().find((event) => event.contract)?.contract;
}

function reportMarkdown(input: ProRoundtripReportInput): string {
  return `# ${input.sprintId ?? 'Flow'} ${input.reportKind} report

## Binding

- Flow: \`${input.flowPath}\`
- Design event: ${input.designEventId ? `\`${input.designEventId}\`` : 'none (audit)'}
- Sprint: ${input.sprintId ? `\`${input.sprintId}\`` : 'none'}
- Base SHA: \`${input.baseSha}\`
- Head SHA: \`${input.headSha}\`
- Evidence hash: \`${stableEvidenceHash(input)}\`

## Contract coverage

${input.completedContractIds.length > 0 ? input.completedContractIds.map((id) => `- \`${id}\``).join('\n') : '- audit flow; no design contract'}

## Changed files

${input.changedFiles.length > 0 ? input.changedFiles.map((file) => `- \`${file}\``).join('\n') : '- none'}

## Verification

${input.verification
  .map((item) => `- **${item.status}** \`${item.command}\` — ${item.summary}`)
  .join('\n')}

## Gates

- Sprint gate: ${input.sprintGatePassed ? 'passed' : 'not passed'}
- Cumulative gate: ${input.cumulativeGatePassed ? 'passed' : 'not passed'}
- Final flow gate: ${input.finalGatePassed ? 'passed' : 'not passed'}

## Risks

${input.risks.length > 0 ? input.risks.map((risk) => `- ${risk}`).join('\n') : '- none'}

## Next action

${input.nextAction}
`;
}

function workflowMatrixMarkdown(
  contract: ProRoundtripContract | undefined,
  inputs: ProRoundtripReportInput[],
): string {
  const cell = (value: string): string =>
    value.replaceAll('|', '\\|').replace(/\r?\n/g, '<br>');
  const rows = new Map(
    inputs.flatMap((input) =>
      input.workflowEvidence.map((evidence) => [evidence.contractId, evidence] as const),
    ),
  );
  const ids = contract
    ? [
        ...contract.requirements.map(({ id }) => id),
        ...contract.invariants.map(({ id }) => id),
        ...contract.workflows.map(({ id }) => id),
        ...contract.nonFunctionalRequirements.map(({ id }) => id),
      ]
    : [...rows.keys()];
  const owners = new Map<string, string>();
  if (contract) {
    for (const sprint of contract.sprints) {
      for (const id of [...sprint.owns, ...sprint.preserves, ...sprint.workflowsAffected]) {
        if (!owners.has(id)) {
          owners.set(id, sprint.id);
        }
      }
    }
  }
  const body = ids.map((id) => {
    const evidence = rows.get(id);
    return `| ${cell(id)} | ${cell(owners.get(id) ?? 'audit')} | ${cell(evidence?.implementationEvidence ?? 'missing')} | ${cell(evidence?.testEvidence ?? 'missing')} | ${cell(evidence?.integrationEvidence ?? 'missing')} | ${cell(evidence?.status ?? 'missing')} | ${cell(evidence?.notes ?? '')} |`;
  });
  return `# Workflow Matrix

| Contract ID | Owner Sprint | Implementation evidence | Test evidence | Integration evidence | Status | Notes |
|---|---|---|---|---|---|---|
${body.join('\n')}
`;
}

function requiredContractIds(contract: ProRoundtripContract): string[] {
  return [
    ...contract.requirements.map(({ id }) => id),
    ...contract.invariants.map(({ id }) => id),
    ...contract.workflows.map(({ id }) => id),
    ...contract.nonFunctionalRequirements.map(({ id }) => id),
  ];
}

function assertFinalEvidence(
  contract: ProRoundtripContract | undefined,
  inputs: ProRoundtripReportInput[],
  requireAllSprintCheckpoints = true,
): void {
  if (inputs.length === 0 || !inputs.at(-1)?.finalGatePassed) {
    throw new Error('final flow gate evidence is required before bridge publication');
  }
  if (!inputs.every((input) => input.sprintGatePassed && input.cumulativeGatePassed)) {
    throw new Error('every recorded report must pass Sprint and cumulative gates');
  }
  if (!contract) {
    return;
  }
  if (requireAllSprintCheckpoints) {
    const sprintIds = new Set(inputs.map(({ sprintId }) => sprintId).filter(Boolean));
    for (const sprint of contract.sprints) {
      if (!sprintIds.has(sprint.id)) {
        throw new Error(`missing checkpoint for ${sprint.id}`);
      }
    }
  }
  const evidence = new Map(
    inputs.flatMap((input) =>
      input.workflowEvidence.map((row) => [row.contractId, row] as const),
    ),
  );
  for (const id of requiredContractIds(contract)) {
    const row = evidence.get(id);
    if (!row || row.status !== 'complete') {
      throw new Error(`final workflow evidence is incomplete for ${id}`);
    }
  }
}

export async function recordSprintReport(
  repoRoot: string,
  snapshot: FlowSnapshot,
  input: ProRoundtripReportInput,
): Promise<string> {
  if (input.flowPath !== snapshot.flow.flowPath) {
    throw new Error('report input is bound to another flow');
  }
  const head = (await runGit(repoRoot, ['rev-parse', 'HEAD^{commit}'])).stdout.trim();
  if (input.headSha !== head) {
    throw new Error(`report HEAD is stale: input=${input.headSha} current=${head}`);
  }
  if (input.baseSha !== snapshot.flow.baseSha) {
    throw new Error('report base SHA does not match FLOW.json');
  }
  const contract = latestContract(snapshot);
  const expectedReportKind = contract
    ? snapshot.latestEvent.marker.kind === 'feedback'
      ? 'remediation'
      : 'implementation'
    : 'audit';
  if (
    expectedReportKind === 'remediation' &&
    snapshot.latestEvent.marker.disposition !== 'remediation-required'
  ) {
    throw new Error(
      `feedback disposition does not allow remediation: ${snapshot.latestEvent.marker.disposition}`,
    );
  }
  if (input.reportKind !== expectedReportKind) {
    throw new Error(
      `report kind does not match flow state: expected=${expectedReportKind} input=${input.reportKind}`,
    );
  }
  if (
    contract &&
    expectedReportKind === 'implementation' &&
    snapshot.latestEvent.marker.kind !== 'design'
  ) {
    throw new Error('implementation evidence may only be recorded after a design event');
  }
  if (input.reportKind === 'remediation' && input.resolvedFindingIds.length === 0) {
    throw new Error('remediation evidence must name at least one resolved finding ID');
  }
  if (input.reportKind === 'remediation') {
    const findings = snapshot.latestEvent.findings?.findings;
    if (!findings) {
      throw new Error('latest feedback has no validated FINDINGS.json');
    }
    if (new Set(input.resolvedFindingIds).size !== input.resolvedFindingIds.length) {
      throw new Error('remediation evidence contains duplicate finding IDs');
    }
    for (const findingId of input.resolvedFindingIds) {
      const finding = findings.find(({ id }) => id === findingId);
      if (!finding) {
        throw new Error(`remediation references unknown finding ID: ${findingId}`);
      }
      if (['design-defect', 'scope-extension'].includes(finding.taxonomy)) {
        throw new Error(`${findingId}: ${finding.taxonomy} cannot be resolved by code remediation`);
      }
    }
  }
  if (contract) {
    if (input.designEventId !== contract.designEventId || !input.sprintId) {
      throw new Error('report design/Sprint binding does not match the imported contract');
    }
    const sprint = contract.sprints.find(({ id }) => id === input.sprintId);
    if (!sprint) {
      throw new Error(`unknown Sprint in report input: ${input.sprintId}`);
    }
    for (const ownedId of sprint.owns) {
      if (!input.completedContractIds.includes(ownedId)) {
        throw new Error(`${input.sprintId}: missing owned contract evidence for ${ownedId}`);
      }
    }
  } else if (
    input.designEventId !== null ||
    input.sprintId !== null ||
    input.reportKind !== 'audit'
  ) {
    throw new Error('an audit flow report must have null design/Sprint bindings');
  }
  if (!input.sprintGatePassed || !input.cumulativeGatePassed) {
    throw new Error('Sprint and cumulative gates must pass before recording a checkpoint');
  }

  const packetRoot = packetRootFor(repoRoot, snapshot.flow.flowPath);
  const directoryName = contract
    ? `${input.sprintId}-${contract.sprints.find(({ id }) => id === input.sprintId)?.slug}`
    : 'AUDIT';
  const reportRoot =
    input.reportKind === 'remediation'
      ? path.join(packetRoot, 'remediation', snapshot.latestEvent.marker.eventId, directoryName)
      : path.join(packetRoot, 'sprints', directoryName);
  await writeTextAtomic(path.join(reportRoot, 'REPORT.md'), reportMarkdown(input));
  await writeJsonAtomic(path.join(reportRoot, 'CHECKPOINT.json'), {
    schemaVersion: 'vibe-pro-sprint-checkpoint-v1',
    recordedAt: new Date().toISOString(),
    evidenceHash: stableEvidenceHash(input),
    input,
  });
  return reportRoot;
}

async function loadRecordedInputs(
  packetRoot: string,
  contract: ProRoundtripContract | undefined,
  snapshot: FlowSnapshot,
): Promise<Array<{ input: ProRoundtripReportInput; recordedAt: string }>> {
  let checkpointPaths: string[];
  if (snapshot.latestEvent.marker.kind === 'feedback') {
    const root = path.join(
      packetRoot,
      'remediation',
      snapshot.latestEvent.marker.eventId,
    );
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
    checkpointPaths = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name, 'CHECKPOINT.json'))
      .sort();
  } else {
    const directories = contract
      ? contract.sprints.map((sprint) => `${sprint.id}-${sprint.slug}`)
      : ['AUDIT'];
    checkpointPaths = directories.map((directory) =>
      path.join(packetRoot, 'sprints', directory, 'CHECKPOINT.json'),
    );
  }
  const inputs: Array<{ input: ProRoundtripReportInput; recordedAt: string }> = [];
  for (const checkpointPath of checkpointPaths) {
    if (!(await exists(checkpointPath))) {
      continue;
    }
    const parsed = JSON.parse(await readFile(checkpointPath, 'utf8')) as {
      schemaVersion?: string;
      recordedAt?: string;
      evidenceHash?: string;
      input?: ProRoundtripReportInput;
    };
    if (
      parsed.schemaVersion !== 'vibe-pro-sprint-checkpoint-v1' ||
      typeof parsed.recordedAt !== 'string' ||
      !parsed.input ||
      parsed.evidenceHash !== stableEvidenceHash(parsed.input)
    ) {
      throw new Error(`invalid or tampered local checkpoint: ${checkpointPath}`);
    }
    inputs.push({
      input: ProRoundtripReportInputSchema.parse(parsed.input),
      recordedAt: parsed.recordedAt,
    });
  }
  return inputs.sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
}

function nextFeedbackTarget(snapshot: FlowSnapshot, reportSequence: number): string {
  const feedbackRevision =
    snapshot.events.filter(({ marker }) => marker.kind === 'feedback').length + 1;
  return `${snapshot.flow.flowPath}/${String(reportSequence + 100).padStart(4, '0')}--pro--feedback--r${String(feedbackRevision).padStart(2, '0')}`;
}

export async function publishAggregateReport(
  repoRoot: string,
  snapshot: FlowSnapshot,
): Promise<PublishResult> {
  const state = await readPacketState(repoRoot, snapshot.flow.flowPath);
  if (!state) {
    throw new Error('sync the flow before publishing a report');
  }
  if (state.latestEventId !== snapshot.latestEvent.marker.eventId) {
    throw new Error('local packet is stale; sync before report publication');
  }
  const contract = latestContract(snapshot);
  const packetRoot = packetRootFor(repoRoot, snapshot.flow.flowPath);
  const recorded = await loadRecordedInputs(packetRoot, contract, snapshot);
  const inputs = recorded.map(({ input }) => input);
  const isRemediation = snapshot.latestEvent.marker.kind === 'feedback';
  assertFinalEvidence(contract, inputs, !isRemediation);
  if (isRemediation) {
    const resolved = new Set(inputs.flatMap(({ resolvedFindingIds }) => resolvedFindingIds));
    for (const finding of snapshot.latestEvent.findings?.findings ?? []) {
      if (
        ['P0', 'P1'].includes(finding.severity) &&
        ['implementation-defect', 'missing-test', 'evidence-missing'].includes(
          finding.taxonomy,
        ) &&
        !resolved.has(finding.id)
      ) {
        throw new Error(`blocking actionable finding is unresolved: ${finding.id}`);
      }
    }
  }
  const headSha = (await runGit(repoRoot, ['rev-parse', 'HEAD^{commit}'])).stdout.trim();
  if (inputs.at(-1)?.headSha !== headSha) {
    throw new Error('final report evidence is not bound to the current code HEAD');
  }
  const kind =
    snapshot.latestEvent.marker.kind === 'feedback'
      ? 'remediation-report'
      : 'implementation-report';
  const expectedTarget = snapshot.latestEvent.marker.nextWriteTarget;
  if (!expectedTarget) {
    throw new Error('latest event does not define a report write target');
  }
  const eventDirectory = path.posix.basename(expectedTarget);
  const eventParts = parseEventDirectory(eventDirectory);
  if (eventParts.kind !== kind || eventParts.actor !== 'codex') {
    throw new Error(`next write target is not a ${kind} event: ${expectedTarget}`);
  }

  const files = new Map<string, string>();
  const reportRoot = `${snapshot.flow.flowPath}/${eventDirectory}`;
  for (const input of inputs) {
    const directory = contract
      ? `${input.sprintId}-${contract.sprints.find(({ id }) => id === input.sprintId)?.slug}`
      : 'AUDIT';
    const category = isRemediation ? 'remediation' : 'sprints';
    files.set(
      `${reportRoot}/${category}/${directory}/REPORT.md`,
      reportMarkdown(input),
    );
    files.set(
      `${reportRoot}/${category}/${directory}/CHECKPOINT.json`,
      `${JSON.stringify(
        {
          schemaVersion: 'vibe-pro-sprint-checkpoint-v1',
          recordedAt:
            recorded.find(({ input: candidate }) => candidate === input)?.recordedAt ??
            new Date().toISOString(),
          evidenceHash: stableEvidenceHash(input),
          input,
        },
        null,
        2,
      )}\n`,
    );
  }
  const matrix = workflowMatrixMarkdown(contract, inputs);
  await writeTextAtomic(path.join(packetRoot, 'FINAL-WORKFLOW-MATRIX.md'), matrix);
  files.set(`${reportRoot}/WORKFLOW-MATRIX.md`, matrix);
  files.set(
    `${reportRoot}/REPORT.md`,
    `# ${kind === 'remediation-report' ? 'Remediation' : 'Implementation'} report

- Flow: \`${snapshot.flow.flowPath}\`
- Design event: ${state.designEventId ? `\`${state.designEventId}\`` : 'none (audit)'}
- Base SHA: \`${snapshot.flow.baseSha}\`
- Head SHA: \`${headSha}\`
- Sprint reports: ${inputs.length}
- Final flow gate: passed

Review every Sprint report and \`WORKFLOW-MATRIX.md\` against the exact code HEAD.
`,
  );
  const payloadPaths = [...files.keys()].map((filePath) =>
    filePath.slice(`${reportRoot}/`.length),
  );
  const marker: ProRoundtripEventComplete = {
    schemaVersion: 'vibe-pro-event-complete-v1',
    flowPath: snapshot.flow.flowPath,
    eventId: eventParts.eventId,
    sequence: eventParts.sequence,
    actor: 'codex',
    kind,
    revision: eventParts.revision,
    previousEventId: snapshot.latestEvent.marker.eventId,
    supersedesEventId: null,
    protocolVersion: snapshot.flow.protocol.version,
    designEventId: state.designEventId,
    sprintId: null,
    repositoryFullName: snapshot.flow.repository.fullName,
    codeBranch: snapshot.flow.codeBranch,
    baseSha: snapshot.flow.baseSha,
    headSha,
    disposition: 'complete',
    files: payloadPaths.map((filePath) => ({
      path: filePath,
      mediaType: filePath.endsWith('.json') ? 'application/json' : 'text/markdown',
    })),
    limitations: inputs.flatMap(({ risks }) => risks),
    createdAt: new Date().toISOString(),
    nextActor: 'pro',
    nextWriteTarget: nextFeedbackTarget(snapshot, eventParts.sequence),
  };
  files.set(`${reportRoot}/COMPLETE.json`, `${JSON.stringify(marker, null, 2)}\n`);
  return publishAdditions(
    files,
    `docs(pro-go): publish ${kind} ${eventParts.revision}`,
    { cwd: repoRoot },
  );
}

export { workflowMatrixMarkdown };
