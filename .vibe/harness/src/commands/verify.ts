import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { getBooleanFlag, getStringFlag, parseArgs } from '../lib/args.js';
import { runMain } from '../lib/cli.js';

const MANIFEST_PATH = '.vibe/harness/test/groups.json';
const RECEIPT_SCHEMA_VERSION = 'vibe-verification-receipt-v1';
const RECEIPT_ROOT = '.vibe/runs/verification-receipts';
const TEST_ROOT = '.vibe/harness/test';
const TEST_SUFFIX = '.test.ts';

type VerificationTier = 'fast' | 'workflow' | 'release';
type VerificationRunner = 'command' | 'node-test';

export interface VerificationGroup {
  id: string;
  description: string;
  tier: VerificationTier;
  runner: VerificationRunner;
  command?: string[];
  testFiles?: string[];
  inputPatterns: string[];
  impactPatterns: string[];
}

export interface VerificationManifest {
  schemaVersion: 'vibe-test-groups-v1';
  globalInputPatterns: string[];
  globalInvalidatorPatterns: string[];
  sharedInputPatterns: string[];
  sharedImpactPatterns: string[];
  environmentKeys: string[];
  groups: VerificationGroup[];
}

export interface VerificationReceipt {
  schemaVersion: typeof RECEIPT_SCHEMA_VERSION;
  groupId: string;
  inputHash: string;
  tier: VerificationTier;
  runner: VerificationRunner;
  passedAt: string;
  durationMs: number;
  observedHead: string | null;
  baseSha: string | null;
  changedPaths: string[];
}

export interface GroupSelection {
  selectedGroupIds: string[];
  ignoredPaths: string[];
  unknownHarnessPaths: string[];
  forceSelectedGroups: boolean;
  reasons: Record<string, string[]>;
}

export interface VerificationPlanGroup {
  id: string;
  tier: VerificationTier;
  runner: VerificationRunner;
  inputHash: string;
  action: 'run' | 'reuse';
  reasons: string[];
  receiptPath: string;
}

export interface VerificationPlan {
  schemaVersion: 'vibe-verification-plan-v1';
  mode: 'all' | 'changed' | 'group' | 'tier';
  baseSha: string | null;
  observedHead: string | null;
  changedPaths: string[];
  ignoredPaths: string[];
  unknownHarnessPaths: string[];
  groups: VerificationPlanGroup[];
}

interface SyncOwnership {
  harnessPatterns: string[];
  hybridPaths: Set<string>;
}

interface CliOptions {
  root: string;
  all: boolean;
  force: boolean;
  planOnly: boolean;
  json: boolean;
  testsOnly: boolean;
  baseSha?: string;
  explicitPaths?: string[];
  groupIds?: string[];
  tier?: VerificationTier;
}

interface ChangedPathResult {
  paths: string[];
  forceAllReason?: string;
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\/+/, '');
}

function isSafeRelativePath(value: string): boolean {
  const normalized = normalizePath(value);
  return (
    normalized.length > 0
    && !path.posix.isAbsolute(normalized)
    && normalized !== '..'
    && !normalized.startsWith('../')
    && !normalized.includes('/../')
  );
}

