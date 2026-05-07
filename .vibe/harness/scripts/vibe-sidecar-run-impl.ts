#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, getStringFlag } from '../src/lib/args.js';
import {
  SidecarArtifactSchema,
  SidecarInputPacketSchema,
  SidecarNameSchema,
  SidecarReviewerOutputSchema,
  type SidecarArtifact,
  type SidecarEffort,
  type SidecarInputPacket,
  type SidecarName,
  type SidecarProvider,
  type SidecarReviewerOutput,
} from '../src/lib/schemas/index.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_INPUT_BYTES = 64 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_EXPIRY_DAYS = 14;
const CODEX_LATEST_MODEL = 'gpt-5.5';
const CLAUDE_LATEST_MODEL = 'opus';

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
}

interface CliOptions {
  cwd: string;
  sidecar: SidecarName;
  sprintId: string;
  provider: SidecarProvider;
  model: string;
  effort: SidecarEffort;
  artifactRoot: string;
  timeoutMs: number;
  maxInputBytes: number;
  maxOutputBytes: number;
  promptFile?: string;
  inputFile?: string;
  mockOutputFile?: string;
  mockExitCode?: number;
  mockDelayMs?: number;
}

function fail(message: string): never {
  process.stderr.write(`[vibe-sidecar] ${message}\n`);
  process.exit(1);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    fail(`expected positive integer, got ${value}`);
  }
  return parsed;
}

function parseNonNegativeInt(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    fail(`expected non-negative integer for ${label}, got ${value}`);
  }
  return parsed;
}

function sanitizeIdentifier(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    fail(`${label} must contain only letters, numbers, dot, underscore, or hyphen: ${value}`);
  }
  return value;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function truncateUtf8(value: string, maxBytes: number): { value: string; truncated: boolean } {
  if (byteLength(value) <= maxBytes) {
    return { value, truncated: false };
  }

  let end = value.length;
  while (end > 0 && byteLength(value.slice(0, end)) > maxBytes) {
    end -= 1;
  }
  return { value: value.slice(0, end), truncated: true };
}

