import { expect, test } from 'bun:test';

import { addNoise, clip, countChanged, rms, whiteNoise } from './helpers/attacks';
import { speechLike } from './helpers/signals';

test('addNoise on silence adds nothing, and says so', () => {
  const attacked = addNoise(new Float32Array(1000), 20, 5);
  expect(attacked.changedSamples).toBe(0);
  expect(attacked.severity.achievedSnrDb).toBe(Number.POSITIVE_INFINITY);
});

test('whiteNoise builds a noise floor at an absolute level without an input signal', () => {
  const noise = whiteNoise(44100, 1e-4, 99);
  expect(rms(noise)).toBeGreaterThan(0);
  expect(Math.max(...noise.map(Math.abs))).toBeLessThanOrEqual(1e-4);
  expect(countChanged(new Float32Array(44100), noise)).toBeGreaterThan(44000);
});

test('the achieved SNR comes from the Float32 residual and tracks the target at moderate levels', () => {
  const signal = speechLike(1).channels[0];
  const attacked = addNoise(signal, 30, 777);
  expect(Math.abs(attacked.severity.achievedSnrDb - 30)).toBeLessThan(0.5);
  let residual = 0;
  let power = 0;
  for (let i = 0; i < signal.length; i++) {
    const d = attacked.signal[i] - signal[i];
    residual += d * d;
    power += signal[i] * signal[i];
  }
  expect(attacked.severity.achievedSnrDb).toBeCloseTo(10 * Math.log10(power / residual), 6);
});

test('clipping above the peak changes nothing, and reports it', () => {
  const signal = speechLike(1).channels[0];
  expect(clip(signal, 1).changedSamples).toBe(0);
  expect(clip(signal, 0.1).changedSamples).toBeGreaterThan(0);
});
