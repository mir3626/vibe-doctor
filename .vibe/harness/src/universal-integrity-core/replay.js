// Universal integrity core — exact replay / conflict comparison (design 0100 §8.6).
//
// A domain-neutral primitive for repositories that ALREADY implement immutable
// insert-or-exact-replay behavior: given the stored byte texts for an identity (or null
// when no row exists) and the candidate byte texts, it distinguishes a new insert, an
// exact idempotent replay, and an identity conflict with different bytes. It performs no
// SQL and is not a repository: table-specific DDL, foreign keys, unique identities,
// update/delete rejection triggers, and canonical re-read stay lane-owned.
import { integrityFailure } from './failure.js';

/**
 * @param {{ stored: readonly string[] | null, candidate: readonly string[] }} input
 * @returns {'new-insert' | 'exact-replay' | 'identity-conflict'}
 */
export function classifyExactReplay(input) {
  if (input.stored === null) return 'new-insert';
  if (input.stored.length !== input.candidate.length) return 'identity-conflict';
  for (let index = 0; index < input.candidate.length; index += 1) {
    if (input.stored[index] !== input.candidate[index]) return 'identity-conflict';
  }
  return 'exact-replay';
}

/**
 * Assert an exact idempotent replay, throwing the LANE's frozen conflict message (carried
 * as the safe message with an additive stable code) on differing bytes. `expectStored`
 * lets an insert path that just lost an ON CONFLICT race also treat a missing row as a
 * conflict, matching existing repository behavior.
 * @param {{
 *   stored: readonly string[] | null,
 *   candidate: readonly string[],
 *   conflictMessage: string,
 *   expectStored?: boolean,
 *   subjectHashOrId?: string,
 * }} input
 * @returns {'new-insert' | 'exact-replay'}
 */
export function assertExactReplay(input) {
  const classification = classifyExactReplay({ stored: input.stored, candidate: input.candidate });
  if (classification === 'identity-conflict' ||
      (classification === 'new-insert' && input.expectStored === true)) {
    throw integrityFailure('UIC_REPLAY_CONFLICT', input.conflictMessage, {
      operation: 'assertExactReplay',
      ...(input.subjectHashOrId === undefined ? {} : { subjectHashOrId: input.subjectHashOrId }),
    });
  }
  return classification;
}
