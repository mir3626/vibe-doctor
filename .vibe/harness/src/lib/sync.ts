import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileExists, readJson, readText, writeJson, writeText } from './fs.js';
import type { VibeConfig } from './config.js';
import { runCommand } from './shell.js';

export interface SyncManifest {
  manifestVersion: string;
  files: {
    harness: string[];
    hybrid: Record<string, HybridFileConfig>;
    project: string[];
  };
  migrations: Record<string, string | null>;
}

export interface HybridFileConfig {
  strategy:
    | 'section-merge'
    | 'json-deep-merge'
    | 'json-array-union'
    | 'template-regenerate'
    | 'line-union'
    | 'replace-if-unmodified';
  harnessMarkers?: string[];
  preserveMarkers?: string[];
  harnessKeys?: string[];
  projectKeys?: string[];
  note?: string;
}

/**
 * A section-merge or json-deep-merge of one hybrid file. `keepLocal` names the harness sections or keys whose
 * local text stays: the downstream changed them and upstream did not, or the user kept them over an upstream
 * change. `unresolved` names the ones kept over an upstream change; their recorded base does not advance, so the
 * next sync reports them again, the way a skipped harness file stays a conflict.
 */
export type HybridMergeAction =
  | { type: 'section-merge'; path: string; sections: string[]; keepLocal?: string[]; unresolved?: string[] }
  | { type: 'json-merge'; path: string; keys: string[]; keepLocal?: string[]; unresolved?: string[] };

export type SyncAction =
  | { type: 'replace'; path: string; reason: string }
  | HybridMergeAction
  | { type: 'json-array-union'; path: string; keys: string[] }
  | { type: 'line-merge'; path: string; reason: string }
  | { type: 'template-regen'; path: string }
  | { type: 'skip'; path: string; reason: string }
  /** `regions` and `merge` are set for a hybrid file: resolving it applies `merge`, never a whole-file replace. */
  | { type: 'conflict'; path: string; reason: string; regions?: string[]; merge?: HybridMergeAction }
  | { type: 'new-file'; path: string }
  | { type: 'delete'; path: string; reason: string };

export interface SyncPlan {
  fromVersion: string | null;
  toVersion: string;
  actions: SyncAction[];
  migrations: string[];
}

interface SyncHashes {
  files: Record<string, string>;
  /**
   * Per section-merge or json-deep-merge file: the hash of each harness-owned section or key as upstream shipped it
   * at the last sync. It is the base of the three-way check that keeps downstream edits from vanishing (B4).
   */
  regions: Record<string, Record<string, string>>;
}

