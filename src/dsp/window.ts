/**
 * Build a periodic Hann window of length `n`.
 *
 * The STFT uses the periodic form, not the symmetric form. The periodic form
 * sums to a constant under overlap-add at the usual hop sizes.
 */
export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  }
  return w;
}
