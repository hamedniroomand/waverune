/**
 * Build a periodic Hann window of length `n`.
 *
 * The window uses the periodic form, not the symmetric form. This form
 * suits STFT analysis and synthesis.
 *
 * @param n - the window length in samples.
 * @returns a `Float64Array` of length `n` with values in `[0, 1]`.
 */
export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  }
  return w;
}
