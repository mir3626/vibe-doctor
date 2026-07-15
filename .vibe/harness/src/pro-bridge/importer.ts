import { createHash } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  CLI_PROMPT_CONTRACT_REQUIREMENTS,
  FOLDER_NAME_PATTERN,
  FindingsFileSchema,
  compareStringsByCodePoint,
  computePayloadSha256,
  isSafeRelativePath,
  type ReviewRequest,
  type ReviewResultKind,
  type ReviewResultManifest,
  type FindingsFile,
} from './contract.js';
import {
  checkRequiredFiles,
  type VibeBundle,
} from './vibe-bundle.js';

export type ImporterFileInput = { path: string; content: string | Uint8Array };

export type ImporterInput =
  | { kind: 'bundle'; bundle: VibeBundle }
  | { kind: 'files'; requestId: string; folder: string; files: ImporterFileInput[] };

export interface ImportContext {
  repoRoot: string;
  installRoot?: string;
  resultKind?: ReviewResultKind;
  request?: ReviewRequest | null;
  resultManifest?: ReviewResultManifest | null;
  expectedRepositoryFullName?: string | null;
  currentRepositoryFullName?: string | null;
  requestRepositoryFullName?: string | null;
  repositoryIdentityOverride?: {
    current: string | null;
    request: string | null;
    flag: 'dangerously-override-repository-identity';
  } | null;
  unboundAcceptance?: {
    flag: 'accept-unbound-web-origin';
    acknowledgedAt: string;
  } | null;
  approveRevision?: boolean;
  acknowledgedValidations?: string[];
  transport?: string;
  now?: () => Date;
  onAfterDurableOp?: (event: {
    scope: string;
    step: string;
    requestId?: string;
    path?: string;
  }) => void | Promise<void>;
  assertDurableLease?: () => Promise<void>;
  limits?: {
    maxFiles?: number;
    maxTotalBytes?: number;
    maxFileBytes?: number;
  };
}

export type ImportValidationErrorCode =
  | 'invalid-folder'
  | 'unsafe-path'
  | 'duplicate-path'
  | 'path-not-allowed'
  | 'reserved-path'
  | 'too-many-files'
  | 'file-too-large'
  | 'total-too-large'
  | 'invalid-utf8'
  | 'binary-content'
  | 'unsafe-control-characters'
  | 'result-kind-ambiguous'
  | 'result-kind-mismatch'
  | 'missing-required-file'
  | 'empty-prompt'
  | 'findings-parse-error'
  | 'findings-schema-violation'
  | 'findings-severity-mismatch'
  | 'findings-summary-mismatch'
  | 'findings-binding-mismatch'
  | 'prompt-contract-violation'
  | 'request-id-mismatch'
  | 'request-hash-mismatch'
  | 'result-hash-mismatch'
  | 'repository-mismatch'
  | 'reviewed-head-mismatch'
  | 'file-roster-mismatch'
  | 'file-sha-mismatch';

export type ImportOutcome =
  | {
      status: 'installed';
      folder: string;
      installedPath: string;
      resultFilesSha256: string;
      nextAction: string;
      skippedValidations: string[];
    }
  | {
      status: 'no-op';
      folder: string;
      installedPath?: string;
      resultFilesSha256?: string;
      repositoryFullName?: string | null;
      legacyRepositoryIdentity?: true;
    }
  | {
      status: 'refused';
      code: 'existing-folder-conflict' | 'revision-slot-occupied';
      message: string;
    }
  | {
      status: 'invalid';
      errors: Array<{ code: ImportValidationErrorCode; path?: string; message: string }>;
    };

interface NormalizedInput {
  requestId: string;
  folder: string;
  files: ImporterFileInput[];
}

interface DecodedFile {
  path: string;
  bytes: Uint8Array;
  content: string | null;
}

interface ProvenanceReceipt {
  schemaVersion: 'vibe-pro-bridge-provenance-v1';
  requestId: string;
  requestPayloadSha256: string | null;
  resultPayloadSha256: string | null;
  resultFilesSha256: string;
  reviewedBaseSha: string | null;
  reviewedHeadSha: string | null;
  importedAt: string;
  transport: string;
  reviewerDeclaration: ReviewResultManifest['reviewerDeclaration'] | null;
  skippedValidations: string[];
  folder: string;
  currentRepositoryFullName: string | null;
  requestRepositoryFullName: string | null;
  repositoryIdentityOverride: {
    current: string | null;
    request: string | null;
    flag: 'dangerously-override-repository-identity';
  } | null;
  unboundAcceptance: {
    flag: 'accept-unbound-web-origin';
    acknowledgedAt: string;
  } | null;
  revision?: number;
  revisionOf?: string | null;
  predecessorResultSha256?: string | null;
}

