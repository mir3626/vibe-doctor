import path from 'node:path';
import { fileExists, readJson, writeJson } from './fs.js';
import { paths } from './paths.js';

export interface ProjectMapModule {
  exports: string[];
  imports: string[];
  sprintAdded?: string;
}

export interface ActivePlatformRule {
  rule: string;
  location: string;
  sprintAdded: string;
}

export interface ProjectMap {
  $schema?: string;
  schemaVersion: string;
  updatedAt: string;
  lastSprintId?: string;
  modules: Record<string, ProjectMapModule>;
  activePlatformRules: ActivePlatformRule[];
}

function resolveRoot(root?: string): string {
  return root ?? paths.root;
}

function projectMapPath(root?: string): string {
  return path.join(resolveRoot(root), '.vibe', 'agent', 'project-map.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function normalizeModulePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function emptyProjectMap(): ProjectMap {
  return {
    schemaVersion: '0.1',
    updatedAt: new Date().toISOString(),
    modules: {},
    activePlatformRules: [],
  };
}

function cloneProjectMapModule(module: ProjectMapModule): ProjectMapModule {
  return {
    exports: [...module.exports],
    imports: [...module.imports],
    ...(module.sprintAdded === undefined ? {} : { sprintAdded: module.sprintAdded }),
  };
}

function cloneActivePlatformRule(rule: ActivePlatformRule): ActivePlatformRule {
  return { ...rule };
}

function cloneProjectMap(map: ProjectMap): ProjectMap {
  return {
    ...(map.$schema === undefined ? {} : { $schema: map.$schema }),
    schemaVersion: map.schemaVersion,
    updatedAt: map.updatedAt,
    ...(map.lastSprintId === undefined ? {} : { lastSprintId: map.lastSprintId }),
    modules: Object.fromEntries(
      Object.entries(map.modules).map(([key, value]) => [key, cloneProjectMapModule(value)]),
    ),
    activePlatformRules: map.activePlatformRules.map(cloneActivePlatformRule),
  };
}

function isProjectMapModule(value: unknown): value is ProjectMapModule {
  return (
    isRecord(value) &&
    isStringArray(value.exports) &&
    isStringArray(value.imports) &&
    (value.sprintAdded === undefined || typeof value.sprintAdded === 'string')
  );
}

function isActivePlatformRule(value: unknown): value is ActivePlatformRule {
  return (
    isRecord(value) &&
    typeof value.rule === 'string' &&
    typeof value.location === 'string' &&
    typeof value.sprintAdded === 'string'
  );
}

export function isProjectMap(value: unknown): value is ProjectMap {
  return (
    isRecord(value) &&
    (value.$schema === undefined || typeof value.$schema === 'string') &&
    typeof value.schemaVersion === 'string' &&
    typeof value.updatedAt === 'string' &&
    (value.lastSprintId === undefined || typeof value.lastSprintId === 'string') &&
    isRecord(value.modules) &&
    Object.values(value.modules).every(isProjectMapModule) &&
    Array.isArray(value.activePlatformRules) &&
    value.activePlatformRules.every(isActivePlatformRule)
  );
}

export async function loadProjectMap(root?: string): Promise<ProjectMap> {
  const filePath = projectMapPath(root);
  if (!(await fileExists(filePath))) {
    return emptyProjectMap();
  }

  const loaded = await readJson<unknown>(filePath);
  if (!isProjectMap(loaded)) {
    throw new Error(`Invalid project map at ${filePath}`);
  }

  return cloneProjectMap(loaded);
}

export async function saveProjectMap(map: ProjectMap, root?: string): Promise<void> {
  const nextMap = cloneProjectMap(map);
  nextMap.updatedAt = new Date().toISOString();
  await writeJson(projectMapPath(root), nextMap);
}

export async function registerModule(args: {
  path: string;
  exports: string[];
  imports: string[];
  sprintId: string;
  root?: string;
}): Promise<ProjectMap> {
  const map = await loadProjectMap(args.root);
  const key = normalizeModulePath(args.path);
  const existing = map.modules[key];
  map.modules[key] = {
    exports: [...args.exports],
    imports: [...args.imports],
    sprintAdded: existing?.sprintAdded ?? args.sprintId,
  };
  map.lastSprintId = args.sprintId;
  await saveProjectMap(map, args.root);
  return loadProjectMap(args.root);
}

export async function registerPlatformRule(args: {
  rule: string;
  location: string;
  sprintId: string;
  root?: string;
}): Promise<ProjectMap> {
  const map = await loadProjectMap(args.root);
  const exists = map.activePlatformRules.some(
    (entry) => entry.rule === args.rule && entry.location === args.location,
  );
  if (exists) {
    return map;
  }

  map.activePlatformRules.push({
    rule: args.rule,
    location: args.location,
    sprintAdded: args.sprintId,
  });
  map.lastSprintId = args.sprintId;
  await saveProjectMap(map, args.root);
  return loadProjectMap(args.root);
}

export function mergeProjectMaps(base: ProjectMap, incoming: Partial<ProjectMap>): ProjectMap {
  const mergedModules: Record<string, ProjectMapModule> = {
    ...Object.fromEntries(
      Object.entries(base.modules).map(([key, value]) => [key, cloneProjectMapModule(value)]),
    ),
  };
  for (const [key, value] of Object.entries(incoming.modules ?? {})) {
    if (isProjectMapModule(value)) {
      mergedModules[key] = cloneProjectMapModule(value);
    }
  }

  const rules: ActivePlatformRule[] = [];
  const seen = new Set<string>();
  for (const rule of [...base.activePlatformRules, ...(incoming.activePlatformRules ?? [])]) {
    if (!isActivePlatformRule(rule)) {
      continue;
    }
    const dedupeKey = `${rule.rule}\u0000${rule.location}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    rules.push(cloneActivePlatformRule(rule));
  }

  return {
    ...(incoming.$schema !== undefined
      ? { $schema: incoming.$schema }
      : base.$schema !== undefined
        ? { $schema: base.$schema }
        : {}),
    schemaVersion: incoming.schemaVersion ?? base.schemaVersion,
    updatedAt: incoming.updatedAt ?? base.updatedAt,
    ...(incoming.lastSprintId !== undefined
      ? { lastSprintId: incoming.lastSprintId }
      : base.lastSprintId !== undefined
        ? { lastSprintId: base.lastSprintId }
        : {}),
    modules: mergedModules,
    activePlatformRules: rules,
  };
}
