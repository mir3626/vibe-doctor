export declare const HASH_PROFILE_CANONICAL_JSON_V1: 'canonical-json-v1';
export declare const HASH_PROFILE_ORDERED_JSON_V1: 'ordered-json-v1';
export declare const HASH_PROFILE_RAW_BYTES_SHA256_V1: 'raw-bytes-sha256-v1';

export type HashProfile = 'canonical-json-v1' | 'ordered-json-v1' | 'raw-bytes-sha256-v1';

export declare const HASH_PROFILES: readonly HashProfile[];

export declare function canonicalJsonV1(value: unknown): string;
export declare function orderedJsonV1(value: unknown): string;
export declare function serializeWithProfile(profile: HashProfile, value: unknown): string;
export declare function hashWithProfile(profile: HashProfile, value: unknown): string;