interface ExistingProvenance {
  resultIdentity: string | null;
  resultPayloadSha256: string | null;
  resultFilesSha256: string | null;
  repositoryFullName: string | null;
  hasRepositoryIdentityFields: boolean;
}

interface RevisionSlot {
  folder: string;
  folderPath: string;
  revision: number;
  provenance: ExistingProvenance | null;
}

const DEFAULT_LIMITS = {
  maxFiles: 64,
  maxTotalBytes: 4 * 1024 * 1024,
  maxFileBytes: 1024 * 1024,
} as const;

const RESERVED_PROVENANCE_PATH = '.bridge/provenance.json';
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const CONTRACT_ERROR_CODES = new Set<ImportValidationErrorCode>([
  'findings-schema-violation',
  'findings-severity-mismatch',
  'findings-summary-mismatch',
  'findings-binding-mismatch',
  'prompt-contract-violation',
]);

function normalizeLimit(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function normalizeInput(input: ImporterInput): NormalizedInput {
  if (input.kind === 'bundle') {
    return {
      requestId: input.bundle.requestId,
      folder: input.bundle.folder,
      files: input.bundle.files,
    };
  }
  return {
    requestId: input.requestId,
    folder: input.folder,
    files: input.files,
  };
}

function fileBytes(file: ImporterFileInput): Uint8Array {
  return typeof file.content === 'string'
    ? Buffer.from(file.content, 'utf8')
    : new Uint8Array(file.content);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function computeResultFilesSha256(files: ImporterFileInput[]): string {
  const roster = files
    .map((file) => {
      const bytes = fileBytes(file);
      return {
        path: file.path,
        byteLength: bytes.byteLength,
        sha256: sha256(bytes),
      };
    })
    .sort((left, right) => compareStringsByCodePoint(left.path, right.path));
  return computePayloadSha256(roster);
}

function pathIsWithin(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function hasCanonicalContainment(rootPath: string, relativePath: string): boolean {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(resolvedRoot, relativePath);
  return resolvedTarget !== resolvedRoot && pathIsWithin(resolvedRoot, resolvedTarget);
}

function isAllowedResultPath(filePath: string): boolean {
  if (['README.md', 'REVIEW.md', 'DESIGN.md', 'FINDINGS.json'].includes(filePath)) {
    return true;
  }
  return ['source/', 'design/', 'specs/', 'prompt/', '.bridge/'].some((prefix) =>
    filePath.startsWith(prefix),
  );
}

function hasUnsafeControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      return true;
    }
  }
  return false;
}

function addError(
  errors: Array<{ code: ImportValidationErrorCode; path?: string; message: string }>,
  code: ImportValidationErrorCode,
  message: string,
  filePath?: string,
): void {
  errors.push(filePath === undefined ? { code, message } : { code, path: filePath, message });
}

function addSkipped(skipped: Set<string>, validation: string): void {
  skipped.add(validation);
}

function resolveResultKind(
  paths: Set<string>,
  manifestKind: ReviewResultKind | null,
  contextKind: ReviewResultKind | null,
  errors: Array<{ code: ImportValidationErrorCode; path?: string; message: string }>,
): ReviewResultKind | null {
  const hasReview = paths.has('REVIEW.md');
  const hasDesign = paths.has('DESIGN.md');
  if (hasReview && hasDesign) {
    addError(
      errors,
      'result-kind-ambiguous',
      'Both REVIEW.md and DESIGN.md are present, so result kind is ambiguous',
    );
    return null;
  }

  const inferredKind: ReviewResultKind | null = hasReview ? 'audit' : hasDesign ? 'design' : null;
  const declaredKinds = [manifestKind, contextKind].filter(
    (value): value is ReviewResultKind => value !== null,
  );
  if (new Set(declaredKinds).size > 1) {
    addError(errors, 'result-kind-mismatch', 'Manifest and import context disagree on result kind');
    return null;
  }

  const declaredKind = declaredKinds[0] ?? null;
  if (declaredKind !== null && inferredKind !== null && declaredKind !== inferredKind) {
    addError(
      errors,
      'result-kind-mismatch',
      `Declared result kind ${declaredKind} conflicts with the primary result document`,
    );
    return null;
  }
  if (declaredKind === null && inferredKind === null) {
    addError(
      errors,
      'result-kind-ambiguous',
      'Neither a declared result kind nor exactly one primary result document is available',
    );
    return null;
  }
  return declaredKind ?? inferredKind;
}

