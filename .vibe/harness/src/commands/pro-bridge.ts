import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { getBooleanFlag, getStringFlag, parseArgs } from '../lib/args.js';
import { runMain } from '../lib/cli.js';
import {
  loadConfig,
  resolveProBridgeConfig,
  type ProBridgeConfig,
} from '../lib/config.js';
import { logger } from '../lib/logger.js';
import {
  FOLDER_NAME_PATTERN,
  type ReviewKind,
  type ReviewRequest,
} from '../pro-bridge/contract.js';
import { resolveGoalSource } from '../pro-bridge/goal-source/resolver.js';
import {
  createDefaultGitPort,
  type GitPort,
} from '../pro-bridge/goal-source/types.js';
import { importReviewResult, type ImportContext } from '../pro-bridge/importer.js';
import type { MailboxHealth } from '../pro-bridge/mailbox/store.js';
import { startMcpServer } from '../pro-bridge/mailbox/server.js';
import { createMailboxTools } from '../pro-bridge/mailbox/tools.js';
import {
  startTunnel,
  type TunnelKind,
} from '../pro-bridge/mailbox/tunnel.js';
import { buildReviewRequest, ScopeBlockedError } from '../pro-bridge/prompt-composer.js';
import {
  parseGitHubFullName,
  resolveGitHubScope,
} from '../pro-bridge/scope-resolver.js';
import {
  copyFileToClipboard,
  ManualDirectoryTransport,
  openInBrowser,
  readClipboardText,
} from '../pro-bridge/transports/manual.js';
import { McpMailboxTransport } from '../pro-bridge/transports/mcp-mailbox.js';
import {
  estimateReviewCost,
  ResponsesApiExecutionError,
  ResponsesApiTransport,
} from '../pro-bridge/transports/responses-api.js';
import {
  resolveTransportName,
  type RequestStatus,
  type SupportedTransportName,
  type VibeProBridgeTransport,
} from '../pro-bridge/transports/types.js';
import {
  WorkspaceAgentTransport,
  type WorkspaceAgentTriggerPort,
} from '../pro-bridge/transports/workspace-agent.js';
import { parseVibeBundle } from '../pro-bridge/vibe-bundle.js';

const CHATGPT_URL = 'https://chatgpt.com/';
const CHATGPT_BOOTSTRAP =
  '클립보드의 Vibe Pro Bridge 리뷰 요청 프롬프트를 붙여넣고, Pro 모델을 직접 선택해 진행하세요.';
const CHATGPT_MCP_BOOTSTRAP =
  '클립보드의 Vibe Pro Bridge request invocation을 붙여넣고, Pro 모델과 연결된 mailbox 도구로 진행하세요.';
const TERMINAL_STATES = new Set(['imported', 'cancelled', 'expired', 'failed']);
const REPOSITORY_OVERRIDE_FLAG = 'dangerously-override-repository-identity' as const;
const UNBOUND_ACCEPTANCE_FLAG = 'accept-unbound-web-origin' as const;
const UNBOUND_SKIPPED_VALIDATIONS = [
  'request-metadata-unavailable',
  'result-manifest-unavailable',
  'request-hash-binding-skipped',
  'result-hash-binding-skipped',
  'repository-binding-skipped',
  'reviewed-head-binding-skipped',
  'file-roster-binding-skipped',
  'file-sha-binding-skipped',
  'reviewer-declaration-unavailable',
] as const;

type CurrentRepoIdentity =
  | { ok: true; fullName: string }
  | { ok: false; reason: 'origin-missing' | 'origin-unresolvable' };

interface RepositoryImportBinding {
  expectedRepositoryFullName: string | null;
  currentRepositoryFullName: string | null;
  requestRepositoryFullName: string | null;
  repositoryIdentityOverride: NonNullable<ImportContext['repositoryIdentityOverride']> | null;
}

type BridgeCliTransport = VibeProBridgeTransport & {
  listRequests(): Promise<RequestStatus[]>;
  cancelRequest(requestId: string): Promise<void>;
  readRequest(requestId: string): Promise<ReviewRequest | null>;
  listResultReady?(): Promise<RequestStatus[]>;
  inspectMailboxHealth?(): Promise<MailboxHealth>;
  getCurrentResultFilesSha256?(requestId: string): Promise<string | null>;
};

export interface ProBridgeIo {
  out(line: string): void;
  err(line: string): void;
  confirm(question: string): Promise<boolean>;
}

export interface ProBridgeDeps {
  repoRoot?: string;
  git?: GitPort;
  config?: ProBridgeConfig;
  io?: ProBridgeIo;
  clipboard?: {
    copyFile: typeof copyFileToClipboard;
    readText: typeof readClipboardText;
  };
  browser?: { open: typeof openInBrowser };
  stdin?: { isTTY: boolean };
  goalResolver?: typeof resolveGoalSource;
  now?: () => Date;
  mcpServer?: { start: typeof startMcpServer };
  tunnel?: { start: typeof startTunnel };
  waitForShutdown?: () => Promise<void>;
  randomToken?: () => string;
  agentTrigger?: WorkspaceAgentTriggerPort;
  fetchPort?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  env?: Record<string, string | undefined>;
  codexExec?: {
    run(args: string[], stdinText: string): Promise<{
      code: number | null;
      stdout: string;
      stderr: string;
    }>;
  };
}

function createDefaultIo(): ProBridgeIo {
  return {
    out: (line) => logger.info(line),
    err: (line) => logger.error(line),
    async confirm(question) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        return false;
      }
      const readline = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = await readline.question(`${question} [y/N] `);
        return /^(y|yes)$/i.test(answer.trim());
      } finally {
        readline.close();
      }
    },
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nested(value: unknown, ...keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    const currentRecord = record(current);
    if (!currentRecord) {
      return undefined;
    }
    current = currentRecord[key];
  }
  return current;
}

function stringAt(value: unknown, ...keys: string[]): string | null {
  const found = nested(value, ...keys);
  return typeof found === 'string' ? found : null;
}

function booleanAt(value: unknown, ...keys: string[]): boolean | null {
  const found = nested(value, ...keys);
  return typeof found === 'boolean' ? found : null;
}

function arrayAt(value: unknown, ...keys: string[]): unknown[] {
  const found = nested(value, ...keys);
  return Array.isArray(found) ? found : [];
}

async function resolveCurrentRepositoryIdentity(git: GitPort): Promise<CurrentRepoIdentity> {
  let remote: Awaited<ReturnType<GitPort['run']>>;
  try {
    remote = await git.run(['remote', 'get-url', 'origin']);
  } catch {
    return { ok: false, reason: 'origin-missing' };
  }
  const remoteUrl = remote.ok ? remote.stdout.trim() : '';
  if (!remoteUrl) {
    return { ok: false, reason: 'origin-missing' };
  }
  const fullName = parseGitHubFullName(remoteUrl);
  return fullName
    ? { ok: true, fullName }
    : { ok: false, reason: 'origin-unresolvable' };
}

