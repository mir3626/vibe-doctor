#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SKILL_PATH = '.claude/skills/vibe-sync/SKILL.md';
const MANIFEST_PATH = '.vibe/sync-manifest.json';
const RUNTIME_PATH = '.vibe/harness/src/commands/sync.ts';
const CONFIG_PATH = '.vibe/config.json';

// Shared-module ownership boundary: product code may import from the harness tree only
// through the documented cross-boundary surface — module paths whose sanctioned symbols
// are values BOTH sides compute and compare (FND-020 fail-closed equality):
//   universal-integrity-core/index.js -> deriveFinalEvidenceManifest (manifest derivation)
//   pro-roundtrip/report.js           -> workflowMatrixMarkdown (matrix bytes feed
//                                        workflowMatrixSha256 in that manifest)
// The audit is path-granular; symbol discipline is documented and guarded downstream.
// Projects extend this list via `.vibe/config.json` audit.harnessImportAllowlist.
const CROSS_BOUNDARY_IMPORT_ALLOWLIST = [
  '.vibe/harness/src/universal-integrity-core/index.js',
  '.vibe/harness/src/pro-roundtrip/report.js',
];
const PRODUCT_CODE_DIRS = ['src', 'scripts', 'test', 'app', 'components', 'lib'];
const PRODUCT_CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']);
const HARNESS_OWNED_PRODUCT_FILES = new Set(['scripts/vibe-sync-bootstrap.mjs']);
const HARNESS_SRC_PREFIX = '.vibe/harness/src/';