interface SectionBlock {
  name: string;
  full: string;
  body: string;
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function normalizeVersion(version: string): string {
  return version.startsWith('v') ? version.slice(1) : version;
}

function normalizeRelativePath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function compareVersions(left: string, right: string): number {
  const leftParts = normalizeVersion(left).split('.').map((part) => Number(part));
  const rightParts = normalizeVersion(right).split('.').map((part) => Number(part));
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return 0;
}

function isRecord(value: JsonValue | unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneJson<T extends JsonValue | unknown>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function splitPath(keyPath: string): string[] {
  return keyPath.split('.').filter((segment) => segment.length > 0);
}

function getAtPath(value: JsonValue | unknown, keyPath: string): JsonValue | undefined {
  const parts = splitPath(keyPath);
  let current: JsonValue | unknown = value;

  for (const part of parts) {
    if (!isRecord(current) || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }

  return current as JsonValue | undefined;
}

function setAtPath(target: JsonValue | unknown, keyPath: string, nextValue: JsonValue): void {
  const parts = splitPath(keyPath);
  if (parts.length === 0 || !isRecord(target)) {
    return;
  }

  let current = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (!part) {
      return;
    }

    const existing = current[part];
    if (!isRecord(existing)) {
      current[part] = {};
    }

    const next = current[part];
    if (!isRecord(next)) {
      return;
    }
    current = next;
  }

  const leaf = parts[parts.length - 1];
  if (!leaf) {
    return;
  }
  current[leaf] = cloneJson(nextValue);
}

function jsonArrayUnion(left: JsonValue | undefined, right: JsonValue | undefined): JsonValue[] {
  const result = Array.isArray(left) ? [...left] : [];
  const seen = new Set(result.map((item) => JSON.stringify(item)));

  if (!Array.isArray(right)) {
    return result;
  }

  for (const item of right) {
    const key = JSON.stringify(item);
    if (seen.has(key)) {
      continue;
    }
    result.push(cloneJson(item));
    seen.add(key);
  }

  return result;
}

async function readFileMode(filePath: string): Promise<number | null> {
  try {
    return (await stat(filePath)).mode & 0o777;
  } catch {
    return null;
  }
}

function desiredSyncedMode(relativePath: string, existingMode: number | null): number {
  if (relativePath.endsWith('.sh')) {
    return 0o755;
  }

  return existingMode ?? 0o644;
}

async function copySyncedFile(source: string, target: string, relativePath: string): Promise<void> {
  const existingMode = await readFileMode(target);
  await copyFile(source, target);

  try {
    await chmod(target, desiredSyncedMode(relativePath, existingMode));
  } catch {
    // Some filesystems do not support POSIX mode changes. Content sync should still proceed.
  }
}

function deleteAtPath(target: JsonValue | unknown, keyPath: string): void {
  const parts = splitPath(keyPath);
  if (parts.length === 0 || !isRecord(target)) {
    return;
  }

  let current = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (!part) {
      return;
    }
    const next = current[part];
    if (!isRecord(next)) {
      return;
    }
    current = next;
  }

  const leaf = parts[parts.length - 1];
  if (!leaf) {
    return;
  }
  delete current[leaf];
}

const SECTION_NAME_PATTERN = '[A-Za-z0-9:_-]+';
// Markers may carry a trailing description, e.g. `<!-- BEGIN:SPRINT_ROLES (vibe-init 자동 업데이트 영역) -->`.
const MARKER_SUFFIX = '(?: [^>]*?)? -->';

function sectionBlockPattern(name?: string): RegExp {
  const namePart = name ? escapeRegExp(name) : SECTION_NAME_PATTERN;
  return new RegExp(`<!-- BEGIN:(${namePart})${MARKER_SUFFIX}([\\s\\S]*?)<!-- END:\\1${MARKER_SUFFIX}`, 'g');
}

function findSectionBlocks(content: string): SectionBlock[] {
  const pattern = sectionBlockPattern();
  const blocks: SectionBlock[] = [];
  let match = pattern.exec(content);

  while (match) {
    const full = match[0];
    const name = match[1];
    const inner = match[2] ?? '';
    if (name) {
      blocks.push({ name, full, body: inner.trim() });
      // Preserved sections may sit inside another block (for example SPRINT_ROLES inside CHARTER).
      blocks.push(...findSectionBlocks(inner));
    }
    match = pattern.exec(content);
  }

  return blocks;
}

function hasMarkers(content: string): boolean {
  return new RegExp(`<!-- BEGIN:${SECTION_NAME_PATTERN}${MARKER_SUFFIX}`).test(content);
}

function shouldPreserveMarker(name: string, config: HybridFileConfig): boolean {
  return name.startsWith('PROJECT:') || (config.preserveMarkers ?? []).includes(name);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ABSENT = '<absent>';
/** Recorded for a region the user kept over an upstream change when no earlier base exists: it matches no hash. */
const UNRESOLVED_BASE = 'unresolved';

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

const ABSENT_HASH = hashText(ABSENT);

/** Top-level marker sections by name (nested blocks stay inside their parent's body). */
function topLevelSections(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  const pattern = sectionBlockPattern();
  let match = pattern.exec(content);
  while (match) {
    const name = match[1];
    if (name && !sections.has(name)) {
      sections.set(name, match[2] ?? '');
    }
    match = pattern.exec(content);
  }
  return sections;
}

/** Hash of each harness-owned top-level section; a nested preserved block is project text, so it is left out. */
function sectionRegionHashes(content: string, config: HybridFileConfig): Map<string, string> {
  const regions = new Map<string, string>();
  for (const [name, body] of topLevelSections(content)) {
    if (shouldPreserveMarker(name, config)) {
      continue;
    }
    const harnessText = body
      .replace(sectionBlockPattern(), (full, nested: string) =>
        shouldPreserveMarker(nested, config) ? `<!-- PRESERVED:${nested} -->` : full,
      )
      .replace(/\r\n/g, '\n')
      .trim();
    regions.set(name, hashText(harnessText));
  }
  return regions;
}

function sortJsonKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(sortJsonKeys);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJsonKeys(value[key] as JsonValue)]),
    );
  }
  return value;
}

