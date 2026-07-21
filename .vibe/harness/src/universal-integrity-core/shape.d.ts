export declare const SHAPE_POLICY_EXACT_KEYS_V1: 'exact-keys-v1';
export declare const SHAPE_POLICY_LEGACY_KNOWN_FIELDS_V1: 'legacy-known-fields-v1';

export type ShapePolicy = 'exact-keys-v1' | 'legacy-known-fields-v1';

export declare const SHAPE_POLICIES: readonly ShapePolicy[];

export declare function assertPlainRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown>;

export declare function assertExactKeys(
  value: unknown,
  expected: readonly string[],
  label: string,
): asserts value is Record<string, unknown>;

export declare function assertShapePolicy(
  value: unknown,
  roster: readonly string[],
  policy: ShapePolicy,
  label: string,
): asserts value is Record<string, unknown>;

export declare function isSha256Hex(value: unknown): value is string;
