import { assignCells } from "../codec/prng";
import { SYNC_BITS, buildBlock, parseBlock, syncBits, totalBits } from "../codec/payload";
import {
  frameGate,
  maskingThreshold,
  planBand,
  slotEnergy,
  type BandPlan,
} from "../codec/mask";
import { istft, stft } from "../dsp/stft";
import type {
  AudioBuffer,
  DetectOptions,
  DetectionResult,
  EmbedOptions,
  Watermarker,
} from "../types";

/** The tunable geometry and strength of the perceptual watermarker. */
export interface PerceptualConfig {
  hopSeconds: number;
  windowSeconds: number;
  lowHz: number;
  highHz: number;
  slots: number;
  blockSeconds: number;
  payloadBits: number;
  alpha: number;
}

export const DEFAULT_CONFIG: PerceptualConfig = {
  hopSeconds: 0.01,
  windowSeconds: 0.046,
  lowHz: 500,
  highHz: 5000,
  slots: 48,
  blockSeconds: 1.5,
  payloadBits: 32,
  alpha: 0.45,
};

/** The key that applies when the caller gives no key. */
const DEFAULT_KEY = "wavemark";

/** The smallest magnitude that a modified bin keeps. */
const MAGNITUDE_FLOOR = 1e-9;

/** The guard value that keeps the decibel conversion finite. */
const DB_EPSILON = 1e-12;

/** The half-height of the whitening neighbourhood, in frames. */
const WHITEN_FRAME_RADIUS = 2;

/** The half-width of the whitening neighbourhood, in slots. */
const WHITEN_SLOT_RADIUS = 3;

/**
 * The number of embedding passes.
 *
 * The analysis windows overlap by a factor near 4.6. One pass therefore
 * delivers only a small part of the requested magnitude change to the output
 * signal. Each further pass measures the shortfall and adds it again.
 */
const EMBED_PASSES = 8;

/** The frame grid, the block size and the band plan for one sample rate. */
interface Geometry {
  nFft: number;
  hop: number;
  blockFrames: number;
  bits: number;
  plan: BandPlan;
}

/**
 * Remove the host signal from the slot values.
 *
 * The function converts each slot value to decibels. It then subtracts the
 * mean of the neighbourhood around the cell. The spectral envelope of the
 * host is smooth across this neighbourhood, but the watermark is not. The
 * subtraction therefore keeps the watermark and drops the host.
 *
 * Both stages use the active frames only. A silent part of the file gives
 * slot values far below every other frame. Those values move the means and
 * hide the watermark, and the correlation does not use them.
 *
 * A second stage subtracts the mean of each slot over the active frames. A narrow
 * spectral peak sits far above its neighbourhood in every frame. The first
 * stage leaves that constant offset in place, and the offset is large enough
 * to hide the watermark. The second stage removes it.
 *
 * @param energy - the per-frame, per-slot mean magnitude.
 * @param slots - the number of slots in one frame.
 * @param active - the frame gate. The statistics use the active frames only.
 * @returns the whitened residual, in decibels.
 */
function whiten(energy: Float64Array[], slots: number, active: Uint8Array): Float64Array[] {
  const frames = energy.length;
  const db: Float64Array[] = new Array(frames);
  for (let f = 0; f < frames; f++) {
    const row = new Float64Array(slots);
    for (let s = 0; s < slots; s++) {
      row[s] = 20 * Math.log10(energy[f]![s]! + DB_EPSILON);
    }
    db[f] = row;
  }

  const residual: Float64Array[] = new Array(frames);
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
        const source = db[nf]!;
        for (let ns = firstSlot; ns <= lastSlot; ns++) {
          sum += source[ns]!;
          cells++;
        }
      }
      row[s] = cells > 0 ? db[f]![s]! - sum / cells : 0;
    }
    residual[f] = row;
  }

  for (let s = 0; s < slots; s++) {
    let sum = 0;
    let count = 0;
    for (let f = 0; f < frames; f++) {
      if (active[f] === 0) continue;
      sum += residual[f]![s]!;
      count++;
    }
    if (count === 0) continue;
    const mean = sum / count;
    for (let f = 0; f < frames; f++) residual[f]![s]! -= mean;
  }
  return residual;
}

