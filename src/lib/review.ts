import { execFile as execFileCallback } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { readDecisions, type ProjectDecision } from './decisions.js';
import { fileExists, readJson, readText } from './fs.js';
import { paths } from './paths.js';
import { loadSprintStatus, type PendingRisk } from './sprint-status.js';

const execFile = promisify(execFileCallback);
const DEFAULT_RECENT_ENTRIES = 50;
const DEFAULT_GIT_COMMITS = 20;
const PHASE3_UTILITY_OPT_IN_TAG = '[decision][phase3-utility-opt-in]';
const WEB_PLATFORM_PATTERN = /\b(web|mobile|browser)\b/i;

export interface ReviewInputs {
  handoff: string;
  sessionLog: string;
  recentSessionEntries: string[];
  recentEntriesLimit: number;
  gitLog: string[];
  gitLogMode: 'recent' | 'since-last-review';
  gitCommitLimit: number;
  latestReviewReportPath: string | null;
  openPendingRisks: PendingRisk[];
  decisions: ProjectDecision[];
  passedSprintCount: number;
  productText: string;
  harnessGaps: string;
  openHarnessGapCount: number;
}

export interface ReviewConfigInput {
  bundle?: {
    enabled?: boolean;
  };
  browserSmoke?: {
    enabled?: boolean;
  };
}

export interface ReviewSeedInput {
  productText?: string;
  platform?: string | string[];
  sessionLogRecent?: string[];
}

export interface ReviewIssueSeed {
  id: string;
  severity: 'friction';
  priority: 'P1';
  proposal: string;
  estimated_loc: number;
  proposed_sprint: 'backlog';
}

function resolveRoot(root?: string): string {
  return root ?? paths.root;
}

function handoffPath(root?: string): string {
  return path.join(resolveRoot(root), '.vibe', 'agent', 'handoff.md');
}

function sessionLogPath(root?: string): string {
  return path.join(resolveRoot(root), '.vibe', 'agent', 'session-log.md');
}

function sharedConfigPath(root?: string): string {
  return path.join(resolveRoot(root), '.vibe', 'config.json');
}

function productPath(root?: string): string {
  return path.join(resolveRoot(root), 'docs', 'context', 'product.md');
}

function harnessGapsPath(root?: string): string {
  return path.join(resolveRoot(root), 'docs', 'context', 'harness-gaps.md');
}

function reportsPath(root?: string): string {
  return path.join(resolveRoot(root), 'docs', 'reports');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecentEntriesLimit(config: unknown): number {
  if (!isRecord(config)) {
    return DEFAULT_RECENT_ENTRIES;
  }

  const review = config.review;
  if (!isRecord(review) || typeof review.recentEntries !== 'number') {
    return DEFAULT_RECENT_ENTRIES;
  }

  return Number.isInteger(review.recentEntries) && review.recentEntries > 0
    ? review.recentEntries
    : DEFAULT_RECENT_ENTRIES;
}

async function readOptionalText(filePath: string): Promise<string> {
  return (await fileExists(filePath)) ? readText(filePath) : '';
}

function extractCurrentSessionEntries(sessionLog: string, limit: number): string[] {
  const lines = sessionLog.split(/\r?\n/);
  const entries: string[] = [];
  let inEntries = false;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (inEntries) {
        break;
      }

      inEntries = line.trim() === '## Entries';
      continue;
    }

    if (inEntries && line.startsWith('- ')) {
      entries.push(line);
    }
  }

  return entries.slice(0, limit);
}

async function findLatestReviewReport(root?: string): Promise<string | null> {
  const reportsDir = reportsPath(root);
  if (!(await fileExists(reportsDir))) {
    return null;
  }

  const fileNames = await readdir(reportsDir);
  let latestFile: string | null = null;
  let latestMtime = -1;

  for (const fileName of fileNames) {
    if (!/^review-\d+-\d{4}-\d{2}-\d{2}\.md$/.test(fileName)) {
      continue;
    }

    const absolutePath = path.join(reportsDir, fileName);
    const fileStat = await stat(absolutePath);
    if (fileStat.mtimeMs <= latestMtime) {
      continue;
    }

    latestMtime = fileStat.mtimeMs;
    latestFile = absolutePath;
  }

  return latestFile;
}

async function readLastReviewCommit(
  root: string,
  latestReviewReportPath: string,
): Promise<string | null> {
  try {
    const relativePath = path.relative(root, latestReviewReportPath);
    const { stdout } = await execFile(
      'git',
      ['log', '-n', '1', '--format=%H', '--', relativePath],
      { cwd: root },
    );
    const commit = stdout.trim();
    return commit.length > 0 ? commit : null;
  } catch {
    return null;
  }
}

