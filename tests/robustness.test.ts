import { expect, test } from "bun:test";
import { PerceptualWatermarker } from "../src/watermarkers/perceptual";
import { speechLike } from "./helpers/signals";
import type { DetectionResult } from "../src/types";

const SR = 44100;
const KEY = "robustness";
const PAYLOAD = 0xcafe_1234n;
const SECONDS = 6;

const watermarker = new PerceptualWatermarker();

// The embedding runs 8 analysis and synthesis passes, so every test shares one
// watermarked signal. The attacks only read it.
let cached: Float32Array | undefined;
function marked(): Float32Array {
  if (!cached) {
    const audio = speechLike(SECONDS, SR);
    cached = watermarker.applyWatermark(audio, { key: KEY, payload: PAYLOAD }).channels[0];
  }
  return cached;
}

function detect(signal: Float32Array): DetectionResult {
  return watermarker.getWatermark({ sampleRate: SR, channels: [signal] }, { key: KEY });
}

/** Assert that the attack leaves the payload readable. */
function expectExactRecovery(signal: Float32Array): void {
  const result = detect(signal);
  expect(result.detected).toBe(true);
  expect(result.payload).toBe(PAYLOAD);
}

/**
 * Assert a documented limit.
 *
 * The detector must report no detection. It must also report a null payload:
 * a wrong payload with `detected` true would be a false accept, which is the
 * one failure that the design must never produce.
 */
function expectDocumentedLimit(signal: Float32Array): DetectionResult {
  const result = detect(signal);
  expect(result.detected).toBe(false);
  expect(result.payload).toBeNull();
  return result;
}

function addNoise(signal: Float32Array, snrDb: number): Float32Array {
  let sum = 0;
  for (const sample of signal) sum += sample * sample;
  const level = Math.sqrt(sum / signal.length) * 10 ** (-snrDb / 20);
  const amplitude = level * Math.sqrt(3);
  let state = 777;
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = signal[i]! + (state / 4294967296 - 0.5) * 2 * amplitude;
  }
  return out;
}

function requantize(signal: Float32Array, bits: number): Float32Array {
  const steps = 2 ** (bits - 1) - 1;
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = Math.round(signal[i]! * steps) / steps;
  return out;
}

function scale(signal: Float32Array, gain: number): Float32Array {
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = signal[i]! * gain;
  return out;
}

function clip(signal: Float32Array, limit: number): Float32Array {
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    out[i] = Math.max(-limit, Math.min(limit, signal[i]!));
  }
  return out;
}

function padSilence(signal: Float32Array, seconds: number): Float32Array {
  const pad = Math.round(seconds * SR);
  const out = new Float32Array(signal.length + pad);
  out.set(signal, pad);
  return out;
}

test("amplitude scaling by 0.5 keeps the payload", () => {
  expectExactRecovery(scale(marked(), 0.5));
});

test("amplitude scaling by 2.0 keeps the payload", () => {
  expectExactRecovery(scale(marked(), 2.0));
});

test("hard clipping at 0.5 keeps the payload", () => {
  expectExactRecovery(clip(marked(), 0.5));
});

test("0.5 s of leading silence keeps the payload", () => {
  expectExactRecovery(padSilence(marked(), 0.5));
});

/**
 * Assert a documented limit and the measured number of sync bit errors.
 *
 * The bound catches a regression but permits an improvement. A change that
 * recovers the payload makes `expectDocumentedLimit` fail, which is correct:
 * the limit then needs a new test.
 */
function expectSyncErrorsAtMost(result: DetectionResult, errors: number): void {
  expect(Math.round(result.bitErrorEstimate * 16)).toBeLessThanOrEqual(errors);
}

// The excerpt holds 1.33 blocks, which is not enough to decode all 56 bits.
// The alignment search still works, and the confidence stays near the value of
// an undamaged signal.
test("truncation to 2 s is a documented limit: 1 of 16 sync bits fails", () => {
  const result = expectDocumentedLimit(marked().slice(2 * SR, 4 * SR));
  expectSyncErrorsAtMost(result, 1);
});

// The signal is tonal, so most of the watermark band holds only the noise
// floor of the source. The step of the requantizer lands far above the
// watermark in those slots and turns their cells into noise.
test("8-bit requantization is a documented limit: 1 of 16 sync bits fails", () => {
  const result = expectDocumentedLimit(requantize(marked(), 8));
  expectSyncErrorsAtMost(result, 1);
});

// The same cause as the requantization limit.
test("additive noise at 30 dB is a documented limit: 3 of 16 sync bits fail", () => {
  const result = expectDocumentedLimit(addNoise(marked(), 30));
  expectSyncErrorsAtMost(result, 3);
});

// The noise sits 20 dB below the signal, near the level of the watermark.
test("additive noise at 20 dB is a documented limit: 3 of 16 sync bits fail", () => {
  const result = expectDocumentedLimit(addNoise(marked(), 20));
  expectSyncErrorsAtMost(result, 3);
});
