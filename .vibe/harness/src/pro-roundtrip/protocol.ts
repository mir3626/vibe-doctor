import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { publishAdditions } from './git-branch-transport.js';
import {
  prepareBridgeWorktree,
  runGit,
  type WorktreeContext,
} from './worktree.js';

// Only the five protocol sources are hashed. Any PROTOCOL.json serialization change
// (field order, schemaVersion, indentation, or trailing newline) must bump this lineage
// (v1 -> v2), or existing bridge namespaces become unrecoverable byte-compare failures.
const PROTOCOL_LINEAGE = 'v1';

const sourceFiles = [
  {
    source: 'docs/context/workflow-integrity.md',
    name: 'COMMON-HARNESS.md',
  },
  {
    source: '.claude/skills/vibe-pro-go/references/WEB-RUNBOOK.md',
    name: 'WEB-RUNBOOK.md',
  },
  {
    source: '.vibe/harness/schemas/pro-roundtrip-flow.schema.json',
    name: 'FLOW.schema.json',
  },
  {
    source: '.vibe/harness/schemas/pro-roundtrip-contract.schema.json',
    name: 'CONTRACT.schema.json',
  },
  {
    source: '.vibe/harness/schemas/pro-roundtrip-event-complete.schema.json',
    name: 'EVENT-COMPLETE.schema.json',
  },
] as const;

export interface LocalProtocol {
  version: string;
  root: string;
  files: Map<string, string>;
  commonHarnessSha256: string;
}

export interface ProtocolBinding {
  version: string;
  commitSha: string;
  commonHarnessSha256: string;
  bootstrapped: boolean;
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function normalizeProtocolSource(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

function deriveProtocolVersion(
  sources: ReadonlyArray<{ name: string; content: string }>,
): string {
  const contentAddress = sources
    .map(({ name, content }) => `${name}:${sha256(normalizeProtocolSource(content))}`)
    .sort()
    .join('\n');
  return `${PROTOCOL_LINEAGE}-${sha256(contentAddress).slice(0, 8)}`;
}

async function resolveImmutableProtocolCommit(
  worktreePath: string,
  ref: string,
  protocolTargets: readonly string[],
  version: string,
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
    throw new Error(`protocol ${version} files were not published in one immutable commit`);
  }
  const commitSha = [...commits][0] ?? '';
  if (!/^[0-9a-f]{40}$/.test(commitSha)) {
    throw new Error(`cannot resolve immutable protocol commit for ${version}`);
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
  const sources = await Promise.all(
    sourceFiles.map(async ({ source, name }) => ({
      name,
      content: normalizeProtocolSource(
        await readFile(path.join(repoRoot, source), 'utf8'),
      ),
    })),
  );
  const version = deriveProtocolVersion(sources);
  const root = `protocol/${version}`;
  const files = new Map<string, string>();
  for (const { name, content } of sources) {
    files.set(`${root}/${name}`, content);
  }
  const commonHarness = files.get(`${root}/COMMON-HARNESS.md`);
  if (!commonHarness) {
    throw new Error('local common harness resource is missing');
  }
  const commonHarnessSha256 = sha256(commonHarness);
  const protocolManifestTarget = `${root}/PROTOCOL.json`;
  files.set(
    protocolManifestTarget,
    `${JSON.stringify(
      {
        schemaVersion: 'vibe-pro-protocol-manifest-v1',
        version,
        commonHarnessSha256,
        files: [...files.entries()].map(([filePath, content]) => ({
          path: filePath.slice(`${root}/`.length),
          sha256: sha256(content),
        })),
      },
      null,
      2,
    )}\n`,
  );
  return {
    version,
    root,
    files,
    commonHarnessSha256,
  };
}

export async function ensureProtocol(
  options: {
    cwd?: string;
    context?: WorktreeContext;
    publish: boolean;
  },
): Promise<ProtocolBinding> {
  const context = options.context ?? await prepareBridgeWorktree(options.cwd);
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
      `protocol/${local.version} is partial; append-only recovery requires a new protocol namespace`,
    );
  }

  let bootstrapped = false;
  let commitSha: string;
  if (presentCount === 0) {
    if (!options.publish) {
      throw new Error(
        `protocol/${local.version} is not bootstrapped; rerun only after user authorizes --publish`,
      );
    }
    const result = await publishAdditions(
      local.files,
      `chore(pro-go): bootstrap protocol ${local.version}`,
      { context },
    );
    commitSha = result.bridgeCommitSha;
    bootstrapped = true;
  } else {
    for (const [relativePath, expected] of local.files) {
      const actual = normalizeProtocolSource(
        await readFile(
          path.join(context.worktreePath, ...relativePath.split('/')),
          'utf8',
        ),
      );
      if (actual !== expected) {
        throw new Error(`protocol hash/content mismatch: ${relativePath}`);
      }
    }
    commitSha = await resolveImmutableProtocolCommit(
      context.worktreePath,
      'refs/remotes/origin/vibe-pro-bridge',
      [...local.files.keys()],
      local.version,
    );
  }

  return {
    version: local.version,
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
  const local = await loadLocalProtocol(repoRoot);
  if (binding.version !== local.version) {
    throw new Error(
      `pinned protocol version ${binding.version} does not match local protocol version ${local.version}; the flow is bound to a different protocol generation (finish or close it with the harness generation that created it, or start a new flow)`,
    );
  }
  if (local.commonHarnessSha256 !== binding.commonHarnessSha256) {
    throw new Error('local common harness hash differs from FLOW.json');
  }
  const immutableCommit = await resolveImmutableProtocolCommit(
    worktreePath,
    'HEAD',
    [...local.files.keys()],
    local.version,
  );
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
