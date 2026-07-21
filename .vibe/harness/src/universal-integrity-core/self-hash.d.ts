import type { HashProfile } from './hash.js';
import type { ShapePolicy } from './shape.js';

export declare function stripField(
  value: Record<string, unknown>,
  field: string,
): Record<string, unknown>;

export declare function appendSelfHash(
  unsigned: Record<string, unknown>,
  hashField: string,
  profile: HashProfile,
): Record<string, unknown>;

export declare function assertSelfHash(input: {
  value: unknown;
  hashField: string;
  profile: HashProfile;
  projectUnsigned: (value: Record<string, unknown>) => unknown;
  roster: readonly string[];
  shapePolicy: ShapePolicy;
  label: string;
}): string;
