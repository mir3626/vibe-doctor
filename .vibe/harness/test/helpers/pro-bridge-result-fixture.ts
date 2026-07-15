import type {
  ReviewResultKind,
  ReviewResultManifest,
} from '../../src/pro-bridge/contract.js';
import type { VibeBundle } from '../../src/pro-bridge/vibe-bundle.js';

const DEFAULT_BASE_SHA = 'a'.repeat(40);
const DEFAULT_HEAD_SHA = 'b'.repeat(40);

export type FixtureSeverity = 'P0' | 'P1' | 'P2' | 'P3';

export interface FixtureFinding<Severity extends FixtureSeverity = FixtureSeverity> {
  id: string;
  severity: Severity;
  title: string;
}

export interface CompliantResultBundleOptions {
  requestId: string;
  folder: string;
  repositoryFullName: string;
  baseSha?: string;
  headSha?: string;
  resultKind?: ReviewResultKind;
  disposition?: string;
  title?: string;
  readmeContent?: string;
  primaryContent?: string;
  findings?: {
    [Severity in FixtureSeverity]?: readonly FixtureFinding<Severity>[];
  };
}

export interface CompliantResultBundleFixture {
  bundle: VibeBundle;
  findingsSummary: ReviewResultManifest['findingsSummary'];
  reviewerDeclaration: ReviewResultManifest['reviewerDeclaration'];
}

export function buildCompliantResultBundle(
  options: CompliantResultBundleOptions,
): CompliantResultBundleFixture {
  const baseSha = options.baseSha ?? DEFAULT_BASE_SHA;
  const headSha = options.headSha ?? DEFAULT_HEAD_SHA;
  const resultKind = options.resultKind ?? 'audit';
  const primaryPath = resultKind === 'audit' ? 'REVIEW.md' : 'DESIGN.md';
  const title = options.title ?? 'Contract-compliant review result';
  const P0 = (options.findings?.P0 ?? []).map((finding) => ({ ...finding, severity: 'P0' as const }));
  const P1 = (options.findings?.P1 ?? []).map((finding) => ({ ...finding, severity: 'P1' as const }));
  const P2 = (options.findings?.P2 ?? []).map((finding) => ({ ...finding, severity: 'P2' as const }));
  const P3 = (options.findings?.P3 ?? []).map((finding) => ({ ...finding, severity: 'P3' as const }));
  const findingsSummary = {
    p0: P0.length,
    p1: P1.length,
    p2: P2.length,
    p3: P3.length,
  } satisfies ReviewResultManifest['findingsSummary'];
  const reviewerDeclaration = {
    surface: 'chatgpt-web',
    requestedMode: 'pro',
    githubConnectorUsed: true,
    limitations: [],
  } satisfies ReviewResultManifest['reviewerDeclaration'];
  const findings = {
    schemaVersion: 'vibe-goal-audit-findings-v1',
    requestId: options.requestId,
    repository: { fullName: options.repositoryFullName },
    snapshot: { baseSha, headSha },
    disposition: options.disposition ?? 'approved',
    summary: {
      P0: P0.length,
      P1: P1.length,
      P2: P2.length,
      P3: P3.length,
    },
    reviewerDeclaration,
    P0,
    P1,
    P2,
    P3,
  };
  const prompt = [
    '# Reviewed repository identity',
    `Repository identity: ${options.repositoryFullName}`,
    '## Reviewed SHA',
    `Reviewed HEAD: ${headSha}`,
    '## Mandatory reading',
    `Read ${primaryPath} before implementation.`,
    '## Implementation order',
    'Apply the approved work in dependency order.',
    '## Immutable boundaries',
    'Preserve repository, request, and reviewed-SHA invariants.',
    '## Prohibited operations',
    'Do not push or weaken validation.',
    '## Exact verification commands',
    'Run npm run vibe:typecheck.',
    '## Stop conditions',
    'Stop and report on any mismatch.',
    '## Final report requirements',
    'Report changed files, verification evidence, and residual limitations.',
    '',
  ].join('\n');

  return {
    bundle: {
      requestId: options.requestId,
      folder: options.folder,
      files: [
        { path: 'README.md', content: options.readmeContent ?? `# ${title}\n` },
        {
          path: primaryPath,
          content: options.primaryContent ?? `# ${resultKind === 'audit' ? 'Review' : 'Design'}\n\n${title}.\n`,
        },
        { path: 'FINDINGS.json', content: `${JSON.stringify(findings, null, 2)}\n` },
        { path: 'prompt/CLI_MAIN_SESSION_PROMPT.md', content: prompt },
      ],
    },
    findingsSummary,
    reviewerDeclaration,
  };
}