const REQUIRED_SKILL_SIGNALS = [
  { id: 'dry-run-first', pattern: /npm run vibe:sync -- --dry-run/ },
  { id: 'conflict-explain', pattern: /Explain any `conflict` rows/ },
  { id: 'run-sync', pattern: /npm run vibe:sync/ },
  { id: 'harness-typecheck', pattern: /\.vibe\/harness\/tsconfig\.harness\.json/ },
  { id: 'bootstrap-preflight', pattern: /vibe-preflight\.mjs --bootstrap/ },
  { id: 'sync-backup', pattern: /\.vibe\/sync-backup\/<timestamp>\// },
  { id: 'audit-command', pattern: /npm run vibe:sync-audit/ },
  { id: 'dry-run-flag', pattern: /`--dry-run`/ },
  { id: 'force-flag', pattern: /`--force`/ },
  { id: 'from-flag', pattern: /`--from <path>`/ },
  { id: 'ref-flag', pattern: /`--ref <tag>`/ },
  { id: 'no-backup-flag', pattern: /`--no-backup`/ },
  { id: 'no-verify-flag', pattern: /`--no-verify`/ },
  { id: 'json-flag', pattern: /`--json`/ },
  { id: 'bootstrap-script', pattern: /vibe-sync-bootstrap\.mjs/ },
  { id: 'canonical-runtime', pattern: /canonical harness runtime lives under `\.vibe\/harness\/\*\*`/ },
  { id: 'exact-ref', pattern: /exact `vX\.Y\.Z` or `X\.Y\.Z`: hard pin/ },
  { id: 'caret-ref', pattern: /caret `\^vX\.Y\.Z` or `\^X\.Y\.Z`: floating compatible range/ },
  { id: 'missing-upstream-ref', pattern: /missing `upstream\.ref`/ },
  { id: 'root-code-project-owned', pattern: /Root `src\/\*\*`, `scripts\/\*\*`, `test\/\*\*`, `app\/\*\*`, `components\/\*\*`, and `lib\/\*\*` are project-owned/ },
  { id: 'package-boundary', pattern: /`package\.json` sync owns `scripts\.vibe:\*` and `engines`/ },
];

const REQUIRED_RUNTIME_SIGNALS = [
  { id: 'init-guard', pattern: /hasVibeInitArtifacts/ },
  { id: 'sync-init-message', pattern: /vibe:sync requires an initialized vibe-doctor project/ },
  { id: 'missing-upstream-init', pattern: /resolveMissingUpstream/ },
  { id: 'sync-cache-refresh', pattern: /refreshSyncCache/ },
  { id: 'floating-caret-ref', pattern: /resolveFloatingRefUpdateCandidate/ },
  { id: 'harness-typecheck-selection', pattern: /resolvePostSyncTypecheckArgs/ },
  { id: 'harness-tsconfig', pattern: /\.vibe\/harness\/tsconfig\.harness\.json/ },
  { id: 'bootstrap-preflight', pattern: /vibe-preflight\.mjs', '--bootstrap'/ },
  { id: 'no-verify', pattern: /no-verify/ },
  { id: 'backup-created', pattern: /createBackup/ },
  { id: 'migrations-run', pattern: /runMigrations/ },
  { id: 'harness-version-installed', pattern: /harnessVersionInstalled/ },
  { id: 'conflict-approval', pattern: /approveAndResolve/ },
  { id: 'force-conflicts', pattern: /acceptAllConflicts/ },
];

const REQUIRED_HARNESS_ENTRIES = [
  '.vibe/harness/src/**',
  '.vibe/harness/scripts/**',
  '.vibe/harness/test/**',
  '.vibe/harness/migrations/**',
  '.vibe/harness/tsconfig.harness.json',
  '.vibe/harness/tsconfig.json',
  '.vibe/harness/playwright.config.ts',
  'scripts/vibe-sync-bootstrap.mjs',
  '.vibe/settings-presets/**',
  '.vibe/sync-manifest.json',
  '.claude/agents/**',
  '.claude/skills/**',
  '.claude/templates/**',
  '.codex/agents/**',
  '.codex/skills/**',
  'docs/context/codex-execution.md',
  'docs/context/codex-wrapper-injection-audit.md',
  'docs/context/md-injection-guarantees.md',
  'docs/context/orchestration.md',
  'docs/context/harness-gaps.md',
  'docs/context/vibe-init-sharding.md',
  'docs/context/vibe-interview-sharding.md',
  'docs/context/vibe-iterate-sharding.md',
  'docs/context/vibe-review-sharding.md',
  'docs/context/vibe-sprint-mode-audit.md',
  'docs/context/vibe-sync-audit.md',
  'docs/guides/**',
  'docs/release/**',
];

const REQUIRED_PROJECT_ENTRIES = [
  'docs/context/product.md',
  'docs/context/architecture.md',
  'docs/context/conventions.md',
  'docs/context/qa.md',
  'docs/context/secrets.md',
  'docs/context/tokens.md',
  '.vibe/config.local.json',
  '.env',
  '.vibe/agent/sprint-status.json',
  '.vibe/agent/project-map.json',
  '.vibe/agent/sprint-api-contracts.json',
  '.vibe/agent/iteration-history.json',
  '.vibe/agent/handoff.md',
  '.vibe/agent/session-log.md',
  '.vibe/agent/project-decisions.jsonl',
  '.vibe/agent/tokens.json',
  '.vibe/archive/README.md',
  'docs/plans/project-milestones.md',
  'docs/plans/**',
  'docs/prompts/**',
  'docs/reports/**',
  'src/**',
  'scripts/**',
  'test/**',
  'app/**',
  'components/**',
  'lib/**',
];

const REQUIRED_HYBRID_CONTRACTS = [
  {
    path: 'CLAUDE.md',
    strategy: 'section-merge',
    harnessMarkers: ['HARNESS:core-framing', 'HARNESS:sprint-flow'],
    preserveMarkers: ['SPRINT_ROLES', 'PROJECT:custom-rules'],
  },
  {
    path: 'AGENTS.md',
    strategy: 'section-merge',
    harnessMarkers: ['HARNESS:agent-memory'],
    preserveMarkers: ['PROJECT:custom-rules'],
  },
  {
    path: 'GEMINI.md',
    strategy: 'section-merge',
    harnessMarkers: ['HARNESS:agent-memory'],
    preserveMarkers: ['PROJECT:custom-rules'],
  },
  {
    path: '.claude/settings.json',
    strategy: 'json-deep-merge',
    harnessKeys: ['hooks', 'statusLine'],
    projectKeys: ['permissions'],
  },
  {
    path: 'package.json',
    strategy: 'json-deep-merge',
    harnessKeys: ['scripts.vibe:*', 'engines'],
    projectKeys: ['name', 'version', 'description', 'scripts.test', 'scripts.build', 'scripts.typecheck', 'scripts.test:ui', 'dependencies', 'devDependencies'],
    forbiddenHarnessKeys: ['scripts.test', 'scripts.build', 'scripts.typecheck', 'scripts.test:ui', 'dependencies', 'devDependencies'],
  },
  {
    path: '.vibe/config.json',
    strategy: 'json-deep-merge',
    harnessKeys: ['harnessVersion', 'qa', 'mode'],
    projectKeys: ['orchestrator', 'sprintRoles', 'sprint', 'providers', 'harnessVersionInstalled', 'upstream', 'bundle', 'browserSmoke', 'audit'],
  },
  { path: '.gitignore', strategy: 'line-union' },
  { path: '.gitattributes', strategy: 'line-union' },
  { path: '.editorconfig', strategy: 'line-union' },
  { path: '.env.example', strategy: 'replace-if-unmodified' },
  { path: '.github/workflows/ci.yml', strategy: 'replace-if-unmodified' },
  { path: '.vscode/settings.json', strategy: 'json-deep-merge' },
  { path: '.vscode/extensions.json', strategy: 'json-array-union' },
];

const FORBIDDEN_HARNESS_EXACT = new Set([
  'package.json',
  '.vibe/config.json',
  '.vibe/config.local.json',
  '.env',
  '.env.example',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.github/workflows/ci.yml',
  '.vscode/settings.json',
  '.vscode/extensions.json',
  'README.md',
  'docs/context/product.md',
  'docs/context/architecture.md',
  'docs/context/conventions.md',
  'docs/context/qa.md',
  'docs/context/secrets.md',
  'docs/context/tokens.md',
  'docs/plans/project-milestones.md',
]);

const ALLOWED_HARNESS_AGENT_FILES = new Set([
  '.vibe/agent/_common-rules.md',
  '.vibe/agent/re-incarnation.md',
  '.vibe/agent/README.md',
  '.vibe/agent/sprint-status.schema.json',
  '.vibe/agent/project-map.schema.json',
  '.vibe/agent/sprint-api-contracts.schema.json',
  '.vibe/agent/iteration-history.schema.json',
]);

const FORBIDDEN_ROOT_CODE_DIRS = ['src', 'test', 'app', 'components', 'lib'];
const FORBIDDEN_PROJECT_DOC_DIRS = ['docs/plans', 'docs/prompts', 'docs/reports'];
const FORBIDDEN_PROJECT_VIBE_AGENT_PREFIX = '.vibe/agent/';

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    format: 'text',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === '--root') {
      options.root = argv[index + 1] ?? options.root;
      index += 1;
      continue;
    }
    if (current === '--format') {
      options.format = argv[index + 1] ?? options.format;
      index += 1;
      continue;
    }
    if (current === '--help' || current === '-h') {
      process.stdout.write('Usage: node .vibe/harness/scripts/vibe-sync-audit.mjs [--root <dir>] [--format text|json]\n');
      process.exit(0);
    }
  }

  if (!['text', 'json'].includes(options.format)) {
    throw new Error(`unsupported --format: ${options.format}`);
  }

  return options;
}