function compareStringArrays(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const leftSorted = [...left].sort(compareStringsByCodePoint);
  const rightSorted = [...right].sort(compareStringsByCodePoint);
  return leftSorted.every((value, index) => value === rightSorted[index]);
}

function errorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null;
}

async function existingProvenance(
  folderPath: string,
  preferResultPayload: boolean,
): Promise<ExistingProvenance | null> {
  try {
    const value = JSON.parse(
      await readFile(path.join(folderPath, RESERVED_PROVENANCE_PATH), 'utf8'),
    ) as Record<string, unknown>;
    const resultPayloadSha256 = value.resultPayloadSha256;
    const resultFilesSha256 = value.resultFilesSha256;
    const field = preferResultPayload ? resultPayloadSha256 : resultFilesSha256;
    const requestRepository = value.requestRepositoryFullName;
    const currentRepository = value.currentRepositoryFullName;
    return {
      resultIdentity: typeof field === 'string' && /^[0-9a-f]{64}$/.test(field) ? field : null,
      resultPayloadSha256: typeof resultPayloadSha256 === 'string'
        && /^[0-9a-f]{64}$/.test(resultPayloadSha256)
        ? resultPayloadSha256
        : null,
      resultFilesSha256: typeof resultFilesSha256 === 'string' && /^[0-9a-f]{64}$/.test(resultFilesSha256)
        ? resultFilesSha256
        : null,
      repositoryFullName: typeof requestRepository === 'string'
        ? requestRepository
        : typeof currentRepository === 'string'
          ? currentRepository
          : null,
      hasRepositoryIdentityFields:
        Object.prototype.hasOwnProperty.call(value, 'requestRepositoryFullName')
        || Object.prototype.hasOwnProperty.call(value, 'currentRepositoryFullName'),
    };
  } catch {
    return null;
  }
}

function noOpOutcome(
  existing: ExistingProvenance | null,
  resultIdentity: string,
  expectedRepositoryFullName: string | null,
  folder: string,
  installedPath: string,
): ImportOutcome | null {
  if (existing?.resultIdentity !== resultIdentity || existing.resultFilesSha256 === null) {
    return null;
  }
  const outcome = {
    status: 'no-op' as const,
    folder,
    installedPath,
    resultFilesSha256: existing.resultFilesSha256,
    repositoryFullName: existing.repositoryFullName,
  };
  if (expectedRepositoryFullName === null) {
    return { status: 'no-op', folder };
  }
  if (!existing.hasRepositoryIdentityFields) {
    return {
      ...outcome,
      // Legacy provenance still binds the exact result manifest payload; the caller
      // independently binds that manifest to the current request repository.
      repositoryFullName: expectedRepositoryFullName,
      legacyRepositoryIdentity: true,
    };
  }
  if (existing.repositoryFullName !== expectedRepositoryFullName) {
    return {
      status: 'invalid',
      errors: [{
        code: 'repository-mismatch',
        message: `Installed provenance repository ${existing.repositoryFullName ?? 'unbound'} does not match ${expectedRepositoryFullName}`,
      }],
    };
  }
  return outcome;
}

