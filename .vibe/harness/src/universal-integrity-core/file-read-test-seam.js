// TEST-ONLY seam for deterministic race injection and open/close counter access in the
// bounded one-copy reader (design 2200--pro--design--r04 §7). Deliberately NOT exported
// through #universal-integrity-core: tests import this file by path. The setters refuse
// to arm outside a test runner, so no production module or barrel carries a mutable
// hook surface.
export {
  setBoundedFileReadTestHooks,
  resetBoundedFileReadCounters,
  boundedFileReadCounters,
} from './file-read-hooks.js';