function preview(value: string, maxBytes = 4000): string {
  return truncateUtf8(value, maxBytes).value;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function hashPacket(packet: Omit<SidecarInputPacket, 'inputHash'>): string {
  return sha256(stableStringify(packet));
}

function readOptionalText(filePath: string | undefined): string {
  if (!filePath) {
    return '';
  }
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function currentGitSha(cwd: string): string {
  return git(cwd, ['rev-parse', 'HEAD']) || 'unknown';
}

function currentDiff(cwd: string): string {
  const unstaged = git(cwd, ['diff', '--no-ext-diff', '--']);
  const staged = git(cwd, ['diff', '--cached', '--no-ext-diff', '--']);
  const combined = [staged, unstaged].filter(Boolean).join('\n');
  if (combined.trim()) {
    return combined;
  }
  return git(cwd, ['diff', '--no-ext-diff', 'HEAD~1', 'HEAD']);
}

function changedFiles(cwd: string): string[] {
  const names = [
    git(cwd, ['diff', '--name-only', '--cached', '--']),
    git(cwd, ['diff', '--name-only', '--']),
    git(cwd, ['diff', '--name-only', 'HEAD~1', 'HEAD']),
  ]
    .join('\n')
    .split(/\r?\n/)
    .map((line) => line.trim());
  return unique(names).filter((entry) => !entry.startsWith('.vibe/sidecars/'));
}

function extractChecklist(prompt: string): string[] {
  return prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+\[[ xX]\]/.test(line) || /^[-*]\s+AC\b/i.test(line))
    .slice(0, 50)
    .map((line) => line.slice(0, 500));
}

function buildInputPacket(options: CliOptions): SidecarInputPacket {
  if (options.inputFile) {
    const raw = readFileSync(options.inputFile, 'utf8');
    const parsed = SidecarInputPacketSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      fail(`input packet schema mismatch: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  const rawPrompt = readOptionalText(options.promptFile);
  const promptBudget = Math.min(12_000, Math.floor(options.maxInputBytes / 4));
  const promptSummary = truncateUtf8(rawPrompt, promptBudget);
  const rawDiff = currentDiff(options.cwd);
  const diffBudget = Math.max(0, options.maxInputBytes - byteLength(promptSummary.value) - 4000);
  const diff = truncateUtf8(rawDiff, diffBudget);
  const files = changedFiles(options.cwd);
  const packetWithoutHash = {
    schemaVersion: 1 as const,
    sidecar: options.sidecar,
    sprintId: options.sprintId,
    gitSha: currentGitSha(options.cwd),
    ...(promptSummary.value ? { promptSummary: promptSummary.value } : {}),
    diff: diff.value,
    changedFiles: files,
    checklist: extractChecklist(promptSummary.value),
    relevantLogs: [],
    evidenceRefs: [],
    coverage: {
      inputFilesSeen: files.length,
      diffBytesSeen: byteLength(diff.value),
      truncated: promptSummary.truncated || diff.truncated,
    },
  };

  return {
    ...packetWithoutHash,
    inputHash: hashPacket(packetWithoutHash),
  };
}

function parseProvider(value: string | undefined, cwd: string): SidecarProvider {
  if (value === 'claude' || value === 'codex' || value === 'mock') {
    return value;
  }
  if (value && value !== 'auto') {
    fail(`unknown provider: ${value}`);
  }

  const configPath = path.join(cwd, '.vibe', 'config.json');
  if (existsSync(configPath)) {
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as { orchestrator?: unknown };
    const orchestrator = typeof raw.orchestrator === 'string' ? raw.orchestrator : '';
    if (orchestrator.toLowerCase().startsWith('codex')) {
      return 'codex';
    }
    if (orchestrator.toLowerCase().startsWith('claude')) {
      return 'claude';
    }
  }

  return 'claude';
}

function defaultModel(provider: SidecarProvider): string {
  if (provider === 'codex') {
    return CODEX_LATEST_MODEL;
  }
  if (provider === 'claude') {
    return CLAUDE_LATEST_MODEL;
  }
  return 'mock';
}

function parseEffort(value: string | undefined, importance: string | undefined): SidecarEffort {
  if (value === 'high' || value === 'xhigh') {
    return value;
  }
  if (value !== undefined) {
    fail(`unknown effort: ${value}`);
  }
  return importance === 'critical' || importance === 'very-important' ? 'xhigh' : 'high';
}

function parseOptions(): CliOptions {
  const args = parseArgs(process.argv.slice(2));
  const sidecarRaw = args.positionals[0] ?? getStringFlag(args, 'sidecar', 'diff-reviewer');
  const sidecarParsed = SidecarNameSchema.safeParse(sidecarRaw);
  if (!sidecarParsed.success) {
    fail(`unsupported sidecar: ${sidecarRaw}`);
  }

  const cwd = path.resolve(getStringFlag(args, 'cwd', process.cwd()) ?? process.cwd());
  const sprintIdRaw = getStringFlag(args, 'sprint-id');
  if (!sprintIdRaw) {
    fail('missing --sprint-id');
  }
  const sprintId = sanitizeIdentifier(sprintIdRaw, 'sprint-id');

  const provider = getStringFlag(args, 'mock-output-file')
    ? 'mock'
    : parseProvider(getStringFlag(args, 'provider', 'auto'), cwd);
  const effort = parseEffort(getStringFlag(args, 'effort'), getStringFlag(args, 'importance'));

  const options: CliOptions = {
    cwd,
    sidecar: sidecarParsed.data,
    sprintId,
    provider,
    model: getStringFlag(args, 'model', defaultModel(provider)) ?? defaultModel(provider),
    effort,
    artifactRoot: path.resolve(
      cwd,
      getStringFlag(args, 'artifact-root', '.vibe/sidecars/artifacts') ?? '.vibe/sidecars/artifacts',
    ),
    timeoutMs: parsePositiveInt(getStringFlag(args, 'timeout-ms'), DEFAULT_TIMEOUT_MS),
    maxInputBytes: parsePositiveInt(getStringFlag(args, 'max-input-bytes'), DEFAULT_MAX_INPUT_BYTES),
    maxOutputBytes: parsePositiveInt(getStringFlag(args, 'max-output-bytes'), DEFAULT_MAX_OUTPUT_BYTES),
  };
  const promptFile = getStringFlag(args, 'prompt-file');
  if (promptFile) {
    options.promptFile = promptFile;
  }
  const inputFile = getStringFlag(args, 'input-file');
  if (inputFile) {
    options.inputFile = inputFile;
  }
  const mockOutputFile = getStringFlag(args, 'mock-output-file');
  if (mockOutputFile) {
    options.mockOutputFile = mockOutputFile;
  }
  const mockExitCode = getStringFlag(args, 'mock-exit-code');
  if (mockExitCode) {
    options.mockExitCode = parseNonNegativeInt(mockExitCode, 'mock-exit-code');
  }
  const mockDelayMs = getStringFlag(args, 'mock-delay-ms');
  if (mockDelayMs) {
    options.mockDelayMs = parseNonNegativeInt(mockDelayMs, 'mock-delay-ms');
  }
  return options;
}

function readPromptTemplate(cwd: string, sidecar: SidecarName): string {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(cwd, '.vibe', 'harness', 'sidecars', `${sidecar}.md`),
    path.join(scriptDir, '..', 'sidecars', `${sidecar}.md`),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    fail(`missing sidecar prompt template for ${sidecar}`);
  }
  return readFileSync(found, 'utf8');
}

function buildReviewerPrompt(packet: SidecarInputPacket, cwd: string): string {
  return [
    readPromptTemplate(cwd, packet.sidecar),
    '',
    '## Sealed Input Packet',
    '',
    'Review only this JSON packet. Do not read or write repository files.',
    '',
    '```json',
    JSON.stringify(packet, null, 2),
    '```',
    '',
    'Return exactly one JSON object matching the requested output shape.',
  ].join('\n');
}

function runMock(options: CliOptions): CommandResult {
  const started = Date.now();
  const delay = options.mockDelayMs ?? 0;
  if (delay > options.timeoutMs) {
    return {
      stdout: '',
      stderr: 'mock timeout',
      exitCode: null,
      timedOut: true,
      durationMs: options.timeoutMs,
    };
  }
  const stdout = options.mockOutputFile ? readFileSync(options.mockOutputFile, 'utf8') : '';
  return {
    stdout,
    stderr: '',
    exitCode: options.mockExitCode ?? 0,
    timedOut: false,
    durationMs: Date.now() - started,
  };
}

function runClaude(prompt: string, options: CliOptions): CommandResult {
  const started = Date.now();
  const result = spawnSync(
    'claude',
    [
      '-p',
      '--model',
      options.model,
      '--effort',
      options.effort,
      '--permission-mode',
      'dontAsk',
      '--tools',
      '',
      '--no-session-persistence',
      '--output-format',
      'text',
      prompt,
    ],
    {
      cwd: options.cwd,
      encoding: 'utf8',
      timeout: options.timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? (result.error ? result.error.message : ''),
    exitCode: typeof result.status === 'number' ? result.status : null,
    timedOut: result.error ? result.error.message.includes('ETIMEDOUT') : false,
    durationMs: Date.now() - started,
  };
}

function runCodex(prompt: string, options: CliOptions): CommandResult {
  const started = Date.now();
  const tempDir = path.join(os.tmpdir(), `vibe-sidecar-${process.pid}-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  const lastMessagePath = path.join(tempDir, 'last-message.txt');
  try {
    const result = spawnSync(
      'codex',
      [
        'exec',
        '-C',
        options.cwd,
        '-s',
        'read-only',
        '--ephemeral',
        '--color',
        'never',
        '-c',
        'approval_policy="never"',
        '-c',
        `model_reasoning_effort="${options.effort}"`,
        '-m',
        options.model,
        '--output-last-message',
        lastMessagePath,
        '-',
      ],
      {
        cwd: options.cwd,
        input: prompt,
        encoding: 'utf8',
        timeout: options.timeoutMs,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    const stdout = existsSync(lastMessagePath)
      ? readFileSync(lastMessagePath, 'utf8')
      : (result.stdout ?? '');
    return {
      stdout,
      stderr: result.stderr ?? (result.error ? result.error.message : ''),
      exitCode: typeof result.status === 'number' ? result.status : null,
      timedOut: result.error ? result.error.message.includes('ETIMEDOUT') : false,
      durationMs: Date.now() - started,
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function runSidecar(prompt: string, options: CliOptions): CommandResult {
  if (options.provider === 'mock') {
    return runMock(options);
  }
  if (options.provider === 'codex') {
    return runCodex(prompt, options);
  }
  return runClaude(prompt, options);
}

function parseReviewerOutput(raw: string, maxOutputBytes: number): SidecarReviewerOutput {
  const truncated = truncateUtf8(raw, maxOutputBytes);
  const parsedJson = JSON.parse(truncated.value.trim()) as unknown;
  const parsed = SidecarReviewerOutputSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error(parsed.error.message);
  }
  return parsed.data;
}

function expiryDate(now: Date): string {
  return new Date(now.getTime() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function artifactPath(options: CliOptions): string {
  const sprintId = sanitizeIdentifier(options.sprintId, 'sprint-id');
  const sidecar = sanitizeIdentifier(options.sidecar, 'sidecar');
  const dir = path.join(options.artifactRoot, sprintId);
  const resolvedDir = path.resolve(dir);
  const resolvedRoot = path.resolve(options.artifactRoot);
  if (resolvedDir !== resolvedRoot && !resolvedDir.startsWith(`${resolvedRoot}${path.sep}`)) {
    fail(`artifact path escaped root: ${resolvedDir}`);
  }
  mkdirSync(resolvedDir, { recursive: true });
  return path.join(resolvedDir, `${sidecar}.json`);
}

function buildArtifact(
  packet: SidecarInputPacket,
  options: CliOptions,
  result: CommandResult,
): SidecarArtifact {
  const now = new Date();
  const base = {
    schemaVersion: 1 as const,
    sidecar: options.sidecar,
    provider: options.provider,
    model: options.model,
    effort: options.effort,
    sprintId: options.sprintId,
    gitSha: packet.gitSha,
    inputHash: packet.inputHash,
    createdAt: now.toISOString(),
    expiresAt: expiryDate(now),
    durationMs: result.durationMs,
    exitCode: result.exitCode,
  };

  if (result.timedOut) {
    return {
      ...base,
      status: 'unavailable',
      summary: 'Sidecar timed out before producing a validated review.',
      findings: [],
      limitations: ['Sidecar timed out; no review findings were accepted.'],
      coverage: packet.coverage,
      stderrPreview: preview(result.stderr),
      error: 'timeout',
    };
  }

  if (result.exitCode !== 0) {
    return {
      ...base,
      status: 'error',
      summary: 'Sidecar exited non-zero before producing a validated review.',
      findings: [],
      limitations: ['Sidecar process failed; no review findings were accepted.'],
      coverage: packet.coverage,
      stderrPreview: preview(result.stderr),
      rawPreview: preview(result.stdout),
      error: `exit ${String(result.exitCode)}`,
    };
  }

  try {
    const output = parseReviewerOutput(result.stdout, options.maxOutputBytes);
    return {
      ...base,
      status: output.status,
      summary: output.summary,
      findings: output.findings,
      limitations: output.limitations,
      coverage: output.coverage,
      stderrPreview: result.stderr.trim() ? preview(result.stderr) : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...base,
      status: 'error',
      summary: 'Sidecar output did not match the required JSON schema.',
      findings: [],
      limitations: ['Sidecar output was rejected by the wrapper schema validator.'],
      coverage: packet.coverage,
      stderrPreview: preview(result.stderr),
      rawPreview: preview(result.stdout),
      error: message.slice(0, 1000),
    };
  }
}

function writeArtifact(filePath: string, artifact: SidecarArtifact): void {
  const parsed = SidecarArtifactSchema.safeParse(artifact);
  if (!parsed.success) {
    fail(`internal artifact schema mismatch: ${parsed.error.message}`);
  }
  const tempPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(parsed.data, null, 2)}\n`, 'utf8');
  renameSync(tempPath, filePath);
}

function main(): void {
  const options = parseOptions();
  const packet = buildInputPacket(options);
  const prompt = buildReviewerPrompt(packet, options.cwd);
  const result = runSidecar(prompt, options);
  const artifact = buildArtifact(packet, options, result);
  const outPath = artifactPath(options);
  writeArtifact(outPath, artifact);
  process.stdout.write(`${outPath}\n`);
}

main();
