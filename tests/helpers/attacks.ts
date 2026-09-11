/**
 * Attacks for robustness measurement.
 *
 * Every non-identity attack here returns the altered signal together with a
 * measurement of what it changed. A test that claims robustness against an
 * attack must first check that the attack altered the input: an attack that
 * changes nothing proves nothing.
 */

/** The result of one attack on one channel. */
export interface Attacked<S extends Record<string, number>> {
  signal: Float32Array;
  /** The number of samples whose value differs from the input at the same index. */
  changedSamples: number;
  /** `changedSamples` divided by the input length. */
  changedFraction: number;
  /** The achieved severity, in the units of the attack. */
  severity: S;
}

/** Count the positions where two equal-length signals differ. */
export function countChanged(before: Float32Array, after: Float32Array): number {
  const n = Math.min(before.length, after.length);
  let changed = 0;
  for (let i = 0; i < n; i++) if (before[i] !== after[i]) changed++;
  return changed + Math.abs(before.length - after.length);
}

function report<S extends Record<string, number>>(
  before: Float32Array,
  after: Float32Array,
  severity: S,
): Attacked<S> {
  const changed = countChanged(before, after);
  return {
    signal: after,
    changedSamples: changed,
    changedFraction: before.length > 0 ? changed / before.length : 0,
    severity,
  };
}

/** The largest absolute sample value. */
export function peak(signal: Float32Array): number {
  let max = 0;
  for (const s of signal) if (Math.abs(s) > max) max = Math.abs(s);
  return max;
}

/** The root-mean-square level. */
export function rms(signal: Float32Array): number {
  let sum = 0;
  for (const s of signal) sum += s * s;
  return Math.sqrt(sum / Math.max(1, signal.length));
}

/**
 * Throw when an attack that must alter the signal did not.
 *
 * @param attacked - the attack result.
 * @param label - the attack name for the error message.
 */
export function assertAltered(attacked: Attacked<Record<string, number>>, label: string): void {
  if (attacked.changedSamples === 0) {
    throw new Error(`The attack "${label}" changed zero samples and measures nothing`);
  }
}

/** Multiply every sample by `gain`. */
export function scale(signal: Float32Array, gain: number): Attacked<{ gain: number }> {
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = signal[i] * gain;
  return report(signal, out, { gain });
}

/**
 * Hard-clip at an absolute limit.
 *
 * The severity reports the limit and the fraction of the peak that it
 * represents. A limit at or above the peak clips nothing; use
 * `clipAtPeakFraction` for a limit that is defined relative to the signal.
 */
export function clip(
  signal: Float32Array,
  limit: number,
): Attacked<{ limit: number; limitOverPeak: number }> {
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    out[i] = Math.max(-limit, Math.min(limit, signal[i]));
  }
  const p = peak(signal);
  return report(signal, out, { limit, limitOverPeak: p > 0 ? limit / p : Infinity });
}

/** Hard-clip at `fraction` of the signal's own peak, so the attack always bites. */
export function clipAtPeakFraction(
  signal: Float32Array,
  fraction: number,
): Attacked<{ limit: number; limitOverPeak: number }> {
  return clip(signal, peak(signal) * fraction);
}

/**
 * Add uniform white noise at a target signal-to-noise ratio.
 *
 * The generator is a fixed-seed linear congruential generator, so the noise
 * is the same on every run for the same seed. The severity reports the SNR
 * that the added noise achieved, measured against the input.
 */
export function addNoise(
  signal: Float32Array,
  targetSnrDb: number,
  seed = 777,
): Attacked<{ targetSnrDb: number; achievedSnrDb: number; seed: number }> {
  const amplitude = rms(signal) * 10 ** (-targetSnrDb / 20) * Math.sqrt(3);
  const out = new Float32Array(signal.length);
  const noise = whiteNoise(signal.length, amplitude, seed);
  for (let i = 0; i < signal.length; i++) out[i] = signal[i] + noise[i];
  // The achieved SNR uses the residual that the Float32 output actually
  // carries, not the noise before rounding. At weak noise levels the two
  // differ, because rounding to Float32 absorbs part of the noise.
  let noisePower = 0;
  let signalPower = 0;
  for (let i = 0; i < signal.length; i++) {
    const residual = out[i] - signal[i];
    noisePower += residual * residual;
    signalPower += signal[i] * signal[i];
  }
  const achievedSnrDb = noisePower > 0 ? 10 * Math.log10(signalPower / noisePower) : Infinity;
  return report(signal, out, { targetSnrDb, achievedSnrDb, seed });
}

/**
 * Uniform white noise at an absolute peak amplitude, from a fixed seed.
 *
 * Unlike `addNoise`, the level does not depend on any input signal, so the
 * function can build a noise floor for a silent buffer.
 */
export function whiteNoise(length: number, amplitude: number, seed: number): Float32Array {
  let state = seed >>> 0;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = (state / 4294967296 - 0.5) * 2 * amplitude;
  }
  return out;
}

/** Round every sample to a signed integer grid of `bits` bits. */
export function requantize(signal: Float32Array, bits: number): Attacked<{ bits: number }> {
  const steps = 2 ** (bits - 1) - 1;
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = Math.round(signal[i] * steps) / steps;
  return report(signal, out, { bits });
}

/** Prepend `samples` zero samples. The audio content does not move relative to itself. */
export function padLeading(signal: Float32Array, samples: number): Attacked<{ samples: number }> {
  const out = new Float32Array(signal.length + samples);
  out.set(signal, samples);
  return report(signal, out, { samples });
}

/** Append `samples` zero samples. */
export function padTrailing(signal: Float32Array, samples: number): Attacked<{ samples: number }> {
  const out = new Float32Array(signal.length + samples);
  out.set(signal, 0);
  return report(signal, out, { samples });
}

/**
 * Insert `samples` zero samples at position `at`, inside the audio.
 *
 * Unlike leading or trailing padding, this attack moves the second part of
 * the audio relative to the first, so the two parts no longer share one
 * block grid.
 */
export function insertSilence(
  signal: Float32Array,
  at: number,
  samples: number,
): Attacked<{ at: number; samples: number }> {
  const out = new Float32Array(signal.length + samples);
  out.set(signal.subarray(0, at), 0);
  out.set(signal.subarray(at), at + samples);
  return report(signal, out, { at, samples });
}

/**
 * Remove the first `samples` samples and keep everything after them.
 *
 * The severity records the exact count and the remaining length, so a test
 * can check that enough audio remains for the claim that it makes.
 */
export function removePrefix(
  signal: Float32Array,
  samples: number,
): Attacked<{ samples: number; remainingSamples: number }> {
  const out = signal.slice(samples);
  return report(signal, out, { samples, remainingSamples: out.length });
}

/**
 * Cut a fixed-duration excerpt.
 *
 * @param signal - the source channel.
 * @param start - the first sample to keep.
 * @param length - the number of samples to keep.
 */
export function excerpt(
  signal: Float32Array,
  start: number,
  length: number,
): Attacked<{ start: number; length: number }> {
  const out = signal.slice(start, start + length);
  return report(signal, out, { start, length: out.length });
}
