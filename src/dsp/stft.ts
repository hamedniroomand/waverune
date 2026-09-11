import { WatermarkingError } from '../types';
import { fft, ifft } from './fft';
import { hann } from './window';

export interface StftConfig {
  nFft: number;
  hop: number;
}

export interface Spectrogram {
  magnitude: Float64Array[]; // frames, each of length nFft/2 + 1
  phase: Float64Array[]; // same shape
  nFft: number;
  hop: number;
  length: number; // original signal length in samples, before the pad
}

/**
 * Check that the frame grid covers every sample.
 *
 * A hop larger than the FFT size leaves gaps between the frames. The
 * reconstruction writes zeros into those gaps, and the error can reach the
 * full amplitude of the signal. The function throws instead.
 *
 * @param nFft - the FFT size, in samples.
 * @param hop - the hop size, in samples.
 */
function assertFrameGrid(nFft: number, hop: number): void {
  if (!Number.isInteger(hop) || hop < 1 || hop > nFft) {
    throw new WatermarkingError(`stft: hop ${hop} must be an integer from 1 to nFft ${nFft}`);
  }
}

/**
 * Compute the number of frames needed to cover a padded signal.
 *
 * @param paddedLength - the length of the padded signal, in samples.
 * @param nFft - the FFT size, in samples.
 * @param hop - the hop size, in samples.
 * @returns the number of frames.
 */
function frameCount(paddedLength: number, nFft: number, hop: number): number {
  return Math.floor((paddedLength - nFft) / hop) + 1;
}

/**
 * Compute the short-time Fourier transform of a signal.
 *
 * The function pads the signal with `nFft` zero samples on each side.
 * The returned `length` gives the number of samples before the pad. Both
 * functions compute the pad from `nFft`, so `istft` can trim the pad off.
 *
 * @param signal - the input signal.
 * @param cfg - the FFT size and hop size to use.
 * @returns the magnitude and phase spectrogram of the signal.
 * @throws WatermarkingError when the hop is larger than the FFT size.
 */
export function stft(signal: Float32Array, cfg: StftConfig): Spectrogram {
  const { nFft, hop } = cfg;
  assertFrameGrid(nFft, hop);
  const pad = nFft;
  const paddedLength = signal.length + 2 * pad;
  const padded = new Float64Array(paddedLength);
  for (let i = 0; i < signal.length; i++) padded[pad + i] = signal[i]!;

  const window = hann(nFft);
  const numFrames = frameCount(paddedLength, nFft, hop);
  const numBins = nFft / 2 + 1;
  const magnitude: Float64Array[] = [];
  const phase: Float64Array[] = [];

  for (let i = 0; i < numFrames; i++) {
    const start = i * hop;
    const re = new Float64Array(nFft);
    const im = new Float64Array(nFft);
    for (let j = 0; j < nFft; j++) re[j] = padded[start + j] * window[j];
    fft(re, im);

    const mag = new Float64Array(numBins);
    const ph = new Float64Array(numBins);
    for (let k = 0; k < numBins; k++) {
      mag[k] = Math.hypot(re[k], im[k]);
      ph[k] = Math.atan2(im[k], re[k]);
    }
    magnitude.push(mag);
    phase.push(ph);
  }

  return { magnitude, phase, nFft, hop, length: signal.length };
}

/**
 * Rebuild a full complex spectrum from magnitude and phase.
 *
 * The function fills bins `0..nFft/2` from the given magnitude and phase,
 * then mirrors the conjugate into the bins above Nyquist.
 *
 * @param mag - the magnitude for bins `0..nFft/2`.
 * @param ph - the phase for bins `0..nFft/2`.
 * @param nFft - the FFT size, in samples.
 * @returns the real and imaginary parts of the full spectrum.
 */
function rebuildSpectrum(
  mag: Float64Array,
  ph: Float64Array,
  nFft: number,
): { re: Float64Array; im: Float64Array } {
  const re = new Float64Array(nFft);
  const im = new Float64Array(nFft);
  const numBins = nFft / 2 + 1;
  for (let k = 0; k < numBins; k++) {
    re[k] = mag[k] * Math.cos(ph[k]);
    im[k] = mag[k] * Math.sin(ph[k]);
  }
  for (let k = 1; k < nFft / 2; k++) {
    re[nFft - k] = re[k]!;
    im[nFft - k] = -im[k];
  }
  return { re, im };
}

/**
 * Reconstruct a signal from a magnitude and phase spectrogram.
 *
 * This uses weighted overlap-add. It applies the Hann window on
 * synthesis as well as on analysis, and it accumulates the window
 * squared into a normalization array. It divides by that array where
 * the array exceeds `1e-8`. This makes the reconstruction exact for
 * every hop from 1 to `nFft`, not only for a hop that satisfies the
 * constant-overlap-add rule. A larger hop leaves gaps that no frame
 * covers, so the function rejects it.
 *
 * @param spec - the spectrogram to invert.
 * @returns the reconstructed signal, trimmed to `spec.length` samples.
 * @throws WatermarkingError when the hop is larger than the FFT size.
 */
export function istft(spec: Spectrogram): Float32Array {
  const { magnitude, phase, nFft, hop, length } = spec;
  assertFrameGrid(nFft, hop);
  const pad = nFft;
  const numFrames = magnitude.length;
  const window = hann(nFft);
  const bufLength = Math.max((numFrames - 1) * hop + nFft, pad + length);

  const accum = new Float64Array(bufLength);
  const norm = new Float64Array(bufLength);

  for (let i = 0; i < numFrames; i++) {
    const { re, im } = rebuildSpectrum(magnitude[i], phase[i], nFft);
    ifft(re, im);
    const start = i * hop;
    for (let j = 0; j < nFft; j++) {
      accum[start + j] += re[j] * window[j];
      norm[start + j] += window[j] * window[j];
    }
  }

  for (let i = 0; i < bufLength; i++) {
    if (norm[i] > 1e-8) accum[i] = accum[i] / norm[i];
  }

  const output = new Float32Array(length);
  for (let i = 0; i < length; i++) output[i] = accum[pad + i]!;
  return output;
}
