import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import { promisify } from 'node:util';
import { executeProRoundtrip } from '../src/commands/pro-roundtrip.js';
import type {
  ProRoundtripContract,
  ProRoundtripEventComplete,
  ProRoundtripFlow,
  ProRoundtripReportInput,
} from '../src/lib/schemas/pro-roundtrip.js';
import { publishAdditions } from '../src/pro-roundtrip/git-branch-transport.js';
import { packetRootFor } from '../src/pro-roundtrip/importer.js';
import {
  prepareBridgeWorktree,
  runGit,
  type WorktreeContext,
} from '../src/pro-roundtrip/worktree.js';

const execFile = promisify(execFileCallback);
const sourceRoot = process.cwd();
const cliPath = path.resolve('.vibe', 'harness', 'scripts', 'vibe-pro-go.mjs');

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFile('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  return result.stdout.trim();
}

async function writeText(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}

async function copyProtocolSources(checkout: string): Promise<void> {
  const paths = [
    'docs/context/workflow-integrity.md',
    '.claude/skills/vibe-pro-go/references/WEB-RUNBOOK.md',
    '.vibe/harness/schemas/pro-roundtrip-flow.schema.json',
    '.vibe/harness/schemas/pro-roundtrip-contract.schema.json',
    '.vibe/harness/schemas/pro-roundtrip-event-complete.schema.json',
  ];
  for (const relativePath of paths) {
    await writeText(
      path.join(checkout, ...relativePath.split('/')),
      await readFile(path.join(sourceRoot, ...relativePath.split('/')), 'utf8'),
    );
  }
}

interface CliFixture {
  checkout: string;
  mainHead: string;
  context: WorktreeContext;
}

async function scaffoldRepository(testContext: TestContext): Promise<CliFixture> {
  const root = await mkdtemp(path.join(tmpdir(), 'pro-roundtrip-cli-'));
  testContext.after(() => rm(root, { recursive: true, force: true }));
  const remote = path.join(root, 'remote.git');
  const seed = path.join(root, 'seed');
  const checkout = path.join(root, 'checkout');
  await execFile('git', ['init', '--bare', remote], { windowsHide: true });
  await execFile('git', ['init', '--initial-branch=main', seed], { windowsHide: true });
  await git(seed, ['config', 'user.name', 'Roundtrip Test']);
  await git(seed, ['config', 'user.email', 'roundtrip@example.invalid']);
  await writeFile(path.join(seed, 'README.md'), '# Fixture\n', 'utf8');
  await git(seed, ['add', 'README.md']);
  await git(seed, ['commit', '-m', 'initial']);
  await git(seed, ['remote', 'add', 'origin', remote]);
  await git(seed, ['push', '-u', 'origin', 'main']);
  await git(seed, ['branch', 'vibe-pro-bridge']);
  await git(seed, ['push', 'origin', 'vibe-pro-bridge']);
  await execFile('git', ['clone', '--branch', 'main', remote, checkout], {
    windowsHide: true,
  });
  await git(checkout, ['config', 'user.name', 'Roundtrip Test']);
  await git(checkout, ['config', 'user.email', 'roundtrip@example.invalid']);
  await git(checkout, ['config', 'core.autocrlf', 'false']);
  await copyProtocolSources(checkout);
  return {
    checkout,
    mainHead: await git(checkout, ['rev-parse', 'HEAD']),
    context: await prepareBridgeWorktree(checkout),
  };
}

async function runCli(
  fixture: CliFixture,
  args: string[],
): Promise<Record<string, unknown>> {
  let result: unknown;
  await executeProRoundtrip(args, {
    cwd: fixture.checkout,
    preparedContext: fixture.context,
    writeOutput(value) {
      result = value;
    },
    setExitCode(exitCode) {
      throw new Error(`unexpected in-process exit code: ${exitCode}`);
    },
  });
  assert.notEqual(result, undefined, 'command must produce output');
  assert.equal(typeof result, 'object');
  return result as Record<string, unknown>;
}

