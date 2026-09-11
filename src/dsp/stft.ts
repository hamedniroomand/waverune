import { fft, ifft } from '~/dsp/fft';
import { hann } from '~/dsp/window';
import { WatermarkingError } from '~/types';

export interface StftConfig {
  nFft: number;
  hop: number;
}

export interface Spectrogram {
  /** One array per frame, each of length `nFft / 2 + 1`. */
  magnitude: Float64Array[];
  /** The same shape as `magnitude`. */
  phase: Float64Array[];
  nFft: number;
  hop: number;
  /** The signal length in samples, before the pad. */
  length: number;
}

/**
 * Check that the frame grid covers every sample.
 *
 * A hop larger than the FFT size leaves gaps between the frames. The
 * reconstruction writes zeros into those gaps, and the error can reach the
 * full amplitude of the signal.
 */
function assertFrameGrid(nFft: number, hop: number): void {
  if (!Number.isInteger(hop) || hop < 1 || hop > nFft) {
    throw new WatermarkingError(`stft: hop ${hop} must be an integer from 1 to nFft ${nFft}`);
  }
}

/**
 * Compute the short-time Fourier transform of a signal.
 *
 * The function pads the signal with `nFft` zero samples on each side, so the
 * first and last samples get full window coverage. `istft` computes the same
 * pad from `nFft` and trims it off.
 *
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
  const numFrames = Math.floor((paddedLength - nFft) / hop) + 1;
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

/** Rebuild the full complex spectrum. The bins above Nyquist are the conjugate mirror. */
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
 * The function uses weighted overlap-add. It applies the Hann window on
 * synthesis as well as on analysis, and divides the sum by the sum of the
 * squared windows where that sum exceeds `1e-8`. The reconstruction is then
 * exact for every hop from 1 to `nFft`, not only for a hop that satisfies the
 * constant-overlap-add rule.
 *
 * @returns the signal, trimmed to `spec.length` samples.
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
