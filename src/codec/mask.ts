import { WatermarkingError } from '~/types';

/** The masking threshold decreases by this value in decibels. */
const MASK_OFFSET_DB = 14;

/** A masker loses this many decibels for each slot of distance. */
const SPREAD_DB = 10;

/** A frequency band that holds contiguous bin ranges, one range per slot. */
export interface BandPlan {
  lowHz: number;
  highHz: number;
  slots: number;
  binStart: Int32Array; // per slot, inclusive
  binEnd: Int32Array; // per slot, exclusive
}

/**
 * Plan a band split into contiguous slots of FFT bins.
 * The function clamps highHz below 0.95 of the Nyquist frequency.
 * It divides the clamped band into slots of equal width in Hz.
 * The boundary sweep forces each edge past its predecessor by at least one bin.
 * This step keeps every slot non-empty even when adjacent edges round to the same bin.
 *
 * The sweep can push the top edge above the requested frequency. The returned
 * lowHz and highHz therefore give the band that the slots occupy, not the band
 * that the caller asked for. The function throws when the sweep needs more bins
 * than the clamp permits.
 */
export function planBand(
  sampleRate: number,
  nFft: number,
  lowHz: number,
  highHz: number,
  slots: number,
): BandPlan {
  const nyquist = sampleRate / 2;
  const clampedHigh = Math.min(highHz, 0.95 * nyquist);
  const hzPerBin = sampleRate / nFft;
  const maxBin = Math.floor((0.95 * nyquist) / hzPerBin);

  const boundaries = new Int32Array(slots + 1);
  for (let i = 0; i <= slots; i++) {
    const hz = lowHz + ((clampedHigh - lowHz) * i) / slots;
    boundaries[i] = Math.round(hz / hzPerBin);
  }
  for (let i = 1; i <= slots; i++) {
    if (boundaries[i] <= boundaries[i - 1]) boundaries[i] = boundaries[i - 1] + 1;
  }

  if (boundaries[slots] > maxBin) {
    throw new WatermarkingError(
      `planBand: nFft ${nFft} is too small to hold ${slots} slots below 0.95 of the Nyquist frequency`,
    );
  }

  const binStart = new Int32Array(slots);
  const binEnd = new Int32Array(slots);
  for (let s = 0; s < slots; s++) {
    binStart[s] = boundaries[s];
    binEnd[s] = boundaries[s + 1];
  }

  return {
    lowHz: boundaries[0] * hzPerBin,
    highHz: boundaries[slots] * hzPerBin,
    slots,
    binStart,
    binEnd,
  };
}

/** Compute, per frame and slot, the mean magnitude over the slot's bins. */
export function slotEnergy(magnitude: Float64Array[], plan: BandPlan): Float64Array[] {
  const result: Float64Array[] = [];
  for (const frame of magnitude) {
    const energy = new Float64Array(plan.slots);
    for (let s = 0; s < plan.slots; s++) {
      const start = plan.binStart[s];
      const end = plan.binEnd[s];
      let sum = 0;
      for (let k = start; k < end; k++) sum += frame[k];
      energy[s] = sum / (end - start);
    }
    result.push(energy);
  }
  return result;
}

/**
 * Compute the masking threshold from per-slot energy.
 * Each masker spreads energy to neighbour slots at a rate of 10 dB per slot of distance.
 * The threshold takes the strongest spread contribution, then attenuates it by MASK_OFFSET_DB.
 */
export function maskingThreshold(energy: Float64Array[], plan: BandPlan): Float64Array[] {
  const offset = Math.pow(10, -MASK_OFFSET_DB / 20);
  const result: Float64Array[] = [];
  for (const frame of energy) {
    const threshold = new Float64Array(plan.slots);
    for (let s = 0; s < plan.slots; s++) {
      let maxSpread = 0;
      for (let sp = 0; sp < plan.slots; sp++) {
        const spread = frame[sp] * Math.pow(10, (-SPREAD_DB * Math.abs(s - sp)) / 20);
        if (spread > maxSpread) maxSpread = spread;
      }
      threshold[s] = maxSpread * offset;
    }
    result.push(threshold);
  }
  return result;
}

/**
 * Mark each frame active when its total magnitude exceeds a fraction of the loudest frame.
 * A frame at or below the threshold is silent or near-silent and gets a zero flag.
 */
export function frameGate(magnitude: Float64Array[], fraction = 0.05): Uint8Array {
  const totals = new Float64Array(magnitude.length);
  let maxTotal = 0;
  for (let i = 0; i < magnitude.length; i++) {
    const frame = magnitude[i];
    let sum = 0;
    for (let k = 0; k < frame.length; k++) sum += frame[k];
    totals[i] = sum;
    if (sum > maxTotal) maxTotal = sum;
  }

  const gate = new Uint8Array(magnitude.length);
  const cutoff = fraction * maxTotal;
  for (let i = 0; i < totals.length; i++) {
    gate[i] = totals[i] > cutoff ? 1 : 0;
  }
  return gate;
}
