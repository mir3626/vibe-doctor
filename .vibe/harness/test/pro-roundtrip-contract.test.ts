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
      await readFile('docs/plans/github-pro-roundtrip/examples/FLOW.json', 'utf8'),
    );
    const contract = parseContractJson(
      await readFile('docs/plans/github-pro-roundtrip/examples/CONTRACT.json', 'utf8'),
    );
    const event = parseEventCompleteJson(
      await readFile('docs/plans/github-pro-roundtrip/examples/COMPLETE.json', 'utf8'),
    );

    assert.doesNotThrow(() => validateContractSemantics(flow, event, contract));
  });

  it('rejects duplicate ownership and Sprint dependency cycles', async () => {
    const flow = parseFlowJson(
      await readFile('docs/plans/github-pro-roundtrip/examples/FLOW.json', 'utf8'),
    );
    const contract = parseContractJson(
      await readFile('docs/plans/github-pro-roundtrip/examples/CONTRACT.json', 'utf8'),
    );
    const event = parseEventCompleteJson(
      await readFile('docs/plans/github-pro-roundtrip/examples/COMPLETE.json', 'utf8'),
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
      await readFile('docs/plans/github-pro-roundtrip/examples/FLOW.json', 'utf8'),
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

    const snapshot = await loadFlowSnapshot(root, flow.flowPath);

    assert.equal(snapshot.latestEvent.marker.kind, 'goal');
    assert.deepEqual(snapshot.incompleteEventDirectories, ['0100--pro--design--r01']);
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
