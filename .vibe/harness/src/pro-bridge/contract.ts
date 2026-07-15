import { createHash } from 'node:crypto';
import type { ReviewResultKind } from '../lib/schemas/pro-bridge.js';

export * from '../lib/schemas/pro-bridge.js';

export const REQUEST_LIFECYCLE_STATES = [
  'draft',
  'ready',
  'claimed',
  'reviewing',
  'result-uploading',
  'result-ready',
  'imported',
  'cancelled',
  'expired',
  'failed',
] as const;

export type RequestLifecycleState = (typeof REQUEST_LIFECYCLE_STATES)[number];

const FAILURE_STATES = ['cancelled', 'expired', 'failed'] as const;

export const REQUEST_LIFECYCLE_TRANSITIONS: Record<
  RequestLifecycleState,
  readonly RequestLifecycleState[]
> = {
  draft: ['ready', ...FAILURE_STATES],
  ready: ['claimed', ...FAILURE_STATES],
  claimed: ['reviewing', ...FAILURE_STATES],
  reviewing: ['result-uploading', ...FAILURE_STATES],
  'result-uploading': ['result-ready', ...FAILURE_STATES],
  'result-ready': ['imported', ...FAILURE_STATES],
  imported: [],
  cancelled: [],
  expired: [],
  failed: [],
};

export function canTransition(from: RequestLifecycleState, to: RequestLifecycleState): boolean {
  return REQUEST_LIFECYCLE_TRANSITIONS[from].includes(to);
}

export const REQUIRED_RESULT_FILES = {
  audit: ['README.md', 'REVIEW.md', 'FINDINGS.json', 'prompt/CLI_MAIN_SESSION_PROMPT.md'],
  design: ['README.md', 'DESIGN.md', 'FINDINGS.json', 'prompt/CLI_MAIN_SESSION_PROMPT.md'],
} as const satisfies Record<ReviewResultKind, readonly string[]>;

function stableStringify(value: unknown, seen: WeakSet<object>): string | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') {
    throw new TypeError('Payload must be JSON serializable');
  }
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    return undefined;
  }

  if (seen.has(value)) {
    throw new TypeError('Payload must not contain circular references');
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => stableStringify(entry, seen) ?? 'null').join(',')}]`;
    }
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .flatMap((key) => {
        const serialized = stableStringify((value as Record<string, unknown>)[key], seen);
        return serialized === undefined ? [] : [`${JSON.stringify(key)}:${serialized}`];
      });
    return `{${entries.join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

export function computePayloadSha256(value: unknown): string {
  let hashInput = value;
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const { payloadSha256: _excluded, ...rest } = value as Record<string, unknown>;
    hashInput = rest;
  }

  const serialized = stableStringify(hashInput, new WeakSet());
  if (serialized === undefined) {
    throw new TypeError('Payload must be JSON serializable');
  }
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}
