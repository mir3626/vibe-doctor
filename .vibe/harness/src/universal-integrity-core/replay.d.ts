export type ExactReplayClassification = 'new-insert' | 'exact-replay' | 'identity-conflict';

export declare function classifyExactReplay(input: {
  stored: readonly string[] | null;
  candidate: readonly string[];
}): ExactReplayClassification;

export declare function assertExactReplay(input: {
  stored: readonly string[] | null;
  candidate: readonly string[];
  conflictMessage: string;
  expectStored?: boolean;
  subjectHashOrId?: string;
}): 'new-insert' | 'exact-replay';
