import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import {
  deriveFinalEvidenceManifest,
  validateFinalEvidenceManifest,
  type FinalEvidenceManifestCheckpointInput,
} from '../universal-integrity-core/index.js';
import path from 'node:path';
import type {
  ProRoundtripContract,
  ProRoundtripEventComplete,
  ProRoundtripReportInput,
} from '../lib/schemas/pro-roundtrip.js';
import { ProRoundtripReportInputSchema } from '../lib/schemas/pro-roundtrip.js';
import {
  MAX_PACKET_FILE_BYTES,
  readFlowFileOnce, parseEventDirectory } from './contract.js';
import { publishAdditions, type PublishResult } from './git-branch-transport.js';
import {
  packetRootFor,
  readPacketState,
  stableEvidenceHash,
  writeJsonAtomic,
  writeTextAtomic,
} from './importer.js';
import type { FlowSnapshot } from './flow-store.js';
import { runGit, type WorktreeContext } from './worktree.js';

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
  // A feedback event demands remediation evidence even on a design-less audit flow: the
  // publisher only reads remediation/<feedback-event>/ checkpoints once feedback is latest.
  const expectedReportKind =
    snapshot.latestEvent.marker.kind === 'feedback'
      ? 'remediation'
      : contract
        ? 'implementation'
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
  } else if (input.designEventId !== null || input.sprintId !== null) {
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
    const parsed = JSON.parse((await readFlowFileOnce(
      path.dirname(checkpointPath), path.basename(checkpointPath), MAX_PACKET_FILE_BYTES, 'CHECKPOINT.json',
    )).toString('utf8')) as {
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

/**
 * r08 FND-020: the publisher DERIVES the product-to-current comparison itself from the
 * final product HEAD, the actual current HEAD, and the exact changed paths — the
 * supplied manifest is never the source of its own compare status. Any non-agent-state
 * delta after the final gate fails closed.
 */
export function deriveCompareStatus(
  finalProductHeadSha: string,
  currentHeadSha: string,
  changedPaths: readonly string[],
): string {
  if (currentHeadSha === finalProductHeadSha) {
    return 'identical';
  }
  if (changedPaths.length === 0 || !changedPaths.every((file) => file.startsWith('.vibe/agent/'))) {
    throw new Error('product bytes changed after the final gate (rerun the complete gate)');
  }
  return `agent-state-only: ${changedPaths.join(', ')}`;
}

/**
 * r08 FND-020: ONE independent reconstruction of the complete expected manifest from the
 * normalized checkpoint inputs, the EXACT bytes being published, the derived compare
 * status, an EMPTY skipped-check list (required for approval eligibility), and the
 * complete design-required mandatory command roster. The caller must require self-hash
 * equality with the supplied manifest.
 */
export function reconstructExpectedManifest(input: {
  flowPath: string;
  protocolVersion: string;
  designEventId: string;
  flowBaseSha: string;
  currentHeadSha: string;
  changedPathsSinceFinalHead: readonly string[];
  contract: ProRoundtripContract;
  recorded: readonly { input: ProRoundtripReportInput; recordedAt: string }[];
  publishedCheckpointBytes: ReadonlyMap<string, string>;
  matrix: string;
}): Record<string, unknown> & { payloadSha256: string } {
  // FND-023 (upstream shape): the frozen mandatory command roster lives in the design
  // event itself — CONTRACT.json's finalGatePolicy block — so it is authored by Web Pro,
  // immutable through the pinned bridge blob, and never a harness-side registry that
  // needs editing per flow. There is NO default roster: a design that declares no
  // finalGatePolicy cannot produce an approval-eligible manifest.
  const finalGatePolicy = input.contract.finalGatePolicy;
  if (!finalGatePolicy) {
    throw new Error(
      `design ${input.designEventId} declares no finalGatePolicy: approval-eligible publication is impossible`,
    );
  }
  const owners = new Map<string, string>();
  for (const sprint of input.contract.sprints) {
    for (const id of [...sprint.owns, ...sprint.preserves, ...sprint.workflowsAffected]) {
      if (!owners.has(id)) owners.set(id, sprint.id);
    }
  }
  const contractRows = requiredContractIds(input.contract)
    .map((contractId) => ({ contractId, ownerSprintId: owners.get(contractId) ?? 'audit' }));
  const finalProductHeadSha = input.recorded.at(-1)?.input.headSha;
  if (!finalProductHeadSha) {
    throw new Error('final evidence manifest reconstruction requires recorded checkpoints');
  }
  const checkpoints = input.recorded.map(({ input: reportInput, recordedAt }) => {
    const directory = `${reportInput.sprintId}-${input.contract.sprints.find(({ id }) => id === reportInput.sprintId)?.slug}`;
    const publishedBytes = input.publishedCheckpointBytes.get(directory);
    if (publishedBytes === undefined) {
      throw new Error(`final evidence manifest checkpoint is not being published: ${directory}`);
    }
    return {
      directory,
      checkpointFileSha256: createHash('sha256').update(publishedBytes, 'utf8').digest('hex'),
      recordedAt,
      evidenceHash: stableEvidenceHash(reportInput),
      input: reportInput as unknown as FinalEvidenceManifestCheckpointInput['input'],
    };
  });
  return deriveFinalEvidenceManifest({
    flowPath: input.flowPath,
    protocolVersion: input.protocolVersion,
    designEventId: input.designEventId,
    flowBaseSha: input.flowBaseSha,
    currentReviewedHeadSha: input.currentHeadSha,
    productToCurrentCompareStatus: deriveCompareStatus(
      finalProductHeadSha, input.currentHeadSha, input.changedPathsSinceFinalHead,
    ),
    checkpoints,
    contractRows,
    workflowMatrixSha256: createHash('sha256').update(input.matrix, 'utf8').digest('hex'),
    skippedChecks: [],
    mandatoryCommands: finalGatePolicy.mandatoryCommands,
  }) as Record<string, unknown> & { payloadSha256: string };
}

export async function publishAggregateReport(
  repoRoot: string,
  snapshot: FlowSnapshot,
  options: { context?: WorktreeContext } = {},
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
  // Optional canonical final-evidence manifest (e.g. FinalWorkflowEvidenceManifestV1 —
  // design-mandated exact-HEAD evidence): when the flow's tooling has generated one next
  // to the recorded checkpoints, publish it as part of the event roster so the reviewer
  // can validate every report/checkpoint/matrix file against a single self-hashed source.
  // SPR-003 (universal-integrity-core §8.8): the harness never trusts the prebuilt file —
  // it re-validates roster + canonical self-hash through the shared codec and reconciles
  // the manifest's current HEAD, checkpoint file hashes, and matrix hash against the
  // exact bytes THIS publication is writing.
  const manifestSource = isRemediation
    ? path.join(
        packetRoot,
        'remediation',
        snapshot.latestEvent.marker.eventId,
        'FINAL-EVIDENCE-MANIFEST.json',
      )
    : path.join(packetRoot, 'sprints', 'FINAL-EVIDENCE-MANIFEST.json');
  if (await exists(manifestSource)) {
    const manifestText = (await readFlowFileOnce(
      path.dirname(manifestSource), path.basename(manifestSource), MAX_PACKET_FILE_BYTES, 'FINAL-EVIDENCE-MANIFEST.json',
    )).toString('utf8');
    let parsedManifest: unknown;
    try {
      parsedManifest = JSON.parse(manifestText);
    } catch {
      throw new Error('final evidence manifest is not valid JSON');
    }
    validateFinalEvidenceManifest(parsedManifest);
    const manifest = parsedManifest as {
      currentReviewedHeadSha: string;
      skippedChecks: readonly string[];
      payloadSha256: string;
    };
    if (manifest.currentReviewedHeadSha !== headSha) {
      throw new Error('final evidence manifest is not bound to the current code HEAD');
    }
    // r08 FND-020: an approval-eligible manifest may not represent ANY check as skipped.
    if (manifest.skippedChecks.length > 0) {
      throw new Error('final evidence manifest may not declare skipped checks');
    }
    // r08 FND-020: the publisher INDEPENDENTLY reconstructs the complete expected
    // manifest through the ONE shared pure derivation, over the normalized checkpoint
    // inputs and the EXACT checkpoint/matrix bytes this publication is writing, with the
    // COMPLETE design-required mandatory command roster enforced inside the derivation
    // and the compare status DERIVED from git facts (never from the supplied manifest).
    // Self-hash equality over the exact-keys canonical form is required, so a
    // self-consistent rehashed manifest that omits mandatory QA, a contract row, a
    // checkpoint, alters compare status or skipped checks, or alters any
    // flow/design/base/final binding cannot publish.
    if (!state.designEventId) {
      throw new Error('final evidence manifest requires a design-bound flow');
    }
    if (!contract) {
      throw new Error('final evidence manifest requires the active design contract');
    }
    const category = isRemediation ? 'remediation' : 'sprints';
    const publishedCheckpointBytes = new Map<string, string>();
    for (const [filePath, content] of files) {
      const match = filePath.match(new RegExp(`^${reportRoot}/${category}/([^/]+)/CHECKPOINT\\.json$`, 'u'));
      if (match) publishedCheckpointBytes.set(match[1]!, content);
    }
    const finalHead = recorded.at(-1)?.input.headSha ?? headSha;
    const changedPathsSinceFinalHead = finalHead === headSha
      ? []
      : (await runGit(repoRoot, ['diff', '--name-only', `${finalHead}..${headSha}`]))
          .stdout.split('\n').map((line) => line.trim()).filter(Boolean);
    let expected: { payloadSha256: string };
    try {
      expected = reconstructExpectedManifest({
        flowPath: snapshot.flow.flowPath,
        protocolVersion: snapshot.flow.protocol.version,
        designEventId: state.designEventId,
        flowBaseSha: snapshot.flow.baseSha,
        currentHeadSha: headSha,
        changedPathsSinceFinalHead,
        contract,
        recorded,
        publishedCheckpointBytes,
        matrix,
      });
    } catch (error) {
      throw new Error(`final evidence manifest reconstruction failed: ${
        error instanceof Error ? error.message : String(error)}`);
    }
    if (expected.payloadSha256 !== manifest.payloadSha256) {
      throw new Error('final evidence manifest does not match its independent reconstruction');
    }
    files.set(`${reportRoot}/FINAL-EVIDENCE-MANIFEST.json`, manifestText);
  }
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
    {
      cwd: repoRoot,
      ...(options.context ? { context: options.context } : {}),
    },
  );
}

export { workflowMatrixMarkdown };
