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
  ensureProtocol,
  loadLocalProtocol,
  verifyPinnedProtocol,
} from '../src/pro-roundtrip/protocol.js';
import {
  prepareBridgeWorktree,
  runGit,
  type WorktreeContext,
} from '../src/pro-roundtrip/worktree.js';

const execFile = promisify(execFileCallback);
const sourceRoot = process.cwd();
const cliPath = path.resolve('.vibe', 'harness', 'scripts', 'vibe-pro-go.mjs');
const fixtureRoot = path.resolve('.vibe', 'harness', 'test', 'fixtures', 'pro-roundtrip');
const protocolSourcePaths = [
  'docs/context/workflow-integrity.md',
  '.claude/skills/vibe-pro-go/references/WEB-RUNBOOK.md',
  '.vibe/harness/schemas/pro-roundtrip-flow.schema.json',
  '.vibe/harness/schemas/pro-roundtrip-contract.schema.json',
  '.vibe/harness/schemas/pro-roundtrip-event-complete.schema.json',
] as const;
const protocolMutationSource = protocolSourcePaths[0];

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
  for (const relativePath of protocolSourcePaths) {
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
      path.join(fixtureRoot, 'CONTRACT.json'),
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

  it('derives a deterministic normalized content-addressed protocol version', async (testContext) => {
    const fixture = await scaffoldRepository(testContext);
    const sourcePath = path.join(fixture.checkout, protocolMutationSource);
    const original = await readFile(sourcePath, 'utf8');
    const first = await loadLocalProtocol(fixture.checkout);
    const second = await loadLocalProtocol(fixture.checkout);

    assert.match(first.version, /^v1-[0-9a-f]{8}$/u);
    assert.equal(second.version, first.version);
    assert.equal(first.root, `protocol/${first.version}`);
    assert.ok(
      [...first.files.keys()].every((relativePath) => relativePath.startsWith(`${first.root}/`)),
    );

    const crlf = original.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
    await writeFile(sourcePath, crlf, 'utf8');
    const crlfProtocol = await loadLocalProtocol(fixture.checkout);
    assert.equal(crlfProtocol.version, first.version);
  });

  it('changes the protocol namespace when one source changes', async (testContext) => {
    const fixture = await scaffoldRepository(testContext);
    const before = await loadLocalProtocol(fixture.checkout);

    for (const relativePath of protocolSourcePaths) {
      const sourcePath = path.join(fixture.checkout, ...relativePath.split('/'));
      const original = await readFile(sourcePath, 'utf8');
      await writeFile(
        sourcePath,
        `${original}\ncontent-addressed generation fixture: ${relativePath}\n`,
        'utf8',
      );
      const after = await loadLocalProtocol(fixture.checkout);
      await writeFile(sourcePath, original, 'utf8');
      const restored = await loadLocalProtocol(fixture.checkout);

      assert.notEqual(after.version, before.version, relativePath);
      assert.notEqual(after.root, before.root, relativePath);
      assert.equal(restored.version, before.version, relativePath);
    }
  });

  it('accepts CRLF-materialized files in an existing protocol namespace', async (testContext) => {
    const fixture = await scaffoldRepository(testContext);
    const local = await loadLocalProtocol(fixture.checkout);
    const bootstrap = await ensureProtocol({ context: fixture.context, publish: true });
    const relativePath = `${local.root}/COMMON-HARNESS.md`;
    const target = path.join(fixture.context.worktreePath, ...relativePath.split('/'));
    const original = await readFile(target, 'utf8');
    const crlf = original.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');

    assert.equal(bootstrap.bootstrapped, true);
    await writeFile(target, crlf, 'utf8');
    const binding = await ensureProtocol({ context: fixture.context, publish: false });

    assert.equal(binding.bootstrapped, false);
    assert.equal(binding.version, local.version);
  });

  it('rejects fully present protocol content that differs from local bytes', async (testContext) => {
    const fixture = await scaffoldRepository(testContext);
    const localA = await loadLocalProtocol(fixture.checkout);
    await ensureProtocol({ context: fixture.context, publish: true });

    const sourcePath = path.join(fixture.checkout, protocolMutationSource);
    const original = await readFile(sourcePath, 'utf8');
    await writeFile(sourcePath, `${original}\ncontent mismatch generation fixture\n`, 'utf8');
    const localB = await loadLocalProtocol(fixture.checkout);
    const tamperedFiles = new Map(localB.files);
    const tamperedPath = `${localB.root}/COMMON-HARNESS.md`;
    const expected = tamperedFiles.get(tamperedPath);
    if (expected === undefined) {
      throw new Error(`missing protocol test fixture: ${tamperedPath}`);
    }
    tamperedFiles.set(tamperedPath, `${expected}\ntampered bridge content\n`);

    assert.notEqual(localB.version, localA.version);
    assert.equal(tamperedFiles.size, 6);
    await publishAdditions(tamperedFiles, 'test: publish tampered protocol namespace', {
      context: fixture.context,
    });
    await assert.rejects(
      ensureProtocol({ context: fixture.context, publish: true }),
      /protocol hash\/content mismatch: /u,
    );
  });

  it('rejects a partially present protocol namespace', async (testContext) => {
    const fixture = await scaffoldRepository(testContext);
    const localA = await loadLocalProtocol(fixture.checkout);
    await ensureProtocol({ context: fixture.context, publish: true });

    const sourcePath = path.join(fixture.checkout, protocolMutationSource);
    const original = await readFile(sourcePath, 'utf8');
    await writeFile(sourcePath, `${original}\npartial generation fixture\n`, 'utf8');
    const localB = await loadLocalProtocol(fixture.checkout);
    const partialFiles = new Map([...localB.files.entries()].slice(0, -1));

    assert.notEqual(localB.version, localA.version);
    assert.equal(localB.files.size, 6);
    assert.equal(partialFiles.size, 5);
    await publishAdditions(partialFiles, 'test: publish partial protocol namespace', {
      context: fixture.context,
    });
    await assert.rejects(
      ensureProtocol({ context: fixture.context, publish: true }),
      /is partial; append-only recovery requires a new protocol namespace/u,
    );
  });

  it('bootstraps changed protocol content into a new append-only namespace', async (testContext) => {
    const fixture = await scaffoldRepository(testContext);
    const localA = await loadLocalProtocol(fixture.checkout);
    const bindingA = await ensureProtocol({ context: fixture.context, publish: true });
    const generationABytes = new Map<string, string>();
    for (const relativePath of localA.files.keys()) {
      generationABytes.set(
        relativePath,
        await readFile(
          path.join(fixture.context.worktreePath, ...relativePath.split('/')),
          'utf8',
        ),
      );
    }

    assert.equal(bindingA.bootstrapped, true);
    assert.equal(bindingA.version, localA.version);

    const sourcePath = path.join(fixture.checkout, protocolMutationSource);
    const original = await readFile(sourcePath, 'utf8');
    await writeFile(sourcePath, `${original}\nnew protocol generation fixture\n`, 'utf8');
    const localB = await loadLocalProtocol(fixture.checkout);

    assert.notEqual(localB.version, localA.version);
    await assert.rejects(
      ensureProtocol({ context: fixture.context, publish: false }),
      new RegExp(
        `protocol/${localB.version} is not bootstrapped; rerun only after user authorizes --publish`,
        'u',
      ),
    );

    const bindingB = await ensureProtocol({ context: fixture.context, publish: true });
    assert.equal(bindingB.bootstrapped, true);
    assert.equal(bindingB.version, localB.version);
    assert.notEqual(bindingB.version, bindingA.version);

    for (const [relativePath, expected] of generationABytes) {
      assert.equal(
        await readFile(
          path.join(fixture.context.worktreePath, ...relativePath.split('/')),
          'utf8',
        ),
        expected,
      );
    }

    const manifest = JSON.parse(
      await readFile(
        path.join(fixture.context.worktreePath, ...localB.root.split('/'), 'PROTOCOL.json'),
        'utf8',
      ),
    ) as { version: string };
    assert.equal(manifest.version, localB.version);
  });

  it('rejects a flow pinned to a different local protocol generation', async (testContext) => {
    const fixture = await scaffoldRepository(testContext);
    const started = await runCli(fixture, [
      'start',
      'audit',
      '--goal',
      'Protocol generation mismatch fixture',
      '--slug',
      'protocol-generation-mismatch',
      '--timezone',
      'Asia/Seoul',
      '--repository',
      'fixture/repo',
      '--publish',
    ]);
    const flowPath = started.flowPath as string;
    const flow = JSON.parse(
      await readFile(
        path.join(fixture.context.worktreePath, ...flowPath.split('/'), 'FLOW.json'),
        'utf8',
      ),
    ) as ProRoundtripFlow;
    const sourcePath = path.join(fixture.checkout, protocolMutationSource);
    const original = await readFile(sourcePath, 'utf8');
    await writeFile(sourcePath, `${original}\nlocal protocol generation changed\n`, 'utf8');
    const local = await loadLocalProtocol(fixture.checkout);

    assert.notEqual(local.version, flow.protocol.version);
    await assert.rejects(
      verifyPinnedProtocol(
        fixture.checkout,
        fixture.context.worktreePath,
        flow.protocol,
      ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes(flow.protocol.version));
        assert.ok(error.message.includes(local.version));
        assert.match(error.message, /different protocol generation/u);
        return true;
      },
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
    const localProtocol = await loadLocalProtocol(fixture.checkout);
    assert.match(flowPath, /^flows\/[0-9]{8}\/001-roundtrip-fixture$/);
    assert.equal(started.nextActor, 'pro');
    assert.match(String(started.webPrompt), /MUST NOT use Web Search/);
    assert.ok(
      String(started.webPrompt).includes(`${localProtocol.root}/PROTOCOL.json`),
    );

    const protocolContext = fixture.context;
    const protocolManifest = JSON.parse(
      await readFile(
        path.join(
          protocolContext.worktreePath,
          ...localProtocol.root.split('/'),
          'PROTOCOL.json',
        ),
        'utf8',
      ),
    ) as {
      schemaVersion: string;
      version: string;
      files: Array<{ path: string; sha256: string }>;
    };
    assert.equal(protocolManifest.schemaVersion, 'vibe-pro-protocol-manifest-v1');
    assert.equal(protocolManifest.version, localProtocol.version);
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
    assert.equal(resumed.autoPublish, false);
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
    'records and publishes contract-less remediation after audit feedback',
    async (testContext) => {
      const fixture = await scaffoldRepository(testContext);
      const started = await runCli(fixture, [
        'start',
        'audit',
        '--goal',
        'Audit the contract-less remediation fixture',
        '--slug',
        'contract-less-remediation',
        '--timezone',
        'Asia/Seoul',
        '--repository',
        'fixture/repo',
        '--publish',
      ]);
      const flowPath = String(started.flowPath);
      assert.match(flowPath, /^flows\/[0-9]{8}\/001-contract-less-remediation$/);
      assert.equal(started.nextActor, 'codex');

      const flow = JSON.parse(
        await readFile(
          path.join(fixture.context.worktreePath, ...flowPath.split('/'), 'FLOW.json'),
          'utf8',
        ),
      ) as ProRoundtripFlow;
      const goalMarker = JSON.parse(
        await readFile(
          path.join(
            fixture.context.worktreePath,
            ...flowPath.split('/'),
            '0000--cli--goal--r01',
            'COMPLETE.json',
          ),
          'utf8',
        ),
      ) as ProRoundtripEventComplete;
      assert.equal(
        goalMarker.nextWriteTarget,
        `${flowPath}/0100--codex--implementation-report--r01`,
      );

      const codeHead = await git(fixture.checkout, ['rev-parse', 'HEAD']);
      const evidencePath = path.join(fixture.checkout, 'audit-evidence.json');
      const auditEvidence: ProRoundtripReportInput = {
        schemaVersion: 'vibe-pro-report-input-v1',
        flowPath,
        designEventId: null,
        sprintId: null,
        reportKind: 'audit',
        baseSha: flow.baseSha,
        headSha: codeHead,
        completedContractIds: [],
        changedFiles: [],
        verification: [
          {
            command: 'fixture audit verification',
            status: 'passed',
            summary: 'fixture audit passed',
          },
        ],
        workflowEvidence: [],
        sprintGatePassed: true,
        cumulativeGatePassed: true,
        finalGatePassed: true,
        resolvedFindingIds: [],
        risks: [],
        nextAction: 'Publish the audit report.',
      };
      await writeFile(evidencePath, `${JSON.stringify(auditEvidence, null, 2)}\n`, 'utf8');
      const auditRecorded = await runCli(fixture, [
        'report',
        flowPath,
        '--evidence',
        evidencePath,
      ]);
      assert.match(String(auditRecorded.checkpointPath), /sprints[\\/]AUDIT$/);
      const auditPublished = await runCli(fixture, ['report', flowPath, '--publish']);
      assert.ok(auditPublished.published);
      await readFile(
        path.join(
          fixture.context.worktreePath,
          ...flowPath.split('/'),
          '0100--codex--implementation-report--r01',
          'COMPLETE.json',
        ),
        'utf8',
      );

      const feedbackEventId = '0200--pro--feedback--r01';
      const feedbackRoot = `${flowPath}/${feedbackEventId}`;
      const feedbackMarker: ProRoundtripEventComplete = {
        schemaVersion: 'vibe-pro-event-complete-v1',
        flowPath,
        eventId: feedbackEventId,
        sequence: 200,
        actor: 'pro',
        kind: 'feedback',
        revision: 1,
        previousEventId: '0100--codex--implementation-report--r01',
        supersedesEventId: null,
        protocolVersion: flow.protocol.version,
        designEventId: null,
        sprintId: null,
        repositoryFullName: flow.repository.fullName,
        codeBranch: flow.codeBranch,
        baseSha: flow.baseSha,
        headSha: codeHead,
        disposition: 'remediation-required',
        files: [
          { path: 'FEEDBACK.md', mediaType: 'text/markdown' },
          { path: 'FINDINGS.json', mediaType: 'application/json' },
        ],
        limitations: [],
        createdAt: new Date().toISOString(),
        nextActor: 'codex',
        nextWriteTarget: `${flowPath}/0300--codex--remediation-report--r01`,
      };
      await publishAdditions(
        new Map([
          [`${feedbackRoot}/FEEDBACK.md`, '# Contract-less remediation required\n'],
          [
            `${feedbackRoot}/FINDINGS.json`,
            `${JSON.stringify(
              {
                schemaVersion: 'vibe-pro-findings-v1',
                flowPath,
                eventId: feedbackEventId,
                reviewedHeadSha: codeHead,
                disposition: 'remediation-required',
                findings: [
                  {
                    id: 'FND-001',
                    taxonomy: 'implementation-defect',
                    severity: 'P1',
                    contractIds: [],
                    summary: 'First audit defect',
                    evidence: 'fixture evidence one',
                    expectedBehavior: 'The first audit defect is remediated.',
                  },
                  {
                    id: 'FND-002',
                    taxonomy: 'implementation-defect',
                    severity: 'P1',
                    contractIds: [],
                    summary: 'Second audit defect',
                    evidence: 'fixture evidence two',
                    expectedBehavior: 'The second audit defect is remediated.',
                  },
                ],
              },
              null,
              2,
            )}\n`,
          ],
          [`${feedbackRoot}/COMPLETE.json`, `${JSON.stringify(feedbackMarker, null, 2)}\n`],
        ]),
        'test: publish contract-less audit feedback',
        { context: fixture.context },
      );
      const synced = await runCli(fixture, ['sync', flowPath]);
      assert.equal(synced.latestEventId, feedbackEventId);

      const remediationEvidence: ProRoundtripReportInput = {
        ...auditEvidence,
        reportKind: 'remediation',
        resolvedFindingIds: ['FND-001', 'FND-002'],
        nextAction: 'Publish the contract-less remediation report.',
      };
      await writeFile(
        evidencePath,
        `${JSON.stringify(remediationEvidence, null, 2)}\n`,
        'utf8',
      );
      const remediationRecorded = await runCli(fixture, [
        'report',
        flowPath,
        '--evidence',
        evidencePath,
      ]);
      assert.match(
        String(remediationRecorded.checkpointPath),
        /remediation[\\/]0200--pro--feedback--r01[\\/]AUDIT$/,
      );
      const checkpoint = JSON.parse(
        await readFile(
          path.join(String(remediationRecorded.checkpointPath), 'CHECKPOINT.json'),
          'utf8',
        ),
      ) as { input: ProRoundtripReportInput };
      assert.equal(checkpoint.input.reportKind, 'remediation');

      for (const reportKind of ['audit', 'implementation'] as const) {
        await writeFile(
          evidencePath,
          `${JSON.stringify({ ...remediationEvidence, reportKind }, null, 2)}\n`,
          'utf8',
        );
        await assert.rejects(
          runCli(fixture, ['report', flowPath, '--evidence', evidencePath]),
          /report kind does not match flow state/,
        );
      }

      const invalidBindings: ProRoundtripReportInput[] = [
        {
          ...remediationEvidence,
          designEventId: '0100--pro--design--r01',
        },
        {
          ...remediationEvidence,
          sprintId: 'SPR-001',
        },
      ];
      for (const invalidBinding of invalidBindings) {
        await writeFile(
          evidencePath,
          `${JSON.stringify(invalidBinding, null, 2)}\n`,
          'utf8',
        );
        await assert.rejects(
          runCli(fixture, ['report', flowPath, '--evidence', evidencePath]),
          /an audit flow report must have null design\/Sprint bindings/,
        );
      }

      const partialRemediationEvidence: ProRoundtripReportInput = {
        ...remediationEvidence,
        resolvedFindingIds: ['FND-001'],
      };
      await writeFile(
        evidencePath,
        `${JSON.stringify(partialRemediationEvidence, null, 2)}\n`,
        'utf8',
      );
      await runCli(fixture, ['report', flowPath, '--evidence', evidencePath]);
      await assert.rejects(
        runCli(fixture, ['report', flowPath, '--publish']),
        /blocking actionable finding is unresolved: FND-002/,
      );

      await writeFile(
        evidencePath,
        `${JSON.stringify(remediationEvidence, null, 2)}\n`,
        'utf8',
      );
      await runCli(fixture, ['report', flowPath, '--evidence', evidencePath]);
      const remediationPublished = await runCli(fixture, [
        'report',
        flowPath,
        '--publish',
      ]);
      assert.ok(remediationPublished.published);
      const publishedMarker = JSON.parse(
        await readFile(
          path.join(
            fixture.context.worktreePath,
            ...flowPath.split('/'),
            '0300--codex--remediation-report--r01',
            'COMPLETE.json',
          ),
          'utf8',
        ),
      ) as ProRoundtripEventComplete;
      assert.equal(publishedMarker.kind, 'remediation-report');
      assert.equal(publishedMarker.previousEventId, feedbackEventId);
    },
  );

  it('toggles the auto-publish confirmation-skip directive', async (testContext) => {
    const fixture = await scaffoldRepository(testContext);
    const configLocalPath = path.join(fixture.checkout, '.vibe', 'config.local.json');
    const sessionLogPath = path.join(fixture.checkout, '.vibe', 'agent', 'session-log.md');
    await writeText(sessionLogPath, '# Session Log\n\n## Entries\n');

    const initial = await runCli(fixture, ['confirm-skip', 'status']);
    assert.equal(initial.autoPublish, false);
    assert.equal(initial.directive, null);

    await assert.rejects(
      runCli(fixture, ['confirm-skip', 'on', '--reason', 'multi\nline']),
      /reason must be single-line/,
    );
    await assert.rejects(
      runCli(fixture, ['confirm-skip', 'on', '--days', '0']),
      /days must be a positive integer/,
    );

    const enabled = await runCli(fixture, [
      'confirm-skip',
      'on',
      '--reason',
      'dogfood roundtrip',
    ]);
    assert.equal(enabled.autoPublish, true);
    const written = JSON.parse(await readFile(configLocalPath, 'utf8')) as {
      userDirectives: {
        proGoAutoPublish: { enabled: boolean; reason: string; expiresAt: string | null };
      };
    };
    assert.equal(written.userDirectives.proGoAutoPublish.enabled, true);
    assert.equal(written.userDirectives.proGoAutoPublish.reason, 'dogfood roundtrip');
    assert.equal(written.userDirectives.proGoAutoPublish.expiresAt, null);
    assert.match(
      await readFile(sessionLogPath, 'utf8'),
      /\[decision\]\[pro-go-auto-publish\] reason=dogfood roundtrip expiresAt=none/,
    );
    const active = await runCli(fixture, ['confirm-skip', 'status']);
    assert.equal(active.autoPublish, true);

    written.userDirectives.proGoAutoPublish.expiresAt = new Date(
      Date.now() - 1000,
    ).toISOString();
    await writeFile(configLocalPath, `${JSON.stringify(written, null, 2)}\n`, 'utf8');
    const lapsed = await runCli(fixture, ['confirm-skip', 'status']);
    assert.equal(lapsed.autoPublish, false);
    assert.equal(lapsed.expired, true);

    const rearmed = await runCli(fixture, ['confirm-skip', 'on', '--days', '7']);
    assert.equal(rearmed.autoPublish, true);
    assert.notEqual((rearmed.directive as { expiresAt: string | null }).expiresAt, null);

    const disabled = await runCli(fixture, ['confirm-skip', 'off']);
    assert.equal(disabled.autoPublish, false);
    assert.equal(disabled.changed, true);
    const cleared = JSON.parse(await readFile(configLocalPath, 'utf8')) as {
      userDirectives: { proGoAutoPublish: { enabled: boolean } };
    };
    assert.equal(cleared.userDirectives.proGoAutoPublish.enabled, false);
    assert.match(
      await readFile(sessionLogPath, 'utf8'),
      /\[decision\]\[pro-go-auto-publish-clear\]/,
    );
    const repeated = await runCli(fixture, ['confirm-skip', 'off']);
    assert.equal(repeated.changed, false);

    await assert.rejects(
      runCli(fixture, ['confirm-skip', 'maybe']),
      /confirm-skip requires on, off, or status/,
    );
  });

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