/**
 * Measure the bit error rate on the sync bits.
 *
 * The sync bits hold known values, so the function counts real errors. The
 * result is a lower bound, not an unbiased estimate: the alignment search
 * picks the offset that agrees best with the sync pattern, so these bits are
 * biased towards the correct value. The true rate over the payload bits is
 * equal to this value or higher.
 *
 * @param decoded - the decoded block.
 * @returns the fraction of the sync bits that decode incorrectly.
 */
function syncErrorRate(decoded: Uint8Array): number {
  const pattern = syncBits();
  let wrong = 0;
  for (let b = 0; b < SYNC_BITS; b++) {
    if (decoded[b] !== pattern[b]) wrong++;
  }
  return wrong / SYNC_BITS;
}

/**
 * A blind watermarker that spreads a payload over the magnitude spectrum.
 *
 * The watermarker modulates the short-time magnitudes inside one frequency
 * band. A keyed chip sequence carries each payload bit over many cells. A
 * masking threshold keeps the change below the audible level. Detection
 * needs the key only, not the original audio.
 */
export class PerceptualWatermarker implements Watermarker {
  private readonly config: PerceptualConfig;

  constructor(config?: Partial<PerceptualConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Embed a payload into every channel of the audio.
   *
   * @param audio - the source audio. The function does not change it.
   * @param opts - the key, the payload and the strength to use.
   * @returns a new audio buffer that holds the watermark.
   */
  applyWatermark(audio: AudioBuffer, opts?: EmbedOptions): AudioBuffer {
    const key = opts?.key ?? DEFAULT_KEY;
    const payload = opts?.payload ?? 0n;
    const alpha = opts?.alpha ?? this.config.alpha;
    const payloadBits = this.config.payloadBits;

    const geometry = this.geometry(audio.sampleRate, payloadBits);
    const block = buildBlock(payload, payloadBits);
    const cells = assignCells(
      key,
      geometry.blockFrames,
      geometry.plan.slots,
      geometry.bits,
    );

    const channels = audio.channels.map((channel) =>
      this.embedChannel(channel, geometry, block, cells.bitIndex, cells.chip, alpha),
    );
    return { sampleRate: audio.sampleRate, channels };
  }

  /**
   * Recover a payload from the audio with the key alone.
   *
   * The function reads every channel. It returns the first result that
   * passes the sync and checksum test. If no channel passes, it returns the
   * result with the highest confidence and reports no detection.
   *
   * @param audio - the audio to examine.
   * @param opts - the key and the payload width to use.
   * @returns the detection result.
   */
  getWatermark(audio: AudioBuffer, opts?: DetectOptions): DetectionResult {
    const key = opts?.key ?? DEFAULT_KEY;
    const payloadBits = opts?.payloadBits ?? this.config.payloadBits;
    const geometry = this.geometry(audio.sampleRate, payloadBits);

    let best: DetectionResult = {
      detected: false,
      payload: null,
      confidence: 0,
      bitErrorEstimate: 1,
      band: { lowHz: geometry.plan.lowHz, highHz: geometry.plan.highHz },
    };

    for (const channel of audio.channels) {
      const result = this.detectChannel(channel, geometry, key, payloadBits);
      if (result.detected) return result;
      if (result.confidence > best.confidence) best = result;
    }
    return best;
  }

  /** Derive the frame grid, the block size and the band plan. */
  private geometry(sampleRate: number, payloadBits: number): Geometry {
    const nFft = 2 ** Math.round(Math.log2(sampleRate * this.config.windowSeconds));
    const hop = Math.round(sampleRate * this.config.hopSeconds);
    const blockFrames = Math.round(this.config.blockSeconds / this.config.hopSeconds);
    const bits = totalBits(payloadBits);
    const plan = planBand(
      sampleRate,
      nFft,
      this.config.lowHz,
      this.config.highHz,
      this.config.slots,
    );
    return { nFft, hop, blockFrames, bits, plan };
  }

  /** Embed one block, repeated back to back, into one channel. */
  private embedChannel(
    channel: Float32Array,
    geometry: Geometry,
    block: Uint8Array,
    bitIndex: Int32Array,
    chip: Int8Array,
    alpha: number,
  ): Float32Array {
    const { plan, blockFrames } = geometry;
    const source = stft(channel, { nFft: geometry.nFft, hop: geometry.hop });
    const gate = frameGate(source.magnitude);
    let energy = slotEnergy(source.magnitude, plan);
    const threshold = maskingThreshold(energy, plan);

    const target: Float64Array[] = new Array(energy.length);
    for (let f = 0; f < energy.length; f++) {
      const row = new Float64Array(plan.slots);
      const base = (f % blockFrames) * plan.slots;
      for (let s = 0; s < plan.slots; s++) {
        const cell = base + s;
        const bitSign = block[bitIndex[cell]!] ? 1 : -1;
        const delta = alpha * chip[cell]! * bitSign * threshold[f]![s]!;
        row[s] = energy[f]![s]! + (gate[f] === 1 ? delta : 0);
      }
      target[f] = row;
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
        const magnitude = spec.magnitude[f]!;
        for (let s = 0; s < plan.slots; s++) {
          const delta = target[f]![s]! - energy[f]![s]!;
          const end = plan.binEnd[s]!;
          for (let k = plan.binStart[s]!; k < end; k++) {
            magnitude[k] = Math.max(magnitude[k]! + delta, MAGNITUDE_FLOOR);
          }
        }
      }
      output = istft(spec);
    }
    return output;
  }