function toPosix(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

function readText(root, relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(root, relativePath) {
  return JSON.parse(readText(root, relativePath).replace(/^\uFEFF/, ''));
}

function asStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value.map(toPosix) : [];
}

function addFinding(findings, id, detail, extra = {}) {
  findings.push({ severity: 'error', id, detail, ...extra });
}

function addWarning(warnings, id, detail, extra = {}) {
  warnings.push({ severity: 'warning', id, detail, ...extra });
}

function readOptionalJson(root, relativePath) {
  if (!existsSync(path.join(root, relativePath))) {
    return null;
  }
  try {
    return readJson(root, relativePath);
  } catch {
    return null;
  }
}

function walkFiles(root, relativeDir, results) {
  const absolute = path.join(root, relativeDir);
  if (!existsSync(absolute)) {
    return;
  }
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }
    const relative = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      walkFiles(root, relative, results);
    } else if (entry.isFile()) {
      results.push(relative);
    }
  }
}

function extractImportSpecifiers(text) {
  const specifiers = [];
  const pattern = /(?:\bfrom\s*|\bimport\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;
  for (const match of text.matchAll(pattern)) {
    specifiers.push(match[2]);
  }
  return specifiers;
}

function canonicalHarnessTarget(importerRelativePath, specifier) {
  const normalizedSpecifier = toPosix(specifier);
  const resolved = normalizedSpecifier.startsWith('.')
    ? toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(toPosix(importerRelativePath)), normalizedSpecifier)))
    : normalizedSpecifier;
  const index = resolved.indexOf(HARNESS_SRC_PREFIX);
  return index === -1 ? null : resolved.slice(index);
}

