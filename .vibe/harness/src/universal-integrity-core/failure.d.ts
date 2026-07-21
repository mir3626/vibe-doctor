export declare class IntegrityFailure extends Error {
  readonly code: string;
  readonly safeMessage: string;
  readonly operation: string | undefined;
  readonly subjectKind: string | undefined;
  readonly subjectHashOrId: string | undefined;
  constructor(input: {
    code: string;
    safeMessage: string;
    operation?: string | undefined;
    subjectKind?: string | undefined;
    subjectHashOrId?: string | undefined;
    cause?: unknown;
  });
}

export declare function integrityFailure(
  code: string,
  safeMessage: string,
  details?: {
    operation?: string;
    subjectKind?: string;
    subjectHashOrId?: string;
    cause?: unknown;
  },
): IntegrityFailure;
