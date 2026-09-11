/**
 * The measured attack behaviour on the six-second robustness fixtures.
 *
 * The required attacks, gain and prefix removal, live in `tests/acceptance/`.
 * Each test here first asserts that the attack changed the signal, then
 * asserts the outcome that the benchmark measured. An outcome is exact
 * recovery or explicit rejection. An accepted wrong payload fails every test.
 *
 * A change that turns a documented rejection into a recovery fails the test
 * on purpose. The documented limit then needs an update.
 */
import { expect, setDefaultTimeout, test } from 'bun:test';

import type { DetectionResult } from '~/types';
import { PerceptualWatermarker } from '~/watermarkers/perceptual';

import { robustnessMarked } from './helpers/acceptance';
import {
  addNoise,
  assertAltered,
  clip,
  clipAtPeakFraction,
  excerpt,
  insertSilence,
  padLeading,
  padTrailing,
  requantize,
  type Attacked,
} from './helpers/attacks';
import { ROBUSTNESS, ROBUSTNESS_FIXTURES, SAMPLE_RATE } from './helpers/matrix';
import { mono } from './helpers/trial';

// One embed takes about 1.5 s and several seconds on a loaded machine. The
// 5 s default would fail tests for speed, not correctness.
setDefaultTimeout(60000);

const SR = SAMPLE_RATE;
const { key: KEY, payload: PAYLOAD } = ROBUSTNESS;
const watermarker = new PerceptualWatermarker();

function detect(signal: Float32Array): DetectionResult {
  return watermarker.getWatermark(mono(signal), { key: KEY });
}

/** The attack must change the signal, and the detector must recover the payload exactly. */
function expectExactRecovery(attacked: Attacked<Record<string, number>>, label: string): void {
  assertAltered(attacked, label);
  const result = detect(attacked.signal);
  expect(result.detected).toBe(true);
  expect(result.payload).toBe(PAYLOAD);
}

/**
 * Accept either outcome for an attack outside the support envelope.
 *
 * A rejection reports `detected` false and a null payload. A wrong payload
 * with `detected` true is an accepted wrong payload, the one outcome that no
 * attack can produce. `bench/attacks.ts` records which outcome occurred.
 */
function expectExactOrRejection(
  attacked: Attacked<Record<string, number>>,
  label: string,
): DetectionResult {
  assertAltered(attacked, label);
  const result = detect(attacked.signal);
  if (result.detected) expect(result.payload).toBe(PAYLOAD);
  else expect(result.payload).toBeNull();
  return result;
}

const [TONAL, BROADBAND] = ROBUSTNESS_FIXTURES;

// Both fixtures peak below 0.43, so a clip at an absolute 0.5 changes no
// samples. The test keeps the case to show that it is not evidence.
for (const fixture of ROBUSTNESS_FIXTURES) {
  test(`clipping at an absolute 0.5 changes no samples on the marked fixture (${fixture})`, () => {
    const attacked = clip(robustnessMarked(watermarker, fixture), 0.5);
    expect(attacked.changedSamples).toBe(0);
  });
}

// A clip relative to the fixture's own peak always changes samples. The
// measured outcomes come from `bench/attacks.ts`. See the reliability report
// for the changed-sample counts.
test('clipping at 0.9 of the peak keeps the payload on both fixtures', () => {
  for (const fixture of ROBUSTNESS_FIXTURES) {
    const attacked = clipAtPeakFraction(robustnessMarked(watermarker, fixture), 0.9);
    expect(attacked.changedSamples).toBeGreaterThan(0);
    expectExactRecovery(attacked, 'clip 0.9');
  }
});

for (const fraction of [0.7, 0.5, 0.3]) {
  test(`clipping at ${fraction} of the peak keeps the payload (broadband)`, () => {
    const attacked = clipAtPeakFraction(robustnessMarked(watermarker, BROADBAND), fraction);
    expect(attacked.changedFraction).toBeGreaterThan(0.005);
    expectExactRecovery(attacked, `clip ${fraction}`);
  });

  test(`clipping at ${fraction} of the peak is a measured limit for tonal audio: exact or rejection`, () => {
    const attacked = clipAtPeakFraction(robustnessMarked(watermarker, TONAL), fraction);
    expect(attacked.changedFraction).toBeGreaterThan(0.05);
    expectExactOrRejection(attacked, `clip ${fraction}`);
  });
}

