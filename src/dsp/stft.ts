import { fft, ifft } from "./fft";
import { hann } from "./window";

export interface StftConfig {
  nFft: number;
  hop: number;
}

export interface Spectrogram {
  magnitude: Float64Array[]; // frames, each of length nFft/2 + 1
  phase: Float64Array[]; // same shape
  nFft: number;
  hop: number;
  length: number; // original signal length in samples
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
 * It stores the pad amount in the returned spectrogram through `length`,
 * so `istft` can trim the padding back off.
 *
 * @param signal - the input signal.
 * @param cfg - the FFT size and hop size to use.
 * @returns the magnitude and phase spectrogram of the signal.
 */
export function stft(signal: Float32Array, cfg: StftConfig): Spectrogram {
  const { nFft, hop } = cfg;
  const pad = nFft;
  const paddedLength = signal.length + 2 * pad;
  const padded = new Float64Array(paddedLength);
  for (let i = 0; i < signal.length; i++) padded[pad + i] = signal[i]!;

  const window = hann(nFft);
  const numFrames = frameCount(paddedLength, nFft, hop);
  const numBins = nFft / 2 + 1;
  const magnitude: Float64Array[] = new Array(numFrames);
  const phase: Float64Array[] = new Array(numFrames);

  for (let i = 0; i < numFrames; i++) {
    const start = i * hop;
    const re = new Float64Array(nFft);
    const im = new Float64Array(nFft);
    for (let j = 0; j < nFft; j++) re[j] = padded[start + j]! * window[j]!;
    fft(re, im);

    const mag = new Float64Array(numBins);
    const ph = new Float64Array(numBins);
    for (let k = 0; k < numBins; k++) {
      mag[k] = Math.hypot(re[k]!, im[k]!);
      ph[k] = Math.atan2(im[k]!, re[k]!);
    }
    magnitude[i] = mag;
    phase[i] = ph;
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
function rebuildSpectrum(mag: Float64Array, ph: Float64Array, nFft: number): { re: Float64Array; im: Float64Array } {
  const re = new Float64Array(nFft);
  const im = new Float64Array(nFft);
  const numBins = nFft / 2 + 1;
  for (let k = 0; k < numBins; k++) {
    re[k] = mag[k]! * Math.cos(ph[k]!);
    im[k] = mag[k]! * Math.sin(ph[k]!);
  }
  for (let k = 1; k < nFft / 2; k++) {
    re[nFft - k] = re[k]!;
    im[nFft - k] = -im[k]!;
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
 * any hop, not only a hop that satisfies the constant-overlap-add rule.
 *
 * @param spec - the spectrogram to invert.
 * @returns the reconstructed signal, trimmed to `spec.length` samples.
 */
export function istft(spec: Spectrogram): Float32Array {
  const { magnitude, phase, nFft, hop, length } = spec;
  const pad = nFft;
  const numFrames = magnitude.length;
  const window = hann(nFft);
  const bufLength = Math.max((numFrames - 1) * hop + nFft, pad + length);

  const accum = new Float64Array(bufLength);
  const norm = new Float64Array(bufLength);

  for (let i = 0; i < numFrames; i++) {
    const { re, im } = rebuildSpectrum(magnitude[i]!, phase[i]!, nFft);
    ifft(re, im);
    const start = i * hop;
    for (let j = 0; j < nFft; j++) {
      accum[start + j]! += re[j]! * window[j]!;
      norm[start + j]! += window[j]! * window[j]!;
    }
  }

  for (let i = 0; i < bufLength; i++) {
    if (norm[i]! > 1e-8) accum[i] = accum[i]! / norm[i]!;
  }

  const output = new Float32Array(length);
  for (let i = 0; i < length; i++) output[i] = accum[pad + i]!;
  return output;
}