function reportRepositoryIdentityFailure(
  identity: Extract<CurrentRepoIdentity, { ok: false }>,
  io: ProBridgeIo,
): void {
  const reason = identity.reason === 'origin-missing'
    ? 'origin remote가 없거나 URL을 읽을 수 없습니다.'
    : 'origin URL이 GitHub 저장소 fullName으로 해석되지 않습니다.';
  io.err(`현재 저장소 정체성 확인 실패 (${identity.reason}): ${reason}`);
  io.err('GitHub origin을 설정한 뒤 다시 시도하세요 (git remote add/set-url origin <github-url>).');
  io.err(`정말 우회해야 한다면 --${REPOSITORY_OVERRIDE_FLAG}를 명시하세요. 이 실행은 provenance에 기록되고 release 증거에서 제외됩니다.`);
}

function bindRepositoryIdentity(input: {
  current: CurrentRepoIdentity;
  requestRepositoryFullName: string | null;
  override: boolean;
  io: ProBridgeIo;
}): RepositoryImportBinding | null {
  const currentFullName = input.current.ok ? input.current.fullName : null;
  if (!input.current.ok && !input.override) {
    reportRepositoryIdentityFailure(input.current, input.io);
    return null;
  }
  if (
    input.current.ok
    && input.requestRepositoryFullName !== null
    && input.current.fullName !== input.requestRepositoryFullName
    && !input.override
  ) {
    input.io.err(
      `저장소 정체성 불일치: current=${input.current.fullName}, request/manifest=${input.requestRepositoryFullName}`,
    );
    input.io.err(`다른 저장소 결과는 설치하지 않습니다. 정말 우회해야 한다면 --${REPOSITORY_OVERRIDE_FLAG}를 명시하세요.`);
    return null;
  }

  const expectedRepositoryFullName = input.override
    ? input.requestRepositoryFullName ?? currentFullName
    : currentFullName;
  const repositoryIdentityOverride = input.override
    ? {
        current: currentFullName,
        request: input.requestRepositoryFullName,
        flag: REPOSITORY_OVERRIDE_FLAG,
      }
    : null;
  if (repositoryIdentityOverride) {
    const currentLabel = currentFullName ?? `unavailable (${input.current.ok ? 'unknown' : input.current.reason})`;
    input.io.err(
      `저장소 정체성 강제 우회: current=${currentLabel}, request/manifest=${input.requestRepositoryFullName ?? 'unbound'}`,
    );
    input.io.err(`--${REPOSITORY_OVERRIDE_FLAG} 사용을 provenance에 기록하며 release 증거에서 제외합니다.`);
  }
  return {
    expectedRepositoryFullName,
    currentRepositoryFullName: currentFullName,
    requestRepositoryFullName: input.requestRepositoryFullName,
    repositoryIdentityOverride,
  };
}

function printUnboundValidations(io: ProBridgeIo, channel: 'out' | 'err'): void {
  io[channel](`unbound Web-origin에서 생략되는 검증: ${UNBOUND_SKIPPED_VALIDATIONS.join(', ')}`);
}

function warnLegacyNoOp(io: ProBridgeIo): void {
  io.err('경고: 기존 provenance에 저장소 정체성 필드가 없어 legacy no-op를 허용했습니다. 새 설치에는 정체성 필드가 기록됩니다.');
}

async function acknowledgeAfterInstall(input: {
  transport: Pick<VibeProBridgeTransport, 'acknowledgeImport'>;
  requestId: string;
  folder: string;
  installedPath: string;
  resultFilesSha256: string;
  repositoryFullName: string;
  resultManifestSha256?: string;
  verification?: 'out-of-band';
  now: () => Date;
  io: ProBridgeIo;
}): Promise<boolean> {
  try {
    await input.transport.acknowledgeImport(input.requestId, {
      requestId: input.requestId,
      folder: input.folder,
      installedPath: input.installedPath,
      resultFilesSha256: input.resultFilesSha256,
      importedAt: input.now().toISOString(),
      repositoryFullName: input.repositoryFullName,
      ...(input.resultManifestSha256 === undefined
        ? {}
        : { resultManifestSha256: input.resultManifestSha256 }),
      ...(input.verification === undefined
        ? {}
        : { verification: input.verification }),
    });
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    input.io.err(`경고: 요청 후처리(ack) 실패: ${reason} — 설치는 완료됐으며 다음 sync가 동일 provenance를 검증해 다시 종결합니다.`);
    return false;
  }
}

function scopeReasons(error: unknown): string[] {
  if (!(error instanceof ScopeBlockedError) || !Array.isArray(error.reasons)) {
    return [];
  }
  return error.reasons.filter((reason): reason is string => typeof reason === 'string');
}

function scopeBlockedMessage(reasons: readonly string[]): string | null {
  const messages: string[] = [];
  if (reasons.includes('repository-fullname-unresolved')) {
    messages.push('GitHub origin을 확인할 수 없어 발행을 보류했습니다. GitHub remote를 설정한 뒤 manual/API 경로로 재시도하세요.');
  }
  if (reasons.includes('base-not-on-remote')) {
    messages.push('리뷰 base가 GitHub remote에서 보이지 않습니다. base branch는 사용자가 직접 push한 뒤 재시도하세요.');
  }
  if (reasons.includes('head-not-on-remote')) {
    messages.push('리뷰 head가 GitHub remote에서 보이지 않습니다. patch 자동 첨부가 불가능하면 review branch를 사용자가 직접 push한 뒤 재시도하세요.');
  }
  if (reasons.includes('patch-oversized')) {
    messages.push('GitHub에서 보이지 않는 head의 patch가 상한을 초과했습니다. review branch는 사용자가 직접 push한 뒤 재시도하세요.');
  }
  return messages.length > 0 ? messages.join('\n') : null;
}

async function resolveConfig(deps: ProBridgeDeps): Promise<ProBridgeConfig> {
  if (deps.config) {
    return resolveProBridgeConfig(deps.config);
  }
  const loaded = await loadConfig();
  return resolveProBridgeConfig(loaded.proBridge);
}

function createGit(repoRoot: string, supplied?: GitPort): GitPort {
  if (supplied) {
    return supplied;
  }
  const factory = createDefaultGitPort as unknown as (root: string) => GitPort;
  return factory(repoRoot);
}