function isAllowlistedTarget(target, allowlist) {
  return allowlist.some((entry) =>
    entry === target || (entry.endsWith('/**') && target.startsWith(entry.slice(0, -2))));
}

/**
 * Shared-module ownership signal (report-only): broad product dependence on harness
 * internals is the observable symptom of an ownership inversion. Imports of the
 * documented cross-boundary surface are recorded as informational; anything else warns.
 */
function checkOwnershipBoundary(root, config, warnings) {
  const allowlist = [
    ...CROSS_BOUNDARY_IMPORT_ALLOWLIST,
    ...asStringArray(config?.audit?.harnessImportAllowlist),
  ];
  const files = [];
  for (const dir of PRODUCT_CODE_DIRS) {
    walkFiles(root, dir, files);
  }
  const crossBoundaryImports = [];
  for (const file of files) {
    if (HARNESS_OWNED_PRODUCT_FILES.has(file) || !PRODUCT_CODE_EXTENSIONS.has(path.posix.extname(file))) {
      continue;
    }
    let text;
    try {
      text = readText(root, file);
    } catch {
      continue;
    }
    if (!text.includes(HARNESS_SRC_PREFIX)) {
      continue;
    }
    for (const specifier of extractImportSpecifiers(text)) {
      const target = canonicalHarnessTarget(file, specifier);
      if (!target) {
        continue;
      }
      if (isAllowlistedTarget(target, allowlist)) {
        crossBoundaryImports.push({ file, target });
      } else {
        addWarning(
          warnings,
          'harness-internal-import',
          'product code imports harness internals beyond the documented cross-boundary surface (ownership-inversion symptom)',
          { path: file, target },
        );
      }
    }
  }
  return crossBoundaryImports;
}

/**
 * Shared-module drift signal (report-only): a downstream that keeps its own copy of a
 * module the harness also vendors declares the pair in
 * `.vibe/config.json` audit.sharedModuleMirrors, and this reports divergence without
 * failing — duplication is expected; silent divergence is not.
 */