test('0.5 s of leading silence keeps the payload on both fixtures', () => {
  for (const fixture of ROBUSTNESS_FIXTURES) {
    expectExactRecovery(
      padLeading(robustnessMarked(watermarker, fixture), Math.round(0.5 * SR)),
      'pad leading',
    );
  }
});

test('0.5 s of trailing silence keeps the payload on both fixtures', () => {
  for (const fixture of ROBUSTNESS_FIXTURES) {
    expectExactRecovery(
      padTrailing(robustnessMarked(watermarker, fixture), Math.round(0.5 * SR)),
      'pad trailing',
    );
  }
});

// An internal insertion moves the second part against the first part, so the
// two parts no longer share one block grid. This differs from leading padding.
// Measured with the v0.3 detector: both fixtures recover at 1 s and 4.5 s and
// reject at 3 s. Broadband recovered at 3 s with the v0.2 detector, at a
// marginal score of 0.092.
for (const fixture of ROBUSTNESS_FIXTURES) {
  test(`0.5 s of silence inserted at 3 s gives exact recovery or rejection (${fixture})`, () => {
    const attacked = insertSilence(
      robustnessMarked(watermarker, fixture),
      3 * SR,
      Math.round(0.5 * SR),
    );
    expectExactOrRejection(attacked, 'insert silence');
  });
}

// The measured excerpt grid lives in `bench/crop.ts`. This case is the one
// excerpt that an earlier suite documented as a tonal failure. The alignment
// search now recovers it.
test('a 2 s excerpt starting at 2 s keeps the payload on both fixtures', () => {
  for (const fixture of ROBUSTNESS_FIXTURES) {
    expectExactRecovery(
      excerpt(robustnessMarked(watermarker, fixture), 2 * SR, 2 * SR),
      'excerpt 2 s',
    );
  }
});

test('12-bit requantization alters samples and keeps the payload on both fixtures', () => {
  for (const fixture of ROBUSTNESS_FIXTURES) {
    const attacked = requantize(robustnessMarked(watermarker, fixture), 12);
    expect(attacked.changedFraction).toBeGreaterThan(0.9);
    expectExactRecovery(attacked, 'requantize 12');
  }
});

test('8-bit requantization alters samples and keeps the payload (broadband)', () => {
  const attacked = requantize(robustnessMarked(watermarker, BROADBAND), 8);
  expect(attacked.changedFraction).toBeGreaterThan(0.9);
  expectExactRecovery(attacked, 'requantize 8');
});

test('8-bit requantization is a measured limit for tonal audio: exact or rejection', () => {
  const attacked = requantize(robustnessMarked(watermarker, TONAL), 8);
  expect(attacked.changedFraction).toBeGreaterThan(0.9);
  expectExactOrRejection(attacked, 'requantize 8');
});

// The noise attack reports the SNR that it achieved. The fixed seed keeps the
// noise the same on every run. The tonal fixture holds numerically empty
// slots across most of the band, so any added noise floor covers the
// watermark there. It rejected at every measured SNR from 40 dB down.
for (const snr of [40, 30, 20]) {
  test(`additive noise at ${snr} dB SNR keeps the payload (broadband)`, () => {
    const attacked = addNoise(robustnessMarked(watermarker, BROADBAND), snr);
    expect(Math.abs(attacked.severity.achievedSnrDb - snr)).toBeLessThan(0.5);
    expectExactRecovery(attacked, `noise ${snr}`);
  });

  test(`additive noise at ${snr} dB SNR is a measured limit for tonal audio: exact or rejection`, () => {
    const attacked = addNoise(robustnessMarked(watermarker, TONAL), snr);
    expect(Math.abs(attacked.severity.achievedSnrDb - snr)).toBeLessThan(0.5);
    expectExactOrRejection(attacked, `noise ${snr}`);
  });
}
