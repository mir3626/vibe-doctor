// Universal integrity core — bounded one-copy source reads (design 2200--pro--design--r04).
//
// r04 TRUST MODEL (supersedes the r02/r07/r08 filesystem-location-proof lineage): an
// absolute path proves NOTHING about a file's ancestry or source location, and this
// module claims nothing about it. Untrusted paths are transport inputs. Callers that
// need byte authenticity copy the bytes ONCE into a private process-owned stage and
// verify the STAGED bytes against their own signed expectations (exact hashes, canonical
// identities, Ed25519 envelopes). A path race therefore yields either byte-identical
// content or a staged hash/signature failure — never a location-proof problem.
//
// What every read here still guarantees (design r04 §4.3/§6.3):
//   - bounded relative-path grammar (lexical only; no ancestry claim);
//   - the FINAL component is opened exactly once with read-only no-follow semantics —
//     platforms that cannot enforce or prove final-component no-follow fail closed;
//   - fstat of the held descriptor: regular file within the declared/fixed bound;
//   - one single read of declared bytes plus one sentinel from that descriptor
//     (short reads and growth past the bound fail closed);
//   - the returned buffer is a PRIVATE copy; the source path is never re-read;
//   - the descriptor is closed in `finally` on every success and failure path.
//
// This production module exports NO mutable hook. Deterministic race-injection seams and
// open/close counters live in file-read-hooks.js (read-only import below) and are
// reachable only through file-read-test-seam.js; the setter refuses to arm outside a
// test runner.
import { constants as fsConstants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { boundedFileReadTestHooks as testHooks, boundedFileReadCounters as counters } from './file-read-hooks.js';

const O_NOFOLLOW = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
const noFollowEnforced = O_NOFOLLOW !== 0;
const OPEN_FLAGS = fsConstants.O_RDONLY | O_NOFOLLOW;

/**
 * Lexical bounded relative-path validation, byte-compatible with the historical downstream
 * messages via the caller's message prefix. Grammar only — no ancestry claim.
 * @param {string} path
 * @param {number} maxLength
 * @param {string} messagePrefix
 */
export function validateBoundedRelativePath(path, maxLength, messagePrefix) {
  if (typeof path !== 'string' || path.length === 0 || path.length > maxLength) {
    throw new Error(`${messagePrefix} path length is invalid`);
  }
  const segments = path.split('/');
  if (segments.some((segment) =>
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(segment) || segment === '.' || segment === '..' ||
    segment.includes('\\'))) {
    throw new Error(`${messagePrefix} path is not a bounded package-relative path`);
  }
}

/**
 * Shared single-descriptor read core: open final component once (no-follow), fstat,
 * bounded sentinel read, private copy, close in finally.
 * @param {string} subject
 * @param {string} relativePath
 * @param {string} absolute
 * @param {(size: number) => number | null} declaredSizeFor
 *   maps the fstat size to the byte count to read, or null to fail the bound.
 * @returns {Promise<Buffer>}
 */
async function readOnceFromDescriptor(subject, relativePath, absolute, declaredSizeFor) {
  if (testHooks.beforeFinalLstat !== null) await testHooks.beforeFinalLstat(absolute);
  const before = await lstat(absolute);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error(`${subject} is not a regular file: ${relativePath}`);
  }
  if (testHooks.beforeOpen !== null) await testHooks.beforeOpen(absolute);
  let handle;
  try {
    handle = await open(absolute, OPEN_FLAGS);
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    if (code === 'ELOOP' || code === 'EMLINK') {
      throw new Error(`${subject} final component is a symlink: ${relativePath}`);
    }
    throw error;
  }
  counters.opens += 1;
  try {
    const descriptorStat = await handle.stat();
    if (!descriptorStat.isFile() ||
        descriptorStat.ino !== before.ino || descriptorStat.dev !== before.dev) {
      throw new Error(`${subject} descriptor is not the checked regular file: ${relativePath}`);
    }
    // Where no-follow is not kernel-enforced, fail closed unless the descriptor is
    // provably bound to a real, non-symlink inode (the identity equality above is the
    // fallback guarantee and requires a provable identity here).
    if (!noFollowEnforced &&
        (descriptorStat.ino === undefined || descriptorStat.ino === 0 ||
         descriptorStat.nlink === undefined)) {
      throw new Error(`${subject} cannot be no-follow verified on this platform: ${relativePath}`);
    }
    const declaredSize = declaredSizeFor(descriptorStat.size);
    if (declaredSize === null) {
      throw new Error(`${subject} exceeds the fixed byte bound: ${relativePath}`);
    }
    if (descriptorStat.size !== declaredSize) {
      throw new Error(`${subject} byte size mismatch: ${relativePath}`);
    }
    if (testHooks.afterOpen !== null) await testHooks.afterOpen(absolute);
    // One read of declared bytes plus one sentinel byte FROM THE HELD DESCRIPTOR: a
    // short read or growth past the declared bound fails closed.
    const buffer = Buffer.alloc(declaredSize + 1);
    const { bytesRead } = await handle.read(buffer, 0, declaredSize + 1, 0);
    if (bytesRead !== declaredSize) {
      throw new Error(`${subject} byte size mismatch: ${relativePath}`);
    }
    return Buffer.from(buffer.subarray(0, declaredSize));
  } finally {
    counters.closes += 1;
    await handle.close().catch(() => undefined);
  }
}