/** The value a harness key owns; for `prefix:*` keys, the matching children of the parent object. */
function jsonRegionValue(json: JsonValue | unknown, keyPath: string): JsonValue | undefined {
  if (!keyPath.endsWith(':*')) {
    return getAtPath(json, keyPath);
  }
  const parts = splitPath(keyPath.slice(0, -2));
  const prefix = parts.at(-1);
  const parentPath = parts.slice(0, -1).join('.');
  const parent = parentPath ? getAtPath(json, parentPath) : json;
  if (!prefix || !isRecord(parent)) {
    return undefined;
  }
  const matching = Object.entries(parent).filter(([key]) => key.startsWith(prefix));
  return matching.length > 0 ? Object.fromEntries(matching) : undefined;
}

function jsonRegionHashes(json: JsonValue | unknown, config: HybridFileConfig): Map<string, string> {
  const regions = new Map<string, string>();
  for (const keyPath of config.harnessKeys ?? []) {
    const value = jsonRegionValue(json, keyPath);
    regions.set(keyPath, value === undefined ? ABSENT_HASH : hashText(JSON.stringify(sortJsonKeys(value))));
  }
  return regions;
}

function tracksRegions(config: HybridFileConfig): boolean {
  return config.strategy === 'section-merge' || config.strategy === 'json-deep-merge';
}

async function regionHashesOf(filePath: string, config: HybridFileConfig): Promise<Map<string, string>> {
  return config.strategy === 'section-merge'
    ? sectionRegionHashes(await readText(filePath), config)
    : jsonRegionHashes(await readJson<JsonValue>(filePath), config);
}

interface RegionVerdict {
  keepLocal: string[];
  conflicts: string[];
}

/**
 * Three-way check per harness section or key. `base` is what upstream shipped at the last sync, or null when no
 * base is known: then a region the downstream never had is a new upstream region, and any other difference is a
 * conflict because nobody can tell which side changed it.
 */
function classifyRegions(
  local: Map<string, string>,
  upstream: Map<string, string>,
  base: Map<string, string> | null,
): RegionVerdict {
  const keepLocal: string[] = [];
  const conflicts: string[] = [];
  const names = new Set([...local.keys(), ...upstream.keys()]);

  for (const name of names) {
    const localHash = local.get(name) ?? ABSENT_HASH;
    const upstreamHash = upstream.get(name) ?? ABSENT_HASH;
    if (localHash === upstreamHash) {
      continue;
    }
    if (base === null) {
      if (localHash !== ABSENT_HASH) {
        conflicts.push(name);
      }
      continue;
    }
    const baseHash = base.get(name) ?? ABSENT_HASH;
    if (baseHash === localHash) {
      continue;
    }
    // Only the downstream changed it, and upstream still ships it: keep the local text. A region upstream dropped
    // cannot be kept by the merge, so a local edit to it is a conflict.
    if (baseHash === upstreamHash && upstreamHash !== ABSENT_HASH) {
      keepLocal.push(name);
    } else {
      conflicts.push(name);
    }
  }

  return { keepLocal, conflicts };
}

/** True when a section-merge or json-deep-merge file exists locally without recorded region hashes. */
export async function missingRegionHistory(localRoot: string, manifest: SyncManifest): Promise<boolean> {
  const syncHashes = await loadSyncHashes(localRoot);
  for (const [relativePath, config] of Object.entries(manifest.files.hybrid)) {
    if (
      tracksRegions(config) &&
      !syncHashes.regions[relativePath] &&
      (await fileExists(path.join(localRoot, relativePath)))
    ) {
      return true;
    }
  }
  return false;
}

function isGlob(pattern: string): boolean {
  return pattern.includes('*');
}

function segmentMatchesPattern(patternSegment: string, candidateSegment: string): boolean {
  const regex = new RegExp(`^${escapeRegExp(patternSegment).replaceAll('\\*', '[^/]*')}$`);
  return regex.test(candidateSegment);
}

