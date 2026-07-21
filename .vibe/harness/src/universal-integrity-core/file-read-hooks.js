// TEST-ONLY mutable hook container and open/close counters for the bounded one-copy
// reader (design 2200--pro--design--r04 §7).
//
// This module exists so that file-read.js — the PRODUCTION reader — exports no mutable
// hook surface at all. The reader imports the frozen containers below; the setter and
// counter reset live here, refuse to arm outside a test runner, and are reachable only
// through file-read-test-seam.js (never through the #universal-integrity-core alias or
// any production barrel). The counters let tests assert that every opened descriptor is
// closed on every success and failure path (open count === close count).

/**
 * @type {{
 *   beforeFinalLstat: ((absolute: string) => Promise<void>) | null,
 *   beforeOpen: ((absolute: string) => Promise<void>) | null,
 *   afterOpen: ((absolute: string) => Promise<void>) | null,
 * }}
 */
export const boundedFileReadTestHooks = {
  beforeFinalLstat: null,
  beforeOpen: null,
  afterOpen: null,
};

/** @type {{ opens: number, closes: number }} */
export const boundedFileReadCounters = { opens: 0, closes: 0 };

/**
 * TEST-ONLY: deterministic race injection points.
 * @param {{
 *   beforeFinalLstat?: ((absolute: string) => Promise<void>) | null,
 *   beforeOpen?: ((absolute: string) => Promise<void>) | null,
 *   afterOpen?: ((absolute: string) => Promise<void>) | null,
 * }} hooks
 */
export function setBoundedFileReadTestHooks(hooks) {
  if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
    throw new Error('bounded file-read test hooks are test-only');
  }
  boundedFileReadTestHooks.beforeFinalLstat = hooks.beforeFinalLstat ?? null;
  boundedFileReadTestHooks.beforeOpen = hooks.beforeOpen ?? null;
  boundedFileReadTestHooks.afterOpen = hooks.afterOpen ?? null;
}

/** TEST-ONLY: reset the open/close counters and return the container. */
export function resetBoundedFileReadCounters() {
  if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
    throw new Error('bounded file-read counters are test-only');
  }
  boundedFileReadCounters.opens = 0;
  boundedFileReadCounters.closes = 0;
  return boundedFileReadCounters;
}
