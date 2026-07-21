export declare const TIME_PROFILE_INSTANT_STRICT_V1: 'instant-strict-v1';
export declare const TIME_PROFILE_LEGACY_DATE_PARSE_V1: 'legacy-date-parse-v1';
export declare const TIME_PROFILE_CALENDAR_DATE_STRICT_V1: 'calendar-date-strict-v1';
export declare const TIME_PROFILE_EXPLICIT_GRAMMAR_V1: 'explicit-grammar-v1';

export type TimeProfile = 'instant-strict-v1' | 'legacy-date-parse-v1' | 'calendar-date-strict-v1' | 'explicit-grammar-v1';

export declare const TIME_PROFILES: readonly TimeProfile[];

export declare function isValidTime(profile: TimeProfile, value: unknown): boolean;
export declare function parseTime(profile: TimeProfile, value: unknown, label: string): number;
export declare function notAfter(left: number, right: number): boolean;
export declare function strictlyBefore(left: number, right: number): boolean;
export declare function monotonicNonDecreasing(chain: readonly number[]): boolean;
export declare function latestOf(values: readonly number[]): number;
export declare function withinWindow(at: number, startInclusive: number, endExclusive: number): boolean;
