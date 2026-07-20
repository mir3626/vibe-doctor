import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface AutoPublishDirective {
  enabled: boolean;
  reason: string;
  recordedAt: string;
  expiresAt: string | null;
}

export interface AutoPublishState {
  autoPublish: boolean;
  directive: AutoPublishDirective | null;
  expired: boolean;
}

const DIRECTIVE_KEY = 'proGoAutoPublish';

function configLocalPath(repoRoot: string): string {
  return path.join(repoRoot, '.vibe', 'config.local.json');
}

function sessionLogPath(repoRoot: string): string {
  return path.join(repoRoot, '.vibe', 'agent', 'session-log.md');
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown> | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${filePath} must contain a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function directiveOf(config: Record<string, unknown> | null): AutoPublishDirective | null {
  const userDirectives = config?.userDirectives;
  if (typeof userDirectives !== 'object' || userDirectives === null || Array.isArray(userDirectives)) {
    return null;
  }
  const raw = (userDirectives as Record<string, unknown>)[DIRECTIVE_KEY];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  return {
    enabled: candidate.enabled === true,
    reason: typeof candidate.reason === 'string' ? candidate.reason : '',
    recordedAt: typeof candidate.recordedAt === 'string' ? candidate.recordedAt : '',
    expiresAt: typeof candidate.expiresAt === 'string' ? candidate.expiresAt : null,
  };
}

export async function readAutoPublishState(repoRoot: string): Promise<AutoPublishState> {
  // A broken or missing config.local.json must fail toward requiring confirmation.
  let config: Record<string, unknown> | null = null;
  try {
    config = await readJsonObject(configLocalPath(repoRoot));
  } catch {
    return { autoPublish: false, directive: null, expired: false };
  }
  const directive = directiveOf(config);
  if (!directive || !directive.enabled) {
    return { autoPublish: false, directive, expired: false };
  }
  const expired =
    directive.expiresAt !== null &&
    (!Number.isFinite(Date.parse(directive.expiresAt)) ||
      Date.parse(directive.expiresAt) <= Date.now());
  return { autoPublish: !expired, directive, expired };
}

async function appendSessionLogDecision(repoRoot: string, entry: string): Promise<void> {
  const logPath = sessionLogPath(repoRoot);
  let content: string;
  try {
    content = await readFile(logPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`session-log.md not found at ${logPath}`);
    }
    throw error;
  }
  const entriesPattern = /(^## Entries\s*$\n?)/m;
  if (!entriesPattern.test(content)) {
    throw new Error("session-log.md lacks '## Entries' heading");
  }
  await writeFile(logPath, content.replace(entriesPattern, `$1\n${entry}\n`), 'utf8');
}

async function writeDirective(
  repoRoot: string,
  directive: AutoPublishDirective,
): Promise<void> {
  const filePath = configLocalPath(repoRoot);
  const config = (await readJsonObject(filePath)) ?? { userDirectives: {} };
  const userDirectives =
    typeof config.userDirectives === 'object' &&
    config.userDirectives !== null &&
    !Array.isArray(config.userDirectives)
      ? (config.userDirectives as Record<string, unknown>)
      : {};
  config.userDirectives = { ...userDirectives, [DIRECTIVE_KEY]: directive };
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function validateAutoPublishReason(rawReason: string): string {
  if (/[\r\n]/.test(rawReason)) {
    throw new Error('reason must be single-line');
  }
  const reason = rawReason.trim();
  if (reason.length === 0 || reason.length > 500) {
    throw new Error('reason must be non-empty (1-500 chars)');
  }
  return reason;
}

export function validateAutoPublishDays(rawDays: string): number {
  if (!/^\d+$/.test(rawDays)) {
    throw new Error('days must be a positive integer (1-365)');
  }
  const days = Number(rawDays);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error('days must be a positive integer (1-365)');
  }
  return days;
}

export async function enableAutoPublish(
  repoRoot: string,
  options: { reason: string; days?: number },
): Promise<AutoPublishDirective> {
  const recordedAt = new Date().toISOString();
  const expiresAt =
    options.days === undefined
      ? null
      : new Date(Date.now() + options.days * 86_400_000).toISOString();
  const directive: AutoPublishDirective = {
    enabled: true,
    reason: options.reason,
    recordedAt,
    expiresAt,
  };
  await writeDirective(repoRoot, directive);
  await appendSessionLogDecision(
    repoRoot,
    `- ${recordedAt} [decision][pro-go-auto-publish] reason=${options.reason} expiresAt=${expiresAt ?? 'none'}`,
  );
  return directive;
}

export async function disableAutoPublish(
  repoRoot: string,
): Promise<{ directive: AutoPublishDirective; changed: boolean }> {
  const state = await readAutoPublishState(repoRoot);
  const recordedAt = new Date().toISOString();
  const directive: AutoPublishDirective = {
    enabled: false,
    reason: state.directive?.reason ?? '',
    recordedAt,
    expiresAt: null,
  };
  if (!state.directive?.enabled) {
    return { directive: state.directive ?? directive, changed: false };
  }
  await writeDirective(repoRoot, directive);
  await appendSessionLogDecision(
    repoRoot,
    `- ${recordedAt} [decision][pro-go-auto-publish-clear]`,
  );
  return { directive, changed: true };
}
