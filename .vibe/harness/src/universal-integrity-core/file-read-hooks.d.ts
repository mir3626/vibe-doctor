/** TEST-ONLY mutable hook container; the production reader only reads it. */
export declare const boundedFileReadTestHooks: {
  beforeFinalLstat: ((absolute: string) => Promise<void>) | null;
  beforeOpen: ((absolute: string) => Promise<void>) | null;
  afterOpen: ((absolute: string) => Promise<void>) | null;
};

/** TEST-ONLY open/close counters (open count must equal close count on every path). */
export declare const boundedFileReadCounters: { opens: number; closes: number };

/** TEST-ONLY: refuses to arm outside a test runner. */
export declare function setBoundedFileReadTestHooks(hooks: {
  beforeFinalLstat?: ((absolute: string) => Promise<void>) | null;
  beforeOpen?: ((absolute: string) => Promise<void>) | null;
  afterOpen?: ((absolute: string) => Promise<void>) | null;
}): void;

/** TEST-ONLY: reset the open/close counters and return the container. */
export declare function resetBoundedFileReadCounters(): { opens: number; closes: number };
