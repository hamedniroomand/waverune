import { expect, test } from 'bun:test';

import { fft, ifft } from '~/dsp/fft';

function naiveDft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  const outRe = new Float64Array(n),
    outIm = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    for (let t = 0; t < n; t++) {
      const a = (-2 * Math.PI * k * t) / n;
      outRe[k] += re[t] * Math.cos(a) - im[t] * Math.sin(a);
      outIm[k] += re[t] * Math.sin(a) + im[t] * Math.cos(a);
    }
  }
  return { outRe, outIm };
}

test('fft matches a naive DFT', () => {
  const n = 64;
  const re = new Float64Array(n),
    im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    re[i] = Math.sin(i * 0.3) + 0.4 * Math.cos(i * 1.1);
    im[i] = 0;
  }
  const { outRe, outIm } = naiveDft(re, im);
  fft(re, im);
  for (let k = 0; k < n; k++) {
    expect(Math.abs(re[k] - outRe[k])).toBeLessThan(1e-9);
    expect(Math.abs(im[k] - outIm[k])).toBeLessThan(1e-9);
  }
});

test('ifft inverts fft', () => {
  const n = 256;
  const re = new Float64Array(n),
    im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.random() * 2 - 1;
  const copy = Float64Array.from(re);
  fft(re, im);
  ifft(re, im);
  for (let i = 0; i < n; i++) expect(Math.abs(re[i] - copy[i])).toBeLessThan(1e-12);
});

test('fft rejects non-power-of-two lengths', () => {
  expect(() => fft(new Float64Array(50), new Float64Array(50))).toThrow();
});
