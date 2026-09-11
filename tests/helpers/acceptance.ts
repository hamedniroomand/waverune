/**
 * The runners behind the acceptance matrix.
 *
 * `tests/acceptance.test.ts` asserts on these results. `bench/acceptance.ts`
 * writes them to disk for the reliability report. Both call the same code,
 * so the report and the test cannot disagree about what ran.
 */
import { decodeWav, encodeWav } from '~/audio/wav';
import type { AudioBuffer, DetectionResult } from '~/types';
import { PerceptualWatermarker } from '~/watermarkers/perceptual';

import { removePrefix, scale } from './attacks';
import { keyPayloadPairs } from './lcg';
import {
  CLEAN_FIXTURES,
  CLEAN_PAIRS,
  FIXTURES,
  GAINS,
  PREFIX_CASES,
  PREFIX_MIN_REMAINING_SECONDS,
  REJECTION,
  ROBUSTNESS,
  ROBUSTNESS_FIXTURES,
  SAMPLE_RATE,
  WAV_ROUND_TRIP,
  buildFixture,
} from './matrix';

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

const markedCache = new Map<string, Float32Array>();

/** Embed the robustness pair into one six-second fixture, once per process. */
export function robustnessMarked(
  watermarker: PerceptualWatermarker,
  fixtureId: string,
): Float32Array {
  const cached = markedCache.get(fixtureId);
  if (cached) return cached;
  const marked = watermarker.applyWatermark(buildFixture(fixtureId), ROBUSTNESS).channels[0];
  markedCache.set(fixtureId, marked);
  return marked;
}

/**
 * Clean recovery and WAV round trip for the 20 pairs on one fixture.
 *
 * The round trip encodes the marked buffer with the default WAV settings,
 * decodes the bytes, and detects the decoded audio. One embed serves both
 * cases, because the embed is the expensive step.
 */
export function runCleanRecovery(watermarker: PerceptualWatermarker, fixtureId: string): Trial[] {
  const audio = buildFixture(fixtureId);
  const trials: Trial[] = [];
  for (const { key, payload } of keyPayloadPairs(CLEAN_PAIRS.seed, CLEAN_PAIRS.count)) {
    const marked = watermarker.applyWatermark(audio, { key, payload });
    trials.push(
      trial('clean', fixtureId, key, payload, {}, watermarker.getWatermark(marked, { key })),
    );
    const decoded = decodeWav(encodeWav(marked, WAV_ROUND_TRIP));
    trials.push(
      trial(
        'wav-round-trip',
        fixtureId,
        key,
        payload,
        { bitDepth: WAV_ROUND_TRIP.bitDepth },
        watermarker.getWatermark(decoded, { key }),
      ),
    );
  }
  return trials;
}

export function runGainCases(watermarker: PerceptualWatermarker): Trial[] {
  const trials: Trial[] = [];
  for (const fixtureId of ROBUSTNESS_FIXTURES) {
    const marked = robustnessMarked(watermarker, fixtureId);
    for (const gain of GAINS) {
      const attacked = scale(marked, gain);
      if (attacked.changedSamples === 0) throw new Error(`gain ${gain} changed nothing`);
      trials.push(
        trial(
          'gain',
          fixtureId,
          ROBUSTNESS.key,
          ROBUSTNESS.payload,
          { gain },
          watermarker.getWatermark(mono(attacked.signal), { key: ROBUSTNESS.key }),
        ),
      );
    }
  }
  return trials;
}

export function runPrefixCases(watermarker: PerceptualWatermarker): Trial[] {
  const trials: Trial[] = [];
  for (const fixtureId of ROBUSTNESS_FIXTURES) {
    const marked = robustnessMarked(watermarker, fixtureId);
    for (const c of PREFIX_CASES) {
      const attacked = removePrefix(marked, c.samples);
      const remainingSeconds = attacked.severity.remainingSamples / SAMPLE_RATE;
      if (remainingSeconds < PREFIX_MIN_REMAINING_SECONDS) {
        throw new Error(`prefix case ${c.samples} leaves ${remainingSeconds} s, below the minimum`);
      }
      trials.push(
        trial(
          'prefix-removal',
          fixtureId,
          ROBUSTNESS.key,
          ROBUSTNESS.payload,
          {
            samples: c.samples,
            group: c.group,
            label: c.label,
            remainingSeconds: Number(remainingSeconds.toFixed(4)),
          },
          watermarker.getWatermark(mono(attacked.signal), { key: ROBUSTNESS.key }),
        ),
      );
    }
  }
  return trials;
}

/**
 * The deterministic rejection set.
 *
 * Every trial must reject. The trial records what did happen, so a failure
 * can be classified: sync match alone, checksum match alone, or both.
 */
export function runRejection(watermarker: PerceptualWatermarker): Trial[] {
  const trials: Trial[] = [];

  for (const fixtureId of REJECTION.cleanFixtures) {
    const audio = buildFixture(fixtureId);
    for (const key of REJECTION.cleanKeys) {
      trials.push(
        trial('unmarked', fixtureId, key, null, {}, watermarker.getWatermark(audio, { key })),
      );
    }
  }

  for (const fixtureId of ROBUSTNESS_FIXTURES) {
    const marked = mono(robustnessMarked(watermarker, fixtureId));
    for (const key of REJECTION.wrongKeys) {
      trials.push(
        trial(
          'wrong-key',
          fixtureId,
          key,
          null,
          { embeddedKey: ROBUSTNESS.key, embeddedPayload: ROBUSTNESS.payload.toString(16) },
          watermarker.getWatermark(marked, { key }),
        ),
      );
    }
  }

  for (const seconds of REJECTION.silenceSeconds) {
    const silence = mono(new Float32Array(seconds * SAMPLE_RATE));
    for (const key of REJECTION.silenceKeys) {
      trials.push(
        trial(
          'silence',
          `silence-${seconds}s`,
          key,
          null,
          { seconds },
          watermarker.getWatermark(silence, { key }),
        ),
      );
    }
  }

  for (const fixtureId of CLEAN_FIXTURES) {
    const quiet = mono(scale(buildFixture(fixtureId).channels[0], REJECTION.lowEnergyGain).signal);
    for (const key of REJECTION.cleanKeys) {
      trials.push(
        trial(
          'low-energy-unmarked',
          fixtureId,
          key,
          null,
          { gain: REJECTION.lowEnergyGain },
          watermarker.getWatermark(quiet, { key }),
        ),
      );
    }
  }

  const pairs = keyPayloadPairs(REJECTION.crossPairs.seed, REJECTION.crossPairs.count);
  for (const fixtureId of CLEAN_FIXTURES) {
    const audio = buildFixture(fixtureId);
    for (let i = 0; i < pairs.length; i++) {
      const marked = watermarker.applyWatermark(audio, pairs[i]);
      for (let j = 0; j < pairs.length; j++) {
        if (i === j) continue;
        trials.push(
          trial(
            'cross-pair-wrong-key',
            fixtureId,
            pairs[j].key,
            null,
            { embeddedKey: pairs[i].key, embeddedPayload: pairs[i].payload.toString(16) },
            watermarker.getWatermark(marked, { key: pairs[j].key }),
          ),
        );
      }
    }
  }
  return trials;
}

/** Summarise a rejection trial that did not reject. */
export function rejectionFailureKind(t: Trial): string {
  if (t.detected) return 'false-accept';
  if (t.syncValid && t.checksumValid) return 'sync-and-checksum-without-detect';
  return 'ok';
}

export { FIXTURES };