function checkSharedModuleMirrors(root, config, warnings) {
  const mirrors = Array.isArray(config?.audit?.sharedModuleMirrors)
    ? config.audit.sharedModuleMirrors
    : [];
  const reports = [];
  for (const mirror of mirrors) {
    const projectPath = typeof mirror?.projectPath === 'string' ? toPosix(mirror.projectPath) : null;
    const harnessPath = typeof mirror?.harnessPath === 'string' ? toPosix(mirror.harnessPath) : null;
    if (!projectPath || !harnessPath) {
      addWarning(warnings, 'shared-module-mirror-invalid', 'sharedModuleMirrors entries need projectPath and harnessPath strings', { target: JSON.stringify(mirror) });
      continue;
    }
    if (!existsSync(path.join(root, projectPath)) || !existsSync(path.join(root, harnessPath))) {
      addWarning(warnings, 'shared-module-mirror-missing', 'declared shared-module mirror side does not exist', { path: projectPath, target: harnessPath });
      continue;
    }
    const hashSide = (base) => {
      const files = [];
      walkFiles(root, base, files);
      const map = new Map();
      for (const file of files) {
        map.set(file.slice(base.length + 1), createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex'));
      }
      return map;
    };
    const project = hashSide(projectPath);
    const harness = hashSide(harnessPath);
    const drifted = [...project.keys()].filter((file) => harness.has(file) && harness.get(file) !== project.get(file)).sort();
    const onlyInProject = [...project.keys()].filter((file) => !harness.has(file)).sort();
    const onlyInHarness = [...harness.keys()].filter((file) => !project.has(file)).sort();
    reports.push({ projectPath, harnessPath, drifted, onlyInProject, onlyInHarness });
    if (drifted.length > 0 || onlyInProject.length > 0 || onlyInHarness.length > 0) {
      addWarning(
        warnings,
        'shared-module-drift',
        `mirror diverged: ${drifted.length} changed, ${onlyInProject.length} project-only, ${onlyInHarness.length} harness-only (${[...drifted, ...onlyInProject, ...onlyInHarness].slice(0, 5).join(', ')})`,
        { path: projectPath, target: harnessPath },
      );
    }
  }
  return reports;
}

function checkSignals(text, signals, target, findings) {
  const present = [];
  for (const signal of signals) {
    if (signal.pattern.test(text)) {
      present.push(signal.id);
    } else {
      addFinding(findings, 'missing-critical-signal', `missing required signal: ${signal.id}`, { target, signal: signal.id });
    }
  }
  return present;
}

function checkPathSafety(entries, owner, findings) {
  for (const entry of entries) {
    if (entry.includes('\\')) {
      addFinding(findings, 'unsafe-manifest-path', 'manifest paths must use POSIX separators', { owner, path: entry });
    }
    if (path.isAbsolute(entry) || /^[A-Za-z]:/.test(entry)) {
      addFinding(findings, 'unsafe-manifest-path', 'manifest paths must be repository-relative', { owner, path: entry });
    }
    if (entry.split('/').includes('..')) {
      addFinding(findings, 'unsafe-manifest-path', 'manifest paths must not contain parent traversal', { owner, path: entry });
    }
  }
}

function checkDuplicates(entries, owner, findings) {
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry)) {
      addFinding(findings, 'duplicate-manifest-entry', 'duplicate manifest entry', { owner, path: entry });
    }
    seen.add(entry);
  }
}

function hasEntry(entries, required) {
  return entries.includes(required);
}

function startsWithPath(entry, prefix) {
  return entry === prefix || entry.startsWith(`${prefix}/`);
}

function isForbiddenHarnessEntry(entry) {
  if (FORBIDDEN_HARNESS_EXACT.has(entry)) {
    return true;
  }
  if (entry === 'scripts/vibe-sync-bootstrap.mjs') {
    return false;
  }
  if (entry === 'scripts/**' || startsWithPath(entry, 'scripts')) {
    return true;
  }
  if (FORBIDDEN_ROOT_CODE_DIRS.some((dir) => entry === `${dir}/**` || startsWithPath(entry, dir))) {
    return true;
  }
  if (FORBIDDEN_PROJECT_DOC_DIRS.some((dir) => entry === `${dir}/**` || startsWithPath(entry, dir))) {
    return true;
  }
  if (entry === 'docs/context/**') {
    return true;
  }
  if (entry.startsWith(FORBIDDEN_PROJECT_VIBE_AGENT_PREFIX) && !ALLOWED_HARNESS_AGENT_FILES.has(entry)) {
    return true;
  }
  return false;
}

function isForbiddenProjectEntry(entry) {
  return (
    entry === '.vibe/harness/**' ||
    startsWithPath(entry, '.vibe/harness') ||
    entry === '.claude/skills/**' ||
    startsWithPath(entry, '.claude/skills') ||
    entry === '.codex/skills/**' ||
    startsWithPath(entry, '.codex/skills') ||
    entry === '.vibe/settings-presets/**' ||
    startsWithPath(entry, '.vibe/settings-presets')
  );
}

function checkRequiredEntries(entries, requiredEntries, owner, findings) {
  for (const required of requiredEntries) {
    if (!hasEntry(entries, required)) {
      addFinding(findings, 'missing-required-manifest-entry', `missing required ${owner} entry: ${required}`, { owner, path: required });
    }
  }
}

function getHybridConfig(manifest, relativePath) {
  return manifest?.files?.hybrid?.[relativePath] && typeof manifest.files.hybrid[relativePath] === 'object'
    ? manifest.files.hybrid[relativePath]
    : null;
}

function checkIncludes(actual, required, label, relativePath, findings) {
  const values = asStringArray(actual);
  for (const requiredValue of required ?? []) {
    if (!values.includes(requiredValue)) {
      addFinding(findings, 'missing-hybrid-key', `missing ${label}: ${requiredValue}`, { path: relativePath, target: label });
    }
  }
}

