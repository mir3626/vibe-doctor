// Universal integrity core — safe stable failures (design 0100 §8.5).
//
// An IntegrityFailure is an ordinary Error carrying an additive, machine-stable code and
// safe metadata. Existing lane error MESSAGES remain the compatibility surface: a lane
// wrapper passes its frozen legacy text as `safeMessage`, so callers and tests observe
// byte-identical messages while gaining a stable `code`. Raw payloads, keys, signatures,
// SQL, environment values, or unbounded paths must never be placed in these fields.

export class IntegrityFailure extends Error {
  /**
   * @param {{
   *   code: string,
   *   safeMessage: string,
   *   operation?: string | undefined,
   *   subjectKind?: string | undefined,
   *   subjectHashOrId?: string | undefined,
   *   cause?: unknown,
   * }} input
   */
  constructor(input) {
    super(input.safeMessage, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = 'IntegrityFailure';
    this.code = input.code;
    this.safeMessage = input.safeMessage;
    this.operation = input.operation;
    this.subjectKind = input.subjectKind;
    this.subjectHashOrId = input.subjectHashOrId;
  }
}

/**
 * @param {string} code
 * @param {string} safeMessage
 * @param {{ operation?: string, subjectKind?: string, subjectHashOrId?: string, cause?: unknown }} [details]
 * @returns {IntegrityFailure}
 */
export function integrityFailure(code, safeMessage, details = {}) {
  return new IntegrityFailure({ code, safeMessage, ...details });
}