function createDefaultCodexExec(repoRoot: string): NonNullable<ProBridgeDeps['codexExec']> {
  return {
    run(args, stdinText) {
      return new Promise((resolve, reject) => {
        const child = spawn('codex', args, {
          cwd: repoRoot,
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => { stdout += chunk; });
        child.stderr.on('data', (chunk: string) => { stderr += chunk; });
        child.once('error', reject);
        child.once('close', (code) => resolve({ code, stdout, stderr }));
        child.stdin.end(stdinText, 'utf8');
      });
    },
  };
}

const REVIEW_KINDS = new Set<ReviewKind>([
  'goal_audit',
  'feature_design',
  'architecture_review',
  'implementation_review',
]);

function resolveKindFlag(args: ReturnType<typeof parseArgs>): ReviewKind | null {
  const value = getStringFlag(args, 'kind');
  if (value === undefined) {
    return null;
  }
  if (!REVIEW_KINDS.has(value as ReviewKind)) {
    throw new Error(`Invalid --kind value "${value}". Expected ${[...REVIEW_KINDS].join(', ')}.`);
  }
  return value as ReviewKind;
}

function errorCode(error: unknown): string | null {
  return error !== null && typeof error === 'object' && 'code' in error
    && typeof error.code === 'string'
    ? error.code
    : null;
}

async function gitHead(git: GitPort): Promise<string> {
  const port = git as unknown as Record<string, unknown>;
  const method = typeof port.run === 'function'
    ? port.run
    : typeof port.exec === 'function'
      ? port.exec
      : null;
  if (!method) {
    throw new Error('Git port does not expose a read command method');
  }
  const result = await (method as (args: string[]) => Promise<unknown>).call(git, [
    'rev-parse',
    'HEAD',
  ]);
  const stdout = typeof result === 'string' ? result : stringAt(result, 'stdout');
  if (!stdout?.trim()) {
    throw new Error('Unable to resolve git HEAD');
  }
  return stdout.trim();
}

function deepLink(transportName: 'manual' | 'mcp-mailbox'): string {
  const bootstrap = transportName === 'mcp-mailbox' ? CHATGPT_MCP_BOOTSTRAP : CHATGPT_BOOTSTRAP;
  const candidate = `${CHATGPT_URL}?q=${encodeURIComponent(bootstrap)}`;
  return Buffer.byteLength(candidate, 'utf8') <= 2048 ? candidate : CHATGPT_URL;
}

function publicationSummary(scope: unknown, destination = 'OpenAI(ChatGPT 웹)'): string[] {
  const included = arrayAt(scope, 'patch', 'files');
  const fallbackIncluded = arrayAt(scope, 'patch', 'included');
  const roster = included.length > 0 ? included : fallbackIncluded;
  const excluded = arrayAt(scope, 'patch', 'excluded');
  let protectedCount = 0;
  let nonTextCount = 0;
  let otherCount = 0;
  for (const item of excluded) {
    const reason = stringAt(item, 'reason');
    if (reason === 'secret') {
      protectedCount += 1;
    } else if (reason === 'binary') {
      nonTextCount += 1;
    } else {
      otherCount += 1;
    }
  }
  return [
    `외부 발행 고지: 요청 메타데이터, 리뷰 프롬프트, 아래 patch가 ${destination}로 전송됩니다.`,
    `patch 파일: ${roster.length > 0 ? roster.map((item) => stringAt(item, 'path') ?? String(item)).join(', ') : '없음'}`,
    `제외 요약: 보안 필터 제외 ${protectedCount}, 비텍스트 제외 ${nonTextCount}, 기타 제외 ${otherCount}`,
  ];
}

function printStatuses(
  statuses: RequestStatus[],
  io: ProBridgeIo,
): void {
  if (statuses.length === 0) {
    io.out('Pro Bridge 요청이 없습니다.');
    return;
  }
  io.out('requestId\tkind\tstate\tcreatedAt\texpiresAt');
  for (const status of statuses) {
    io.out([
      status.requestId,
      status.kind,
      status.state,
      status.createdAt,
      status.expiresAt,
    ].join('\t'));
  }
}

async function createAndPublish(
  request: ReviewRequest,
  scope: unknown,
  options: {
    yes: boolean;
    config: ProBridgeConfig;
    io: ProBridgeIo;
    transport: BridgeCliTransport;
    transportName: SupportedTransportName;
    clipboard: NonNullable<ProBridgeDeps['clipboard']>;
    browser: NonNullable<ProBridgeDeps['browser']>;
    stdin: NonNullable<ProBridgeDeps['stdin']>;
  },
): Promise<number> {
  const destination = options.transportName === 'responses-api'
    ? 'OpenAI Responses API'
    : 'OpenAI(ChatGPT 웹)';
  for (const line of publicationSummary(scope, destination)) {
    options.io.out(line);
  }
  if (options.transportName === 'responses-api') {
    const estimate = estimateReviewCost(request, options.config.api);
    options.io.out([
      `Responses API 비용 추정 — model=${options.config.api.model}`,
      `inputTokens=${estimate.inputTokens}`,
      `outputTokens=${estimate.outputTokens}`,
      `usd=${estimate.usd.toFixed(4)}`,
    ].join(', '));
    if (estimate.exceedsLimit) {
      options.io.err(
        `예상 입력 ${estimate.inputTokens} tokens가 maxInputTokens ${options.config.api.maxInputTokens}를 초과해 발행을 중단했습니다.`,
      );
      return 1;
    }
  }
  if (!options.yes) {
    if (!options.stdin.isTTY) {
      options.io.err('비대화 환경에서는 외부 발행 승인을 위해 --yes가 필요합니다.');
      return 1;
    }
    if (!(await options.io.confirm('이 요청 패킷을 외부에 발행할까요?'))) {
      options.io.out('외부 발행을 보류했습니다.');
      return 1;
    }
  }

  const handle = await options.transport.createRequest(request);
  if (options.transportName === 'workspace-agent') {
    const triggered = await (options.transport as WorkspaceAgentTransport).trigger(handle.requestId);
    options.io.out(`requestId: ${handle.requestId}`);
    options.io.out(`triggered: ${triggered.triggered} (${triggered.reason})`);
    options.io.out('trigger 응답은 접수 확인일 뿐입니다. completion은 npm run vibe:pro-status 폴링과 npm run vibe:pro-sync로만 확인하세요.');
    return 0;
  }
  if (options.transportName === 'responses-api') {
    try {
      const executed = await (options.transport as ResponsesApiTransport).execute(handle.requestId);
      options.io.out(`requestId: ${handle.requestId}`);
      options.io.out(`Responses API attempts: ${executed.attempts}`);
      options.io.out('결과 업로드 완료 — npm run vibe:pro-sync 로 설치하세요.');
      return executed.resultReady ? 0 : 1;
    } catch (error) {
      const attempts = error instanceof ResponsesApiExecutionError ? error.attempts : 0;
      options.io.err(
        `Responses API 리뷰 실패 (attempts=${attempts}): ${error instanceof Error ? error.message : String(error)}`,
      );
      options.io.err(`요청을 정리하려면 vibe-pro-bridge cancel ${handle.requestId} 를 실행하세요.`);
      return 1;
    }
  }
  if (options.config.copyInvocation) {
    const copyPath = options.transportName === 'mcp-mailbox'
      ? path.join(handle.requestDir, 'invocation.txt')
      : handle.promptPath;
    const copied = await options.clipboard.copyFile(copyPath);
    if (!copied.ok) {
      options.io.err(`클립보드 복사 실패. 다음 파일을 수동 복사하세요: ${copyPath}`);
    }
  }
  if (options.config.openBrowser) {
    const opened = await options.browser.open(deepLink(options.transportName));
    if (!opened.ok) {
      options.io.err(`브라우저 열기 실패(요청은 보존됨): ${opened.error ?? 'unknown error'}`);
    }
  }

  options.io.out(`requestId: ${handle.requestId}`);
  options.io.out(`prompt: ${handle.promptPath}`);
  options.io.out('Pro 모델은 사용자가 웹에서 직접 선택하세요.');
  if (options.transportName === 'mcp-mailbox') {
    options.io.out(`@Vibe Pro Bridge review ${handle.requestId}`);
    options.io.out('npm run vibe:pro-mcp 로 서버를 켜두세요. 결과 도착 후 npm run vibe:pro-sync 를 실행하면 클립보드 없이 설치됩니다.');
    options.io.out(`수동 fallback prompt: ${handle.promptPath}`);
  } else {
    options.io.out('응답의 vibe-bundle 한 블록을 복사한 뒤 npm run vibe:pro-sync 를 실행하세요.');
  }
  if (booleanAt(scope, 'git', 'headVisibleOnGitHub') === true) {
    const compareUrl = stringAt(scope, 'compareUrlHint') ?? stringAt(scope, 'git', 'compareUrlHint');
    if (compareUrl) {
      options.io.out(`compare: ${compareUrl}`);
    }
  }
  return 0;
}

async function resolveScopeAndCompose(
  input: {
    kind: 'goal_audit' | 'feature_design';
    userGoal: string;
    goalSource: unknown;
    baseSha: string;
    headSha: string;
  },
  context: {
    repoRoot: string;
    git: GitPort;
    now: () => Date;
    config: ProBridgeConfig;
  },
): Promise<{ request: ReviewRequest; scope: unknown }> {
  const scope = await resolveGitHubScope(
    { repoRoot: context.repoRoot, git: context.git },
    { baseSha: input.baseSha, headSha: input.headSha },
    { maxPatchBytes: context.config.maxPatchBytes },
  );
  const compose = buildReviewRequest as unknown as (value: {
    kind: 'goal_audit' | 'feature_design';
    userGoal: string;
    goalSource: unknown;
    scope: unknown;
    now: () => Date;
    ttlDays: number;
  }) => ReviewRequest;
  return {
    request: compose({
      kind: input.kind,
      userGoal: input.userGoal,
      goalSource: input.goalSource,
      scope,
      now: context.now,
      ttlDays: context.config.requestTtlHours / 24,
    }),
    scope,
  };
}

function parseBundleText(text: string): {
  bundle: unknown | null;
  errors: string[];
  missingEndSentinel: boolean;
} {
  try {
    const parsed = (parseVibeBundle as unknown as (value: string) => unknown)(text);
    const parsedRecord = record(parsed);
    if (parsedRecord?.ok === false) {
      const code = stringAt(parsed, 'error', 'code') ?? 'invalid-bundle';
      const message = stringAt(parsed, 'error', 'message') ?? 'invalid bundle';
      const line = nested(parsed, 'error', 'line');
      return {
        bundle: null,
        errors: [`${code}: ${message}${typeof line === 'number' ? ` (line ${line})` : ''}`],
        missingEndSentinel: code === 'missing-end-sentinel',
      };
    }
    return { bundle: parsedRecord?.bundle ?? parsed, errors: [], missingEndSentinel: false };
  } catch (error) {
    return {
      bundle: null,
      errors: [error instanceof Error ? error.message : String(error)],
      missingEndSentinel: false,
    };
  }
}

function bundleRequestId(bundle: unknown): string | null {
  return stringAt(bundle, 'requestId') ?? stringAt(bundle, 'manifest', 'requestId');
}

async function runBundleSync(
  args: ReturnType<typeof parseArgs>,
  context: {
    repoRoot: string;
    config: ProBridgeConfig;
    io: ProBridgeIo;
    transport: BridgeCliTransport;
    clipboard: NonNullable<ProBridgeDeps['clipboard']>;
    git: GitPort;
    now: () => Date;
  },
): Promise<number> {
  const from = getStringFlag(args, 'from');
  let text: string;
  if (from) {
    text = await readFile(path.resolve(context.repoRoot, from), 'utf8');
  } else {
    const clipboard = await context.clipboard.readText();
    if (!clipboard.ok || !clipboard.text?.trim()) {
      context.io.err('클립보드가 비어 있거나 읽을 수 없습니다. --from <file>을 사용하세요.');
      return 1;
    }
    text = clipboard.text;
  }

  const parsed = parseBundleText(text);
  if (!parsed.bundle) {
    context.io.err(`vibe-bundle 파싱 실패: ${parsed.errors.join('; ') || 'invalid bundle'}`);
    if (parsed.missingEndSentinel || !text.includes('VIBE:END')) {
      context.io.err('VIBE:END가 없습니다. 응답 블록 전체를 다시 복사하세요.');
    }
    return 1;
  }

  const requestId = bundleRequestId(parsed.bundle);
  if (!requestId) {
    context.io.err('vibe-bundle requestId가 없습니다.');
    return 1;
  }

  const currentIdentity = await resolveCurrentRepositoryIdentity(context.git);
  const overrideRepositoryIdentity = getBooleanFlag(args, REPOSITORY_OVERRIDE_FLAG);
  if (!currentIdentity.ok && !overrideRepositoryIdentity) {
    reportRepositoryIdentityFailure(currentIdentity, context.io);
    return 1;
  }

  let request: ReviewRequest | null = null;
  let boundRequestId: string | null = null;
  let acknowledgementTransport: Pick<VibeProBridgeTransport, 'acknowledgeImport'> | null = null;
  if (requestId === 'web-origin') {
    if (getBooleanFlag(args, 'latest')) {
      const latest = (await context.transport.listRequests()).find(
        (status) => !TERMINAL_STATES.has(status.state),
      );
      if (latest) {
        request = await context.transport.readRequest(latest.requestId);
        boundRequestId = latest.requestId;
        acknowledgementTransport = request ? context.transport : null;
      }
    }
  } else {
    const manual = new ManualDirectoryTransport({ repoRoot: context.repoRoot, now: context.now });
    const mailbox = new McpMailboxTransport({ repoRoot: context.repoRoot, now: context.now });
    request = await manual.readRequest(requestId);
    if (request) {
      boundRequestId = requestId;
      acknowledgementTransport = manual;
    } else {
      request = await mailbox.store.getRequest(requestId);
      if (request) {
        boundRequestId = requestId;
        acknowledgementTransport = mailbox;
      }
    }
  }

  const unbound = request === null;
  const acceptUnbound = getBooleanFlag(args, UNBOUND_ACCEPTANCE_FLAG);
  if (unbound && !acceptUnbound) {
    context.io.err('바인딩 메타데이터가 없는 Web-origin 결과는 기본적으로 설치하지 않습니다.');
    printUnboundValidations(context.io, 'err');
    context.io.err(`검증 생략을 명시적으로 승인하려면 --${UNBOUND_ACCEPTANCE_FLAG}를 사용하세요.`);
    return 1;
  }
  if (unbound) {
    printUnboundValidations(context.io, 'out');
    context.io.out(`--${UNBOUND_ACCEPTANCE_FLAG} 승인을 provenance에 기록하며 release 증거에서 제외합니다.`);
  }

  const requestRepositoryFullName = request?.repository.fullName ?? null;
  const repositoryBinding = bindRepositoryIdentity({
    current: currentIdentity,
    requestRepositoryFullName,
    override: overrideRepositoryIdentity,
    io: context.io,
  });
  if (!repositoryBinding) {
    return 1;
  }

  const approveRevision = getBooleanFlag(args, 'approve-revision');
  const importer = importReviewResult as unknown as (
    input: { kind: 'bundle'; bundle: unknown },
    importContext: ImportContext,
  ) => Promise<unknown>;
  const bundleRecord = record(parsed.bundle);
  const bundleForImport = requestId === 'web-origin' && boundRequestId && bundleRecord
    ? { ...bundleRecord, requestId: boundRequestId }
    : parsed.bundle;
  const importInput: { kind: 'bundle'; bundle: unknown } = {
    kind: 'bundle',
    bundle: bundleForImport,
  };
  const importContext: ImportContext = {
    repoRoot: context.repoRoot,
    request,
    expectedRepositoryFullName: repositoryBinding.expectedRepositoryFullName,
    currentRepositoryFullName: repositoryBinding.currentRepositoryFullName,
    requestRepositoryFullName: repositoryBinding.requestRepositoryFullName,
    repositoryIdentityOverride: repositoryBinding.repositoryIdentityOverride,
    unboundAcceptance: unbound
      ? {
          flag: UNBOUND_ACCEPTANCE_FLAG,
          acknowledgedAt: context.now().toISOString(),
        }
      : null,
    transport: 'manual',
    now: context.now,
  };
  if (context.config.resultRoot !== 'docs/plans') {
    importContext.installRoot = path.join(context.repoRoot, context.config.resultRoot);
  }
  if (approveRevision) {
    importContext.approveRevision = true;
  }
  const outcome = await importer(importInput, importContext);
  const status = stringAt(outcome, 'status') ?? stringAt(outcome, 'kind') ?? 'invalid';
  if (status === 'installed') {
    const installedPath = stringAt(outcome, 'installedPath')
      ?? stringAt(outcome, 'packagePath')
      ?? '';
    const folder = stringAt(outcome, 'folder')
      ?? stringAt(parsed.bundle, 'manifest', 'folder')
      ?? path.basename(installedPath);
    context.io.out(`설치 완료: ${installedPath || folder}`);
    const nextAction = stringAt(outcome, 'nextAction');
    if (nextAction) {
      context.io.out(`nextAction: ${nextAction}`);
    }
    const skipped = arrayAt(outcome, 'skippedValidations');
    if (skipped.length > 0) {
      context.io.out(`skippedValidations: ${skipped.map(String).join(', ')}`);
    }
    context.io.out('구현은 자동 시작하지 않습니다. 다음 goal 투입 여부를 사용자가 결정하세요.');
    if (boundRequestId && acknowledgementTransport && request) {
      const resultFilesSha256 = stringAt(outcome, 'resultFilesSha256');
      if (!resultFilesSha256) {
        context.io.err('경고: importer 결과에 resultFilesSha256가 없어 요청 후처리(ack)를 생략했습니다. 설치는 완료되었습니다.');
      } else {
        await acknowledgeAfterInstall({
          transport: acknowledgementTransport,
          requestId: boundRequestId,
          folder,
          installedPath,
          resultFilesSha256,
          repositoryFullName: request.repository.fullName,
          verification: 'out-of-band',
          now: context.now,
          io: context.io,
        });
      }
    }
    return 0;
  }
  if (status === 'no-op' || status === 'noop') {
    context.io.out('동일한 결과 패키지가 이미 설치되어 변경이 없습니다.');
    if (booleanAt(outcome, 'legacyRepositoryIdentity') === true) {
      warnLegacyNoOp(context.io);
    }
    if (boundRequestId && acknowledgementTransport && request) {
      const resultFilesSha256 = stringAt(outcome, 'resultFilesSha256');
      const installedRepository = stringAt(outcome, 'repositoryFullName');
      const installedPath = stringAt(outcome, 'installedPath');
      const folder = stringAt(outcome, 'folder');
      if (
        !resultFilesSha256
        || !installedPath
        || !folder
        || installedRepository !== request.repository.fullName
      ) {
        context.io.err('설치 provenance의 결과 SHA 또는 저장소 바인딩을 정확히 확인할 수 없어 ack하지 않았습니다.');
        return 1;
      }
      await acknowledgeAfterInstall({
        transport: acknowledgementTransport,
        requestId: boundRequestId,
        folder,
        installedPath,
        resultFilesSha256,
        repositoryFullName: request.repository.fullName,
        verification: 'out-of-band',
        now: context.now,
        io: context.io,
      });
    }
    return 0;
  }
  context.io.err(`결과 반입 ${status}: ${stringAt(outcome, 'message') ?? '검증을 통과하지 못했습니다.'}`);
  return 1;
}

async function runMailboxSync(
  args: ReturnType<typeof parseArgs>,
  context: {
    repoRoot: string;
    config: ProBridgeConfig;
    io: ProBridgeIo;
    transport: BridgeCliTransport & { listResultReady(): Promise<RequestStatus[]> };
    transportName: SupportedTransportName;
    git: GitPort;
    stdin: NonNullable<ProBridgeDeps['stdin']>;
    now: () => Date;
  },
): Promise<number> {
  const currentIdentity = await resolveCurrentRepositoryIdentity(context.git);
  const overrideRepositoryIdentity = getBooleanFlag(args, REPOSITORY_OVERRIDE_FLAG);
  if (!currentIdentity.ok && !overrideRepositoryIdentity) {
    reportRepositoryIdentityFailure(currentIdentity, context.io);
    return 1;
  }

  let ready = await context.transport.listResultReady();
  const positional = args.positionals[1];
  const kind = resolveKindFlag(args);
  if (!positional) {
    if (kind !== null) {
      ready = ready.filter((status) => status.kind === kind);
    }
    if (currentIdentity.ok && !overrideRepositoryIdentity) {
      const matching: RequestStatus[] = [];
      for (const status of ready) {
        const candidate = await context.transport.readRequest(status.requestId);
        if (candidate?.repository.fullName === currentIdentity.fullName) {
          matching.push(status);
        }
      }
      ready = matching;
    }
  }
  let requestId: string | null = null;
  if (positional) {
    const status = await context.transport.getRequestStatus(positional).catch(() => null);
    if (!status || status.state !== 'result-ready') {
      context.io.err(`result-ready 요청이 아닙니다: ${positional}`);
      return 1;
    }
    requestId = positional;
  } else if (getBooleanFlag(args, 'latest')) {
    requestId = ready[0]?.requestId ?? null;
  } else if (ready.length === 1) {
    requestId = ready[0]!.requestId;
  } else if (ready.length > 1) {
    printStatuses(ready, context.io);
    context.io.err('result-ready 요청이 여러 개입니다. requestId 또는 --latest를 지정하세요.');
    return 1;
  }
  if (!requestId) {
    context.io.err('result-ready mailbox 요청이 없습니다. 웹 리뷰 결과 업로드를 확인하세요.');
    return 1;
  }

  const [request, manifest] = await Promise.all([
    context.transport.readRequest(requestId),
    context.transport.getResultManifest(requestId),
  ]);
  if (!request || !manifest) {
    context.io.err(`mailbox request/result manifest를 읽을 수 없습니다: ${requestId}`);
    return 1;
  }
  if (manifest.repositoryFullName !== request.repository.fullName) {
    context.io.err(
      `request/result 저장소 정체성 불일치: request=${request.repository.fullName}, manifest=${manifest.repositoryFullName}`,
    );
    return 1;
  }
  const repositoryBinding = bindRepositoryIdentity({
    current: currentIdentity,
    requestRepositoryFullName: request.repository.fullName,
    override: overrideRepositoryIdentity,
    io: context.io,
  });
  if (!repositoryBinding) {
    return 1;
  }
  if (kind !== null && request.kind !== kind) {
    context.io.err(`요청 kind ${request.kind}가 --kind ${kind}와 일치하지 않습니다.`);
    return 1;
  }
  const acknowledgedValidations: string[] = [];
  if (request.origin === 'web') {
    let localHead: string | null = null;
    let headFailure: string | null = null;
    try {
      localHead = await gitHead(context.git);
    } catch (error) {
      headFailure = error instanceof Error ? error.message : String(error);
    }
    if (localHead !== manifest.reviewedHeadSha) {
      context.io.err([
        'web-origin HEAD 불일치 경고:',
        `local=${localHead ?? `unavailable (${headFailure ?? 'unknown'})`}`,
        `reviewed=${manifest.reviewedHeadSha}`,
      ].join(' '));
      let accepted = getBooleanFlag(args, 'accept-head-mismatch');
      if (!accepted && context.stdin.isTTY) {
        accepted = await context.io.confirm('HEAD 불일치를 승인하고 결과를 설치할까요?');
      }
      if (!accepted) {
        context.io.err('설치를 중단했습니다. 비대화 환경에서는 --accept-head-mismatch가 필요합니다.');
        return 1;
      }
      acknowledgedValidations.push('local-head-mismatch-acknowledged');
    }
  }
  const files = await Promise.all(manifest.files.map(async (file) => ({
    path: file.path,
    content: await context.transport.getResultFile(requestId, file.path),
  })));
  const importContext = {
    repoRoot: context.repoRoot,
    request,
    resultManifest: manifest,
    expectedRepositoryFullName: repositoryBinding.expectedRepositoryFullName,
    currentRepositoryFullName: repositoryBinding.currentRepositoryFullName,
    requestRepositoryFullName: repositoryBinding.requestRepositoryFullName,
    repositoryIdentityOverride: repositoryBinding.repositoryIdentityOverride,
    unboundAcceptance: null,
    transport: context.transportName,
    now: context.now,
    ...(acknowledgedValidations.length === 0 ? {} : { acknowledgedValidations }),
    ...(context.config.resultRoot === 'docs/plans'
      ? {}
      : { installRoot: path.join(context.repoRoot, context.config.resultRoot) }),
    ...(getBooleanFlag(args, 'approve-revision') ? { approveRevision: true } : {}),
  };
  const outcome = await importReviewResult(
    { kind: 'files', requestId, folder: manifest.proposedFolder, files },
    importContext,
  );
  if (outcome.status === 'installed') {
    context.io.out(`설치 완료: ${outcome.installedPath}`);
    context.io.out(`nextAction: ${outcome.nextAction}`);
    if (outcome.skippedValidations.length > 0) {
      context.io.out(`skippedValidations: ${outcome.skippedValidations.join(', ')}`);
    }
    context.io.out('구현은 자동 시작하지 않습니다. 다음 goal 투입 여부를 사용자가 결정하세요.');
    await acknowledgeAfterInstall({
      transport: context.transport,
      requestId,
      folder: outcome.folder,
      installedPath: outcome.installedPath,
      resultFilesSha256: outcome.resultFilesSha256,
      repositoryFullName: request.repository.fullName,
      resultManifestSha256: manifest.payloadSha256,
      now: context.now,
      io: context.io,
    });
    return 0;
  }
  if (outcome.status === 'no-op') {
    context.io.out('동일한 결과 패키지가 이미 설치되어 변경이 없습니다.');
    if (outcome.legacyRepositoryIdentity === true) {
      warnLegacyNoOp(context.io);
    }
    const currentResultFilesSha256 = await context.transport.getCurrentResultFilesSha256?.(requestId)
      ?? null;
    const installedResultFilesSha256 = outcome.resultFilesSha256;
    const installedRepositoryFullName = outcome.repositoryFullName;
    const installedPath = outcome.installedPath;
    if (
      currentResultFilesSha256 === null
      || installedResultFilesSha256 === undefined
      || installedPath === undefined
      || installedResultFilesSha256 !== currentResultFilesSha256
      || installedRepositoryFullName !== request.repository.fullName
    ) {
      context.io.err([
        '설치 provenance가 mailbox 현재 결과와 일치하지 않아 ack하지 않았습니다.',
        `installedSha=${installedResultFilesSha256 ?? 'unavailable'}`,
        `currentSha=${currentResultFilesSha256 ?? 'unavailable'}`,
        `installedRepository=${installedRepositoryFullName ?? 'unbound'}`,
      ].join(' '));
      return 1;
    }
    const acknowledged = await acknowledgeAfterInstall({
      transport: context.transport,
      requestId,
      folder: outcome.folder,
      installedPath,
      resultFilesSha256: installedResultFilesSha256,
      repositoryFullName: request.repository.fullName,
      resultManifestSha256: manifest.payloadSha256,
      now: context.now,
      io: context.io,
    });
    if (!acknowledged) {
      return 1;
    }
    context.io.out(
      `복구 수렴: result-ready → provenance 검증(${installedResultFilesSha256}) → imported`,
    );
    if (getBooleanFlag(args, 'latest')) {
      const remaining = (await context.transport.listResultReady()).filter(
        (candidate) => candidate.requestId !== requestId,
      );
      if (remaining.length > 0) {
        context.io.out(`남은 result-ready 요청 ${remaining.length}건 — 다음 sync를 실행하세요.`);
      }
    }
    return 0;
  }
  context.io.err(
    outcome.status === 'refused'
      ? `결과 반입 refused: ${outcome.message}`
      : `결과 반입 invalid: ${outcome.errors.map((error) => error.message).join('; ')}`,
  );
  return 1;
}

async function runSync(
  args: ReturnType<typeof parseArgs>,
  context: {
    repoRoot: string;
    config: ProBridgeConfig;
    io: ProBridgeIo;
    transport: BridgeCliTransport;
    transportName: SupportedTransportName;
    clipboard: NonNullable<ProBridgeDeps['clipboard']>;
    git: GitPort;
    stdin: NonNullable<ProBridgeDeps['stdin']>;
    now: () => Date;
  },
): Promise<number> {
  if (context.transportName !== 'mcp-mailbox' && getBooleanFlag(args, 'latest')) {
    context.io.err('--latest는 mcp-mailbox transport 전용입니다. .vibe/config.local.json에서 proBridge.transport를 설정하거나 --from/클립보드 sync를 사용하세요.');
    return 1;
  }
  if (getStringFlag(args, 'from') || context.transportName === 'manual') {
    return runBundleSync(args, context);
  }
  return runMailboxSync(args, {
    ...context,
    transport: context.transport as BridgeCliTransport & {
      listResultReady(): Promise<RequestStatus[]>;
    },
  });
}

async function runApply(
  args: ReturnType<typeof parseArgs>,
  context: {
    repoRoot: string;
    config: ProBridgeConfig;
    io: ProBridgeIo;
    codexExec: NonNullable<ProBridgeDeps['codexExec']>;
  },
): Promise<number> {
  const folder = args.positionals[1];
  if (!folder || !FOLDER_NAME_PATTERN.test(folder)) {
    context.io.err('usage: vibe-pro-bridge apply <folder>');
    return 1;
  }
  const promptPath = path.join(
    context.repoRoot,
    context.config.resultRoot,
    folder,
    'prompt',
    'CLI_MAIN_SESSION_PROMPT.md',
  );
  let prompt: string;
  try {
    prompt = await readFile(promptPath, 'utf8');
  } catch {
    context.io.err(`설치된 구현 프롬프트를 찾을 수 없습니다: ${promptPath}`);
    return 1;
  }
  const envId = context.config.apply.envId?.trim() ?? '';
  if (envId.length === 0) {
    context.io.out('codex cloud 환경 id가 설정되지 않았습니다. codex cloud의 환경 목록에서 envId를 확인하세요.');
    context.io.out('.vibe/config.local.json에 proBridge.apply.envId를 설정한 뒤 다시 실행하세요.');
    return 0;
  }
  const result = await context.codexExec.run(['cloud', 'exec', '--env', envId], prompt);
  if (result.stdout.length > 0) {
    context.io.out(result.stdout);
  }
  if (result.stderr.length > 0) {
    context.io.err(result.stderr);
  }
  context.io.out('다음: codex cloud status / codex cloud diff 로 확인하세요 — 자동 merge/apply는 하지 않습니다.');
  return result.code ?? 1;
}

function resolveTunnelKind(value: string): TunnelKind {
  if (value === 'cloudflared' || value === 'ngrok' || value === 'none') {
    return value;
  }
  throw new Error(`Unsupported tunnel kind "${value}". Expected cloudflared, ngrok, or none.`);
}

function resolvePort(value: string | undefined, fallback: number): number {
  const port = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid MCP port: ${value ?? fallback}`);
  }
  return port;
}

function waitForShutdownSignal(): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      process.off('SIGINT', finish);
      process.off('SIGTERM', finish);
      resolve();
    };
    process.once('SIGINT', finish);
    process.once('SIGTERM', finish);
  });
}

async function runMcpServer(
  args: ReturnType<typeof parseArgs>,
  context: {
    repoRoot: string;
    config: ProBridgeConfig;
    io: ProBridgeIo;
    deps: ProBridgeDeps;
    now: () => Date;
  },
): Promise<number> {
  const port = resolvePort(getStringFlag(args, 'port'), context.config.mcp.port);
  const tunnelKind = resolveTunnelKind(
    getStringFlag(args, 'tunnel') ?? context.config.mcp.tunnel,
  );
  const token = context.deps.randomToken?.() ?? randomBytes(32).toString('base64url');
  const mailbox = new McpMailboxTransport({ repoRoot: context.repoRoot, now: context.now });
  let server: Awaited<ReturnType<typeof startMcpServer>>;
  try {
    server = await (context.deps.mcpServer?.start ?? startMcpServer)({
      tools: createMailboxTools(mailbox.store, {
        now: context.now,
        requestTtlHours: context.config.requestTtlHours,
      }),
      token,
      port,
      log: (line) => context.io.out(`[mcp] ${line}`),
    });
  } catch (error) {
    const code = errorCode(error);
    if (code === 'EACCES' || code === 'EADDRINUSE') {
      context.io.err(`MCP port ${port} listen 실패 (${code}).`);
      context.io.err('Windows WinNAT excluded port range 충돌 가능 (실측 예: 8827–8926) — netsh interface ipv4 show excludedportrange protocol=tcp 로 확인하세요.');
      context.io.err('--port <n> 또는 .vibe/config.local.json의 proBridge.mcp.port로 오버라이드하세요.');
      return 1;
    }
    throw error;
  }
  let tunnelHandle: Awaited<ReturnType<typeof startTunnel>> | null = null;
  try {
    tunnelHandle = await (context.deps.tunnel?.start ?? startTunnel)(tunnelKind, server.port);
    if (tunnelKind !== 'none' && tunnelHandle.publicUrl === null) {
      context.io.err(`터널 URL을 만들지 못해 로컬 URL로 계속합니다: ${tunnelHandle.reason ?? 'binary unavailable'}`);
    }
    const baseUrl = tunnelHandle.publicUrl ?? server.url;
    context.io.out(`local URL: ${server.url}`);
    if (tunnelHandle.publicUrl) {
      context.io.out(`public URL: ${tunnelHandle.publicUrl}`);
    }
    context.io.out(`connector URL: ${baseUrl}/mcp?token=${encodeURIComponent(token)}`);
    context.io.out('이 URL에는 토큰이 포함됩니다 — 세션 밖에 저장·공유하지 마세요. 서버 재시작 시 토큰이 재발급됩니다.');
    context.io.out('Developer Mode 등록: docs/context/pro-bridge-setup.md 를 참조하세요.');
    context.io.out('종료: Ctrl+C');
    await (context.deps.waitForShutdown ?? waitForShutdownSignal)();
  } finally {
    await tunnelHandle?.stop();
    await server.close();
  }
  return 0;
}

export async function runProBridge(argv: string[], deps: ProBridgeDeps = {}): Promise<number> {
  const repoRoot = path.resolve(deps.repoRoot ?? process.cwd());
  const now = deps.now ?? (() => new Date());
  const io = deps.io ?? createDefaultIo();
  const config = await resolveConfig(deps);
  const args = parseArgs(argv);
  let command = args.positionals[0] ?? '';
  const clipboard = deps.clipboard ?? {
    copyFile: copyFileToClipboard,
    readText: readClipboardText,
  };
  const browser = deps.browser ?? { open: openInBrowser };
  const stdin = deps.stdin ?? { isTTY: process.stdin.isTTY === true };

  let transportName: SupportedTransportName;
  try {
    transportName = resolveTransportName({
      cliOption: getStringFlag(args, 'transport'),
      configTransport: config.transport,
    });
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return 1;
  }
  let transport: BridgeCliTransport;
  try {
    if (transportName === 'workspace-agent') {
      if (!config.workspaceAgent.enabled || config.workspaceAgent.triggerCommand.length === 0) {
        io.err('workspace-agent transport는 proBridge.workspaceAgent.enabled=true와 비어 있지 않은 triggerCommand가 필요합니다.');
        return 1;
      }
      transport = new WorkspaceAgentTransport({
        repoRoot,
        now,
        triggerCommand: config.workspaceAgent.triggerCommand,
        ...(deps.agentTrigger === undefined ? {} : { trigger: deps.agentTrigger }),
      });
    } else if (transportName === 'responses-api') {
      if (!config.api.enabled) {
        io.err('responses-api transport는 proBridge.api.enabled=true 명시 opt-in이 필요합니다.');
        return 1;
      }
      const apiKey = deps.env?.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
      if (!apiKey?.trim()) {
        io.err('OPENAI_API_KEY 환경변수 전용 — API key를 config에 넣지 마세요.');
        return 1;
      }
      if (config.api.model.trim().length === 0) {
        io.err('responses-api model은 config에 직접 지정하세요 (model-registry 확장 범위 밖).');
        return 1;
      }
      transport = new ResponsesApiTransport({
        repoRoot,
        now,
        apiKey,
        api: config.api,
        ports: {
          ...(deps.fetchPort === undefined ? {} : { fetch: deps.fetchPort }),
          ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
        },
      });
    } else if (transportName === 'mcp-mailbox') {
      transport = new McpMailboxTransport({ repoRoot, now });
    } else {
      transport = new ManualDirectoryTransport({ repoRoot, now });
    }
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (!command) {
    const pending = (await transport.listRequests()).filter(
      (status) => !TERMINAL_STATES.has(status.state),
    );
    if (pending.length > 0) {
      printStatuses(pending, io);
      if (transportName !== 'manual') {
        if (pending.some((status) => status.state === 'result-ready')) {
          io.out('결과 도착 — npm run vibe:pro-sync 로 설치하세요.');
        } else if (transportName === 'mcp-mailbox') {
          io.out('웹이 요청을 읽으려면 npm run vibe:pro-mcp 서버가 떠 있어야 합니다.');
        } else {
          io.out('완료 여부는 npm run vibe:pro-status의 mailbox 상태로 확인하세요.');
        }
      } else {
        io.out('Manual transport는 원격 result-ready를 자동 감지하지 않습니다. 결과가 준비되면 npm run vibe:pro-sync 를 실행하세요.');
      }
      return 0;
    }
    command = 'audit';
  }

  if (!config.enabled && command !== 'status' && command !== 'list') {
    io.err('Pro Bridge가 꺼져 있습니다. .vibe/config.json 또는 config.local.json에 proBridge.enabled: true를 설정하세요.');
    return 1;
  }

  if (command === 'status' || command === 'list') {
    try {
      const kind = resolveKindFlag(args);
      const statuses = await transport.listRequests();
      printStatuses(
        kind === null ? statuses : statuses.filter((status) => status.kind === kind),
        io,
      );
    } catch (error) {
      io.err(error instanceof Error ? error.message : String(error));
      return 1;
    }
    if (transportName === 'mcp-mailbox' && transport.inspectMailboxHealth) {
      try {
        const health = await transport.inspectMailboxHealth();
        io.out(`mailbox health: ${health.state}`);
        for (const entry of health.entries) {
          if (
            entry.problem !== 'recovery-pending'
            && (
              health.state === 'quarantined-corrupt-entry'
              || health.state === 'migration-required'
            )
          ) {
            io.out(`  ${entry.requestId}: ${entry.problem} — ${entry.detail}`);
          }
        }
      } catch (error) {
        io.err(`경고: mailbox health 조회 실패: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return 0;
  }
  if (command === 'cancel') {
    const requestId = args.positionals[1];
    if (!requestId) {
      io.err('usage: vibe-pro-bridge cancel <requestId>');
      return 1;
    }
    try {
      await transport.cancelRequest(requestId);
      io.out(`요청 취소: ${requestId}`);
      return 0;
    } catch (error) {
      io.err(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }
  if (command === 'sync') {
    try {
      return await runSync(args, {
        repoRoot,
        config,
        io,
        transport,
        transportName,
        clipboard,
        git: createGit(repoRoot, deps.git),
        stdin,
        now,
      });
    } catch (error) {
      io.err(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }
  if (command === 'apply') {
    return runApply(args, {
      repoRoot,
      config,
      io,
      codexExec: deps.codexExec ?? createDefaultCodexExec(repoRoot),
    });
  }
  if (command === 'mcp') {
    try {
      return await runMcpServer(args, { repoRoot, config, io, deps, now });
    } catch (error) {
      io.err(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }

  if (command !== 'audit' && command !== 'design') {
    io.err('usage: vibe-pro-bridge [audit|design|status|sync|cancel|list|mcp|apply]');
    return 1;
  }

  const git = createGit(repoRoot, deps.git);
  try {
    let composed: { request: ReviewRequest; scope: unknown };
    if (command === 'audit') {
      const resolver = (deps.goalResolver ?? resolveGoalSource) as unknown as (
        context: { repoRoot: string; git: GitPort; now: () => Date },
      ) => Promise<unknown>;
      const resolution = await resolver({ repoRoot, git, now });
      const selected = nested(resolution, 'selected');
      if (!selected) {
        const candidates = arrayAt(resolution, 'candidates');
        const diagnostics = arrayAt(resolution, 'diagnostics');
        io.err(`일관된 goal을 찾지 못해 발행을 보류했습니다. 후보 ${candidates.length}건, diagnostics ${diagnostics.length}건을 확인하세요.`);
        return 1;
      }
      if (stringAt(selected, 'source', 'confidence') === 'reconstructed') {
        io.out('복원된 goal confidence입니다. 원문 goal보다 불확실할 수 있습니다.');
        if (
          !getBooleanFlag(args, 'allow-reconstructed')
          && !(await io.confirm('복원된 goal로 외부 발행을 계속할까요?'))
        ) {
          io.out('외부 발행을 보류했습니다.');
          return 1;
        }
      }
      const baseSha = getStringFlag(args, 'base') ?? stringAt(selected, 'baseSha');
      const headSha = stringAt(selected, 'headSha');
      const userGoal = stringAt(selected, 'source', 'goalText');
      if (!baseSha || !headSha || !userGoal) {
        io.err('선택된 goal manifest에 base/head/goal text가 없어 발행을 보류했습니다.');
        return 1;
      }
      composed = await resolveScopeAndCompose({
        kind: 'goal_audit',
        userGoal,
        goalSource: selected,
        baseSha,
        headSha,
      }, { repoRoot, git, now, config });
    } else {
      const goal = args.positionals.slice(1).join(' ').trim();
      if (!goal) {
        io.err('usage: npm run vibe:pro-design -- "<goal>"');
        return 1;
      }
      const headSha = await gitHead(git);
      composed = await resolveScopeAndCompose({
        kind: 'feature_design',
        userGoal: goal,
        goalSource: null,
        baseSha: headSha,
        headSha,
      }, { repoRoot, git, now, config });
    }

    return createAndPublish(composed.request, composed.scope, {
      yes: getBooleanFlag(args, 'yes'),
      config,
      io,
      transport,
      transportName,
      clipboard,
      browser,
      stdin,
    });
  } catch (error) {
    const blocked = scopeBlockedMessage(scopeReasons(error));
    io.err(blocked ?? (error instanceof Error ? error.message : String(error)));
    return 1;
  }
}

runMain(async () => {
  process.exitCode = await runProBridge(process.argv.slice(2));
}, import.meta.url);