async function readGitLog(
  root: string,
  latestReviewReportPath: string | null,
): Promise<Pick<ReviewInputs, 'gitLog' | 'gitLogMode' | 'gitCommitLimit'>> {
  const lastReviewCommit =
    latestReviewReportPath === null
      ? null
      : await readLastReviewCommit(root, latestReviewReportPath);

  const args =
    lastReviewCommit === null
      ? ['log', '--oneline', `-${DEFAULT_GIT_COMMITS}`]
      : ['log', '--oneline', `${lastReviewCommit}..HEAD`];

  try {
    const { stdout } = await execFile('git', args, { cwd: root });
    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    return {
      gitLog: lines,
      gitLogMode: lastReviewCommit === null ? 'recent' : 'since-last-review',
      gitCommitLimit: DEFAULT_GIT_COMMITS,
    };
  } catch {
    return {
      gitLog: [],
      gitLogMode: lastReviewCommit === null ? 'recent' : 'since-last-review',
      gitCommitLimit: DEFAULT_GIT_COMMITS,
    };
  }
}

function countOpenHarnessGaps(markdown: string): number {
  return markdown
    .split(/\r?\n/)
    .filter((line) => /^\|\s*gap-[^|]+\|.*\|\s*open\s*\|$/i.test(line.trim())).length;
}

function normalizePlatformSignals(seed: ReviewSeedInput): string[] {
  const signals: string[] = [];

  if (Array.isArray(seed.platform)) {
    signals.push(...seed.platform);
  } else if (typeof seed.platform === 'string') {
    signals.push(seed.platform);
  }

  if (typeof seed.productText === 'string') {
    signals.push(seed.productText);
  }

  return signals;
}

function isWebPlatformSeed(seed: ReviewSeedInput): boolean {
  return normalizePlatformSignals(seed).some((signal) => WEB_PLATFORM_PATTERN.test(signal));
}

function hasUtilityOptInDecision(seed: ReviewSeedInput): boolean {
  return (seed.sessionLogRecent ?? []).some((entry) => entry.includes(PHASE3_UTILITY_OPT_IN_TAG));
}

export async function collectReviewInputs(root?: string): Promise<ReviewInputs> {
  const resolvedRoot = resolveRoot(root);
  const config = await readJson<unknown>(sharedConfigPath(resolvedRoot)).catch(() => ({}));
  const recentEntriesLimit = readRecentEntriesLimit(config);
  const [handoff, sessionLog, status, decisions, productText, harnessGaps, latestReviewReportPath] =
    await Promise.all([
      readOptionalText(handoffPath(resolvedRoot)),
      readOptionalText(sessionLogPath(resolvedRoot)),
      loadSprintStatus(resolvedRoot),
      readDecisions(resolvedRoot),
      readOptionalText(productPath(resolvedRoot)),
      readOptionalText(harnessGapsPath(resolvedRoot)),
      findLatestReviewReport(resolvedRoot),
    ]);
  const gitLogState = await readGitLog(resolvedRoot, latestReviewReportPath);

  return {
    handoff,
    sessionLog,
    recentSessionEntries: extractCurrentSessionEntries(sessionLog, recentEntriesLimit),
    recentEntriesLimit,
    gitLog: gitLogState.gitLog,
    gitLogMode: gitLogState.gitLogMode,
    gitCommitLimit: gitLogState.gitCommitLimit,
    latestReviewReportPath,
    openPendingRisks: status.pendingRisks.filter((risk) => risk.status === 'open'),
    decisions,
    passedSprintCount: status.sprints.filter((sprint) => sprint.status === 'passed').length,
    productText,
    harnessGaps,
    openHarnessGapCount: countOpenHarnessGaps(harnessGaps),
  };
}

export function detectOptInGaps(
  config: ReviewConfigInput,
  seed: ReviewSeedInput,
): ReviewIssueSeed[] {
  if (!isWebPlatformSeed(seed) || hasUtilityOptInDecision(seed)) {
    return [];
  }

  const issues: ReviewIssueSeed[] = [];

  if (config.bundle?.enabled !== true) {
    issues.push({
      id: 'review-bundle-opt-in-disabled',
      severity: 'friction',
      priority: 'P1',
      proposal: 'frontend 프로젝트인데 bundle-size gate 가 opt-in 되지 않음',
      estimated_loc: 20,
      proposed_sprint: 'backlog',
    });
  }

  if (config.browserSmoke?.enabled !== true) {
    issues.push({
      id: 'review-browser-smoke-opt-in-disabled',
      severity: 'friction',
      priority: 'P1',
      proposal: 'frontend 프로젝트인데 browser smoke gate 가 opt-in 되지 않음',
      estimated_loc: 20,
      proposed_sprint: 'backlog',
    });
  }

  return issues;
}
