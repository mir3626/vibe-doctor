import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  parseContractJson,
  parseEventCompleteJson,
  parseFlowJson,
  validateContractSemantics,
  validateEventChain,
} from '../src/pro-roundtrip/contract.js';
import type { ProRoundtripEventComplete } from '../src/lib/schemas/pro-roundtrip.js';
import {
  allocateDailyFlowPath,
  loadFlowSnapshot,
  slugifyGoal,
} from '../src/pro-roundtrip/flow-store.js';

const tempDirs: string[] = [];
const fixtureRoot = path.resolve('.vibe', 'harness', 'test', 'fixtures', 'pro-roundtrip');

afterEach(async () => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'pro-roundtrip-contract-'));
  tempDirs.push(directory);
  return directory;
}

async function writeText(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}

describe('pro roundtrip contract', () => {
  it('validates the golden flow, design event, and semantic contract', async () => {
    const flow = parseFlowJson(
      await readFile(path.join(fixtureRoot, 'FLOW.json'), 'utf8'),
    );
    const contract = parseContractJson(
      await readFile(path.join(fixtureRoot, 'CONTRACT.json'), 'utf8'),
    );
    const event = parseEventCompleteJson(
      await readFile(path.join(fixtureRoot, 'COMPLETE.json'), 'utf8'),
    );

    assert.doesNotThrow(() => validateContractSemantics(flow, event, contract));
  });

  it('rejects duplicate ownership and Sprint dependency cycles', async () => {
    const flow = parseFlowJson(
      await readFile(path.join(fixtureRoot, 'FLOW.json'), 'utf8'),
    );
    const contract = parseContractJson(
      await readFile(path.join(fixtureRoot, 'CONTRACT.json'), 'utf8'),
    );
    const event = parseEventCompleteJson(
      await readFile(path.join(fixtureRoot, 'COMPLETE.json'), 'utf8'),
    );
    const second = structuredClone(contract.sprints[0]);
    assert.ok(second);
    second.id = 'SPR-002';
    second.slug = 'second-sprint';
    second.dependsOn = ['SPR-001'];
    contract.sprints.push(second);
    contract.sprints[0]?.dependsOn.push('SPR-002');

    assert.throws(
      () => validateContractSemantics(flow, event, contract),
      /owned by both|dependency cycle/,
    );
  });

  it('allocates visible flat daily paths and requires an explicit slug for non-ASCII goals', () => {
    assert.equal(
      allocateDailyFlowPath(
        ['001-first-flow', '003-third-flow', 'notes'],
        '20260719',
        'github-pro-review-loop',
      ),
      'flows/20260719/004-github-pro-review-loop',
    );
    assert.equal(slugifyGoal('Review the GitHub Pro loop'), 'review-the-github-pro-loop');
    assert.throws(() => slugifyGoal('상세 설계'), /provide --slug/);
  });

  it('ignores incomplete events but validates completed event rosters and chain order', async () => {
    const root = await makeTempDir();
    const flow = parseFlowJson(
      await readFile(path.join(fixtureRoot, 'FLOW.json'), 'utf8'),
    );
    const flowRoot = path.join(root, ...flow.flowPath.split('/'));
    const goalDirectory = path.join(flowRoot, '0000--cli--goal--r01');
    const designDirectory = path.join(flowRoot, '0100--pro--design--r01');
    const goalMarker = {
      schemaVersion: 'vibe-pro-event-complete-v1',
      flowPath: flow.flowPath,
      eventId: '0000--cli--goal--r01',
      sequence: 0,
      actor: 'cli',
      kind: 'goal',
      revision: 1,
      previousEventId: null,
      supersedesEventId: null,
      protocolVersion: 'v1',
      designEventId: null,
      sprintId: null,
      repositoryFullName: flow.repository.fullName,
      codeBranch: flow.codeBranch,
      baseSha: flow.baseSha,
      headSha: flow.baseSha,
      disposition: 'complete',
      files: [{ path: 'GOAL.md', mediaType: 'text/markdown' }],
      limitations: [],
      createdAt: flow.createdAt,
      nextActor: 'pro',
      nextWriteTarget: `${flow.flowPath}/0100--pro--design--r01`,
    };
    await writeText(path.join(flowRoot, 'FLOW.json'), `${JSON.stringify(flow, null, 2)}\n`);
    await writeText(path.join(goalDirectory, 'GOAL.md'), '# Goal\n');
    await writeText(
      path.join(goalDirectory, 'COMPLETE.json'),
      `${JSON.stringify(goalMarker, null, 2)}\n`,
    );
    await writeText(path.join(designDirectory, 'DESIGN.md'), '# Partial design\n');
    // r08 FND-019: the snapshot is read from the IMMUTABLE Git object store at the
    // pinned bridge commit, so the fixture must be a committed git tree.
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    const git = (args: string[]) => execFileAsync('git', args, { cwd: root, windowsHide: true });
    await git(['init', '--initial-branch=main']);
    await git(['config', 'user.name', 'Roundtrip Test']);
    await git(['config', 'user.email', 'roundtrip@example.invalid']);
    await git(['add', '-A']);
    await git(['commit', '-m', 'fixture']);

    const snapshot = await loadFlowSnapshot(root, flow.flowPath);

    assert.equal(snapshot.latestEvent.marker.kind, 'goal');
    assert.deepEqual(snapshot.incompleteEventDirectories, ['0100--pro--design--r01']);
    assert.match(snapshot.bridgeHeadSha, /^[a-f0-9]{40}$/u);
    // Payload bytes come from the pinned commit, not the worktree: mutating the file on
    // disk does not change what the snapshot reads.
    await writeText(path.join(goalDirectory, 'GOAL.md'), '# Tampered\n');
    const exact = await snapshot.latestEvent.readPayloadExact('GOAL.md');
    assert.equal(exact.bytes.toString('utf8'), '# Goal\n');
    assert.match(exact.blobSha, /^[a-f0-9]{40}$/u);
    assert.equal(exact.byteSize, exact.bytes.length);
  });

  it('r04 FND-022: reads exact non-ASCII bytes and fails closed on invalid UTF-8 / NUL blobs', async () => {
    const { writeFile } = await import('node:fs/promises');
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    const root = await makeTempDir();
    const flow = parseFlowJson(await readFile(path.join(fixtureRoot, 'FLOW.json'), 'utf8'));
    const flowRoot = path.join(root, ...flow.flowPath.split('/'));
    const goalDirectory = path.join(flowRoot, '0000--cli--goal--r01');
    // Valid non-ASCII (Korean) content — its exact bytes must survive the transport.
    const korean = Buffer.from('# 목표: 한글 바이트 보존\n', 'utf8');
    const goalMarker = {
      schemaVersion: 'vibe-pro-event-complete-v1',
      flowPath: flow.flowPath, eventId: '0000--cli--goal--r01', sequence: 0,
      actor: 'cli', kind: 'goal', revision: 1, previousEventId: null, supersedesEventId: null,
      protocolVersion: 'v1', designEventId: null, sprintId: null,
      repositoryFullName: flow.repository.fullName, codeBranch: flow.codeBranch,
      baseSha: flow.baseSha, headSha: flow.baseSha, disposition: 'complete',
      files: [{ path: 'GOAL.md', mediaType: 'text/markdown' }], limitations: [],
      createdAt: flow.createdAt, nextActor: 'pro',
      nextWriteTarget: `${flow.flowPath}/0100--pro--design--r01`,
    };
    await writeText(path.join(flowRoot, 'FLOW.json'), `${JSON.stringify(flow, null, 2)}\n`);
    await mkdir(goalDirectory, { recursive: true });
    await writeFile(path.join(goalDirectory, 'GOAL.md'), korean);
    await writeText(path.join(goalDirectory, 'COMPLETE.json'), `${JSON.stringify(goalMarker, null, 2)}\n`);
    const git = (args: string[]) => execFileAsync('git', args, { cwd: root, windowsHide: true });
    await git(['init', '--initial-branch=main']);
    await git(['config', 'user.name', 'Roundtrip Test']);
    await git(['config', 'user.email', 'roundtrip@example.invalid']);
    await git(['add', '-A']);
    await git(['commit', '-m', 'fixture']);

    // Valid non-ASCII: the raw blob bytes are byte-exact across accessor and receipt.
    const snapshot = await loadFlowSnapshot(root, flow.flowPath);
    const exact = await snapshot.latestEvent.readPayloadExact('GOAL.md');
    assert.ok(exact.bytes.equals(korean));
    assert.equal(exact.byteSize, korean.length);

    // Invalid UTF-8 Markdown blob: fatal decode fails before any packet use.
    const invalidRoot = await makeTempDir();
    const invalidFlowRoot = path.join(invalidRoot, ...flow.flowPath.split('/'));
    const invalidGoal = path.join(invalidFlowRoot, '0000--cli--goal--r01');
    await writeText(path.join(invalidFlowRoot, 'FLOW.json'), `${JSON.stringify(flow, null, 2)}\n`);
    await mkdir(invalidGoal, { recursive: true });
    await writeFile(path.join(invalidGoal, 'GOAL.md'), Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a]));
    await writeText(path.join(invalidGoal, 'COMPLETE.json'), `${JSON.stringify(goalMarker, null, 2)}\n`);
    const ig = (args: string[]) => execFileAsync('git', args, { cwd: invalidRoot, windowsHide: true });
    await ig(['init', '--initial-branch=main']);
    await ig(['config', 'user.name', 'Roundtrip Test']);
    await ig(['config', 'user.email', 'roundtrip@example.invalid']);
    await ig(['add', '-A']);
    await ig(['commit', '-m', 'invalid-utf8']);
    await assert.rejects(loadFlowSnapshot(invalidRoot, flow.flowPath), /not valid UTF-8/u);

    // NUL-bearing blob: fails before parse/copy.
    const nulRoot = await makeTempDir();
    const nulFlowRoot = path.join(nulRoot, ...flow.flowPath.split('/'));
    const nulGoal = path.join(nulFlowRoot, '0000--cli--goal--r01');
    await writeText(path.join(nulFlowRoot, 'FLOW.json'), `${JSON.stringify(flow, null, 2)}\n`);
    await mkdir(nulGoal, { recursive: true });
    await writeFile(path.join(nulGoal, 'GOAL.md'), Buffer.from([0x23, 0x00, 0x0a]));
    await writeText(path.join(nulGoal, 'COMPLETE.json'), `${JSON.stringify(goalMarker, null, 2)}\n`);
    const ng = (args: string[]) => execFileAsync('git', args, { cwd: nulRoot, windowsHide: true });
    await ng(['init', '--initial-branch=main']);
    await ng(['config', 'user.name', 'Roundtrip Test']);
    await ng(['config', 'user.email', 'roundtrip@example.invalid']);
    await ng(['add', '-A']);
    await ng(['commit', '-m', 'nul']);
    await assert.rejects(loadFlowSnapshot(nulRoot, flow.flowPath), /NUL bytes/u);
  });

  it('accepts a Web Pro-origin goal that continues directly into design', () => {
    const flowPath = 'flows/20260719/001-web-origin-review';
    const baseSha = 'a'.repeat(40);
    const rootGoal: ProRoundtripEventComplete = {
      schemaVersion: 'vibe-pro-event-complete-v1',
      flowPath,
      eventId: '0000--pro--goal--r01',
      sequence: 0,
      actor: 'pro',
      kind: 'goal',
      revision: 1,
      previousEventId: null,
      supersedesEventId: null,
      protocolVersion: 'v1',
      designEventId: null,
      sprintId: null,
      repositoryFullName: 'owner/repo',
      codeBranch: 'main',
      baseSha,
      headSha: baseSha,
      disposition: 'complete',
      files: [{ path: 'GOAL.md', mediaType: 'text/markdown' }],
      limitations: [],
      createdAt: '2026-07-19T12:00:00Z',
      nextActor: 'pro',
      nextWriteTarget: `${flowPath}/0100--pro--design--r01`,
    };
    const design: ProRoundtripEventComplete = {
      ...rootGoal,
      eventId: '0100--pro--design--r01',
      sequence: 100,
      kind: 'design',
      previousEventId: rootGoal.eventId,
      designEventId: '0100--pro--design--r01',
      files: [
        { path: 'DESIGN.md', mediaType: 'text/markdown' },
        { path: 'CONTRACT.json', mediaType: 'application/json' },
        { path: 'SPRINTS.md', mediaType: 'text/markdown' },
      ],
      nextActor: 'codex',
      nextWriteTarget: `${flowPath}/0200--codex--implementation-report--r01`,
    };

    assert.doesNotThrow(() => validateEventChain([rootGoal, design]));
  });

  it('keeps design-less audit events explicitly bound to null through feedback and approval', () => {
    const base: Omit<
      ProRoundtripEventComplete,
      | 'eventId'
      | 'sequence'
      | 'actor'
      | 'kind'
      | 'previousEventId'
      | 'disposition'
      | 'nextActor'
      | 'nextWriteTarget'
    > = {
      schemaVersion: 'vibe-pro-event-complete-v1',
      flowPath: 'flows/20260719/001-audit-flow',
      revision: 1,
      supersedesEventId: null,
      protocolVersion: 'v1',
      designEventId: null,
      sprintId: null,
      repositoryFullName: 'owner/repo',
      codeBranch: 'main',
      baseSha: 'a'.repeat(40),
      headSha: 'a'.repeat(40),
      files: [{ path: 'REPORT.md', mediaType: 'text/markdown' }],
      limitations: [],
      createdAt: '2026-07-19T11:00:00Z',
    };
    const events: ProRoundtripEventComplete[] = [
      {
        ...base,
        eventId: '0000--cli--goal--r01',
        sequence: 0,
        actor: 'cli',
        kind: 'goal',
        previousEventId: null,
        disposition: 'complete',
        files: [{ path: 'GOAL.md', mediaType: 'text/markdown' }],
        nextActor: 'codex',
        nextWriteTarget:
          'flows/20260719/001-audit-flow/0100--codex--implementation-report--r01',
      },
      {
        ...base,
        eventId: '0100--codex--implementation-report--r01',
        sequence: 100,
        actor: 'codex',
        kind: 'implementation-report',
        previousEventId: '0000--cli--goal--r01',
        disposition: 'complete',
        nextActor: 'pro',
        nextWriteTarget: 'flows/20260719/001-audit-flow/0200--pro--feedback--r01',
      },
      {
        ...base,
        eventId: '0200--pro--feedback--r01',
        sequence: 200,
        actor: 'pro',
        kind: 'feedback',
        previousEventId: '0100--codex--implementation-report--r01',
        disposition: 'approved',
        files: [{ path: 'FEEDBACK.md', mediaType: 'text/markdown' }],
        nextActor: 'pro',
        nextWriteTarget: 'flows/20260719/001-audit-flow/0300--pro--approval--r01',
      },
      {
        ...base,
        eventId: '0300--pro--approval--r01',
        sequence: 300,
        actor: 'pro',
        kind: 'approval',
        previousEventId: '0200--pro--feedback--r01',
        disposition: 'approved',
        files: [{ path: 'APPROVAL.md', mediaType: 'text/markdown' }],
        nextActor: 'cli',
        nextWriteTarget: 'flows/20260719/001-audit-flow/9900--cli--closed--r01',
      },
    ];

    assert.doesNotThrow(() => validateEventChain(events));
  });
});