function normalizePromptText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[`*_>#~[\]()]/g, ' ')
    .replace(/[\u2013\u2014:|/\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function validatePromptContract(
  prompt: DecodedFile,
  expectedRepository: string | null,
  expectedHeadSha: string | null,
  errors: Array<{ code: ImportValidationErrorCode; path?: string; message: string }>,
  skipped: Set<string>,
): void {
  if (prompt.content === null || prompt.content.trim().length === 0) {
    return;
  }
  const nonEmptyLines = prompt.content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (nonEmptyLines.length <= 1) {
    addError(
      errors,
      'prompt-contract-violation',
      '구현 프롬프트는 비어 있지 않은 여러 줄의 실행 계약을 포함해야 합니다',
      prompt.path,
    );
  }

  const normalized = normalizePromptText(prompt.content);
  for (const requirement of CLI_PROMPT_CONTRACT_REQUIREMENTS) {
    let bindingMissing = false;
    if (requirement.key === 'repository-identity') {
      if (expectedRepository === null) {
        addSkipped(skipped, 'prompt-repository-binding-skipped');
        continue;
      }
      bindingMissing = !prompt.content.includes(expectedRepository);
    } else if (requirement.key === 'reviewed-sha') {
      if (expectedHeadSha === null) {
        addSkipped(skipped, 'prompt-reviewed-head-binding-skipped');
        continue;
      }
      bindingMissing = !prompt.content.includes(expectedHeadSha);
    }

    for (const group of requirement.groups) {
      const semanticMissing = !group.patterns.some((pattern) => pattern.test(normalized));
      if (bindingMissing || semanticMissing) {
        addError(
          errors,
          'prompt-contract-violation',
          `구현 프롬프트에 필수 요소가 없습니다: ${group.label}`,
          prompt.path,
        );
      }
    }
  }
}

function validateFindingsContract(
  findings: FindingsFile,
  request: ReviewRequest | null,
  resultManifest: ReviewResultManifest | null,
  errors: Array<{ code: ImportValidationErrorCode; path?: string; message: string }>,
  skipped: Set<string>,
  filePath: string,
): void {
  const severities = ['P0', 'P1', 'P2', 'P3'] as const;
  for (const severity of severities) {
    if (findings[severity].some((finding) => finding.severity !== severity)) {
      addError(
        errors,
        'findings-severity-mismatch',
        `${severity} 배열에 다른 severity의 finding이 포함되어 있습니다`,
        filePath,
      );
    }
    if (findings.summary[severity] !== findings[severity].length) {
      addError(
        errors,
        'findings-summary-mismatch',
        `FINDINGS summary ${severity}=${findings.summary[severity]}가 배열 길이 ${findings[severity].length}와 일치하지 않습니다`,
        filePath,
      );
    }
    if (
      resultManifest !== null
      && resultManifest.findingsSummary[severity.toLowerCase() as 'p0' | 'p1' | 'p2' | 'p3']
        !== findings.summary[severity]
    ) {
      addError(
        errors,
        'findings-summary-mismatch',
        `FINDINGS summary ${severity}가 result manifest와 일치하지 않습니다`,
        filePath,
      );
    }
  }

  if (request === null) {
    addSkipped(skipped, 'findings-request-binding-skipped');
  } else if (findings.requestId !== request.requestId) {
    addError(
      errors,
      'findings-binding-mismatch',
      `FINDINGS requestId ${findings.requestId}가 요청 ${request.requestId}와 일치하지 않습니다`,
      filePath,
    );
  }
  if (
    resultManifest !== null
    && (
      findings.repository.fullName !== resultManifest.repositoryFullName
      || findings.snapshot.headSha !== resultManifest.reviewedHeadSha
    )
  ) {
    addError(
      errors,
      'findings-binding-mismatch',
      'FINDINGS repository 또는 reviewed head가 result manifest와 일치하지 않습니다',
      filePath,
    );
  }
}

function parseRevisionNumber(baseFolder: string, candidate: string): number | null {
  if (candidate === baseFolder) {
    return 1;
  }
  const prefix = `${baseFolder}-rev`;
  if (!candidate.startsWith(prefix)) {
    return null;
  }
  const suffix = candidate.slice(prefix.length);
  if (!/^(?:[2-9]|[1-9][0-9])$/.test(suffix)) {
    return null;
  }
  const revision = Number(suffix);
  return revision <= 99 ? revision : null;
}

async function scanRevisionSlots(
  installRoot: string,
  baseFolder: string,
  preferResultPayload: boolean,
): Promise<RevisionSlot[]> {
  let entries: string[];
  try {
    entries = await readdir(installRoot);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const candidates = entries
    .map((folder) => ({ folder, revision: parseRevisionNumber(baseFolder, folder) }))
    .filter((entry): entry is { folder: string; revision: number } => entry.revision !== null)
    .sort((left, right) => left.revision - right.revision);
  return Promise.all(candidates.map(async ({ folder, revision }) => {
    const folderPath = path.join(installRoot, folder);
    return {
      folder,
      folderPath,
      revision,
      provenance: await existingProvenance(folderPath, preferResultPayload),
    };
  }));
}

function findExistingNoOp(
  slots: RevisionSlot[],
  resultIdentity: string,
  expectedRepositoryFullName: string | null,
): ImportOutcome | null {
  let bindingError: ImportOutcome | null = null;
  for (const slot of slots) {
    const outcome = noOpOutcome(
      slot.provenance,
      resultIdentity,
      expectedRepositoryFullName,
      slot.folder,
      slot.folderPath,
    );
    if (outcome?.status === 'no-op') {
      return outcome;
    }
    if (outcome?.status === 'invalid') {
      bindingError ??= outcome;
    }
  }
  return bindingError;
}

async function afterDurableOp(
  context: ImportContext,
  step: string,
  requestId: string,
  targetPath: string,
): Promise<void> {
  await context.onAfterDurableOp?.({
    scope: 'importer',
    step,
    requestId,
    path: targetPath,
  });
}

async function beforeDurableOp(context: ImportContext): Promise<void> {
  await context.assertDurableLease?.();
}

async function syncBestEffort(targetPath: string): Promise<void> {
  try {
    const handle = await open(targetPath, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // fsync support differs across filesystems and Windows directory handles.
  }
}

async function assertFilesystemContainment(stagingRoot: string, targetPath: string): Promise<void> {
  const [resolvedRoot, resolvedParent] = await Promise.all([
    realpath(stagingRoot),
    realpath(path.dirname(targetPath)),
  ]);
  if (!pathIsWithin(resolvedRoot, resolvedParent)) {
    throw new Error(`Import target resolves outside staging root: ${targetPath}`);
  }
}

function nextAction(folder: string): string {
  return [
    `Read: docs/plans/${folder}/README.md`,
    `Start implementation with: docs/plans/${folder}/prompt/CLI_MAIN_SESSION_PROMPT.md`,
  ].join('\n');
}

export async function importReviewResult(
  input: ImporterInput,
  context: ImportContext,
): Promise<ImportOutcome> {
  const normalized = normalizeInput(input);
  const installRoot = path.resolve(context.installRoot ?? path.join(context.repoRoot, 'docs/plans'));
  const provisionalStaging = path.join(installRoot, `.tmp-${normalized.folder}`);
  const errors: Array<{ code: ImportValidationErrorCode; path?: string; message: string }> = [];
  const skipped = new Set<string>();
  for (const validation of context.acknowledgedValidations ?? []) {
    addSkipped(skipped, validation);
  }
  if (context.repositoryIdentityOverride) {
    addSkipped(skipped, 'repository-identity-overridden');
  }
  if (context.unboundAcceptance) {
    addSkipped(skipped, 'unbound-import-accepted');
  }
  const limits = {
    maxFiles: normalizeLimit(context.limits?.maxFiles, DEFAULT_LIMITS.maxFiles),
    maxTotalBytes: normalizeLimit(context.limits?.maxTotalBytes, DEFAULT_LIMITS.maxTotalBytes),
    maxFileBytes: normalizeLimit(context.limits?.maxFileBytes, DEFAULT_LIMITS.maxFileBytes),
  };

  if (!FOLDER_NAME_PATTERN.test(normalized.folder)) {
    addError(errors, 'invalid-folder', `Invalid result folder: ${normalized.folder}`);
  }
  if (normalized.files.length > limits.maxFiles) {
    addError(
      errors,
      'too-many-files',
      `Result contains ${normalized.files.length} files; limit is ${limits.maxFiles}`,
    );
  }

  const seenPaths = new Set<string>();
  const decodedFiles: DecodedFile[] = [];
  let totalBytes = 0;
  for (const file of normalized.files) {
    const safePath = isSafeRelativePath(file.path);
    if (!safePath || !hasCanonicalContainment(provisionalStaging, file.path)) {
      addError(errors, 'unsafe-path', `Unsafe result path: ${file.path}`, file.path);
    }
    if (seenPaths.has(file.path)) {
      addError(errors, 'duplicate-path', `Duplicate result path: ${file.path}`, file.path);
    }
    seenPaths.add(file.path);
    if (!isAllowedResultPath(file.path)) {
      addError(errors, 'path-not-allowed', `Result path is outside the allowlist: ${file.path}`, file.path);
    }
    if (file.path === RESERVED_PROVENANCE_PATH) {
      addError(
        errors,
        'reserved-path',
        `${RESERVED_PROVENANCE_PATH} is reserved for the importer`,
        file.path,
      );
    }

    const bytes = fileBytes(file);
    totalBytes += bytes.byteLength;
    if (bytes.byteLength > limits.maxFileBytes) {
      addError(
        errors,
        'file-too-large',
        `File is ${bytes.byteLength} bytes; limit is ${limits.maxFileBytes}`,
        file.path,
      );
    }

    let content: string | null = null;
    try {
      content = typeof file.content === 'string'
        ? file.content
        : UTF8_DECODER.decode(bytes);
    } catch {
      addError(errors, 'invalid-utf8', 'File is not valid UTF-8', file.path);
    }
    if (bytes.includes(0)) {
      addError(errors, 'binary-content', 'NUL bytes are not allowed in result files', file.path);
    } else if (content !== null && hasUnsafeControlCharacters(content)) {
      addError(
        errors,
        'unsafe-control-characters',
        'File contains a disallowed C0 control character',
        file.path,
      );
    }
    decodedFiles.push({ path: file.path, bytes, content });
  }
  if (totalBytes > limits.maxTotalBytes) {
    addError(
      errors,
      'total-too-large',
      `Result contains ${totalBytes} bytes; limit is ${limits.maxTotalBytes}`,
    );
  }

  const resultManifest = context.resultManifest ?? null;
  const request = context.request ?? null;
  const resultKind = resolveResultKind(
    seenPaths,
    resultManifest?.resultKind ?? null,
    context.resultKind ?? null,
    errors,
  );
  if (resultKind !== null) {
    const required = checkRequiredFiles([...seenPaths], resultKind);
    for (const missing of required.missing) {
      addError(errors, 'missing-required-file', `Missing required result file: ${missing}`, missing);
    }
  }

  const byPath = new Map(decodedFiles.map((file) => [file.path, file]));
  const promptFile = byPath.get('prompt/CLI_MAIN_SESSION_PROMPT.md');
  if (promptFile !== undefined && (promptFile.content === null || promptFile.content.trim().length === 0)) {
    addError(
      errors,
      'empty-prompt',
      'prompt/CLI_MAIN_SESSION_PROMPT.md must not be empty',
      promptFile.path,
    );
  } else if (promptFile !== undefined) {
    validatePromptContract(
      promptFile,
      resultManifest?.repositoryFullName ?? request?.repository.fullName ?? null,
      resultManifest?.reviewedHeadSha ?? request?.git.headSha ?? null,
      errors,
      skipped,
    );
  }
  const findingsFile = byPath.get('FINDINGS.json');
  if (findingsFile?.content !== null && findingsFile !== undefined) {
    try {
      const parsedJson = JSON.parse(findingsFile.content) as unknown;
      const parsedFindings = FindingsFileSchema.safeParse(parsedJson);
      if (!parsedFindings.success) {
        addError(
          errors,
          'findings-schema-violation',
          `FINDINGS.json이 vibe-goal-audit-findings-v1 계약을 위반했습니다: ${parsedFindings.error.issues.map((issue) => issue.path.join('.') || '<root>').join(', ')}`,
          findingsFile.path,
        );
      } else {
        validateFindingsContract(
          parsedFindings.data,
          request,
          resultManifest,
          errors,
          skipped,
          findingsFile.path,
        );
      }
    } catch {
      addError(errors, 'findings-parse-error', 'FINDINGS.json is not valid JSON', findingsFile.path);
    }
  }

  if (request === null) {
    addSkipped(skipped, 'request-metadata-unavailable');
    if (normalized.requestId !== 'web-origin' && !context.unboundAcceptance) {
      addError(
        errors,
        'request-id-mismatch',
        'A non-web-origin result requires the matching ReviewRequest metadata',
      );
    }
  } else if (normalized.requestId !== request.requestId) {
    addError(
      errors,
      'request-id-mismatch',
      `Result requestId ${normalized.requestId} does not match request ${request.requestId}`,
    );
  }

  if (resultManifest === null) {
    for (const validation of [
      'result-manifest-unavailable',
      'request-hash-binding-skipped',
      'result-hash-binding-skipped',
      'repository-binding-skipped',
      'reviewed-head-binding-skipped',
      'file-roster-binding-skipped',
      'file-sha-binding-skipped',
      'reviewer-declaration-unavailable',
    ]) {
      addSkipped(skipped, validation);
    }
  } else {
    if (resultManifest.proposedFolder !== normalized.folder) {
      addError(
        errors,
        'invalid-folder',
        `Result manifest proposes ${resultManifest.proposedFolder}, not ${normalized.folder}`,
      );
    }
    if (resultManifest.requestId !== normalized.requestId) {
      addError(
        errors,
        'request-id-mismatch',
        `Result manifest requestId ${resultManifest.requestId} does not match the imported result`,
      );
    }
    if (request === null) {
      addSkipped(skipped, 'request-hash-binding-skipped');
      addSkipped(skipped, 'reviewed-head-binding-skipped');
    } else {
      if (resultManifest.requestPayloadSha256 !== request.payloadSha256) {
        addError(errors, 'request-hash-mismatch', 'Result manifest is bound to a different request hash');
      }
      if (resultManifest.reviewedHeadSha !== request.git.headSha) {
        addError(errors, 'reviewed-head-mismatch', 'Reviewed head SHA does not match the request');
      }
    }
    if (computePayloadSha256(resultManifest) !== resultManifest.payloadSha256) {
      addError(errors, 'result-hash-mismatch', 'Result manifest payload hash is invalid');
    }

    const expectedRepository = context.expectedRepositoryFullName ?? null;
    if (expectedRepository === null) {
      addSkipped(skipped, 'repository-binding-skipped');
    } else if (resultManifest.repositoryFullName !== expectedRepository) {
      addError(
        errors,
        'repository-mismatch',
        `Result repository ${resultManifest.repositoryFullName} does not match ${expectedRepository}`,
      );
    }

    const manifestPaths = resultManifest.files.map((file) => file.path);
    if (
      new Set(manifestPaths).size !== manifestPaths.length ||
      !compareStringArrays(manifestPaths, normalized.files.map((file) => file.path))
    ) {
      addError(errors, 'file-roster-mismatch', 'Result manifest file roster does not match payload files');
    }
    for (const manifestFile of resultManifest.files) {
      const actual = byPath.get(manifestFile.path);
      if (
        actual === undefined ||
        actual.bytes.byteLength !== manifestFile.byteLength ||
        sha256(actual.bytes) !== manifestFile.sha256
      ) {
        addError(
          errors,
          'file-sha-mismatch',
          `Result file hash or byte length does not match manifest: ${manifestFile.path}`,
          manifestFile.path,
        );
      }
    }
  }

  const resultFilesSha256 = computeResultFilesSha256(normalized.files);
  const resultIdentity = resultManifest?.payloadSha256 ?? resultFilesSha256;
  const preferResultPayload = resultManifest !== null;
  const structuralErrors = errors.filter((error) => !CONTRACT_ERROR_CODES.has(error.code));
  if (structuralErrors.length > 0) {
    return { status: 'invalid', errors };
  }

  const revisionSlots = await scanRevisionSlots(
    installRoot,
    normalized.folder,
    preferResultPayload,
  );
  const existingNoOp = findExistingNoOp(
    revisionSlots,
    resultIdentity,
    context.expectedRepositoryFullName ?? null,
  );
  if (existingNoOp !== null) {
    return existingNoOp;
  }
  if (errors.length > 0) {
    return { status: 'invalid', errors };
  }

  let targetFolder = normalized.folder;
  let targetRevision = 1;
  let revisionOf: string | null = null;
  let predecessorResultSha256: string | null = null;
  let finalPath = path.join(installRoot, targetFolder);
  const occupiedRevisions = new Set(revisionSlots.map((slot) => slot.revision));
  if (occupiedRevisions.has(1)) {
    if (context.approveRevision !== true) {
      return {
        status: 'refused',
        code: 'existing-folder-conflict',
        message: `Result folder already exists with different provenance: ${targetFolder}`,
      };
    }

    let selectedRevision: number | null = null;
    for (let revision = 2; revision <= 99; revision += 1) {
      const candidate = `${normalized.folder}-rev${revision}`;
      if (!FOLDER_NAME_PATTERN.test(candidate)) {
        return {
          status: 'invalid',
          errors: [
            {
              code: 'invalid-folder',
              message: `Revision folder exceeds the folder contract: ${candidate}`,
            },
          ],
        };
      }
      if (!occupiedRevisions.has(revision)) {
        selectedRevision = revision;
        targetFolder = candidate;
        break;
      }
    }
    if (selectedRevision === null) {
      return {
        status: 'refused',
        code: 'revision-slot-occupied',
        message: `All revision folders are occupied for ${normalized.folder}`,
      };
    }
    targetRevision = selectedRevision;
    const predecessor = revisionSlots.at(-1) ?? null;
    revisionOf = predecessor?.folder ?? null;
    predecessorResultSha256 = predecessor?.provenance?.resultPayloadSha256
      ?? predecessor?.provenance?.resultFilesSha256
      ?? null;
    finalPath = path.join(installRoot, targetFolder);
  }

  await mkdir(installRoot, { recursive: true });
  const stagingPath = path.join(installRoot, `.tmp-${targetFolder}`);
  await beforeDurableOp(context);
  await rm(stagingPath, { recursive: true, force: true });
  await afterDurableOp(context, 'stale-staging-removed', normalized.requestId, stagingPath);
  let renamed = false;
  try {
    await mkdir(stagingPath);
    const writtenPaths: string[] = [];
    for (const file of [...decodedFiles].sort((left, right) =>
      compareStringsByCodePoint(left.path, right.path),
    )) {
      const targetPath = path.resolve(stagingPath, file.path);
      if (!hasCanonicalContainment(stagingPath, file.path)) {
        throw new Error(`Import target escapes staging root: ${file.path}`);
      }
      await mkdir(path.dirname(targetPath), { recursive: true });
      await assertFilesystemContainment(stagingPath, targetPath);
      await beforeDurableOp(context);
      await writeFile(targetPath, file.bytes, { flag: 'wx' });
      await afterDurableOp(context, 'result-file-written', normalized.requestId, targetPath);
      writtenPaths.push(targetPath);
    }

    const receipt: ProvenanceReceipt = {
      schemaVersion: 'vibe-pro-bridge-provenance-v1',
      requestId: normalized.requestId,
      requestPayloadSha256: request?.payloadSha256 ?? null,
      resultPayloadSha256: resultManifest?.payloadSha256 ?? null,
      resultFilesSha256,
      reviewedBaseSha: resultManifest?.reviewedBaseSha ?? request?.git.baseSha ?? null,
      reviewedHeadSha: resultManifest?.reviewedHeadSha ?? request?.git.headSha ?? null,
      importedAt: (context.now ?? (() => new Date()))().toISOString(),
      transport: context.transport ?? 'manual',
      reviewerDeclaration: resultManifest?.reviewerDeclaration ?? null,
      skippedValidations: [...skipped].sort(compareStringsByCodePoint),
      folder: targetFolder,
      currentRepositoryFullName: context.currentRepositoryFullName ?? null,
      requestRepositoryFullName: context.requestRepositoryFullName ?? null,
      repositoryIdentityOverride: context.repositoryIdentityOverride ?? null,
      unboundAcceptance: context.unboundAcceptance ?? null,
      revision: targetRevision,
      revisionOf,
      predecessorResultSha256,
    };
    const provenancePath = path.join(stagingPath, RESERVED_PROVENANCE_PATH);
    await mkdir(path.dirname(provenancePath), { recursive: true });
    await assertFilesystemContainment(stagingPath, provenancePath);
    await beforeDurableOp(context);
    await writeFile(provenancePath, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    await afterDurableOp(context, 'provenance-written', normalized.requestId, provenancePath);
    writtenPaths.push(provenancePath);

    await Promise.all(writtenPaths.map(syncBestEffort));
    await syncBestEffort(stagingPath);
    try {
      await beforeDurableOp(context);
      await rename(stagingPath, finalPath);
      renamed = true;
      await afterDurableOp(context, 'installation-renamed', normalized.requestId, finalPath);
    } catch (error) {
      if (['EEXIST', 'ENOTEMPTY'].includes(errorCode(error) ?? '')) {
        return {
          status: 'refused',
          code: targetFolder === normalized.folder
            ? 'existing-folder-conflict'
            : 'revision-slot-occupied',
          message: `Result folder appeared during atomic installation: ${targetFolder}`,
        };
      }
      throw error;
    }

    return {
      status: 'installed',
      folder: targetFolder,
      installedPath: finalPath,
      resultFilesSha256,
      nextAction: nextAction(targetFolder),
      skippedValidations: [...skipped].sort(compareStringsByCodePoint),
    };
  } finally {
    if (!renamed) {
      await rm(stagingPath, { recursive: true, force: true });
    }
  }
}
