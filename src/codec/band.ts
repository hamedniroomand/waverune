import { WatermarkingError } from '~/types';

/** A frequency band split into slots. Each slot is a contiguous range of FFT bins. */
export interface BandPlan {
  lowHz: number;
  highHz: number;
  slots: number;
  /** The first bin of each slot, inclusive. */
  binStart: Int32Array;
  /** The last bin of each slot, exclusive. */
  binEnd: Int32Array;
}

/**
 * Split a band into slots of FFT bins.
 *
 * The function clamps `highHz` to 0.95 of the Nyquist frequency and divides
 * the band into slots of equal width in hertz. When two adjacent slot edges
 * round to the same bin, the function moves the upper edge one bin up. Every
 * slot then holds at least one bin. That move can push the top edge above the
 * requested frequency. The returned `lowHz` and `highHz` give the band that
 * the slots occupy, not the band that the caller asked for.
 *
 * @throws WatermarkingError when the slots need more bins than the clamp permits.
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

/** Compute the mean magnitude of each slot, per frame. */
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
