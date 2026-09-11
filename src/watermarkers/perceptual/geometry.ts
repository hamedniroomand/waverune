import { planBand, type BandPlan } from '~/codec/band';
import { totalBits } from '~/codec/payload';
import type { PerceptualConfig } from '~/watermarkers/perceptual/config';

/** The frame grid, the block size and the band plan for one sample rate. */
export interface Geometry {
  nFft: number;
  hop: number;
  blockFrames: number;
  /** The number of bits in one block: sync, payload and checksum. */
  bits: number;
  plan: BandPlan;
}

/**
 * Derive the geometry from the configuration and the sample rate.
 *
 * The configuration gives the window, the hop and the block in seconds, so
 * the frame grid lines up in time across sample rates. The FFT size is the
 * power of two nearest to the window length.
 */
export function deriveGeometry(
  config: PerceptualConfig,
  sampleRate: number,
  payloadBits: number,
): Geometry {
  const nFft = 2 ** Math.round(Math.log2(sampleRate * config.windowSeconds));
  const hop = Math.round(sampleRate * config.hopSeconds);
  const blockFrames = Math.round(config.blockSeconds / config.hopSeconds);
  const bits = totalBits(payloadBits);
  const plan = planBand(sampleRate, nFft, config.lowHz, config.highHz, config.slots);
  return { nFft, hop, blockFrames, bits, plan };
}
