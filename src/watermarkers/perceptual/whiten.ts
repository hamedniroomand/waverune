/**
 * The detector's host-removal stage.
 *
 * The correlator needs the watermark without the host signal. The host has a
 * smooth spectral envelope and the watermark does not, so a local mean in
 * decibels separates them.
 */

/** The guard value that keeps the decibel conversion finite. */
const DB_EPSILON = 1e-12;

/**
 * The half-height of the whitening neighbourhood, in frames.
 *
 * Zero means the local mean comes from the same frame only. Real recordings
 * change level by about 8 dB from one frame to the next, measured on
 * downloaded music and speech. The synthetic fixtures change by about 3 dB.
 * A neighbourhood that spans frames leaks that change into the residual,
 * where the correlator sees it as noise. The slots of one frame share the
 * change, so a within-frame mean cancels it.
 */
const WHITEN_FRAME_RADIUS = 0;

/** The half-width of the whitening neighbourhood, in slots. */
const WHITEN_SLOT_RADIUS = 3;

/** The half-height of the noise-estimate neighbourhood, in frames. */
const VARIANCE_FRAME_RADIUS = 2;

/** The half-width of the noise-estimate neighbourhood, in slots. */
const VARIANCE_SLOT_RADIUS = 3;

/**
 * Remove the host signal from the slot energies.
 *
 * Stage one converts each slot value to decibels and subtracts the mean of
 * the neighbourhood around the cell. Stage two subtracts the mean of each
 * slot over the active frames. A narrow spectral peak sits far above its
 * neighbourhood in every frame. Stage one leaves that constant offset in
 * place, and the offset is large enough to hide the watermark. Stage two
 * removes it.
 *
 * Both stages use the active frames only. A silent part of the file gives
 * slot values far below every other frame. Those values move the means and
 * hide the watermark, and the correlation does not use them.
 *
 * @param energy - the per-frame, per-slot mean magnitude.
 * @param slots - the number of slots in one frame.
 * @param active - the frame gate.
 * @returns the whitened residual, in decibels.
 */
export function whiten(energy: Float64Array[], slots: number, active: Uint8Array): Float64Array[] {
  const frames = energy.length;
  const db: Float64Array[] = [];
  for (let f = 0; f < frames; f++) {
    const row = new Float64Array(slots);
    for (let s = 0; s < slots; s++) {
      row[s] = 20 * Math.log10(energy[f][s] + DB_EPSILON);
    }
    db.push(row);
  }

  const residual: Float64Array[] = [];
  for (let f = 0; f < frames; f++) {
    const row = new Float64Array(slots);
    const firstFrame = Math.max(0, f - WHITEN_FRAME_RADIUS);
    const lastFrame = Math.min(frames - 1, f + WHITEN_FRAME_RADIUS);
    for (let s = 0; s < slots; s++) {
      const firstSlot = Math.max(0, s - WHITEN_SLOT_RADIUS);
      const lastSlot = Math.min(slots - 1, s + WHITEN_SLOT_RADIUS);
      let sum = 0;
      let cells = 0;
      for (let nf = firstFrame; nf <= lastFrame; nf++) {
        if (active[nf] === 0) continue;
        const source = db[nf];
        for (let ns = firstSlot; ns <= lastSlot; ns++) {
          sum += source[ns];
          cells++;
        }
      }
      row[s] = cells > 0 ? db[f][s] - sum / cells : 0;
    }
    residual.push(row);
  }

  for (let s = 0; s < slots; s++) {
    let sum = 0;
    let count = 0;
    for (let f = 0; f < frames; f++) {
      if (active[f] === 0) continue;
      sum += residual[f][s];
      count++;
    }
    if (count === 0) continue;
    const mean = sum / count;
    for (let f = 0; f < frames; f++) residual[f][s] -= mean;
  }
  return residual;
}

/**
 * Estimate the noise power around each cell of the whitened residual.
 *
 * The estimate is the mean squared residual over a neighbourhood of active
 * frames. It includes the cell itself. The watermark adds only a fraction of
 * a decibel, so its effect on the estimate is small.
 *
 * @param residual - the whitened residual, in decibels.
 * @param slots - the number of slots in one frame.
 * @param active - the frame gate.
 * @returns the local noise power per cell, in decibels squared.
 */
export function localNoisePower(
  residual: Float64Array[],
  slots: number,
  active: Uint8Array,
): Float64Array[] {
  const frames = residual.length;
  const power: Float64Array[] = [];
  for (let f = 0; f < frames; f++) {
    const row = new Float64Array(slots);
    const firstFrame = Math.max(0, f - VARIANCE_FRAME_RADIUS);
    const lastFrame = Math.min(frames - 1, f + VARIANCE_FRAME_RADIUS);
    for (let s = 0; s < slots; s++) {
      const firstSlot = Math.max(0, s - VARIANCE_SLOT_RADIUS);
      const lastSlot = Math.min(slots - 1, s + VARIANCE_SLOT_RADIUS);
      let sum = 0;
      let cells = 0;
      for (let nf = firstFrame; nf <= lastFrame; nf++) {
        if (active[nf] === 0) continue;
        const source = residual[nf];
        for (let ns = firstSlot; ns <= lastSlot; ns++) {
          sum += source[ns] * source[ns];
          cells++;
        }
      }
      row[s] = cells > 0 ? sum / cells : 1;
    }
    power.push(row);
  }
  return power;
}