async function publishDesignEvent(
  fixture: CliFixture,
  flowPath: string,
): Promise<{ flow: ProRoundtripFlow; contract: ProRoundtripContract }> {
  const { context } = fixture;
  const flow = JSON.parse(
    await readFile(path.join(context.worktreePath, ...flowPath.split('/'), 'FLOW.json'), 'utf8'),
  ) as ProRoundtripFlow;
  const contractTemplate = JSON.parse(
    await readFile(
      path.join(sourceRoot, 'docs', 'plans', 'github-pro-roundtrip', 'examples', 'CONTRACT.json'),
      'utf8',
    ),
  ) as ProRoundtripContract;
  const contract: ProRoundtripContract = {
    ...contractTemplate,
    flowPath,
    designEventId: '0100--pro--design--r01',
    createdAt: new Date().toISOString(),
  };
  const designRoot = `${flowPath}/0100--pro--design--r01`;
  const designMarker: ProRoundtripEventComplete = {
    schemaVersion: 'vibe-pro-event-complete-v1',
    flowPath,
    eventId: '0100--pro--design--r01',
    sequence: 100,
    actor: 'pro',
    kind: 'design',
    revision: 1,
    previousEventId: '0000--cli--goal--r01',
    supersedesEventId: null,
    protocolVersion: flow.protocol.version,
    designEventId: '0100--pro--design--r01',
    sprintId: null,
    repositoryFullName: flow.repository.fullName,
    codeBranch: flow.codeBranch,
    baseSha: flow.baseSha,
    headSha: flow.baseSha,
    disposition: 'complete',
    files: [
      { path: 'DESIGN.md', mediaType: 'text/markdown' },
      { path: 'CONTRACT.json', mediaType: 'application/json' },
      { path: 'SPRINTS.md', mediaType: 'text/markdown' },
    ],
    limitations: [],
    createdAt: new Date().toISOString(),
    nextActor: 'codex',
    nextWriteTarget: `${flowPath}/0200--codex--implementation-report--r01`,
  };
  await publishAdditions(
    new Map([
      [`${designRoot}/DESIGN.md`, '# Fixture design\n'],
      [`${designRoot}/CONTRACT.json`, `${JSON.stringify(contract, null, 2)}\n`],
      [`${designRoot}/SPRINTS.md`, '# SPR-001\n'],
      [`${designRoot}/COMPLETE.json`, `${JSON.stringify(designMarker, null, 2)}\n`],
    ]),
    'test: publish Web design',
    { context },
  );
  return { flow, contract };
}

