// Universal integrity core — strict scalar time and chronology primitives (design 0100 §8.4).
//
// Explicit parser profiles instead of one permissive Date.parse wrapper. Policy versions,
// allowed lags, market calendars, availability bases, expiry semantics, and reason codes
// remain lane-owned; only primitive parsing and relation checks live here. Future
// contracts use the strict canonical instant profile by default.
import { integrityFailure } from './failure.js';

export const TIME_PROFILE_INSTANT_STRICT_V1 = 'instant-strict-v1';
export const TIME_PROFILE_LEGACY_DATE_PARSE_V1 = 'legacy-date-parse-v1';
export const TIME_PROFILE_CALENDAR_DATE_STRICT_V1 = 'calendar-date-strict-v1';
/**
 * The as-of validation lane's CURRENT explicit timestamp grammar (SPR-002 Slice 1,
 * design §8.4): a calendar date, optionally with a T-time carrying seconds and an
 * explicit zone (Z or ±hh:mm), 1-3 fraction digits, plus a real-calendar-day check.
 * Frozen behavior — see lane-compatibility vectors; never silently tightened.
 */
export const TIME_PROFILE_EXPLICIT_GRAMMAR_V1 = 'explicit-grammar-v1';

export const TIME_PROFILES = Object.freeze([
  TIME_PROFILE_INSTANT_STRICT_V1,
  TIME_PROFILE_LEGACY_DATE_PARSE_V1,
  TIME_PROFILE_CALENDAR_DATE_STRICT_V1,
  TIME_PROFILE_EXPLICIT_GRAMMAR_V1,
]);

const EXPLICIT_GRAMMAR_RE =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/u;

/** @param {string} value YYYY-MM-DD @returns {boolean} real calendar day */
function calendarDateIsValid(value) {
  const [yearRaw, monthRaw, dayRaw] = value.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) ||
      month < 1 || month > 12) {
    return false;
  }
  return day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * @param {string} profile
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidTime(profile, value) {
  if (!TIME_PROFILES.includes(profile)) {
    throw integrityFailure(
      'UIC_TIME_PROFILE_UNKNOWN',
      `time profile must be one of ${TIME_PROFILES.join(', ')}`,
    );
  }
  if (typeof value !== 'string') return false;
  if (profile === TIME_PROFILE_INSTANT_STRICT_V1) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
  }
  if (profile === TIME_PROFILE_CALENDAR_DATE_STRICT_V1) {
    return /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
      Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) &&
      new Date(Date.parse(`${value}T00:00:00.000Z`)).toISOString().slice(0, 10) === value;
  }
  if (profile === TIME_PROFILE_EXPLICIT_GRAMMAR_V1) {
    return EXPLICIT_GRAMMAR_RE.test(value) &&
      calendarDateIsValid(value.slice(0, 10)) &&
      Number.isFinite(Date.parse(value));
  }
  return Number.isFinite(Date.parse(value));
}

/**
 * Parse under an explicit profile, failing closed on invalid input.
 * @param {string} profile
 * @param {unknown} value
 * @param {string} label
 * @returns {number} epoch milliseconds
 */
export function parseTime(profile, value, label) {
  if (!isValidTime(profile, value)) {
    throw integrityFailure('UIC_TIME_INVALID', `${label} is invalid`, { subjectKind: label });
  }
  const text = /** @type {string} */ (value);
  return profile === TIME_PROFILE_CALENDAR_DATE_STRICT_V1
    ? Date.parse(`${text}T00:00:00.000Z`)
    : Date.parse(text);
}

/** @param {number} left @param {number} right @returns {boolean} left <= right */
export function notAfter(left, right) {
  return left <= right;
}

/** @param {number} left @param {number} right @returns {boolean} left < right */
export function strictlyBefore(left, right) {
  return left < right;
}

/** @param {readonly number[]} chain @returns {boolean} non-decreasing */
export function monotonicNonDecreasing(chain) {
  for (let index = 1; index < chain.length; index += 1) {
    if (chain[index] < chain[index - 1]) return false;
  }
  return true;
}

/** @param {readonly number[]} values @returns {number} the maximum (throws on empty) */
export function latestOf(values) {
  if (values.length === 0) {
    throw integrityFailure('UIC_TIME_EMPTY_SET', 'latestOf requires at least one clock');
  }
  return Math.max(...values);
}

/**
 * Bounded half-open window check: start <= at < end.
 * @param {number} at @param {number} startInclusive @param {number} endExclusive
 * @returns {boolean}
 */
export function withinWindow(at, startInclusive, endExclusive) {
  return at >= startInclusive && at < endExclusive;
}