function checkExcludes(actual, forbidden, label, relativePath, findings) {
  const values = asStringArray(actual);
  for (const forbiddenValue of forbidden ?? []) {
    if (values.includes(forbiddenValue)) {
      addFinding(findings, 'forbidden-hybrid-key', `${label} must not include project-owned key: ${forbiddenValue}`, { path: relativePath, target: label });
    }
  }
}

function checkHybridContracts(manifest, findings) {
  for (const contract of REQUIRED_HYBRID_CONTRACTS) {
    const config = getHybridConfig(manifest, contract.path);
    if (!config) {
      addFinding(findings, 'missing-hybrid-config', `missing hybrid config for ${contract.path}`, { path: contract.path });
      continue;
    }
    if (config.strategy !== contract.strategy) {
      addFinding(findings, 'hybrid-strategy-mismatch', `expected strategy ${contract.strategy}, found ${String(config.strategy)}`, { path: contract.path });
    }
    checkIncludes(config.harnessMarkers, contract.harnessMarkers, 'harnessMarkers', contract.path, findings);
    checkIncludes(config.preserveMarkers, contract.preserveMarkers, 'preserveMarkers', contract.path, findings);
    checkIncludes(config.harnessKeys, contract.harnessKeys, 'harnessKeys', contract.path, findings);
    checkIncludes(config.projectKeys, contract.projectKeys, 'projectKeys', contract.path, findings);
    checkExcludes(config.harnessKeys, contract.forbiddenHarnessKeys, 'harnessKeys', contract.path, findings);
  }
}

function checkMigrations(manifest, findings) {
  const migrations = manifest?.migrations;
  if (!migrations || typeof migrations !== 'object' || Array.isArray(migrations)) {
    addFinding(findings, 'invalid-migrations', 'manifest.migrations must be an object');
    return [];
  }

  const migrationPaths = [];
  for (const [version, migrationPath] of Object.entries(migrations)) {
    if (migrationPath === null) {
      continue;
    }
    if (typeof migrationPath !== 'string') {
      addFinding(findings, 'invalid-migration-path', `migration ${version} must be a string path or null`, { target: version });
      continue;
    }
    const normalized = toPosix(migrationPath);
    migrationPaths.push(normalized);
    if (!/^\.vibe\/harness\/migrations\/[^/]+\.mjs$/.test(normalized)) {
      addFinding(findings, 'invalid-migration-path', 'migration scripts must stay under .vibe/harness/migrations', { target: version, path: normalized });
    }
  }
  return migrationPaths;
}

function auditManifest(manifest, findings) {
  const harnessEntries = asStringArray(manifest?.files?.harness);
  const projectEntries = asStringArray(manifest?.files?.project);
  const hybridPaths = Object.keys(manifest?.files?.hybrid ?? {}).map(toPosix);

  if (manifest?.manifestVersion !== '1.0') {
    addFinding(findings, 'manifest-version', 'expected manifestVersion=1.0');
  }
  if (harnessEntries.length === 0) {
    addFinding(findings, 'invalid-harness-list', 'files.harness must be a non-empty string array');
  }
  if (projectEntries.length === 0) {
    addFinding(findings, 'invalid-project-list', 'files.project must be a non-empty string array');
  }

  checkPathSafety([...harnessEntries, ...projectEntries, ...hybridPaths], 'manifest', findings);
  checkDuplicates(harnessEntries, 'harness', findings);
  checkDuplicates(projectEntries, 'project', findings);
  checkRequiredEntries(harnessEntries, REQUIRED_HARNESS_ENTRIES, 'harness', findings);
  checkRequiredEntries(projectEntries, REQUIRED_PROJECT_ENTRIES, 'project', findings);

  for (const entry of harnessEntries) {
    if (isForbiddenHarnessEntry(entry)) {
      addFinding(findings, 'project-owned-harness-entry', 'harness manifest must not own project-owned paths', { owner: 'harness', path: entry });
    }
  }
  for (const entry of projectEntries) {
    if (isForbiddenProjectEntry(entry)) {
      addFinding(findings, 'harness-owned-project-entry', 'project manifest must not own harness runtime paths', { owner: 'project', path: entry });
    }
  }

  checkHybridContracts(manifest, findings);
  const migrationPaths = checkMigrations(manifest, findings);

  return {
    harnessCount: harnessEntries.length,
    projectCount: projectEntries.length,
    hybridCount: hybridPaths.length,
    migrationCount: migrationPaths.length,
    manifestSignals: [
      'required-harness-entries',
      'required-project-entries',
      'hybrid-contracts',
      'project-owned-boundaries',
      'harness-owned-boundaries',
      'migration-paths',
    ],
  };
}

