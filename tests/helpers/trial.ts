import type { AudioBuffer, DetectionResult } from '~/types';

import { SAMPLE_RATE } from './matrix';

/** One recorded trial. `exact` is the pass condition for a recovery case. */
export interface Trial {
  case: string;
  fixture: string;
  key: string;
  payload: string;
  params: Record<string, number | string>;
  detected: boolean;
  recovered: string | null;
  exact: boolean;
  correlationScore: number;
  syncErrorRate: number;
  syncValid: boolean;
  checksumValid: boolean;
  candidate: string;
  sampleShift: number;
  blockOffset: number;
  activeFrames: number;
}

/** Record one detection result as a trial. Payloads are written in hexadecimal. */
export function trial(
  name: string,
  fixture: string,
  key: string,
  payload: bigint | null,
  params: Record<string, number | string>,
  result: DetectionResult,
): Trial {
  const d = result.diagnostics;
  return {
    case: name,
    fixture,
    key,
    payload: payload === null ? 'none' : payload.toString(16),
    params,
    detected: result.detected,
    recovered: result.payload === null ? null : result.payload.toString(16),
    exact: payload !== null && result.detected && result.payload === payload,
    correlationScore: result.correlationScore,
    syncErrorRate: result.syncErrorRate,
    syncValid: d.syncValid,
    checksumValid: d.checksumValid,
    candidate: d.candidatePayload.toString(16),
    sampleShift: d.sampleShift,
    blockOffset: d.blockOffset,
    activeFrames: d.activeFrames,
  };
}

/** Wrap one channel as mono audio at the matrix sample rate. */
export function mono(signal: Float32Array, sampleRate = SAMPLE_RATE): AudioBuffer {
  return { sampleRate, channels: [signal] };
}
