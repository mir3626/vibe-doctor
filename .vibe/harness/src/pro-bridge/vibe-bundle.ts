import {
  FOLDER_NAME_PATTERN,
  REQUIRED_RESULT_FILES,
  isSafeRelativePath,
  type ReviewResultKind,
} from './contract.js';

export interface VibeBundleFile {
  path: string;
  content: string;
}

export interface VibeBundle {
  requestId: string;
  folder: string;
  files: VibeBundleFile[];
}

export type VibeBundleParseErrorCode =
  | 'missing-header'
  | 'duplicate-header'
  | 'missing-header-field'
  | 'invalid-folder'
  | 'invalid-files-count'
  | 'file-count-mismatch'
  | 'missing-end-sentinel'
  | 'unsafe-file-path'
  | 'duplicate-file-path'
  | 'empty-bundle';

export interface VibeBundleError {
  code: VibeBundleParseErrorCode;
  message: string;
  line?: number;
}

export type VibeBundleParseResult =
  | { ok: true; bundle: VibeBundle }
  | { ok: false; error: VibeBundleError };

export type VibeBundleSerializeErrorCode =
  | 'missing-header-field'
  | 'invalid-folder'
  | 'unsafe-file-path'
  | 'duplicate-file-path'
  | 'separator-collision';

export class VibeBundleSerializeError extends Error {
  constructor(
    readonly code: VibeBundleSerializeErrorCode,
    message: string,
    readonly path: string | null = null,
    readonly line: number | null = null,
  ) {
    super(message);
    this.name = 'VibeBundleSerializeError';
  }
}

const HEADER = 'VIBE-BUNDLE v1';
const END = '==== VIBE:END ====';
const FILE_SEPARATOR = /^==== VIBE:FILE (.+) ====$/;

function failure(code: VibeBundleParseErrorCode, message: string, line?: number): VibeBundleParseResult {
  return line === undefined ? { ok: false, error: { code, message } } : { ok: false, error: { code, message, line } };
}

export function parseVibeBundle(input: string): VibeBundleParseResult {
  if (input.trim().length === 0) {
    return failure('empty-bundle', 'Bundle text is empty');
  }

  const lines = input.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  const headerLines = lines.flatMap((line, index) => (line === HEADER ? [index] : []));
  if (headerLines.length === 0) {
    return failure('missing-header', 'VIBE-BUNDLE v1 header was not found');
  }
  if (headerLines.length > 1) {
    return failure('duplicate-header', 'More than one VIBE-BUNDLE v1 header was found', headerLines[1]! + 1);
  }

  const headerIndex = headerLines[0]!;
  const endIndex = lines.indexOf(END, headerIndex + 1);
  if (endIndex < 0) {
    return failure('missing-end-sentinel', 'VIBE:END sentinel was not found');
  }

  const firstSeparatorIndex = lines.findIndex((line, index) => index > headerIndex && FILE_SEPARATOR.test(line));
  const fieldsEnd = firstSeparatorIndex >= 0 && firstSeparatorIndex < endIndex ? firstSeparatorIndex : endIndex;
  const fields = new Map<string, string[]>();
  for (let index = headerIndex + 1; index < fieldsEnd; index += 1) {
    for (const name of ['requestId', 'folder', 'files'] as const) {
      const prefix = `${name}:`;
      if (lines[index]!.startsWith(prefix)) {
        const values = fields.get(name) ?? [];
        values.push(lines[index]!.slice(prefix.length).trim());
        fields.set(name, values);
      }
    }
  }

  for (const name of ['requestId', 'folder', 'files'] as const) {
    const values = fields.get(name);
    if (values?.length !== 1 || values[0]!.length === 0) {
      return failure('missing-header-field', `Header field ${name}: must occur exactly once`);
    }
  }

  const requestId = fields.get('requestId')![0]!;
  const folder = fields.get('folder')![0]!;
  if (!FOLDER_NAME_PATTERN.test(folder)) {
    return failure('invalid-folder', `Invalid bundle folder: ${folder}`);
  }

  const declaredFilesText = fields.get('files')![0]!;
  if (!/^(?:0|[1-9]\d*)$/.test(declaredFilesText)) {
    return failure('invalid-files-count', `Invalid files count: ${declaredFilesText}`);
  }
  const declaredFiles = Number(declaredFilesText);

  const files: VibeBundleFile[] = [];
  const seenPaths = new Set<string>();
  let current: { path: string; contentLines: string[] } | null = null;
  for (let index = fieldsEnd; index < endIndex; index += 1) {
    const line = lines[index]!;
    const separator = FILE_SEPARATOR.exec(line);
    if (separator) {
      if (current) {
        files.push({ path: current.path, content: current.contentLines.join('\n') });
      }
      const filePath = separator[1]!;
      if (!isSafeRelativePath(filePath)) {
        return failure('unsafe-file-path', `Unsafe bundle file path: ${filePath}`, index + 1);
      }
      if (seenPaths.has(filePath)) {
        return failure('duplicate-file-path', `Duplicate bundle file path: ${filePath}`, index + 1);
      }
      seenPaths.add(filePath);
      current = { path: filePath, contentLines: [] };
      continue;
    }

    if (current) {
      current.contentLines.push(line);
    }
  }
  if (current) {
    files.push({ path: current.path, content: current.contentLines.join('\n') });
  }

  if (files.length !== declaredFiles) {
    return failure(
      'file-count-mismatch',
      `Declared ${declaredFiles} files but parsed ${files.length}`,
    );
  }

  return { ok: true, bundle: { requestId, folder, files } };
}

export function serializeVibeBundle(bundle: VibeBundle): string {
  if (bundle.requestId.length === 0) {
    throw new VibeBundleSerializeError('missing-header-field', 'requestId must not be empty');
  }
  if (!FOLDER_NAME_PATTERN.test(bundle.folder)) {
    throw new VibeBundleSerializeError('invalid-folder', `Invalid bundle folder: ${bundle.folder}`);
  }

  const seenPaths = new Set<string>();
  for (const file of bundle.files) {
    if (!isSafeRelativePath(file.path)) {
      throw new VibeBundleSerializeError(
        'unsafe-file-path',
        `Unsafe bundle file path: ${file.path}`,
        file.path,
      );
    }
    if (seenPaths.has(file.path)) {
      throw new VibeBundleSerializeError(
        'duplicate-file-path',
        `Duplicate bundle file path: ${file.path}`,
        file.path,
      );
    }
    seenPaths.add(file.path);
    const contentLines = file.content.split('\n');
    const collisionIndex = contentLines.findIndex(
      (line) => line === HEADER || line === END || FILE_SEPARATOR.test(line),
    );
    if (collisionIndex >= 0) {
      throw new VibeBundleSerializeError(
        'separator-collision',
        `File content collides with a VIBE-BUNDLE control line: ${file.path}`,
        file.path,
        collisionIndex + 1,
      );
    }
  }

  const lines = [
    HEADER,
    `requestId: ${bundle.requestId}`,
    `folder: ${bundle.folder}`,
    `files: ${bundle.files.length}`,
  ];
  for (const file of bundle.files) {
    lines.push(`==== VIBE:FILE ${file.path} ====`, ...file.content.split('\n'));
  }
  lines.push(END);
  return `${lines.join('\n')}\n`;
}

export function checkRequiredFiles(
  paths: string[],
  resultKind: ReviewResultKind,
): { ok: boolean; missing: string[] } {
  const available = new Set(paths);
  const missing = REQUIRED_RESULT_FILES[resultKind].filter((filePath) => !available.has(filePath));
  return { ok: missing.length === 0, missing };
}
