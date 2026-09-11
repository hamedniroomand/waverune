import { expect, test } from 'bun:test';

import { calculateAudioMetrics } from '~/metrics';

test('identical signals give infinite snr and zero mse', () => {
  const a = new Float32Array([0.1, -0.2, 0.3]);
  const m = calculateAudioMetrics(a, Float32Array.from(a));
  expect(m.mse).toBe(0);
  expect(m.snr).toBe(Infinity);
  expect(m.psnr).toBe(Infinity);
});

test('snr decreases as noise grows', () => {
  const n = 4096;
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.sin(i * 0.05);
  const noisy = (amp: number) => {
    const b = Float32Array.from(a);
    for (let i = 0; i < n; i++) b[i] += amp * (Math.random() * 2 - 1);
    return b;
  };
  expect(calculateAudioMetrics(a, noisy(0.001)).snr).toBeGreaterThan(
    calculateAudioMetrics(a, noisy(0.1)).snr,
  );
});

test('length mismatch throws', () => {
  expect(() => calculateAudioMetrics(new Float32Array(4), new Float32Array(5))).toThrow();
});

test('empty input throws', () => {
  expect(() => calculateAudioMetrics(new Float32Array(0), new Float32Array(0))).toThrow();
});
