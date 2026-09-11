import { WatermarkingError } from '~/types';

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

function validate(re: Float64Array, im: Float64Array): void {
  if (re.length !== im.length) {
    throw new WatermarkingError('fft: re and im must have the same length');
  }
  if (!isPowerOfTwo(re.length)) {
    throw new WatermarkingError('fft: length must be a power of two');
  }
}

// Reorder the samples in place by bit-reversed index.
function bitReverse(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
}

/**
 * Compute the in-place radix-2 Cooley-Tukey FFT.
 *
 * The length of `re` and `im` must be a power of two. This function
 * writes the result back into `re` and `im`.
 *
 * @param re - the real part, transformed in place.
 * @param im - the imaginary part, transformed in place.
 */
export function fft(re: Float64Array, im: Float64Array): void {
  validate(re, im);
  const n = re.length;
  bitReverse(re, im);
  // Each stage merges pairs of half-size DFTs into full-size DFTs (butterflies).
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const angleStep = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const angle = angleStep * k;
        const wr = Math.cos(angle);
        const wi = Math.sin(angle);
        const evenIndex = start + k;
        const oddIndex = start + k + half;
        const oddRe = re[oddIndex] * wr - im[oddIndex] * wi;
        const oddIm = re[oddIndex] * wi + im[oddIndex] * wr;
        re[oddIndex] = re[evenIndex] - oddRe;
        im[oddIndex] = im[evenIndex] - oddIm;
        re[evenIndex] = re[evenIndex] + oddRe;
        im[evenIndex] = im[evenIndex] + oddIm;
      }
    }
  }
}

/**
 * Compute the in-place inverse FFT.
 *
 * This conjugates the input, runs the forward FFT, conjugates the
 * result again, and scales by `1/n`.
 *
 * @param re - the real part, transformed in place.
 * @param im - the imaginary part, transformed in place.
 */
export function ifft(re: Float64Array, im: Float64Array): void {
  validate(re, im);
  const n = re.length;
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fft(re, im);
  const scale = 1 / n;
  for (let i = 0; i < n; i++) {
    re[i] = re[i] * scale;
    im[i] = -im[i] * scale;
  }
}