function matchGlobSegments(
  patternSegments: string[],
  candidateSegments: string[],
  patternIndex = 0,
  candidateIndex = 0,
): boolean {
  if (patternIndex >= patternSegments.length) {
    return candidateIndex === candidateSegments.length;
  }

  const patternSegment = patternSegments[patternIndex];
  if (patternSegment === '**') {
    if (patternIndex === patternSegments.length - 1) {
      return candidateIndex < candidateSegments.length;
    }

    for (let nextIndex = candidateIndex; nextIndex <= candidateSegments.length; nextIndex += 1) {
      if (matchGlobSegments(patternSegments, candidateSegments, patternIndex + 1, nextIndex)) {
        return true;
      }
    }

    return false;
  }

  if (patternSegment === undefined) {
    return candidateIndex === candidateSegments.length;
  }

  const candidateSegment = candidateSegments[candidateIndex];
  if (candidateSegment === undefined || !segmentMatchesPattern(patternSegment, candidateSegment)) {
    return false;
  }

  return matchGlobSegments(patternSegments, candidateSegments, patternIndex + 1, candidateIndex + 1);
}

function matchesHarnessGlob(pattern: string, candidate: string): boolean {
  const normalizedPattern = normalizeRelativePath(pattern);
  const normalizedCandidate = normalizeRelativePath(candidate);
  return matchGlobSegments(normalizedPattern.split('/'), normalizedCandidate.split('/'));
}

function readConfigFromRoot(root: string): Promise<VibeConfig> {
  return readJson<VibeConfig>(path.join(root, '.vibe', 'config.json'));
}

async function loadSyncHashes(localRoot: string): Promise<SyncHashes> {
  const hashPath = path.join(localRoot, '.vibe', 'sync-hashes.json');
  if (!(await fileExists(hashPath))) {
    return { files: {}, regions: {} };
  }

  try {
    const loaded = await readJson<Partial<SyncHashes>>(hashPath);
    return { files: loaded.files ?? {}, regions: loaded.regions ?? {} };
  } catch {
    return { files: {}, regions: {} };
  }
}

/**
 * The base for a hybrid file's regions: the hashes recorded at the last sync; else the file as the installed
 * upstream version shipped it (`baseRoot`); else, when the whole file is unchanged since the last sync, the local
 * file itself; else unknown.
 */
async function regionBase(
  relativePath: string,
  config: HybridFileConfig,
  syncHashes: SyncHashes,
  local: Map<string, string>,
  localFileHash: string,
  baseRoot: string | null,
): Promise<Map<string, string> | null> {
  const recorded = syncHashes.regions[relativePath];
  if (recorded) {
    return new Map(Object.entries(recorded));
  }
  if (baseRoot) {
    const basePath = path.join(baseRoot, relativePath);
    return (await fileExists(basePath)) ? regionHashesOf(basePath, config) : new Map();
  }
  return syncHashes.files[relativePath] === localFileHash ? local : null;
}

function hybridAction(
  merge: HybridMergeAction,
  verdict: RegionVerdict,
  kind: 'section' | 'key',
): SyncAction {
  const withKept: HybridMergeAction =
    verdict.keepLocal.length > 0 ? { ...merge, keepLocal: verdict.keepLocal } : merge;
  if (verdict.conflicts.length === 0) {
    return withKept;
  }
  return {
    type: 'conflict',
    path: merge.path,
    reason: `harness ${kind}${verdict.conflicts.length > 1 ? 's' : ''} changed locally and upstream: ${verdict.conflicts.join(', ')}`,
    regions: verdict.conflicts,
    merge: withKept,
  };
}

function recordRegions(
  syncHashes: SyncHashes,
  relativePath: string,
  upstream: Map<string, string>,
  unresolved: readonly string[] = [],
): void {
  const previous = syncHashes.regions[relativePath] ?? {};
  const next: Record<string, string> = Object.fromEntries(upstream);
  for (const name of unresolved) {
    next[name] = previous[name] ?? UNRESOLVED_BASE;
  }
  syncHashes.regions[relativePath] = next;
}