// r08 FND-020: the publisher's independent manifest reconstruction — mandatory-roster
// enforcement, derived compare status, and rehash-forgery rejection at publisher level.
describe('r08/r04 publisher manifest reconstruction', async () => {
  const { deriveCompareStatus, reconstructExpectedManifest } = await import('../src/pro-roundtrip/report.js');
  const { appendSelfHash, stripField, HASH_PROFILE_CANONICAL_JSON_V1 } =
    await import('../src/universal-integrity-core/index.js');
  // FND-023 (upstream shape): the mandatory roster is declared by the design event itself
  // via CONTRACT.json's finalGatePolicy block — immutable through the pinned bridge blob.
  const FLOW = 'flows/20260721/001-sample-flow';
  const DESIGN = '0100--pro--design--r01';
  const MANDATORY_COMMANDS = [
    'npx tsc -p tsconfig.json --noEmit',
    'npx vitest run',
    'npm run vibe:qa',
  ];
  const baseSha = 'a'.repeat(40);
  const headSha = 'b'.repeat(40);
  const contract = {
    schemaVersion: 'vibe-pro-contract-v1',
    flowPath: FLOW,
    designEventId: DESIGN,
    requirements: [{ id: 'REQ-001' }],
    invariants: [{ id: 'INV-001' }],
    workflows: [{ id: 'WF-001' }],
    nonFunctionalRequirements: [{ id: 'NFR-001' }],
    sprints: [{
      id: 'SPR-001', slug: 'sample',
      owns: ['REQ-001', 'NFR-001'], preserves: ['INV-001'], workflowsAffected: ['WF-001'],
    }],
    finalGatePolicy: { mandatoryCommands: MANDATORY_COMMANDS },
  } as unknown as import('../src/lib/schemas/pro-roundtrip.js').ProRoundtripContract;
  const evidenceRow = (contractId: string) => ({
    contractId, implementationEvidence: 'impl', testEvidence: 'test',
    integrationEvidence: 'integration', status: 'complete', notes: '',
  });
  const reportInput = (verification: { command: string; status: string; summary: string }[]) => ({
    schemaVersion: 'vibe-pro-report-input-v1',
    flowPath: FLOW,
    designEventId: DESIGN,
    sprintId: 'SPR-001',
    reportKind: 'implementation',
    baseSha, headSha,
    completedContractIds: ['REQ-001'],
    changedFiles: ['src/x.ts'],
    verification,
    workflowEvidence: ['REQ-001', 'INV-001', 'WF-001', 'NFR-001'].map(evidenceRow),
    sprintGatePassed: true,
    cumulativeGatePassed: true,
    finalGatePassed: true,
    resolvedFindingIds: [],
    risks: [],
    nextAction: 'none',
  }) as unknown as import('../src/lib/schemas/pro-roundtrip.js').ProRoundtripReportInput;
  const fullRoster = () => MANDATORY_COMMANDS
    .map((command) => ({ command, status: 'passed', summary: 'green' }));
  const reconstruction = (verification = fullRoster()) => reconstructExpectedManifest({
    flowPath: FLOW,
    protocolVersion: 'v1@' + '9'.repeat(40),
    designEventId: DESIGN,
    flowBaseSha: baseSha,
    currentHeadSha: headSha,
    changedPathsSinceFinalHead: [],
    contract,
    recorded: [{ input: reportInput(verification), recordedAt: '2026-07-21T00:00:00.000Z' }],
    publishedCheckpointBytes: new Map([['SPR-001-sample', '{"checkpoint":"bytes"}\n']]),
    matrix: '# Workflow Matrix\n',
  });

  it('derives compare status from git facts and fails closed on product deltas', () => {
    assert.equal(deriveCompareStatus(headSha, headSha, []), 'identical');
    assert.equal(
      deriveCompareStatus(baseSha, headSha, ['.vibe/agent/session-log.md']),
      'agent-state-only: .vibe/agent/session-log.md',
    );
    assert.throws(
      () => deriveCompareStatus(baseSha, headSha, ['src/index.ts']),
      /product bytes changed after the final gate/u,
    );
    assert.throws(
      () => deriveCompareStatus(baseSha, headSha, []),
      /product bytes changed after the final gate/u,
    );
  });

  it('enforces the COMPLETE design-declared mandatory roster inside the reconstruction', () => {
    const expected = reconstruction();
    assert.equal(typeof expected.payloadSha256, 'string');
    for (const command of MANDATORY_COMMANDS) {
      const withoutOne = fullRoster().filter((item) => item.command !== command);
      assert.throws(() => reconstruction(withoutOne), /mandatory QA command is missing/u, command);
    }
    const withFailure = fullRoster().map((item) =>
      item.command === 'npx vitest run' ? { ...item, status: 'failed' } : item);
    assert.throws(() => reconstruction(withFailure), /not uniformly passed/u);
    const withConflict = [...fullRoster(), { command: 'npx vitest run', status: 'failed', summary: 'red' }];
    assert.throws(() => reconstruction(withConflict), /not uniformly passed/u);
  });

  it('FND-023: a design that declares no finalGatePolicy cannot be reconstructed', () => {
    const bare = {
      ...(contract as unknown as Record<string, unknown>),
    } as unknown as import('../src/lib/schemas/pro-roundtrip.js').ProRoundtripContract & {
      finalGatePolicy?: unknown;
    };
    delete bare.finalGatePolicy;
    assert.throws(
      () => reconstructExpectedManifest({
        flowPath: FLOW,
        protocolVersion: 'v1@' + '9'.repeat(40),
        designEventId: DESIGN,
        flowBaseSha: baseSha,
        currentHeadSha: headSha,
        changedPathsSinceFinalHead: [],
        contract: bare,
        recorded: [{ input: reportInput(fullRoster()), recordedAt: '2026-07-21T00:00:00.000Z' }],
        publishedCheckpointBytes: new Map([['SPR-001-sample', '{"checkpoint":"bytes"}\n']]),
        matrix: '# Workflow Matrix\n',
      }),
      /declares no finalGatePolicy/u,
    );
  });

  it('FND-023: the contract schema accepts a finalGatePolicy block and rejects an empty roster', async () => {
    const { parseContractJson } = await import('../src/pro-roundtrip/contract.js');
    const fixture = JSON.parse(
      await readFile(path.join(fixtureRoot, 'CONTRACT.json'), 'utf8'),
    ) as Record<string, unknown>;
    const withPolicy = parseContractJson(JSON.stringify({
      ...fixture,
      finalGatePolicy: { mandatoryCommands: MANDATORY_COMMANDS },
    }));
    assert.deepEqual(withPolicy.finalGatePolicy?.mandatoryCommands, MANDATORY_COMMANDS);
    assert.throws(() => parseContractJson(JSON.stringify({
      ...fixture,
      finalGatePolicy: { mandatoryCommands: [] },
    })));
  });

  it('rejects self-consistent rehashes of compare status and skipped checks by payload inequality', () => {
    const expected = reconstruction();
    const rehash = (mutate: (unsigned: Record<string, unknown>) => void) => {
      const unsigned = stripField(expected, 'payloadSha256');
      mutate(unsigned);
      return appendSelfHash(unsigned, 'payloadSha256', HASH_PROFILE_CANONICAL_JSON_V1) as {
        payloadSha256: string;
      };
    };
    const forgedCompare = rehash((unsigned) => {
      unsigned.productToCurrentCompareStatus = 'agent-state-only: forged';
    });
    assert.notEqual(forgedCompare.payloadSha256, expected.payloadSha256);
    const forgedSkipped = rehash((unsigned) => {
      unsigned.skippedChecks = ['npx vitest run'];
    });
    assert.notEqual(forgedSkipped.payloadSha256, expected.payloadSha256);
    const droppedCommand = rehash((unsigned) => {
      unsigned.qaRoster = (unsigned.qaRoster as { command: string }[])
        .filter(({ command }) => command !== 'npm run vibe:qa');
    });
    assert.notEqual(droppedCommand.payloadSha256, expected.payloadSha256);
  });
});