/**
 * @param {string} subject
 * @param {string} rootAbsolute
 * @param {string} relativePath
 */
function resolveLexically(subject, rootAbsolute, relativePath) {
  const packageRoot = resolve(rootAbsolute);
  const absolute = resolve(packageRoot, relativePath);
  if (absolute === packageRoot || !absolute.startsWith(`${packageRoot}${sep}`)) {
    throw new Error(`${subject} path escapes the package root`);
  }
  return absolute;
}

/**
 * The r04 §6.3 ONE-COPY helper: bounded single-descriptor copy of a source file with a
 * caller-declared exact size, returning a PRIVATE buffer. It does not hash, parse, log,
 * persist, or expose content, and it makes NO claim about the source location — the
 * caller must verify the returned stage against its own signed expectations.
 * @param {{
 *   rootAbsolute: string,
 *   relativePath: string,
 *   expectedByteSize: number,
 *   maxByteSize: number,
 *   maxRelativePathLength: number,
 *   messagePrefix: string,
 *   label: string,
 * }} input
 * @returns {Promise<Buffer>}
 */
export async function copyBoundedFileOnce(input) {
  const { relativePath, expectedByteSize, label } = input;
  const subject = `${input.messagePrefix} ${label}`;
  validateBoundedRelativePath(relativePath, input.maxRelativePathLength, input.messagePrefix);
  if (!Number.isSafeInteger(input.maxByteSize) || input.maxByteSize <= 0) {
    throw new Error(`${subject} maximum byte size is invalid`);
  }
  if (!Number.isSafeInteger(expectedByteSize) || expectedByteSize < 0 ||
      expectedByteSize > input.maxByteSize) {
    throw new Error(`${subject} expected byte size is outside the fixed bound`);
  }
  const absolute = resolveLexically(subject, input.rootAbsolute, relativePath);
  return readOnceFromDescriptor(subject, relativePath, absolute, () => expectedByteSize);
}

/**
 * Trusted-local bounded single read (design r04 §4.3): for process-owned local files
 * whose security-critical identity was established BEFORE they were written (e.g. packet
 * bytes admitted from a pinned Git object). Size comes from the held descriptor under
 * the caller's fixed maximum. No external-boundary claim is made.
 * @param {{
 *   rootAbsolute: string,
 *   relativePath: string,
 *   maxByteSize: number,
 *   maxRelativePathLength: number,
 *   messagePrefix: string,
 *   label: string,
 * }} input
 * @returns {Promise<Buffer>}
 */
export async function readBoundedFileOnce(input) {
  const { relativePath, label } = input;
  const subject = `${input.messagePrefix} ${label}`;
  validateBoundedRelativePath(relativePath, input.maxRelativePathLength, input.messagePrefix);
  if (!Number.isSafeInteger(input.maxByteSize) || input.maxByteSize <= 0) {
    throw new Error(`${subject} maximum byte size is invalid`);
  }
  const absolute = resolveLexically(subject, input.rootAbsolute, relativePath);
  return readOnceFromDescriptor(subject, relativePath, absolute, (size) =>
    (Number.isSafeInteger(size) && size <= input.maxByteSize ? size : null));
}