async function isLocalUnmodified(
  localPath: string,
  upstreamPath: string,
  relativePath: string,
  syncHashes: SyncHashes,
): Promise<boolean> {
  const localHash = await computeFileHash(localPath);
  const trackedHash = syncHashes.files[relativePath];

  if (trackedHash) {
    return trackedHash === localHash;
  }

  const upstreamHash = await computeFileHash(upstreamPath);
  return upstreamHash === localHash;
}

function collectMigrationPaths(
  manifest: SyncManifest,
  fromVersion: string | null,
  toVersion: string,
): string[] {
  return Object.entries(manifest.migrations)
    .filter(([version, scriptPath]) => {
      if (scriptPath === null) {
        return false;
      }

      if (compareVersions(version, toVersion) > 0) {
        return false;
      }

      if (fromVersion === null) {
        return true;
      }

      return compareVersions(version, fromVersion) > 0;
    })
    .sort(([left], [right]) => compareVersions(left, right))
    .map(([, scriptPath]) => scriptPath)
    .filter((scriptPath): scriptPath is string => typeof scriptPath === 'string');
}

export async function loadManifest(upstreamDir: string): Promise<SyncManifest> {
  return readJson<SyncManifest>(path.join(upstreamDir, '.vibe', 'sync-manifest.json'));
}

