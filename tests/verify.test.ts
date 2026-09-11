import { expect, test } from 'bun:test';

import { verifyRecovery } from '~/cli/verify';
import type { DetectionResult } from '~/types';

function fakeResult(detected: boolean, payload: bigint | null): DetectionResult {
  return {
    detected,
    payload,
    correlationScore: 0.2,
    syncErrorRate: 0,
    band: { lowHz: 500, highHz: 5000 },
    diagnostics: {
      syncValid: detected,
      checksumValid: detected,
      candidatePayload: payload ?? 0n,
      blockOffset: 0,
      sampleShift: 0,
      activeFrames: 1,
      totalFrames: 1,
      meanCorrelation: 0.25,
      minCorrelation: 0.1,
      channel: 0,
    },
  };
}

test('verifyRecovery passes only on an exact id match', () => {
  expect(verifyRecovery(42n, fakeResult(true, 42n))).toEqual({
    verified: true,
    failure: null,
    requestedId: 42n,
    recoveredId: 42n,
  });
});

// A detected block with a different id needs a checksum collision, so the
// real detector cannot produce this case on request. The test builds it.
test('verifyRecovery reports an id mismatch as a failure', () => {
  const v = verifyRecovery(42n, fakeResult(true, 43n));
  expect(v.verified).toBe(false);
  expect(v.failure).toBe('id-mismatch');
  expect(v.recoveredId).toBe(43n);
});

test('verifyRecovery reports a rejected block as not detected', () => {
  const v = verifyRecovery(42n, fakeResult(false, null));
  expect(v.verified).toBe(false);
  expect(v.failure).toBe('not-detected');
  expect(v.recoveredId).toBeNull();
});