describe('vibe-pro-go CLI', { concurrency: true }, () => {
  it('keeps the shipped Node wrapper connected to the TypeScript command', async () => {
    const result = await execFile(process.execPath, [cliPath, 'help'], {
      cwd: sourceRoot,
      encoding: 'utf8',
      windowsHide: true,
    });

    assert.match(result.stdout, /^Usage:\s+vibe-pro-go/m);
    assert.equal(result.stderr, '');
  });

  it('rejects a prepared bridge context owned by another checkout', async () => {
    const otherRoot = path.join(sourceRoot, 'not-the-current-checkout');

    await assert.rejects(
      executeProRoundtrip(['help'], {
        cwd: sourceRoot,
        preparedContext: {
          repoRoot: otherRoot,
          worktreePath: path.join(otherRoot, '.vibe', 'worktrees', 'pro-roundtrip'),
          markerPath: path.join(
            otherRoot,
            '.vibe',
            'worktrees',
            'pro-roundtrip.owner.json',
          ),
          remoteTip: 'a'.repeat(40),
        },
      }),
      /prepared bridge context does not belong/,
    );
  });

  it(
    'requires the root Web entry runbook on the pushed code branch before bootstrap',
    async (testContext) => {
      const fixture = await scaffoldRepository(testContext);
    await assert.rejects(
      runCli(fixture, [
        'bootstrap',
        '--repository',
        'fixture/repo',
        '--publish',
      ]),
      /bridge-runbook\.md must be committed and pushed unchanged/,
    );

    await writeFile(
      path.join(fixture.checkout, 'bridge-runbook.md'),
      await readFile(path.join(sourceRoot, 'bridge-runbook.md'), 'utf8'),
      'utf8',
    );
    await git(fixture.checkout, ['add', 'bridge-runbook.md']);
    await git(fixture.checkout, ['commit', '-m', 'docs: add Web bridge entry']);
    await git(fixture.checkout, ['push', 'origin', 'main']);
    await writeFile(
      path.join(fixture.checkout, 'pending-review.txt'),
      'current code head\n',
      'utf8',
    );
    await git(fixture.checkout, ['add', 'pending-review.txt']);
    await git(fixture.checkout, ['commit', '-m', 'test: advance local review head']);
    await assert.rejects(
      runCli(fixture, [
        'bootstrap',
        '--repository',
        'fixture/repo',
        '--publish',
      ]),
      /must be pushed at the exact local HEAD/,
    );
    await git(fixture.checkout, ['push', 'origin', 'main']);
    const bootstrapped = await runCli(fixture, [
      'bootstrap',
      '--repository',
      'fixture/repo',
      '--publish',
    ]);

    assert.equal(bootstrapped.action, 'bootstrap');
    assert.equal(bootstrapped.codeBranch, 'main');
    assert.equal(
      (bootstrapped.protocol as { bootstrapped: boolean }).bootstrapped,
      true,
    );
    },
  );

  it(
    'runs start → Web design import → Sprint checkpoint → aggregate publication',
    async (testContext) => {
      const fixture = await scaffoldRepository(testContext);
    const started = await runCli(fixture, [
      'start',
      'design',
      'Implement the roundtrip fixture',
      '--slug',
      'roundtrip-fixture',
      '--timezone',
      'Asia/Seoul',
      '--repository',
      'fixture/repo',
      '--publish',
    ]);
    const flowPath = String(started.flowPath);
    assert.match(flowPath, /^flows\/[0-9]{8}\/001-roundtrip-fixture$/);
    assert.equal(started.nextActor, 'pro');
    assert.match(String(started.webPrompt), /MUST NOT use Web Search/);
    assert.match(String(started.webPrompt), /protocol\/v1\/PROTOCOL\.json/);

    const protocolContext = fixture.context;
    const protocolManifest = JSON.parse(
      await readFile(
        path.join(protocolContext.worktreePath, 'protocol', 'v1', 'PROTOCOL.json'),
        'utf8',
      ),
    ) as { schemaVersion: string; files: Array<{ path: string; sha256: string }> };
    assert.equal(protocolManifest.schemaVersion, 'vibe-pro-protocol-manifest-v1');
    assert.equal(protocolManifest.files.length, 5);

    const { flow, contract } = await publishDesignEvent(fixture, flowPath);

    const synced = await runCli(fixture, ['sync', flowPath]);
    assert.deepEqual(synced.importedEventIds, [
      '0000--cli--goal--r01',
      '0100--pro--design--r01',
    ]);
    const packetRoot = packetRootFor(fixture.checkout, flowPath);
    assert.match(
      await readFile(path.join(packetRoot, 'sprints', 'SPR-001-end-to-end', 'SPRINT.md'), 'utf8'),
      /Design event: `0100--pro--design--r01`/,
    );
    const resumed = await runCli(fixture, []);
    assert.equal(resumed.action, 'go');
    assert.equal(resumed.flowPath, flowPath);
    assert.equal(resumed.currentSprintId, 'SPR-001');
    assert.equal(resumed.selection, 'latest-non-closed-current-repo-branch');
    assert.match(String(resumed.handoffPath), /HANDOFF\.md$/);
    assert.match(String(resumed.sprintEnvelopePath), /SPR-001-end-to-end[\\/]SPRINT\.md$/);
    const active = JSON.parse(
      await readFile(
        path.join(fixture.checkout, '.vibe', 'agent', 'pro-roundtrip', 'ACTIVE.json'),
        'utf8',
      ),
    ) as { flowPath: string; autoReportRequired: boolean };
    assert.equal(active.flowPath, flowPath);
    assert.equal(active.autoReportRequired, true);
    await writeFile(path.join(fixture.checkout, 'implemented.txt'), 'implementation\n', 'utf8');
    await git(fixture.checkout, ['add', 'implemented.txt']);
    await git(fixture.checkout, ['commit', '-m', 'feat: implement fixture']);
    const implementedHead = await git(fixture.checkout, ['rev-parse', 'HEAD']);

    const evidence: ProRoundtripReportInput = {
      schemaVersion: 'vibe-pro-report-input-v1',
      flowPath,
      designEventId: contract.designEventId,
      sprintId: 'SPR-001',
      reportKind: 'implementation',
      baseSha: flow.baseSha,
      headSha: implementedHead,
      completedContractIds: ['REQ-001', 'NFR-001'],
      changedFiles: ['implemented.txt'],
      verification: [
        {
          command: 'fixture verification',
          status: 'passed',
          summary: 'fixture passed',
        },
      ],
      workflowEvidence: [
        {
          contractId: 'REQ-001',
          implementationEvidence: 'fixture',
          testEvidence: 'fixture',
          integrationEvidence: 'fixture',
          status: 'complete',
          notes: '',
        },
        {
          contractId: 'INV-001',
          implementationEvidence: 'fixture',
          testEvidence: 'fixture',
          integrationEvidence: 'fixture',
          status: 'complete',
          notes: '',
        },
        {
          contractId: 'WF-001',
          implementationEvidence: 'fixture',
          testEvidence: 'fixture',
          integrationEvidence: 'fixture',
          status: 'complete',
          notes: '',
        },
        {
          contractId: 'NFR-001',
          implementationEvidence: 'fixture',
          testEvidence: 'fixture',
          integrationEvidence: 'fixture',
          status: 'complete',
          notes: '',
        },
      ],
      sprintGatePassed: true,
      cumulativeGatePassed: true,
      finalGatePassed: false,
      resolvedFindingIds: [],
      risks: [],
      nextAction: 'Request Web Pro review.',
    };
    const evidencePath = path.join(fixture.checkout, 'evidence.json');
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    const recorded = await runCli(fixture, [
      'report',
      flowPath,
      '--evidence',
      evidencePath,
    ]);
    assert.match(String(recorded.checkpointPath), /SPR-001-end-to-end$/);
    assert.equal(recorded.currentSprintId, null);

    await assert.rejects(
      runCli(fixture, ['report', flowPath, '--publish']),
      /final flow gate evidence is required/,
    );
    evidence.finalGatePassed = true;
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    await runCli(fixture, [
      'report',
      flowPath,
      '--evidence',
      evidencePath,
    ]);
    const published = await runCli(fixture, ['report', flowPath, '--publish']);
    assert.ok(published.published);
    const refreshed = fixture.context;
    assert.match(
      await readFile(
        path.join(
          refreshed.worktreePath,
          ...flowPath.split('/'),
          '0200--codex--implementation-report--r01',
          'WORKFLOW-MATRIX.md',
        ),
        'utf8',
      ),
      /\| WF-001 \| SPR-001 .* complete /,
    );
    assert.equal(await git(fixture.checkout, ['branch', '--show-current']), 'main');
    assert.equal(await git(fixture.checkout, ['rev-parse', 'HEAD']), implementedHead);
    assert.equal(await git(fixture.checkout, ['rev-parse', 'origin/main']), fixture.mainHead);

    const feedbackRoot = `${flowPath}/0300--pro--feedback--r01`;
    const feedbackMarker: ProRoundtripEventComplete = {
      schemaVersion: 'vibe-pro-event-complete-v1',
      flowPath,
      eventId: '0300--pro--feedback--r01',
      sequence: 300,
      actor: 'pro',
      kind: 'feedback',
      revision: 1,
      previousEventId: '0200--codex--implementation-report--r01',
      supersedesEventId: null,
      protocolVersion: flow.protocol.version,
      designEventId: contract.designEventId,
      sprintId: null,
      repositoryFullName: flow.repository.fullName,
      codeBranch: flow.codeBranch,
      baseSha: flow.baseSha,
      headSha: implementedHead,
      disposition: 'remediation-required',
      files: [
        { path: 'FEEDBACK.md', mediaType: 'text/markdown' },
        { path: 'FINDINGS.json', mediaType: 'application/json' },
      ],
      limitations: [],
      createdAt: new Date().toISOString(),
      nextActor: 'codex',
      nextWriteTarget: `${flowPath}/0400--codex--remediation-report--r01`,
    };
    await publishAdditions(
      new Map([
        [`${feedbackRoot}/FEEDBACK.md`, '# Remediation required\n'],
        [
          `${feedbackRoot}/FINDINGS.json`,
          `${JSON.stringify(
            {
              schemaVersion: 'vibe-pro-findings-v1',
              flowPath,
              eventId: feedbackMarker.eventId,
              reviewedHeadSha: implementedHead,
              disposition: 'remediation-required',
              findings: [
                {
                  id: 'FND-001',
                  taxonomy: 'implementation-defect',
                  severity: 'P1',
                  contractIds: ['REQ-001'],
                  summary: 'Fixture defect',
                  evidence: 'implemented.txt',
                  expectedBehavior: 'Fixture is remediated.',
                },
              ],
            },
            null,
            2,
          )}\n`,
        ],
        [`${feedbackRoot}/COMPLETE.json`, `${JSON.stringify(feedbackMarker, null, 2)}\n`],
      ]),
      'test: publish Web feedback',
      { context: fixture.context },
    );
    await runCli(fixture, ['sync', flowPath]);
    const remediationEvidence: ProRoundtripReportInput = {
      ...evidence,
      reportKind: 'remediation',
      resolvedFindingIds: ['FND-001'],
      nextAction: 'Request review of remediation.',
    };
    const remediationEvidencePath = path.join(fixture.checkout, 'remediation-evidence.json');
    await writeFile(
      remediationEvidencePath,
      `${JSON.stringify(remediationEvidence, null, 2)}\n`,
      'utf8',
    );
    await runCli(fixture, [
      'report',
      flowPath,
      '--evidence',
      remediationEvidencePath,
    ]);
    await runCli(fixture, ['report', flowPath, '--publish']);

    const secondFeedbackRoot = `${flowPath}/0500--pro--feedback--r02`;
    const secondFeedbackMarker: ProRoundtripEventComplete = {
      ...feedbackMarker,
      eventId: '0500--pro--feedback--r02',
      sequence: 500,
      revision: 2,
      previousEventId: '0400--codex--remediation-report--r01',
      disposition: 'approved',
      files: [
        { path: 'FEEDBACK.md', mediaType: 'text/markdown' },
        { path: 'FINDINGS.json', mediaType: 'application/json' },
      ],
      nextActor: 'pro',
      nextWriteTarget: `${flowPath}/0600--pro--approval--r01`,
    };
    await publishAdditions(
      new Map([
        [`${secondFeedbackRoot}/FEEDBACK.md`, '# Approved\n'],
        [
          `${secondFeedbackRoot}/FINDINGS.json`,
          `${JSON.stringify(
            {
              schemaVersion: 'vibe-pro-findings-v1',
              flowPath,
              eventId: secondFeedbackMarker.eventId,
              reviewedHeadSha: implementedHead,
              disposition: 'approved',
              findings: [],
            },
            null,
            2,
          )}\n`,
        ],
        [
          `${secondFeedbackRoot}/COMPLETE.json`,
          `${JSON.stringify(secondFeedbackMarker, null, 2)}\n`,
        ],
      ]),
      'test: approve remediation',
      { context: fixture.context },
    );
    const approvalRoot = `${flowPath}/0600--pro--approval--r01`;
    const approvalMarker: ProRoundtripEventComplete = {
      schemaVersion: 'vibe-pro-event-complete-v1',
      flowPath,
      eventId: '0600--pro--approval--r01',
      sequence: 600,
      actor: 'pro',
      kind: 'approval',
      revision: 1,
      previousEventId: secondFeedbackMarker.eventId,
      supersedesEventId: null,
      protocolVersion: flow.protocol.version,
      designEventId: contract.designEventId,
      sprintId: null,
      repositoryFullName: flow.repository.fullName,
      codeBranch: flow.codeBranch,
      baseSha: flow.baseSha,
      headSha: implementedHead,
      disposition: 'approved',
      files: [{ path: 'APPROVAL.md', mediaType: 'text/markdown' }],
      limitations: [],
      createdAt: new Date().toISOString(),
      nextActor: 'cli',
      nextWriteTarget: `${flowPath}/9900--cli--closed--r01`,
    };
    await publishAdditions(
      new Map([
        [`${approvalRoot}/APPROVAL.md`, '# Approved exact HEAD\n'],
        [`${approvalRoot}/COMPLETE.json`, `${JSON.stringify(approvalMarker, null, 2)}\n`],
      ]),
      'test: publish Web approval',
      { context: fixture.context },
    );
    await runCli(fixture, ['sync', flowPath]);
    await runCli(fixture, ['close', flowPath, '--publish']);
    const closed = fixture.context;
    assert.match(
      await readFile(
        path.join(
          closed.worktreePath,
          ...flowPath.split('/'),
          '9900--cli--closed--r01',
          'SUMMARY.md',
        ),
        'utf8',
      ),
      /The append-only archive is closed/,
    );
    },
  );

  it(
    'rejects a Web design that reviewed a stale code HEAD',
    async (testContext) => {
      const fixture = await scaffoldRepository(testContext);
    const started = await runCli(fixture, [
      'start',
      'design',
      'Stale HEAD fixture',
      '--slug',
      'stale-head-fixture',
      '--timezone',
      'Asia/Seoul',
      '--repository',
      'fixture/repo',
      '--publish',
    ]);
    const flowPath = String(started.flowPath);
    await publishDesignEvent(fixture, flowPath);
    await writeFile(path.join(fixture.checkout, 'changed-after-design.txt'), 'new head\n', 'utf8');
    await git(fixture.checkout, ['add', 'changed-after-design.txt']);
    await git(fixture.checkout, ['commit', '-m', 'test: advance code head']);

    await assert.rejects(
      runCli(fixture, ['sync', flowPath]),
      /stale reviewed HEAD/,
    );
    },
  );

  it(
    'rejects modify-then-current completed payload history on first sync',
    async (testContext) => {
      const fixture = await scaffoldRepository(testContext);
    const started = await runCli(fixture, [
      'start',
      'design',
      'Tamper history fixture',
      '--slug',
      'tamper-history-fixture',
      '--timezone',
      'Asia/Seoul',
      '--repository',
      'fixture/repo',
      '--publish',
    ]);
    const flowPath = String(started.flowPath);
    await publishDesignEvent(fixture, flowPath);
    const context = fixture.context;
    const designPath = path.join(
      context.worktreePath,
      ...flowPath.split('/'),
      '0100--pro--design--r01',
      'DESIGN.md',
    );
    await writeFile(designPath, '# Mutated completed design\n', 'utf8');
    await runGit(context.worktreePath, [
      'add',
      '--',
      `${flowPath}/0100--pro--design--r01/DESIGN.md`,
    ]);
    await runGit(context.worktreePath, ['commit', '-m', 'test: mutate completed event']);
    await runGit(context.worktreePath, [
      'push',
      'origin',
      'HEAD:refs/heads/vibe-pro-bridge',
    ]);

    await assert.rejects(
      runCli(fixture, ['sync', flowPath]),
      /append-only history violation/,
    );
    },
  );
});
