export declare function validateBoundedRelativePath(
  path: string,
  maxLength: number,
  messagePrefix: string,
): void;

/**
 * The r04 one-copy helper: bounded single-descriptor copy with a caller-declared exact
 * size, returning a private buffer. No hashing, no location claim; the caller verifies
 * the stage against its own signed expectations.
 */
export declare function copyBoundedFileOnce(input: {
  rootAbsolute: string;
  relativePath: string;
  expectedByteSize: number;
  maxByteSize: number;
  maxRelativePathLength: number;
  messagePrefix: string;
  label: string;
}): Promise<Buffer>;

/**
 * Trusted-local bounded single read; size from the held descriptor under the caller's
 * fixed maximum. No external-boundary claim.
 */
export declare function readBoundedFileOnce(input: {
  rootAbsolute: string;
  relativePath: string;
  maxByteSize: number;
  maxRelativePathLength: number;
  messagePrefix: string;
  label: string;
}): Promise<Buffer>;
