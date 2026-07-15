import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  FOLDER_NAME_PATTERN,
  compareStringsByCodePoint,
  computePayloadSha256,
  isSafeRelativePath,
  type ReviewRequest,
  type ReviewResultKind,
  type ReviewResultManifest,
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
  approveRevision?: boolean;
  transport?: string;
  now?: () => Date;
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
      nextAction: string;
      skippedValidations: string[];
    }
  | { status: 'no-op'; folder: string }
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
}

const DEFAULT_LIMITS = {
  maxFiles: 64,
  maxTotalBytes: 4 * 1024 * 1024,
  maxFileBytes: 1024 * 1024,
} as const;

const RESERVED_PROVENANCE_PATH = '.bridge/provenance.json';
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

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

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function existingIdentity(
  folderPath: string,
  preferResultPayload: boolean,
): Promise<string | null> {
  try {
    const value = JSON.parse(
      await readFile(path.join(folderPath, RESERVED_PROVENANCE_PATH), 'utf8'),
    ) as Record<string, unknown>;
    const field = preferResultPayload ? value.resultPayloadSha256 : value.resultFilesSha256;
    return typeof field === 'string' && /^[0-9a-f]{64}$/.test(field) ? field : null;
  } catch {
    return null;
  }
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
  }
  const findingsFile = byPath.get('FINDINGS.json');
  if (findingsFile?.content !== null && findingsFile !== undefined) {
    try {
      JSON.parse(findingsFile.content);
    } catch {
      addError(errors, 'findings-parse-error', 'FINDINGS.json is not valid JSON', findingsFile.path);
    }
  }

  if (request === null) {
    addSkipped(skipped, 'request-metadata-unavailable');
    if (normalized.requestId !== 'web-origin') {
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

  if (errors.length > 0) {
    return { status: 'invalid', errors };
  }

  const resultFilesSha256 = computeResultFilesSha256(normalized.files);
  const resultIdentity = resultManifest?.payloadSha256 ?? resultFilesSha256;
  const preferResultPayload = resultManifest !== null;
  await mkdir(installRoot, { recursive: true });

  let targetFolder = normalized.folder;
  let finalPath = path.join(installRoot, targetFolder);
  if (await pathExists(finalPath)) {
    if ((await existingIdentity(finalPath, preferResultPayload)) === resultIdentity) {
      return { status: 'no-op', folder: targetFolder };
    }
    if (context.approveRevision !== true) {
      return {
        status: 'refused',
        code: 'existing-folder-conflict',
        message: `Result folder already exists with different provenance: ${targetFolder}`,
      };
    }

    targetFolder = `${normalized.folder}-rev2`;
    if (!FOLDER_NAME_PATTERN.test(targetFolder)) {
      return {
        status: 'invalid',
        errors: [
          {
            code: 'invalid-folder',
            message: `Revision folder exceeds the folder contract: ${targetFolder}`,
          },
        ],
      };
    }
    finalPath = path.join(installRoot, targetFolder);
    if (await pathExists(finalPath)) {
      if ((await existingIdentity(finalPath, preferResultPayload)) === resultIdentity) {
        return { status: 'no-op', folder: targetFolder };
      }
      return {
        status: 'refused',
        code: 'revision-slot-occupied',
        message: `Revision folder already exists with different provenance: ${targetFolder}`,
      };
    }
  }

  const stagingPath = path.join(installRoot, `.tmp-${targetFolder}`);
  await rm(stagingPath, { recursive: true, force: true });
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
      await writeFile(targetPath, file.bytes, { flag: 'wx' });
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
    };
    const provenancePath = path.join(stagingPath, RESERVED_PROVENANCE_PATH);
    await mkdir(path.dirname(provenancePath), { recursive: true });
    await assertFilesystemContainment(stagingPath, provenancePath);
    await writeFile(provenancePath, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    writtenPaths.push(provenancePath);

    await Promise.all(writtenPaths.map(syncBestEffort));
    await syncBestEffort(stagingPath);
    try {
      await rename(stagingPath, finalPath);
      renamed = true;
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
      nextAction: nextAction(targetFolder),
      skippedValidations: [...skipped].sort(compareStringsByCodePoint),
    };
  } finally {
    if (!renamed) {
      await rm(stagingPath, { recursive: true, force: true });
    }
  }
}
