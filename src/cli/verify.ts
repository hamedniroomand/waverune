import type { DetectionResult } from '~/types';

/** Why an embed verification failed. */
export type VerifyFailure = 'not-detected' | 'id-mismatch';

/** The outcome of comparing a detection result against the requested id. */
export interface EmbedVerification {
  verified: boolean;
  failure: VerifyFailure | null;
  requestedId: bigint;
  recoveredId: bigint | null;
}

/**
 * Compare a detection result against the id that `embed` requested.
 *
 * Verification passes only when the detector accepted a block and the
 * accepted payload equals the requested id. A detected block with a
 * different id is a failure, not a partial success.
 */
export function verifyRecovery(requestedId: bigint, result: DetectionResult): EmbedVerification {
  if (!result.detected || result.payload === null) {
    return { verified: false, failure: 'not-detected', requestedId, recoveredId: null };
  }
  if (result.payload !== requestedId) {
    return { verified: false, failure: 'id-mismatch', requestedId, recoveredId: result.payload };
  }
  return { verified: true, failure: null, requestedId, recoveredId: result.payload };
}