  /** Search every block alignment in one channel and decode the best one. */
  private detectChannel(
    channel: Float32Array,
    geometry: Geometry,
    key: string,
    payloadBits: number,
  ): DetectionResult {
    const { plan, blockFrames, bits } = geometry;
    const spec = stft(channel, { nFft: geometry.nFft, hop: geometry.hop });
    const gate = frameGate(spec.magnitude);
    const residual = whiten(slotEnergy(spec.magnitude, plan), plan.slots, gate);
    const cells = assignCells(key, blockFrames, plan.slots, bits);

    const size = blockFrames * bits;
    const sum = new Float64Array(size);
    const sumSquares = new Float64Array(size);
    const counts = new Int32Array(size);

    for (let f = 0; f < residual.length; f++) {
      if (gate[f] === 0) continue;
      const row = residual[f]!;
      for (let offset = 0; offset < blockFrames; offset++) {
        const cellBase = ((f + offset) % blockFrames) * plan.slots;
        const bitBase = offset * bits;
        for (let s = 0; s < plan.slots; s++) {
          const cell = cellBase + s;
          const index = bitBase + cells.bitIndex[cell]!;
          const value = row[s]!;
          sum[index]! += cells.chip[cell]! * value;
          sumSquares[index]! += value * value;
          counts[index]!++;
        }
      }
    }

    // The correlation divides by the root-mean-square of its own inputs and by
    // the number of inputs. The result is a mean, so bits and alignments that
    // hold different numbers of cells stay comparable.
    const correlation = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      const count = counts[i]!;
      if (count === 0) continue;
      const rms = Math.sqrt(sumSquares[i]! / count);
      if (rms > 0) correlation[i] = sum[i]! / (rms * count);
    }

    const offset = this.bestOffset(correlation, geometry);
    const decoded = new Uint8Array(bits);
    const strength = new Float64Array(bits);
    for (let b = 0; b < bits; b++) {
      const value = correlation[offset * bits + b]!;
      // The sync bits come from the correlation, never from the known pattern.
      // A copied pattern would turn the sync test in parseBlock into a no-op.
      decoded[b] = value > 0 ? 1 : 0;
      strength[b] = Math.abs(value);
    }

    const parsed = parseBlock(decoded, payloadBits);

    let total = 0;
    for (let b = 0; b < bits; b++) total += strength[b]!;
    const mean = bits > 0 ? total / bits : 0;

    return {
      detected: parsed.valid,
      payload: parsed.valid ? parsed.payload : null,
      confidence: mean / (1 + mean),
      bitErrorEstimate: syncErrorRate(decoded),
      band: { lowHz: plan.lowHz, highHz: plan.highHz },
    };
  }

  /**
   * Pick the block alignment that agrees best with the sync pattern.
   * The score is a signed sum, so an alignment that disagrees scores low.
   */
  private bestOffset(correlation: Float64Array, geometry: Geometry): number {
    const pattern = syncBits();
    let bestOffset = 0;
    let bestScore = -Infinity;
    for (let offset = 0; offset < geometry.blockFrames; offset++) {
      let score = 0;
      for (let b = 0; b < SYNC_BITS; b++) {
        const sign = pattern[b] ? 1 : -1;
        score += sign * correlation[offset * geometry.bits + b]!;
      }
      if (score > bestScore) {
        bestScore = score;
        bestOffset = offset;
      }
    }
    return bestOffset;
  }
}