export async function expandHarnessGlob(
  upstreamRoot: string,
  pattern: string,
): Promise<string[]> {
  const entries = await readdir(upstreamRoot, { recursive: true, withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      normalizeRelativePath(path.relative(upstreamRoot, path.join(entry.parentPath, entry.name))),
    )
    .filter((candidate) => matchesHarnessGlob(pattern, candidate))
    .sort((left, right) => left.localeCompare(right));
}

export interface BuildSyncPlanOptions {
  /** A checkout of the installed upstream version: the region base for hybrid files with no recorded regions. */
  baseRoot?: string | null;
}

export async function buildSyncPlan(
  localRoot: string,
  upstreamRoot: string,
  manifest: SyncManifest,
  options: BuildSyncPlanOptions = {},
): Promise<SyncPlan> {
  const baseRoot = options.baseRoot ?? null;
  const [localConfig, upstreamConfig, syncHashes] = await Promise.all([
    readConfigFromRoot(localRoot),
    readConfigFromRoot(upstreamRoot),
    loadSyncHashes(localRoot),
  ]);

  const actions: SyncAction[] = [];
  const resolvedHarness = Array.from(
    new Set(
      (
        await Promise.all(
          manifest.files.harness.map(async (entry) =>
            isGlob(entry) ? expandHarnessGlob(upstreamRoot, entry) : [normalizeRelativePath(entry)],
          ),
        )
      ).flat(),
    ),
  );

  for (const relativePath of resolvedHarness) {
    const localPath = path.join(localRoot, relativePath);
    const upstreamPath = path.join(upstreamRoot, relativePath);
    const localExists = await fileExists(localPath);
    const upstreamExists = await fileExists(upstreamPath);

    if (!upstreamExists) {
      actions.push({
        type: 'skip',
        path: relativePath,
        reason: 'missing from upstream source',
      });
      continue;
    }

    if (!localExists) {
      actions.push({ type: 'new-file', path: relativePath });
      continue;
    }

    const localHash = await computeFileHash(localPath);
    const trackedHash = syncHashes.files[relativePath];

    // A downstream patch that upstream has since released byte for byte is not a conflict:
    // replacing it changes nothing and records the new hash.
    if (localHash !== trackedHash && localHash === (await computeFileHash(upstreamPath))) {
      actions.push({
        type: 'replace',
        path: relativePath,
        reason: 'local copy already matches upstream',
      });
      continue;
    }

    if (!trackedHash) {
      actions.push({
        type: 'conflict',
        path: relativePath,
        reason: 'local file exists without sync history',
      });
      continue;
    }

    if (trackedHash !== localHash) {
      actions.push({
        type: 'conflict',
        path: relativePath,
        reason: 'local file changed since last sync',
      });
      continue;
    }

    actions.push({
      type: 'replace',
      path: relativePath,
      reason: 'tracked harness file',
    });
  }

  for (const [relativePath, config] of Object.entries(manifest.files.hybrid)) {
    const localPath = path.join(localRoot, relativePath);
    const upstreamPath = path.join(upstreamRoot, relativePath);
    const localExists = await fileExists(localPath);
    const upstreamExists = await fileExists(upstreamPath);

    if (!upstreamExists) {
      actions.push({
        type: 'skip',
        path: relativePath,
        reason: 'missing from upstream source',
      });
      continue;
    }

    if (!localExists) {
      actions.push({ type: 'new-file', path: relativePath });
      continue;
    }

    if (config.strategy === 'section-merge') {
      const [localContent, upstreamContent] = await Promise.all([
        readText(localPath),
        readText(upstreamPath),
      ]);
      const merged = sectionMerge(localContent, upstreamContent, config);
      if (merged === null) {
        if (await isLocalUnmodified(localPath, upstreamPath, relativePath, syncHashes)) {
          actions.push({
            type: 'replace',
            path: relativePath,
            reason: 'bootstrap sync markers for unmodified legacy file',
          });
        } else {
          actions.push({
            type: 'skip',
            path: relativePath,
            reason: 'kept local legacy file without sync markers',
          });
        }
      } else {
        const sections = [
          ...(config.harnessMarkers ?? []),
          ...(config.preserveMarkers ?? []),
        ];
        const local = sectionRegionHashes(localContent, config);
        const base = await regionBase(
          relativePath,
          config,
          syncHashes,
          local,
          await computeFileHash(localPath),
          baseRoot,
        );
        const verdict = classifyRegions(local, sectionRegionHashes(upstreamContent, config), base);
        actions.push(hybridAction({ type: 'section-merge', path: relativePath, sections }, verdict, 'section'));
      }
      continue;
    }

    if (config.strategy === 'json-deep-merge') {
      const keys = [...(config.harnessKeys ?? []), ...(config.projectKeys ?? [])];
      const [localJson, upstreamJson] = await Promise.all([
        readJson<JsonValue>(localPath),
        readJson<JsonValue>(upstreamPath),
      ]);
      const local = jsonRegionHashes(localJson, config);
      const base = await regionBase(
        relativePath,
        config,
        syncHashes,
        local,
        await computeFileHash(localPath),
        baseRoot,
      );
      const verdict = classifyRegions(local, jsonRegionHashes(upstreamJson, config), base);
      actions.push(hybridAction({ type: 'json-merge', path: relativePath, keys }, verdict, 'key'));
      continue;
    }

    if (config.strategy === 'json-array-union') {
      const keys = [...(config.harnessKeys ?? []), ...(config.projectKeys ?? [])];
      actions.push({ type: 'json-array-union', path: relativePath, keys });
      continue;
    }

    if (config.strategy === 'line-union') {
      actions.push({ type: 'line-merge', path: relativePath, reason: config.note ?? 'line union merge' });
      continue;
    }

    if (config.strategy === 'replace-if-unmodified') {
      if (await isLocalUnmodified(localPath, upstreamPath, relativePath, syncHashes)) {
        actions.push({
          type: 'replace',
          path: relativePath,
          reason: 'local file unmodified since last sync',
        });
      } else {
        actions.push({
          type: 'skip',
          path: relativePath,
          reason: 'kept local file changed since last sync',
        });
      }
      continue;
    }

    actions.push({ type: 'template-regen', path: relativePath });
  }

  const fromVersion = localConfig.harnessVersionInstalled ?? null;
  const toVersion = upstreamConfig.harnessVersion ?? manifest.manifestVersion;

  return {
    fromVersion,
    toVersion,
    actions,
    migrations: collectMigrationPaths(manifest, fromVersion, toVersion),
  };
}

export interface HybridMergeOptions {
  /** Harness sections or keys whose local text stays (see `HybridMergeAction`). */
  keepLocal?: readonly string[] | undefined;
}

export function sectionMerge(
  localContent: string,
  upstreamContent: string,
  config: HybridFileConfig,
  options: HybridMergeOptions = {},
): string | null {
  if (!hasMarkers(localContent)) {
    return null;
  }

  const keepLocal = new Set(options.keepLocal ?? []);
  const localBlocks = findSectionBlocks(localContent);
  const localSections = new Map(localBlocks.map((block) => [block.name, block.full]));

  // Top-level pass: preserved and kept sections come from the local file; harness and other
  // upstream-owned sections keep the upstream text.
  let merged = upstreamContent.replace(sectionBlockPattern(), (fullMatch, rawName: string) =>
    shouldPreserveMarker(rawName, config) || keepLocal.has(rawName)
      ? (localSections.get(rawName) ?? fullMatch)
      : fullMatch,
  );

  // A kept section upstream no longer ships has no place in the upstream layout: keep it at the end.
  const upstreamNames = new Set(topLevelSections(upstreamContent).keys());
  for (const name of keepLocal) {
    const block = localSections.get(name);
    if (block && !upstreamNames.has(name)) {
      merged = `${merged.replace(/\s+$/, '')}\n\n${block}\n`;
    }
  }

  // Nested pass: a preserved section inside an upstream-owned block (SPRINT_ROLES inside
  // CHARTER, PROJECT:* inside a HARNESS section) was just overwritten with the upstream
  // copy, so re-apply the local block wherever the same-named section appears.
  for (const block of localBlocks) {
    if (shouldPreserveMarker(block.name, config)) {
      merged = merged.replace(sectionBlockPattern(block.name), () => block.full);
    }
  }

  return merged;
}

export function jsonDeepMerge(
  localJson: JsonValue | unknown,
  upstreamJson: JsonValue | unknown,
  config: HybridFileConfig,
  options: HybridMergeOptions = {},
): JsonValue {
  const result = cloneJson((isRecord(localJson) ? localJson : {}) as JsonValue);
  const keepLocal = new Set(options.keepLocal ?? []);
  const harnessKeys = (config.harnessKeys ?? []).filter((keyPath) => !keepLocal.has(keyPath));

  for (const keyPath of harnessKeys) {
    if (keyPath.endsWith(':*')) {
      const prefixPath = keyPath.slice(0, -2);
      const parts = splitPath(prefixPath);
      const last = parts.at(-1);
      const parentPath = parts.slice(0, -1).join('.');
      const localParent = parentPath ? getAtPath(result, parentPath) : result;
      const upstreamParent = parentPath ? getAtPath(upstreamJson, parentPath) : upstreamJson;

      if (!last || !isRecord(localParent) || !isRecord(upstreamParent)) {
        continue;
      }

      for (const existingKey of Object.keys(localParent)) {
        if (existingKey.startsWith(last)) {
          delete localParent[existingKey];
        }
      }

      for (const [childKey, childValue] of Object.entries(upstreamParent)) {
        if (childKey.startsWith(last)) {
          localParent[childKey] = cloneJson(childValue);
        }
      }

      continue;
    }

    const upstreamValue = getAtPath(upstreamJson, keyPath);
    if (upstreamValue === undefined) {
      deleteAtPath(result, keyPath);
      continue;
    }
    setAtPath(result, keyPath, upstreamValue);
  }

  return result as JsonValue;
}

export function jsonArrayUnionMerge(
  localJson: JsonValue | unknown,
  upstreamJson: JsonValue | unknown,
  config: HybridFileConfig,
): JsonValue {
  const result = cloneJson((isRecord(localJson) ? localJson : {}) as JsonValue);

  for (const keyPath of config.harnessKeys ?? []) {
    const localValue = getAtPath(result, keyPath);
    const upstreamValue = getAtPath(upstreamJson, keyPath);
    setAtPath(result, keyPath, jsonArrayUnion(localValue, upstreamValue));
  }

  return result as JsonValue;
}

function splitLogicalLines(content: string): string[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines;
}

export function lineUnionMerge(localContent: string, upstreamContent: string): string {
  const merged = splitLogicalLines(localContent);
  const seen = new Set(merged);
  let appended = false;

  for (const line of splitLogicalLines(upstreamContent)) {
    if (line.length === 0 || seen.has(line)) {
      continue;
    }

    if (!appended && merged.length > 0 && merged.at(-1) !== '') {
      merged.push('');
    }
    merged.push(line);
    seen.add(line);
    appended = true;
  }

  return `${merged.join('\n')}\n`;
}

export async function computeFileHash(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

export async function createBackup(localRoot: string, files: string[]): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(localRoot, '.vibe', 'sync-backup', stamp);
  await mkdir(backupDir, { recursive: true });

  for (const relativePath of files) {
    const source = path.join(localRoot, relativePath);
    if (!(await fileExists(source))) {
      continue;
    }

    const target = path.join(backupDir, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }

  return backupDir;
}

export async function applySyncPlan(
  localRoot: string,
  upstreamRoot: string,
  plan: SyncPlan,
  manifest: SyncManifest,
): Promise<void> {
  const syncHashes = await loadSyncHashes(localRoot);
  const hashTargets = new Set<string>();

  for (const action of plan.actions) {
    const localPath = path.join(localRoot, action.path);
    const upstreamPath = path.join(upstreamRoot, action.path);

    if (action.type === 'skip' || action.type === 'conflict') {
      continue;
    }

    if (action.type === 'delete') {
      await rm(localPath, { force: true });
      delete syncHashes.files[action.path];
      continue;
    }

    if (action.type === 'replace' || action.type === 'new-file' || action.type === 'template-regen') {
      await mkdir(path.dirname(localPath), { recursive: true });
      await copySyncedFile(upstreamPath, localPath, action.path);
      hashTargets.add(action.path);
      const hybrid = manifest.files.hybrid[action.path];
      if (hybrid && tracksRegions(hybrid)) {
        recordRegions(syncHashes, action.path, await regionHashesOf(upstreamPath, hybrid));
      }
      continue;
    }

    if (action.type === 'section-merge') {
      const [localContent, upstreamContent] = await Promise.all([
        readText(localPath),
        readText(upstreamPath),
      ]);
      const config = manifest.files.hybrid[action.path];
      if (!config) {
        throw new Error(`Missing hybrid config for ${action.path}`);
      }
      const merged = sectionMerge(localContent, upstreamContent, config, { keepLocal: action.keepLocal });
      if (merged === null) {
        throw new Error(`Cannot merge legacy file without markers: ${action.path}`);
      }
      await writeText(localPath, merged);
      hashTargets.add(action.path);
      recordRegions(syncHashes, action.path, sectionRegionHashes(upstreamContent, config), action.unresolved);
      continue;
    }

    if (action.type === 'json-merge') {
      const config = manifest.files.hybrid[action.path];
      if (!config) {
        throw new Error(`Missing hybrid config for ${action.path}`);
      }
      const [localJson, upstreamJson] = await Promise.all([
        readJson<JsonValue>(localPath),
        readJson<JsonValue>(upstreamPath),
      ]);
      const merged = jsonDeepMerge(localJson, upstreamJson, config, { keepLocal: action.keepLocal });
      await writeJson(localPath, merged);
      hashTargets.add(action.path);
      recordRegions(syncHashes, action.path, jsonRegionHashes(upstreamJson, config), action.unresolved);
      continue;
    }

    if (action.type === 'json-array-union') {
      const config = manifest.files.hybrid[action.path];
      if (!config) {
        throw new Error(`Missing hybrid config for ${action.path}`);
      }
      const [localJson, upstreamJson] = await Promise.all([
        readJson<JsonValue>(localPath),
        readJson<JsonValue>(upstreamPath),
      ]);
      const merged = jsonArrayUnionMerge(localJson, upstreamJson, config);
      await writeJson(localPath, merged);
      hashTargets.add(action.path);
      continue;
    }

    if (action.type === 'line-merge') {
      const [localContent, upstreamContent] = await Promise.all([
        readText(localPath),
        readText(upstreamPath),
      ]);
      await writeText(localPath, lineUnionMerge(localContent, upstreamContent));
      hashTargets.add(action.path);
    }
  }

  for (const relativePath of hashTargets) {
    const target = path.join(localRoot, relativePath);
    if (await fileExists(target)) {
      syncHashes.files[relativePath] = await computeFileHash(target);
    }
  }

  // A project with no region history keeps the old file shape until a sync records one.
  await writeJson(
    path.join(localRoot, '.vibe', 'sync-hashes.json'),
    Object.keys(syncHashes.regions).length > 0 ? syncHashes : { files: syncHashes.files },
  );
}

export async function runMigrations(
  localRoot: string,
  upstreamRoot: string,
  migrations: string[],
): Promise<void> {
  for (const migration of migrations) {
    const scriptPath = path.join(upstreamRoot, migration);
    await runCommand('node', [scriptPath, localRoot], {
      cwd: localRoot,
    });
  }
}