function audit(root) {
  const findings = [];
  const skillExists = existsSync(path.join(root, SKILL_PATH));
  const manifestExists = existsSync(path.join(root, MANIFEST_PATH));
  const runtimeExists = existsSync(path.join(root, RUNTIME_PATH));

  const skillSignals = skillExists
    ? checkSignals(readText(root, SKILL_PATH), REQUIRED_SKILL_SIGNALS, SKILL_PATH, findings)
    : [];
  if (!skillExists) {
    addFinding(findings, 'skill-missing', `${SKILL_PATH} is missing`, { path: SKILL_PATH });
  }

  const runtimeSignals = runtimeExists
    ? checkSignals(readText(root, RUNTIME_PATH), REQUIRED_RUNTIME_SIGNALS, RUNTIME_PATH, findings)
    : [];
  if (!runtimeExists) {
    addFinding(findings, 'runtime-missing', `${RUNTIME_PATH} is missing`, { path: RUNTIME_PATH });
  }

  let manifestReport = {
    harnessCount: 0,
    projectCount: 0,
    hybridCount: 0,
    migrationCount: 0,
    manifestSignals: [],
  };
  if (!manifestExists) {
    addFinding(findings, 'manifest-missing', `${MANIFEST_PATH} is missing`, { path: MANIFEST_PATH });
  } else {
    try {
      manifestReport = auditManifest(readJson(root, MANIFEST_PATH), findings);
    } catch (error) {
      addFinding(findings, 'manifest-json-invalid', error instanceof Error ? error.message : String(error), { path: MANIFEST_PATH });
    }
  }

  // Report-only ownership/drift signals: never gate the audit exit code.
  const warnings = [];
  const config = readOptionalJson(root, CONFIG_PATH);
  const crossBoundaryImports = checkOwnershipBoundary(root, config, warnings);
  const sharedModuleMirrors = checkSharedModuleMirrors(root, config, warnings);

  return {
    ok: findings.length === 0,
    skillPath: SKILL_PATH,
    manifestPath: MANIFEST_PATH,
    runtimePath: RUNTIME_PATH,
    skillSignals,
    runtimeSignals,
    ...manifestReport,
    crossBoundaryImports,
    sharedModuleMirrors,
    findings,
    warnings,
  };
}

function printText(report) {
  const status = report.ok ? 'OK' : 'FAIL';
  process.stdout.write(`[vibe-sync-audit] ${status} harness=${report.harnessCount} hybrid=${report.hybridCount} project=${report.projectCount} migrations=${report.migrationCount} skillSignals=${report.skillSignals.length} runtimeSignals=${report.runtimeSignals.length} warnings=${report.warnings.length}\n`);
  for (const finding of report.findings) {
    const target = finding.path ?? finding.target ?? finding.signal ?? '';
    process.stdout.write(`- ${finding.severity}: ${finding.id}${target ? ` ${target}` : ''} - ${finding.detail}\n`);
  }
  for (const warning of report.warnings) {
    const target = warning.path ?? warning.target ?? '';
    process.stdout.write(`- ${warning.severity}: ${warning.id}${target ? ` ${target}` : ''} - ${warning.detail}\n`);
  }
  for (const entry of report.crossBoundaryImports) {
    process.stdout.write(`- info: cross-boundary-import ${entry.file} -> ${entry.target}\n`);
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  const report = audit(path.resolve(options.root));
  if (options.format === 'json') {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printText(report);
  }
  process.exit(report.ok ? 0 : 1);
} catch (error) {
  process.stderr.write(`[vibe-sync-audit] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
