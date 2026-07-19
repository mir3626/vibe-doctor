import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { publishAdditions } from './git-branch-transport.js';
import { prepareBridgeWorktree, runGit } from './worktree.js';

export const PROTOCOL_VERSION = 'v1';
export const PROTOCOL_ROOT = `protocol/${PROTOCOL_VERSION}`;

const sourceFiles = [
  {
    source: 'docs/context/workflow-integrity.md',
    target: `${PROTOCOL_ROOT}/COMMON-HARNESS.md`,
  },
  {
    source: '.claude/skills/vibe-pro-go/references/WEB-RUNBOOK.md',
    target: `${PROTOCOL_ROOT}/WEB-RUNBOOK.md`,
  },
  {
    source: '.vibe/harness/schemas/pro-roundtrip-flow.schema.json',
    target: `${PROTOCOL_ROOT}/FLOW.schema.json`,
  },
  {
    source: '.vibe/harness/schemas/pro-roundtrip-contract.schema.json',
    target: `${PROTOCOL_ROOT}/CONTRACT.schema.json`,
  },
  {
    source: '.vibe/harness/schemas/pro-roundtrip-event-complete.schema.json',
    target: `${PROTOCOL_ROOT}/EVENT-COMPLETE.schema.json`,
  },
] as const;
const protocolManifestTarget = `${PROTOCOL_ROOT}/PROTOCOL.json`;
const protocolTargets = [...sourceFiles.map(({ target }) => target), protocolManifestTarget];

export interface LocalProtocol {
  files: Map<string, string>;
  commonHarnessSha256: string;
}

export interface ProtocolBinding {
  version: typeof PROTOCOL_VERSION;
  commitSha: string;
  commonHarnessSha256: string;
  bootstrapped: boolean;
}

async function resolveImmutableProtocolCommit(
  worktreePath: string,
  ref: string,
): Promise<string> {
  const commits = new Set<string>();
  for (const target of protocolTargets) {
    const log = await runGit(worktreePath, [
      'log',
      '--format=%H',
      ref,
      '--',
      target,
    ]);
    const pathCommits = log.stdout.trim().split(/\r?\n/).filter(Boolean);
    if (pathCommits.length !== 1) {
      throw new Error(
        `${target}: immutable protocol file has ${pathCommits.length} history entries`,
      );
    }
    commits.add(pathCommits[0] ?? '');
  }
  if (commits.size !== 1) {
    throw new Error('protocol v1 files were not published in one immutable commit');
  }
  const commitSha = [...commits][0] ?? '';
  if (!/^[0-9a-f]{40}$/.test(commitSha)) {
    throw new Error(`cannot resolve immutable protocol commit for ${PROTOCOL_VERSION}`);
  }
  return commitSha;
}

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

export async function loadLocalProtocol(repoRoot: string): Promise<LocalProtocol> {
  const files = new Map<string, string>();
  for (const entry of sourceFiles) {
    files.set(
      entry.target,
      (await readFile(path.join(repoRoot, entry.source), 'utf8')).replace(/\r\n/g, '\n'),
    );
  }
  const commonHarness = files.get(`${PROTOCOL_ROOT}/COMMON-HARNESS.md`);
  if (!commonHarness) {
    throw new Error('local common harness resource is missing');
  }
  const commonHarnessSha256 = createHash('sha256')
    .update(commonHarness, 'utf8')
    .digest('hex');
  files.set(
    protocolManifestTarget,
    `${JSON.stringify(
      {
        schemaVersion: 'vibe-pro-protocol-manifest-v1',
        version: PROTOCOL_VERSION,
        commonHarnessSha256,
        files: [...files.entries()].map(([filePath, content]) => ({
          path: filePath.slice(`${PROTOCOL_ROOT}/`.length),
          sha256: createHash('sha256').update(content, 'utf8').digest('hex'),
        })),
      },
      null,
      2,
    )}\n`,
  );
  return {
    files,
    commonHarnessSha256,
  };
}

export async function ensureProtocol(
  options: { cwd?: string; publish: boolean },
): Promise<ProtocolBinding> {
  const context = await prepareBridgeWorktree(options.cwd);
  const local = await loadLocalProtocol(context.repoRoot);
  const presence = await Promise.all(
    [...local.files.keys()].map(async (relativePath) => ({
      relativePath,
      exists: await exists(path.join(context.worktreePath, ...relativePath.split('/'))),
    })),
  );
  const presentCount = presence.filter((item) => item.exists).length;
  if (presentCount > 0 && presentCount !== presence.length) {
    throw new Error(
      `protocol/${PROTOCOL_VERSION} is partial; append-only recovery requires a new protocol version`,
    );
  }

  let bootstrapped = false;
  let commitSha: string;
  if (presentCount === 0) {
    if (!options.publish) {
      throw new Error(
        `protocol/${PROTOCOL_VERSION} is not bootstrapped; rerun only after user authorizes --publish`,
      );
    }
    const result = await publishAdditions(
      local.files,
      `chore(pro-go): bootstrap protocol ${PROTOCOL_VERSION}`,
      { cwd: context.repoRoot },
    );
    commitSha = result.bridgeCommitSha;
    bootstrapped = true;
  } else {
    for (const [relativePath, expected] of local.files) {
      const actual = await readFile(
        path.join(context.worktreePath, ...relativePath.split('/')),
        'utf8',
      );
      if (actual.replace(/\r\n/g, '\n') !== expected) {
        throw new Error(`protocol hash/content mismatch: ${relativePath}`);
      }
    }
    commitSha = await resolveImmutableProtocolCommit(
      context.worktreePath,
      'refs/remotes/origin/vibe-pro-bridge',
    );
  }

  return {
    version: PROTOCOL_VERSION,
    commitSha,
    commonHarnessSha256: local.commonHarnessSha256,
    bootstrapped,
  };
}

export async function verifyPinnedProtocol(
  repoRoot: string,
  worktreePath: string,
  binding: {
    version: string;
    commitSha: string;
    commonHarnessSha256: string;
  },
): Promise<void> {
  if (binding.version !== PROTOCOL_VERSION) {
    throw new Error(`unsupported pinned protocol version: ${binding.version}`);
  }
  const local = await loadLocalProtocol(repoRoot);
  if (local.commonHarnessSha256 !== binding.commonHarnessSha256) {
    throw new Error('local common harness hash differs from FLOW.json');
  }
  const immutableCommit = await resolveImmutableProtocolCommit(worktreePath, 'HEAD');
  if (immutableCommit !== binding.commitSha) {
    throw new Error('pinned protocol commit does not match immutable protocol history');
  }
  const ancestor = await runGit(
    worktreePath,
    ['merge-base', '--is-ancestor', binding.commitSha, 'HEAD'],
    true,
  );
  if (ancestor.exitCode !== 0) {
    throw new Error('pinned protocol commit is not reachable from the bridge HEAD');
  }
  for (const [relativePath, expected] of local.files) {
    const atPinnedCommit = await runGit(worktreePath, [
      'show',
      `${binding.commitSha}:${relativePath}`,
    ]);
    if (atPinnedCommit.stdout !== expected) {
      throw new Error(`pinned protocol content mismatch: ${relativePath}`);
    }
    const atHead = (
      await readFile(path.join(worktreePath, ...relativePath.split('/')), 'utf8')
    ).replace(/\r\n/g, '\n');
    if (atHead !== expected) {
      throw new Error(`protocol was modified after pinning: ${relativePath}`);
    }
  }
}
