import { slotEnergy } from '~/codec/band';
import type { CellAssignment } from '~/codec/cells';
import { frameGate } from '~/codec/gate';
import { maskingThreshold } from '~/codec/mask';
import { istft, stft } from '~/dsp/stft';
import type { Geometry } from '~/watermarkers/perceptual/geometry';

/** The smallest magnitude that a modified bin keeps. */
const MAGNITUDE_FLOOR = 1e-9;

/**
 * The number of embedding passes.
 *
 * The analysis windows overlap by a factor near 4.6. One pass delivers only a
 * small part of the requested magnitude change to the output signal, because
 * the overlap-add averages each change with its unchanged neighbours. Each
 * further pass measures the shortfall and adds it again.
 *
 * Pass 0 modifies the magnitudes of the input and reuses the input phase.
 * Each later pass analyses the output of the previous pass and reuses that
 * phase. The magnitude target stays fixed across passes.
 */
const EMBED_PASSES = 8;

/**
 * Embed one block, repeated back to back, into one channel.
 *
 * For each active frame and slot, the target magnitude is the host magnitude
 * plus `alpha * chip * bitSign * threshold`. The masking threshold scales the
 * change to the local spectral energy, so a loud slot carries a larger change
 * than a quiet one. Gated frames stay unchanged.
 *
 * @param channel - the host channel. The function does not change it.
 * @param block - the block bits, from `buildBlock`.
 * @param cells - the keyed cell assignment.
 * @param alpha - the strength. Zero writes an unmarked copy.
 */
export function embedChannel(
  channel: Float32Array,
  geometry: Geometry,
  block: Uint8Array,
  cells: CellAssignment,
  alpha: number,
): Float32Array {
  const { plan, blockFrames } = geometry;
  const source = stft(channel, { nFft: geometry.nFft, hop: geometry.hop });
  const gate = frameGate(source.magnitude);
  let energy = slotEnergy(source.magnitude, plan);
  const threshold = maskingThreshold(energy, plan);

  const target: Float64Array[] = [];
  for (let f = 0; f < energy.length; f++) {
    const row = new Float64Array(plan.slots);
    const base = (f % blockFrames) * plan.slots;
    for (let s = 0; s < plan.slots; s++) {
      const cell = base + s;
      const bitSign = block[cells.bitIndex[cell]] ? 1 : -1;
      const delta = alpha * cells.chip[cell] * bitSign * threshold[f][s];
      row[s] = energy[f][s] + (gate[f] === 1 ? delta : 0);
    }
    target.push(row);
  }

  let spec = source;
  let output = channel;
  for (let pass = 0; pass < EMBED_PASSES; pass++) {
    if (pass > 0) {
      spec = stft(output, { nFft: geometry.nFft, hop: geometry.hop });
      energy = slotEnergy(spec.magnitude, plan);
    }
    const frames = Math.min(spec.magnitude.length, target.length);
    for (let f = 0; f < frames; f++) {
      if (gate[f] === 0) continue;
      const magnitude = spec.magnitude[f];
      for (let s = 0; s < plan.slots; s++) {
        const delta = target[f][s] - energy[f][s];
        const end = plan.binEnd[s];
        for (let k = plan.binStart[s]; k < end; k++) {
          magnitude[k] = Math.max(magnitude[k] + delta, MAGNITUDE_FLOOR);
        }
      }
    }
    output = istft(spec);
  }
  return output;
}