// r10 FND-024: FLOW.json and event COMPLETE.json are CONTROL DOCUMENTS — the snapshot
// must expose their exact pinned blob records so the packet copy is byte-exact and the
// receipts bind those blob identities.
describe('r10 control-document byte exactness', () => {
  it('exposes exact FLOW.json and COMPLETE.json blobs whose bytes survive byte-distinct-but-equal JSON', async () => {
    const { writeFile } = await import('node:fs/promises');
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { createHash } = await import('node:crypto');
    const execFileAsync = promisify(execFile);
    const root = await makeTempDir();
    const flow = parseFlowJson(await readFile(path.join(fixtureRoot, 'FLOW.json'), 'utf8'));
    const flowRoot = path.join(root, ...flow.flowPath.split('/'));
    const goalDirectory = path.join(flowRoot, '0000--cli--goal--r01');
    const goalMarker = {
      schemaVersion: 'vibe-pro-event-complete-v1',
      flowPath: flow.flowPath, eventId: '0000--cli--goal--r01', sequence: 0,
      actor: 'cli', kind: 'goal', revision: 1, previousEventId: null, supersedesEventId: null,
      protocolVersion: 'v1', designEventId: null, sprintId: null,
      repositoryFullName: flow.repository.fullName, codeBranch: flow.codeBranch,
      baseSha: flow.baseSha, headSha: flow.baseSha, disposition: 'complete',
      files: [{ path: 'GOAL.md', mediaType: 'text/markdown' }], limitations: [],
      createdAt: flow.createdAt, nextActor: 'pro',
      nextWriteTarget: `${flow.flowPath}/0100--pro--design--r01`,
    };
    // Byte-distinct but semantically identical serializations: 4-space indent for
    // FLOW.json and a compact single line for COMPLETE.json. A re-serializing packet
    // copy would silently normalize both.
    const flowBytes = Buffer.from(`${JSON.stringify(flow, null, 4)}\n`, 'utf8');
    const markerBytes = Buffer.from(JSON.stringify(goalMarker), 'utf8');
    await mkdir(goalDirectory, { recursive: true });
    await writeFile(path.join(flowRoot, 'FLOW.json'), flowBytes);
    await writeFile(path.join(goalDirectory, 'COMPLETE.json'), markerBytes);
    await writeText(path.join(goalDirectory, 'GOAL.md'), '# Goal\n');
    const git = (args: string[]) => execFileAsync('git', args, { cwd: root, windowsHide: true });
    await git(['init', '--initial-branch=main']);
    await git(['config', 'user.name', 'Roundtrip Test']);
    await git(['config', 'user.email', 'roundtrip@example.invalid']);
    await git(['add', '-A']);
    await git(['commit', '-m', 'control-documents']);

    const snapshot = await loadFlowSnapshot(root, flow.flowPath);
    // The exact source bytes are preserved — NOT a canonical re-serialization.
    assert.ok(snapshot.flowBlob.bytes.equals(flowBytes));
    assert.notEqual(
      snapshot.flowBlob.bytes.toString('utf8'),
      `${JSON.stringify(snapshot.flow, null, 2)}\n`,
    );
    assert.ok(snapshot.latestEvent.markerBlob.bytes.equals(markerBytes));
    assert.notEqual(
      snapshot.latestEvent.markerBlob.bytes.toString('utf8'),
      `${JSON.stringify(snapshot.latestEvent.marker, null, 2)}\n`,
    );
    // Blob identities are the real Git object SHAs of those exact bytes.
    const gitBlobSha = async (relative: string) =>
      (await execFileAsync('git', ['hash-object', relative], { cwd: root, windowsHide: true }))
        .stdout.trim();
    assert.equal(snapshot.flowBlob.blobSha, await gitBlobSha(`${flow.flowPath}/FLOW.json`));
    assert.equal(
      snapshot.latestEvent.markerBlob.blobSha,
      await gitBlobSha(`${flow.flowPath}/0000--cli--goal--r01/COMPLETE.json`),
    );
    assert.equal(snapshot.flowBlob.byteSize, flowBytes.length);
    assert.equal(
      createHash('sha256').update(snapshot.latestEvent.markerBlob.bytes).digest('hex'),
      createHash('sha256').update(markerBytes).digest('hex'),
    );
  });

  it('fails closed on invalid-UTF-8 and NUL control documents before any packet use', async () => {
    const { writeFile } = await import('node:fs/promises');
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    const flow = parseFlowJson(await readFile(path.join(fixtureRoot, 'FLOW.json'), 'utf8'));
    const build = async (corrupt: 'flow' | 'marker', bytes: Buffer) => {
      const root = await makeTempDir();
      const flowRoot = path.join(root, ...flow.flowPath.split('/'));
      const goalDirectory = path.join(flowRoot, '0000--cli--goal--r01');
      const goalMarker = {
        schemaVersion: 'vibe-pro-event-complete-v1',
        flowPath: flow.flowPath, eventId: '0000--cli--goal--r01', sequence: 0,
        actor: 'cli', kind: 'goal', revision: 1, previousEventId: null, supersedesEventId: null,
        protocolVersion: 'v1', designEventId: null, sprintId: null,
        repositoryFullName: flow.repository.fullName, codeBranch: flow.codeBranch,
        baseSha: flow.baseSha, headSha: flow.baseSha, disposition: 'complete',
        files: [{ path: 'GOAL.md', mediaType: 'text/markdown' }], limitations: [],
        createdAt: flow.createdAt, nextActor: 'pro',
        nextWriteTarget: `${flow.flowPath}/0100--pro--design--r01`,
      };
      await mkdir(goalDirectory, { recursive: true });
      await writeText(path.join(goalDirectory, 'GOAL.md'), '# Goal\n');
      if (corrupt === 'flow') {
        await writeFile(path.join(flowRoot, 'FLOW.json'), bytes);
        await writeText(path.join(goalDirectory, 'COMPLETE.json'), `${JSON.stringify(goalMarker, null, 2)}\n`);
      } else {
        await writeText(path.join(flowRoot, 'FLOW.json'), `${JSON.stringify(flow, null, 2)}\n`);
        await writeFile(path.join(goalDirectory, 'COMPLETE.json'), bytes);
      }
      const g = (args: string[]) => execFileAsync('git', args, { cwd: root, windowsHide: true });
      await g(['init', '--initial-branch=main']);
      await g(['config', 'user.name', 'Roundtrip Test']);
      await g(['config', 'user.email', 'roundtrip@example.invalid']);
      await g(['add', '-A']);
      await g(['commit', '-m', `corrupt-${corrupt}`]);
      return root;
    };
    const invalidUtf8 = Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]);
    const withNul = Buffer.from([0x7b, 0x22, 0x61, 0x00, 0x22, 0x7d]);
    await assert.rejects(
      loadFlowSnapshot(await build('flow', invalidUtf8), flow.flowPath), /not valid UTF-8/u);
    await assert.rejects(
      loadFlowSnapshot(await build('flow', withNul), flow.flowPath), /NUL bytes/u);
    // A corrupt COMPLETE.json fails the whole snapshot load (it is never silently
    // skipped as "incomplete"), so no packet copy, state write, or receipt can occur.
    const markerRoot = await build('marker', invalidUtf8);
    await assert.rejects(
      loadFlowSnapshot(markerRoot, flow.flowPath),
      /COMPLETE\.json: payload is not valid UTF-8/u,
    );
    const markerNulRoot = await build('marker', withNul);
    await assert.rejects(
      loadFlowSnapshot(markerNulRoot, flow.flowPath),
      /COMPLETE\.json: payload contains NUL bytes/u,
    );
  });
});