function segmentMatches(pattern: string, candidate: string): boolean {
  let expression = '^';
  for (const character of pattern) {
    if (character === '*') {
      expression += '[^/]*';
    } else if (character === '?') {
      expression += '[^/]';
    } else {
      expression += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  expression += '$';
  return new RegExp(expression).test(candidate);
}

function matchSegments(
  patternSegments: string[],
  candidateSegments: string[],
  patternIndex = 0,
  candidateIndex = 0,
): boolean {
  const patternSegment = patternSegments[patternIndex];
  if (patternSegment === '**') {
    if (patternIndex === patternSegments.length - 1) {
      return true;
    }
    for (let index = candidateIndex; index <= candidateSegments.length; index += 1) {
      if (matchSegments(patternSegments, candidateSegments, patternIndex + 1, index)) {
        return true;
      }
    }
    return false;
  }
  if (patternSegment === undefined) {
    return candidateIndex === candidateSegments.length;
  }
  const candidateSegment = candidateSegments[candidateIndex];
  if (candidateSegment === undefined || !segmentMatches(patternSegment, candidateSegment)) {
    return false;
  }
  return matchSegments(patternSegments, candidateSegments, patternIndex + 1, candidateIndex + 1);
}

export function matchesPathPattern(pattern: string, candidate: string): boolean {
  return matchSegments(
    normalizePath(pattern).split('/'),
    normalizePath(candidate).split('/'),
  );
}

function matchesAny(patterns: string[], candidate: string): boolean {
  return patterns.some((pattern) => matchesPathPattern(pattern, candidate));
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label} must be a string array`);
  }
  for (const entry of value) {
    if (!isSafeRelativePath(entry)) {
      throw new Error(`${label} contains an unsafe path: ${entry}`);
    }
  }
}

export function validateVerificationManifest(
  value: unknown,
  rootTestFiles: string[],
): VerificationManifest {
  if (!value || typeof value !== 'object') {
    throw new Error('verification manifest must be an object');
  }
  const manifest = value as Partial<VerificationManifest>;
  if (manifest.schemaVersion !== 'vibe-test-groups-v1') {
    throw new Error(`unsupported verification manifest schema: ${String(manifest.schemaVersion)}`);
  }
  assertStringArray(manifest.globalInputPatterns, 'globalInputPatterns');
  assertStringArray(manifest.globalInvalidatorPatterns, 'globalInvalidatorPatterns');
  assertStringArray(manifest.sharedInputPatterns, 'sharedInputPatterns');
  assertStringArray(manifest.sharedImpactPatterns, 'sharedImpactPatterns');
  assertStringArray(manifest.environmentKeys, 'environmentKeys');
  if (!Array.isArray(manifest.groups) || manifest.groups.length === 0) {
    throw new Error('verification manifest groups must be a non-empty array');
  }

  const ids = new Set<string>();
  const testOwners = new Map<string, string>();
  for (const group of manifest.groups) {
    if (!group || typeof group !== 'object') {
      throw new Error('verification group must be an object');
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(group.id)) {
      throw new Error(`invalid verification group id: ${String(group.id)}`);
    }
    if (ids.has(group.id)) {
      throw new Error(`duplicate verification group id: ${group.id}`);
    }
    ids.add(group.id);
    if (!['fast', 'workflow', 'release'].includes(group.tier)) {
      throw new Error(`invalid tier for group ${group.id}: ${String(group.tier)}`);
    }
    if (!['command', 'node-test'].includes(group.runner)) {
      throw new Error(`invalid runner for group ${group.id}: ${String(group.runner)}`);
    }
    assertStringArray(group.inputPatterns, `${group.id}.inputPatterns`);
    assertStringArray(group.impactPatterns, `${group.id}.impactPatterns`);
    if (group.runner === 'command') {
      if (!Array.isArray(group.command) || group.command.length === 0) {
        throw new Error(`command group ${group.id} must declare command`);
      }
      if (group.command.some((entry) => typeof entry !== 'string')) {
        throw new Error(`command group ${group.id} command must contain strings`);
      }
      if (group.testFiles !== undefined && group.testFiles.length > 0) {
        throw new Error(`command group ${group.id} cannot own testFiles`);
      }
      continue;
    }

    assertStringArray(group.testFiles, `${group.id}.testFiles`);
    if (group.testFiles.length === 0) {
      throw new Error(`node-test group ${group.id} must own at least one test file`);
    }
    for (const filePath of group.testFiles) {
      if (!filePath.startsWith(`${TEST_ROOT}/`) || !filePath.endsWith(TEST_SUFFIX)) {
        throw new Error(`invalid root harness test path in ${group.id}: ${filePath}`);
      }
      const prior = testOwners.get(filePath);
      if (prior) {
        throw new Error(`test file ${filePath} is owned by both ${prior} and ${group.id}`);
      }
      testOwners.set(filePath, group.id);
    }
  }

  const expected = new Set(rootTestFiles.map(normalizePath));
  const actual = new Set(testOwners.keys());
  const missing = [...expected].filter((entry) => !actual.has(entry));
  const stale = [...actual].filter((entry) => !expected.has(entry));
  if (missing.length > 0 || stale.length > 0) {
    throw new Error([
      missing.length > 0 ? `unowned root harness tests: ${missing.join(', ')}` : '',
      stale.length > 0 ? `manifest test paths not found: ${stale.join(', ')}` : '',
    ].filter(Boolean).join('; '));
  }
  return manifest as VerificationManifest;
}

function gitBuffer(root: string, args: string[]): Buffer {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'buffer',
    windowsHide: true,
  });
}

function gitText(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
}

function parseNullSeparated(buffer: Buffer): string[] {
  return buffer
    .toString('utf8')
    .split('\0')
    .map(normalizePath)
    .filter(Boolean);
}

function parseStatusPaths(buffer: Buffer): string[] {
  const tokens = buffer.toString('utf8').split('\0');
  const result: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const entry = tokens[index];
    if (!entry) {
      continue;
    }
    const status = entry.slice(0, 2);
    const candidate = normalizePath(entry.slice(3));
    if (candidate) {
      result.push(candidate);
    }
    if (status.includes('R') || status.includes('C')) {
      const paired = normalizePath(tokens[index + 1] ?? '');
      if (paired) {
        result.push(paired);
        index += 1;
      }
    }
  }
  return result;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map(normalizePath).filter(Boolean))].sort();
}

async function listRootTestFiles(root: string): Promise<string[]> {
  const entries = await readdir(path.join(root, TEST_ROOT), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(TEST_SUFFIX))
    .map((entry) => `${TEST_ROOT}/${entry.name}`)
    .sort();
}

async function loadManifest(root: string): Promise<VerificationManifest> {
  const raw = await readFile(path.join(root, MANIFEST_PATH), 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `failed to parse ${MANIFEST_PATH}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return validateVerificationManifest(parsed, await listRootTestFiles(root));
}

function listRepositoryFiles(root: string): string[] {
  return uniqueSorted(parseNullSeparated(
    gitBuffer(root, ['ls-files', '-co', '--exclude-standard', '-z']),
  ));
}

function resolveObservedHead(root: string): string | null {
  try {
    return gitText(root, ['rev-parse', 'HEAD']);
  } catch {
    return null;
  }
}

async function activeProBase(root: string): Promise<string | undefined> {
  try {
    const raw = await readFile(
      path.join(root, '.vibe', 'agent', 'pro-roundtrip', 'ACTIVE.json'),
      'utf8',
    );
    const parsed = JSON.parse(raw) as { baseSha?: unknown };
    return typeof parsed.baseSha === 'string' && parsed.baseSha.trim()
      ? parsed.baseSha.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

async function collectChangedPaths(
  root: string,
  baseSha: string | undefined,
  explicitPaths: string[] | undefined,
): Promise<ChangedPathResult> {
  if (explicitPaths && explicitPaths.length > 0) {
    return { paths: uniqueSorted(explicitPaths) };
  }
  try {
    if (baseSha) {
      const resolved = gitText(root, ['rev-parse', '--verify', `${baseSha}^{commit}`]);
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', resolved, 'HEAD'], {
          cwd: root,
          stdio: 'ignore',
          windowsHide: true,
        });
      } catch {
        return {
          paths: [],
          forceAllReason: `verification base is not an ancestor of HEAD: ${resolved}`,
        };
      }
      const tracked = parseNullSeparated(gitBuffer(root, [
        'diff',
        '--name-only',
        '-z',
        resolved,
        '--',
      ]));
      const untracked = parseNullSeparated(gitBuffer(root, [
        'ls-files',
        '--others',
        '--exclude-standard',
        '-z',
      ]));
      return { paths: uniqueSorted([...tracked, ...untracked]) };
    }
    return {
      paths: uniqueSorted(parseStatusPaths(
        gitBuffer(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
      )),
    };
  } catch (error) {
    return {
      paths: [],
      forceAllReason: `unable to determine changed paths: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

async function loadSyncOwnership(root: string): Promise<SyncOwnership> {
  try {
    const raw = await readFile(path.join(root, '.vibe', 'sync-manifest.json'), 'utf8');
    const parsed = JSON.parse(raw) as {
      files?: { harness?: unknown; hybrid?: unknown };
    };
    if (
      !Array.isArray(parsed.files?.harness)
      || parsed.files.harness.some((entry) => typeof entry !== 'string')
      || !parsed.files?.hybrid
      || typeof parsed.files.hybrid !== 'object'
    ) {
      throw new Error('invalid sync ownership');
    }
    return {
      harnessPatterns: parsed.files.harness as string[],
      hybridPaths: new Set(Object.keys(parsed.files.hybrid).map(normalizePath)),
    };
  } catch {
    return {
      harnessPatterns: [
        '.vibe/harness/**',
        '.vibe/settings-presets/**',
        '.claude/agents/**',
        '.claude/skills/**',
        '.claude/templates/**',
        '.codex/agents/**',
        '.codex/skills/**',
        'docs/context/**',
        'docs/guides/**',
        'bridge-runbook.md',
        'scripts/vibe-sync-bootstrap.mjs',
      ],
      hybridPaths: new Set([
        'CLAUDE.md',
        'AGENTS.md',
        'GEMINI.md',
        '.claude/settings.json',
        '.vibe/config.json',
        'package.json',
      ]),
    };
  }
}

function isHarnessOwned(filePath: string, ownership: SyncOwnership): boolean {
  const normalized = normalizePath(filePath);
  return (
    ownership.hybridPaths.has(normalized)
    || matchesAny(ownership.harnessPatterns, normalized)
  );
}

export function selectVerificationGroups(
  manifest: VerificationManifest,
  changedPaths: string[],
  ownership: SyncOwnership,
  options: {
    all?: boolean;
    testsOnly?: boolean;
    groupIds?: string[];
    tier?: VerificationTier;
    forceAllReason?: string;
  } = {},
): GroupSelection {
  const applicable = manifest.groups.filter((group) => !options.testsOnly || group.runner === 'node-test');
  const applicableIds = new Set(applicable.map((group) => group.id));
  const reasons: Record<string, string[]> = Object.fromEntries(
    applicable.map((group) => [group.id, []]),
  );
  let selected = new Set<string>();
  let forceSelectedGroups = false;

  if (options.groupIds && options.groupIds.length > 0) {
    for (const id of options.groupIds) {
      if (!applicableIds.has(id)) {
        throw new Error(`unknown or inapplicable verification group: ${id}`);
      }
      selected.add(id);
      reasons[id]?.push('explicit group selection');
    }
  } else if (options.tier) {
    for (const group of applicable.filter((entry) => entry.tier === options.tier)) {
      selected.add(group.id);
      reasons[group.id]?.push(`explicit tier selection: ${options.tier}`);
    }
  } else if (options.all || options.forceAllReason) {
    selected = new Set(applicableIds);
    forceSelectedGroups = Boolean(options.forceAllReason);
    for (const id of selected) {
      reasons[id]?.push(options.forceAllReason ?? 'all groups requested');
    }
  }

  const ignoredPaths: string[] = [];
  const unknownHarnessPaths: string[] = [];
  if (
    !options.all
    && !options.forceAllReason
    && (!options.groupIds || options.groupIds.length === 0)
    && !options.tier
  ) {
    for (const filePath of uniqueSorted(changedPaths)) {
      if (matchesAny(manifest.globalInvalidatorPatterns, filePath)) {
        selected = new Set(applicableIds);
        for (const id of selected) {
          reasons[id]?.push(`global invalidator: ${filePath}`);
        }
        continue;
      }

      const matchedGroups = applicable.filter((group) => {
        const patterns = [
          ...manifest.sharedImpactPatterns,
          ...group.impactPatterns,
          ...(group.testFiles ?? []),
        ];
        return matchesAny(patterns, filePath);
      });
      const runtimeGroups = matchedGroups.filter((group) => group.runner === 'node-test');
      if (matchedGroups.length > 0 && (runtimeGroups.length > 0 || !isHarnessOwned(filePath, ownership))) {
        for (const group of matchedGroups) {
          selected.add(group.id);
          reasons[group.id]?.push(`changed input: ${filePath}`);
        }
        continue;
      }
      if (isHarnessOwned(filePath, ownership)) {
        unknownHarnessPaths.push(filePath);
      } else {
        ignoredPaths.push(filePath);
      }
    }
    if (unknownHarnessPaths.length > 0) {
      selected = new Set(applicableIds);
      for (const id of selected) {
        reasons[id]?.push(`unknown harness impact: ${unknownHarnessPaths.join(', ')}`);
      }
    }
  }

  return {
    selectedGroupIds: applicable
      .filter((group) => selected.has(group.id))
      .map((group) => group.id),
    ignoredPaths: uniqueSorted(ignoredPaths),
    unknownHarnessPaths: uniqueSorted(unknownHarnessPaths),
    forceSelectedGroups,
    reasons,
  };
}

function updateHash(
  hash: ReturnType<typeof createHash>,
  label: string,
  value: Buffer | string | number,
): void {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  hash.update(`${label}\0${buffer.length}\0`, 'utf8');
  hash.update(buffer);
  hash.update('\0', 'utf8');
}

function exactPatterns(patterns: string[]): string[] {
  return patterns.filter((pattern) => !pattern.includes('*') && !pattern.includes('?'));
}

async function hashFile(
  hash: ReturnType<typeof createHash>,
  root: string,
  relativePath: string,
): Promise<void> {
  const normalized = normalizePath(relativePath);
  const absolutePath = path.join(root, ...normalized.split('/'));
  updateHash(hash, 'path', normalized);
  try {
    const stat = await lstat(absolutePath);
    updateHash(hash, 'mode', stat.mode);
    if (stat.isSymbolicLink()) {
      updateHash(hash, 'symlink', await readlink(absolutePath));
    } else if (stat.isFile()) {
      updateHash(hash, 'file', await readFile(absolutePath));
    } else {
      updateHash(hash, 'kind', 'non-file');
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      updateHash(hash, 'kind', 'missing');
      return;
    }
    throw error;
  }
}

export async function computeGroupInputHash(
  root: string,
  manifest: VerificationManifest,
  group: VerificationGroup,
  repositoryFiles: string[],
  extraInputPaths: string[] = [],
): Promise<string> {
  const hash = createHash('sha256');
  updateHash(hash, 'receiptSchema', RECEIPT_SCHEMA_VERSION);
  updateHash(hash, 'manifestSchema', manifest.schemaVersion);
  updateHash(hash, 'group', JSON.stringify(group));
  updateHash(hash, 'node', process.version);
  updateHash(hash, 'execPath', process.execPath);
  updateHash(hash, 'platform', `${process.platform}/${process.arch}`);
  for (const key of manifest.environmentKeys) {
    updateHash(hash, `env:${key}`, process.env[key] ?? '<unset>');
  }

  const patterns = [
    ...manifest.globalInputPatterns,
    ...manifest.sharedInputPatterns,
    ...group.inputPatterns,
  ];
  const paths = new Set<string>([
    ...exactPatterns(patterns),
    ...(group.testFiles ?? []),
    ...extraInputPaths,
  ].map(normalizePath));
  for (const filePath of repositoryFiles) {
    if (matchesAny(patterns, filePath)) {
      paths.add(filePath);
    }
  }
  for (const filePath of [...paths].sort()) {
    await hashFile(hash, root, filePath);
  }
  return hash.digest('hex');
}

function receiptPath(root: string, groupId: string, inputHash: string): string {
  return path.join(root, RECEIPT_ROOT, groupId, `${inputHash}.json`);
}

export async function readSuccessfulReceipt(
  root: string,
  groupId: string,
  inputHash: string,
): Promise<VerificationReceipt | null> {
  try {
    const raw = await readFile(receiptPath(root, groupId, inputHash), 'utf8');
    const parsed = JSON.parse(raw) as Partial<VerificationReceipt>;
    if (
      parsed.schemaVersion !== RECEIPT_SCHEMA_VERSION
      || parsed.groupId !== groupId
      || parsed.inputHash !== inputHash
    ) {
      return null;
    }
    return parsed as VerificationReceipt;
  } catch {
    return null;
  }
}

async function writeSuccessfulReceipt(
  root: string,
  receipt: VerificationReceipt,
): Promise<void> {
  const target = receiptPath(root, receipt.groupId, receipt.inputHash);
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await writeFile(target, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') {
      throw error;
    }
  }
}

async function invalidateReceipt(root: string, groupId: string, inputHash: string): Promise<void> {
  await rm(receiptPath(root, groupId, inputHash), { force: true });
}

function verificationEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VIBE_HARNESS_HOOKS: 'on',
    VIBE_SKIP_AGENT_SESSION_START: '1',
  };
  delete env.CLAUDE_PROJECT_DIR;
  return env;
}

function resolveCommand(root: string, command: string[]): { executable: string; args: string[] } {
  const values = command.map((entry) => entry
    .replaceAll('{node}', process.execPath)
    .replaceAll('{root}', root));
  const executable = values[0];
  if (!executable) {
    throw new Error('verification command has no executable');
  }
  return { executable, args: values.slice(1) };
}

function runCommandGroup(root: string, group: VerificationGroup): number {
  const command = resolveCommand(root, group.command ?? []);
  const result = spawnSync(command.executable, command.args, {
    cwd: root,
    env: verificationEnvironment(),
    shell: false,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

function runNodeTestGroups(root: string, groups: VerificationGroup[]): number {
  const tests = uniqueSorted(groups.flatMap((group) => group.testFiles ?? []));
  if (tests.length === 0) {
    return 0;
  }
  const args: string[] = [];
  const preload = path.join(root, '.vibe', 'harness', 'test', 'windows-hide-child-process.cjs');
  if (existsSync(preload)) {
    args.push('--require', preload);
  }
  args.push('--import', 'tsx', '--test', ...tests);
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: verificationEnvironment(),
    shell: false,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

function parseCsv(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = uniqueSorted(value.split(',').map((entry) => entry.trim()));
  return parsed.length > 0 ? parsed : undefined;
}

function parseTier(value: string | undefined): VerificationTier | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!['fast', 'workflow', 'release'].includes(value)) {
    throw new Error(`invalid verification tier: ${value}`);
  }
  return value as VerificationTier;
}

async function parseCliOptions(): Promise<CliOptions> {
  const parsed = parseArgs(process.argv.slice(2));
  const root = path.resolve(getStringFlag(parsed, 'root', process.cwd()) ?? process.cwd());
  const forwardedBaseFlags = ['changed', 'plan', 'json', 'tests-only', 'all', 'force'];
  const consumedBaseFlags = forwardedBaseFlags
    .map((name) => ({ name, value: parsed.flags[name] }))
    .filter((entry): entry is { name: string; value: string } =>
      typeof entry.value === 'string' && entry.value !== 'true');
  const positionals = [
    ...parsed.positionals,
    ...consumedBaseFlags.map((entry) => entry.value),
  ];
  if (positionals.length > 1) {
    throw new Error(`unexpected positional arguments: ${positionals.slice(1).join(', ')}`);
  }
  const positionalBase = positionals[0]?.trim();
  const booleanFlag = (name: string): boolean =>
    getBooleanFlag(parsed, name) || consumedBaseFlags.some((entry) => entry.name === name);
  const baseSha = getStringFlag(parsed, 'base')
    ?? positionalBase
    ?? process.env.VIBE_VERIFY_BASE?.trim()
    ?? await activeProBase(root);
  const explicitPaths = parseCsv(
    getStringFlag(parsed, 'paths') ?? getStringFlag(parsed, 'path'),
  );
  const groupIds = parseCsv(getStringFlag(parsed, 'group'));
  const tier = parseTier(getStringFlag(parsed, 'tier'));
  return {
    root,
    all: booleanFlag('all'),
    force: booleanFlag('force'),
    planOnly: booleanFlag('plan'),
    json: booleanFlag('json'),
    testsOnly: booleanFlag('tests-only'),
    ...(baseSha ? { baseSha } : {}),
    ...(explicitPaths ? { explicitPaths } : {}),
    ...(groupIds ? { groupIds } : {}),
    ...(tier ? { tier } : {}),
  };
}

async function createPlan(options: CliOptions): Promise<{
  plan: VerificationPlan;
  manifest: VerificationManifest;
}> {
  const manifest = await loadManifest(options.root);
  const ownership = await loadSyncOwnership(options.root);
  const changed = await collectChangedPaths(
    options.root,
    options.baseSha,
    options.explicitPaths,
  );
  const selection = selectVerificationGroups(manifest, changed.paths, ownership, {
    all: options.all,
    testsOnly: options.testsOnly,
    ...(options.groupIds ? { groupIds: options.groupIds } : {}),
    ...(options.tier ? { tier: options.tier } : {}),
    ...(changed.forceAllReason ? { forceAllReason: changed.forceAllReason } : {}),
  });
  const repositoryFiles = listRepositoryFiles(options.root);
  const observedHead = resolveObservedHead(options.root);
  const groups: VerificationPlanGroup[] = [];
  for (const group of manifest.groups.filter((entry) =>
    selection.selectedGroupIds.includes(entry.id))) {
    const inputHash = await computeGroupInputHash(
      options.root,
      manifest,
      group,
      repositoryFiles,
      selection.unknownHarnessPaths,
    );
    const receipt = await readSuccessfulReceipt(options.root, group.id, inputHash);
    const mustRun = options.force || selection.forceSelectedGroups || receipt === null;
    groups.push({
      id: group.id,
      tier: group.tier,
      runner: group.runner,
      inputHash,
      action: mustRun ? 'run' : 'reuse',
      reasons: selection.reasons[group.id] ?? [],
      receiptPath: normalizePath(path.relative(
        options.root,
        receiptPath(options.root, group.id, inputHash),
      )),
    });
  }
  const mode: VerificationPlan['mode'] = options.groupIds
    ? 'group'
    : options.tier
      ? 'tier'
      : options.all
        ? 'all'
        : 'changed';
  return {
    manifest,
    plan: {
      schemaVersion: 'vibe-verification-plan-v1',
      mode,
      baseSha: options.baseSha ?? null,
      observedHead,
      changedPaths: changed.paths,
      ignoredPaths: selection.ignoredPaths,
      unknownHarnessPaths: selection.unknownHarnessPaths,
      groups,
    },
  };
}

function printHumanPlan(plan: VerificationPlan): void {
  const run = plan.groups.filter((group) => group.action === 'run').map((group) => group.id);
  const reuse = plan.groups.filter((group) => group.action === 'reuse').map((group) => group.id);
  console.log(
    `[vibe-verify] mode=${plan.mode} changed=${plan.changedPaths.length} `
    + `run=${run.length} reuse=${reuse.length} ignored=${plan.ignoredPaths.length}`,
  );
  if (run.length > 0) {
    console.log(`[vibe-verify] run: ${run.join(', ')}`);
  }
  if (reuse.length > 0) {
    console.log(`[vibe-verify] reuse: ${reuse.join(', ')}`);
  }
  if (plan.unknownHarnessPaths.length > 0) {
    console.log(`[vibe-verify] fail-closed unknown: ${plan.unknownHarnessPaths.join(', ')}`);
  }
}

async function executePlan(
  root: string,
  manifest: VerificationManifest,
  plan: VerificationPlan,
): Promise<void> {
  const byId = new Map(manifest.groups.map((group) => [group.id, group]));
  const runnable = plan.groups.filter((group) => group.action === 'run');
  for (const planned of runnable.filter((group) => group.runner === 'command')) {
    const group = byId.get(planned.id);
    if (!group) {
      throw new Error(`missing manifest group during execution: ${planned.id}`);
    }
    const startedAt = Date.now();
    console.log(`[vibe-verify] start group=${group.id}`);
    const status = runCommandGroup(root, group);
    if (status !== 0) {
      await invalidateReceipt(root, group.id, planned.inputHash);
      throw new Error(`verification group failed: ${group.id} (exit ${status})`);
    }
    await writeSuccessfulReceipt(root, {
      schemaVersion: RECEIPT_SCHEMA_VERSION,
      groupId: group.id,
      inputHash: planned.inputHash,
      tier: group.tier,
      runner: group.runner,
      passedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      observedHead: plan.observedHead,
      baseSha: plan.baseSha,
      changedPaths: plan.changedPaths,
    });
  }

  const nodePlans = runnable.filter((group) => group.runner === 'node-test');
  if (nodePlans.length === 0) {
    return;
  }
  const nodeGroups = nodePlans.map((planned) => {
    const group = byId.get(planned.id);
    if (!group) {
      throw new Error(`missing manifest group during execution: ${planned.id}`);
    }
    return group;
  });
  const startedAt = Date.now();
  console.log(`[vibe-verify] start node-test groups=${nodeGroups.map((group) => group.id).join(',')}`);
  const status = runNodeTestGroups(root, nodeGroups);
  if (status !== 0) {
    await Promise.all(nodePlans.map((planned) =>
      invalidateReceipt(root, planned.id, planned.inputHash)));
    throw new Error(
      `node-test verification groups failed: ${nodeGroups.map((group) => group.id).join(', ')} `
      + `(exit ${status})`,
    );
  }
  const durationMs = Date.now() - startedAt;
  await Promise.all(nodePlans.map(async (planned) => {
    const group = byId.get(planned.id);
    if (!group) {
      return;
    }
    await writeSuccessfulReceipt(root, {
      schemaVersion: RECEIPT_SCHEMA_VERSION,
      groupId: group.id,
      inputHash: planned.inputHash,
      tier: group.tier,
      runner: group.runner,
      passedAt: new Date().toISOString(),
      durationMs,
      observedHead: plan.observedHead,
      baseSha: plan.baseSha,
      changedPaths: plan.changedPaths,
    });
  }));
}

async function main(): Promise<void> {
  const options = await parseCliOptions();
  const { manifest, plan } = await createPlan(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  } else {
    printHumanPlan(plan);
  }
  if (options.planOnly) {
    return;
  }
  await executePlan(options.root, manifest, plan);
  if (!options.json) {
    console.log('[vibe-verify] ok');
  }
}

runMain(main, import.meta.url);
