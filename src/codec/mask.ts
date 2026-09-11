import type { BandPlan } from '~/codec/band';

/** The threshold sits this many decibels below the strongest spread masker. */
const MASK_OFFSET_DB = 14;

/** A masker loses this many decibels per slot of distance. */
const SPREAD_DB = 10;

/**
 * Compute the masking threshold from the per-slot energy.
 *
 * Each slot spreads its energy to the other slots at a loss of `SPREAD_DB`
 * per slot of distance. The threshold of a slot is the strongest spread
 * contribution, reduced by `MASK_OFFSET_DB`. This is a simplified spreading
 * function, not a full psychoacoustic model.
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
