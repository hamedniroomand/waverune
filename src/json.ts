import type { DetectionResult } from '~/types';

/**
 * Convert a detection result to a JSON-safe object.
 *
 * Bigint payloads become decimal strings. `candidateId` is the raw decoded
 * value. On a rejected block it is noise, not a payload.
 */
export function detectionToJson(result: DetectionResult): Record<string, unknown> {
  const d = result.diagnostics;
  return {
    detected: result.detected,
    id: result.payload === null ? null : result.payload.toString(),
    correlationScore: result.correlationScore,
    syncErrorRate: result.syncErrorRate,
    band: result.band,
    diagnostics: {
      syncValid: d.syncValid,
      checksumValid: d.checksumValid,
      candidateId: d.candidatePayload.toString(),
      blockOffset: d.blockOffset,
      sampleShift: d.sampleShift,
      activeFrames: d.activeFrames,
      totalFrames: d.totalFrames,
      meanCorrelation: d.meanCorrelation,
      minCorrelation: d.minCorrelation,
      channel: d.channel,
    },
  };
}
