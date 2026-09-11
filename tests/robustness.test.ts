import { expect, test } from "bun:test";
import { PerceptualWatermarker } from "../src/watermarkers/perceptual";
import { musicLike, speechLike } from "./helpers/signals";
import type { AudioBuffer, DetectionResult } from "../src/types";

const SR = 44100;
const KEY = "robustness";
const PAYLOAD = 0xcafe_1234n;
const SECONDS = 6;

const watermarker = new PerceptualWatermarker();

const SIGNALS: Record<string, (seconds: number, sr?: number) => AudioBuffer> = {
  tonal: speechLike,
  broadband: musicLike,
};

// The embedding runs 8 analysis and synthesis passes, so every test shares one
// watermarked signal per signal class. The attacks only read it.
const cache = new Map<string, Float32Array>();
function marked(signal: string): Float32Array {
  let value = cache.get(signal);
  if (!value) {
    const audio = SIGNALS[signal]!(SECONDS, SR);
    value = watermarker.applyWatermark(audio, { key: KEY, payload: PAYLOAD }).channels[0]!;
    cache.set(signal, value);
  }
  return value;
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

/**
 * Assert the measured number of sync bit errors.
 *
 * The bound catches a regression but permits an improvement. A change that
 * recovers the payload makes `expectDocumentedLimit` fail, which is correct:
 * the limit then needs a new test.
 */
function expectSyncErrorsAtMost(result: DetectionResult, errors: number): void {
  expect(Math.round(result.bitErrorEstimate * 16)).toBeLessThanOrEqual(errors);
}

function addNoise(signal: Float32Array, snrDb: number): Float32Array {
  let sum = 0;
  for (const sample of signal) sum += sample * sample;
  const amplitude = Math.sqrt(sum / signal.length) * 10 ** (-snrDb / 20) * Math.sqrt(3);
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

function truncate(signal: Float32Array): Float32Array {
  return signal.slice(2 * SR, 4 * SR);
}

// These four attacks behave the same way on both signal classes.
for (const signal of Object.keys(SIGNALS)) {
  test(`amplitude scaling by 0.5 keeps the payload (${signal})`, () => {
    expectExactRecovery(scale(marked(signal), 0.5));
  });

  test(`amplitude scaling by 2.0 keeps the payload (${signal})`, () => {
    expectExactRecovery(scale(marked(signal), 2.0));
  });

  test(`hard clipping at 0.5 keeps the payload (${signal})`, () => {
    expectExactRecovery(clip(marked(signal), 0.5));
  });

  test(`0.5 s of leading silence keeps the payload (${signal})`, () => {
    expectExactRecovery(padSilence(marked(signal), 0.5));
  });
}

// The four attacks below depend on the signal class. Broadband audio holds
// content in every slot of the band, so the watermark has somewhere to sit.
// Tonal audio leaves most of the band at the noise floor of the source, and an
// attack that raises that floor destroys the cells there.

test("truncation to 2 s keeps the payload (broadband)", () => {
  expectExactRecovery(truncate(marked("broadband")));
});

test("truncation to 2 s is a limit for tonal audio: 1 of 16 sync bits fails", () => {
  const result = expectDocumentedLimit(truncate(marked("tonal")));
  expectSyncErrorsAtMost(result, 1);
});

test("8-bit requantization keeps the payload (broadband)", () => {
  expectExactRecovery(requantize(marked("broadband"), 8));
});

// The sync bits all decode here. Only the payload and the checksum fail.
test("8-bit requantization is a limit for tonal audio", () => {
  const result = expectDocumentedLimit(requantize(marked("tonal"), 8));
  expectSyncErrorsAtMost(result, 0);
});

test("additive noise at 30 dB keeps the payload (broadband)", () => {
  expectExactRecovery(addNoise(marked("broadband"), 30));
});

test("additive noise at 30 dB is a limit for tonal audio: 1 of 16 sync bits fails", () => {
  const result = expectDocumentedLimit(addNoise(marked("tonal"), 30));
  expectSyncErrorsAtMost(result, 1);
});

test("additive noise at 20 dB keeps the payload (broadband)", () => {
  expectExactRecovery(addNoise(marked("broadband"), 20));
});

test("additive noise at 20 dB is a limit for tonal audio: 2 of 16 sync bits fail", () => {
  const result = expectDocumentedLimit(addNoise(marked("tonal"), 20));
  expectSyncErrorsAtMost(result, 2);
});
