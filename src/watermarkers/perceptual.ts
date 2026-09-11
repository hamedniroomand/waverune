import { frameGate, maskingThreshold, planBand, slotEnergy, type BandPlan } from '~/codec/mask';
import { SYNC_BITS, buildBlock, parseBlock, syncBits, totalBits } from '~/codec/payload';
import { assignCells, type CellAssignment } from '~/codec/prng';
import { istft, stft } from '~/dsp/stft';
import {
  type AudioBuffer,
  type DetectOptions,
  type DetectionDiagnostics,
  type DetectionResult,
  type EmbedOptions,
  type Watermarker,
  WatermarkingError,
} from '~/types';

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
  /**
   * The number of sub-hop shifts that detection searches.
   *
   * The embedder places its chips on a frame grid. A signal that lost a
   * prefix which is not a whole number of hops puts the detector's grid
   * between the embedder's frames, and the correlation weakens. Detection
   * therefore analyses the signal at `alignmentSteps` shifts spaced
   * `hop / alignmentSteps` samples apart and keeps the alignment with the best
   * sync agreement. A value of 1 searches the block alignment only.
   *
   * The default of 8 leaves at most `hop / 16` samples of misalignment
   * (28 samples, 0.6 ms, at 44.1 kHz). Detection time grows in proportion
   * to this value: about 0.1 s per step for six seconds of 44.1 kHz audio on
   * an Apple M-series laptop.
   */
  alignmentSteps: number;
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
  alignmentSteps: 8,
};

/** The key that applies when the caller gives no key. */
const DEFAULT_KEY = 'waverune';

/** The smallest magnitude that a modified bin keeps. */
const MAGNITUDE_FLOOR = 1e-9;

/** The guard value that keeps the decibel conversion finite. */
const DB_EPSILON = 1e-12;

/**
 * The half-height of the whitening neighbourhood, in frames.
 *
 * Zero: the local mean comes from the same frame only. Real recordings
 * change level by about 8 dB from one frame to the next (measured on
 * downloaded music and speech), against 3 dB for the synthetic fixtures.
 * A neighbourhood that spans frames leaks that change into the residual,
 * where it looks like noise to the correlator. Slots within one frame share
 * the change, so a within-frame mean cancels it.
 */
const WHITEN_FRAME_RADIUS = 0;

/** The half-width of the whitening neighbourhood, in slots. */
const WHITEN_SLOT_RADIUS = 3;

/** The half-height of the noise-estimate neighbourhood, in frames. */
const VARIANCE_FRAME_RADIUS = 2;

/** The half-width of the noise-estimate neighbourhood, in slots. */
const VARIANCE_SLOT_RADIUS = 3;

/**
 * The floor added to the local noise power, in dB squared.
 *
 * The correlator divides each residual by the local noise power, so cells
 * inside a transient count for less and cells in steady passages count for
 * more. The floor keeps a neighbourhood with almost no residual (a
 * numerically empty band in a synthetic signal) from dominating. Real
 * recordings measure about 60 dB² of residual power, so a floor of 10 dB²
 * costs them little (scores 0.157 to 0.148 on the tuning file); on the
 * synthetic tonal fixture after requantization or resampling it decides
 * between recovery and rejection. Floors of 2 and 30 were measured too.
 */
const VARIANCE_FLOOR = 10;

/**
 * The number of embedding passes.
 *
 * The analysis windows overlap by a factor near 4.6. One pass therefore
 * delivers only a small part of the requested magnitude change to the output
 * signal. Each further pass measures the shortfall and adds it again.
 *
 * Only the first pass reuses the phase of the input signal. Every later pass
 * analyses the signal that the previous pass produced and reuses that
 * signal's phase. The output phase therefore differs from the input phase by
 * whatever the magnitude changes and the overlap-add introduced.
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

/** The outcome of decoding one channel at one sub-hop shift. */
interface Candidate {
  syncScore: number;
  blockOffset: number;
  sampleShift: number;
  decoded: Uint8Array;
  strength: Float64Array;
  activeFrames: number;
  totalFrames: number;
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
 * frames. It includes the cell itself: the watermark contributes only a
 * fraction of a decibel, so its effect on the estimate is small.
 *
 * @param residual - the whitened residual, in decibels.
 * @param slots - the number of slots in one frame.
 * @param active - the frame gate.
 * @returns the local noise power per cell, in decibels squared.
 */
function localNoisePower(
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

/**
 * Count the errors on the sync bits.
 *
 * The sync bits hold known values, so the count is a real measurement of
 * those 16 bits. It says nothing direct about the payload bits: the
 * alignment search picks the alignment that agrees best with the sync
 * pattern, so the sync bits are biased towards the correct value. The value
 * is not a bound on the payload bit error rate in either direction.
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
 * Check that an audio buffer can be analysed.
 *
 * @param audio - the buffer to check.
 * @throws WatermarkingError when the sample rate is not a positive finite
 *   number, when the buffer holds no channels, when the channels differ in
 *   length, or when any sample is NaN or infinite. A zero-length channel is
 *   valid input and behaves as silence.
 */
function validateAudio(audio: AudioBuffer): void {
  if (!Number.isFinite(audio.sampleRate) || audio.sampleRate <= 0) {
    throw new WatermarkingError(`Invalid sample rate: ${String(audio.sampleRate)}`);
  }
  if (audio.channels.length === 0) {
    throw new WatermarkingError('The audio buffer holds no channels');
  }
  const length = audio.channels[0].length;
  for (const channel of audio.channels) {
    if (channel.length !== length) {
      throw new WatermarkingError('Every channel must hold the same number of samples');
    }
    for (let i = 0; i < channel.length; i++) {
      if (!Number.isFinite(channel[i])) {
        throw new WatermarkingError(`Sample ${i} is not a finite number`);
      }
    }
  }
}

/**
 * A blind watermarker that spreads a payload over the magnitude spectrum.
 *
 * The watermarker modulates the short-time magnitudes inside one frequency
 * band. A keyed chip sequence carries each payload bit over many cells. A
 * simplified masking model scales the change to the local spectral energy.
 * Detection needs the key only, not the original audio.
 *
 * The embedding format has not changed since v0.2.0. The detector changed
 * in v0.3.0: within-frame whitening and inverse-variance weighting replaced
 * a time-and-frequency whitening with equal weights, after real recordings
 * failed to detect at the default strength. Files embedded by v0.2.0 still
 * detect.
 */
export class PerceptualWatermarker implements Watermarker {
  private readonly config: PerceptualConfig;

  constructor(config?: Partial<PerceptualConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (!Number.isInteger(this.config.alignmentSteps) || this.config.alignmentSteps < 1) {
      throw new WatermarkingError('alignmentSteps must be a positive integer');
    }
  }

  /**
   * Embed a payload into every channel of the audio.
   *
   * @param audio - the source audio. The function does not change it.
   * @param opts - the key, the payload and the strength to use.
   * @returns a new audio buffer that holds the watermark.
   * @throws WatermarkingError on invalid audio, when the payload does not
   *   fit in the configured payload width, or when `alpha` is negative, NaN
   *   or infinite. An `alpha` of 0 is valid and writes an unmarked copy.
   */
  applyWatermark(audio: AudioBuffer, opts?: EmbedOptions): AudioBuffer {
    validateAudio(audio);
    const key = opts?.key ?? DEFAULT_KEY;
    const payload = opts?.payload ?? 0n;
    const alpha = opts?.alpha ?? this.config.alpha;
    if (!Number.isFinite(alpha) || alpha < 0) {
      throw new WatermarkingError(
        `alpha must be a finite number of 0 or more, got ${String(alpha)}`,
      );
    }
    const payloadBits = this.config.payloadBits;

    const geometry = this.geometry(audio.sampleRate, payloadBits);
    const block = buildBlock(payload, payloadBits);
    const cells = assignCells(key, geometry.blockFrames, geometry.plan.slots, geometry.bits);

    const channels = audio.channels.map((channel) =>
      this.embedChannel(channel, geometry, block, cells.bitIndex, cells.chip, alpha),
    );
    return { sampleRate: audio.sampleRate, channels };
  }

  /**
   * Recover a payload from the audio with the key alone.
   *
   * The acceptance rule is deterministic: a channel is accepted when its 16
   * decoded sync bits equal the sync pattern and its 8 decoded checksum bits
   * equal the checksum of its decoded payload bits, at the alignment that
   * agrees best with the sync pattern. No correlation threshold applies.
   *
   * Detection whitens the slot energies within each frame, weights every
   * cell by the inverse of its local noise power, and correlates the result
   * against the keyed chips.
   *
   * The function reads every channel and returns the first accepted result.
   * If no channel is accepted, it returns the result with the highest
   * correlation score, with `detected` false and `payload` null.
   *
   * Digital silence gates out every frame. The correlation is then zero, the
   * decoded bits are all zero, and the result is a rejection with a
   * correlation score of 0. The gate is relative to the loudest frame, so
   * quiet audio is analysed like loud audio; only frames below 5% of the
   * loudest frame's magnitude sum are gated. Audio shorter than the measured
   * minimum still runs through the same rule; see the README for the
   * measured durations.
   *
   * @param audio - the audio to examine.
   * @param opts - the key and the payload width to use.
   * @returns the detection result.
   * @throws WatermarkingError on invalid audio.
   */
  getWatermark(audio: AudioBuffer, opts?: DetectOptions): DetectionResult {
    validateAudio(audio);
    const key = opts?.key ?? DEFAULT_KEY;
    const payloadBits = opts?.payloadBits ?? this.config.payloadBits;
    const geometry = this.geometry(audio.sampleRate, payloadBits);
    const cells = assignCells(key, geometry.blockFrames, geometry.plan.slots, geometry.bits);

    let best: DetectionResult | null = null;
    for (let c = 0; c < audio.channels.length; c++) {
      const result = this.detectChannel(audio.channels[c], geometry, cells, payloadBits, c);
      if (result.detected) return result;
      if (best === null || result.correlationScore > best.correlationScore) best = result;
    }
    return best!;
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

    const target: Float64Array[] = [];
    for (let f = 0; f < energy.length; f++) {
      const row = new Float64Array(plan.slots);
      const base = (f % blockFrames) * plan.slots;
      for (let s = 0; s < plan.slots; s++) {
        const cell = base + s;
        const bitSign = block[bitIndex[cell]] ? 1 : -1;
        const delta = alpha * chip[cell] * bitSign * threshold[f][s];
        row[s] = energy[f][s] + (gate[f] === 1 ? delta : 0);
      }
      target.push(row);
    }

    // Pass 0 modifies the magnitudes of the input and reuses the input phase.
    // Each later pass re-analyses its predecessor's output and reuses that
    // output's phase. The magnitude target stays fixed across passes.
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

  /**
   * Decode one channel.
   *
   * The function analyses the channel at every configured sub-hop shift and
   * every block alignment, keeps the candidate with the best sync agreement,
   * and applies the acceptance rule to that candidate alone.
   */
  private detectChannel(
    channel: Float32Array,
    geometry: Geometry,
    cells: CellAssignment,
    payloadBits: number,
    channelIndex: number,
  ): DetectionResult {
    const { plan, bits } = geometry;
    const steps = this.config.alignmentSteps;

    let best: Candidate | null = null;
    for (let step = 0; step < steps; step++) {
      const shift = Math.round((step * geometry.hop) / steps);
      if (shift >= channel.length && channel.length > 0) break;
      const candidate = this.decodeAtShift(channel.subarray(shift), shift, geometry, cells);
      if (best === null || candidate.syncScore > best.syncScore) best = candidate;
    }
    const chosen = best!;

    const parsed = parseBlock(chosen.decoded, payloadBits);

    let total = 0;
    let min = Infinity;
    for (let b = 0; b < bits; b++) {
      total += chosen.strength[b];
      if (chosen.strength[b] < min) min = chosen.strength[b];
    }
    const mean = bits > 0 ? total / bits : 0;

    const diagnostics: DetectionDiagnostics = {
      syncValid: parsed.syncValid,
      checksumValid: parsed.checksumValid,
      candidatePayload: parsed.payload,
      blockOffset: chosen.blockOffset,
      sampleShift: chosen.sampleShift,
      activeFrames: chosen.activeFrames,
      totalFrames: chosen.totalFrames,
      meanCorrelation: mean,
      minCorrelation: Number.isFinite(min) ? min : 0,
      channel: channelIndex,
    };

    return {
      detected: parsed.valid,
      payload: parsed.valid ? parsed.payload : null,
      correlationScore: mean / (1 + mean),
      syncErrorRate: syncErrorRate(chosen.decoded),
      band: { lowHz: plan.lowHz, highHz: plan.highHz },
      diagnostics,
    };
  }

  /** Correlate one shifted channel against the chips at every block alignment. */
  private decodeAtShift(
    channel: Float32Array,
    sampleShift: number,
    geometry: Geometry,
    cells: CellAssignment,
  ): Candidate {
    const { plan, blockFrames, bits } = geometry;
    const spec = stft(channel, { nFft: geometry.nFft, hop: geometry.hop });
    const gate = frameGate(spec.magnitude);
    const residual = whiten(slotEnergy(spec.magnitude, plan), plan.slots, gate);
    const noise = localNoisePower(residual, plan.slots, gate);

    const size = blockFrames * bits;
    const sum = new Float64Array(size);
    const sumSquares = new Float64Array(size);
    const counts = new Int32Array(size);

    let activeFrames = 0;
    for (let f = 0; f < residual.length; f++) {
      if (gate[f] === 0) continue;
      activeFrames++;
      const row = residual[f];
      const rowNoise = noise[f];
      for (let offset = 0; offset < blockFrames; offset++) {
        const cellBase = ((f + offset) % blockFrames) * plan.slots;
        const bitBase = offset * bits;
        for (let s = 0; s < plan.slots; s++) {
          const cell = cellBase + s;
          const index = bitBase + cells.bitIndex[cell];
          // Inverse-variance weighting: a matched filter for a signal of
          // roughly constant size in noise whose power varies from cell to cell.
          const value = row[s] / (rowNoise[s] + VARIANCE_FLOOR);
          sum[index] += cells.chip[cell] * value;
          sumSquares[index] += value * value;
          counts[index]++;
        }
      }
    }

    // The correlation divides by the root-mean-square of its own inputs and by
    // the number of inputs. The result is a mean, so bits and alignments that
    // hold different numbers of cells stay comparable.
    const correlation = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      const count = counts[i];
      if (count === 0) continue;
      const rms = Math.sqrt(sumSquares[i] / count);
      if (rms > 0) correlation[i] = sum[i] / (rms * count);
    }

    const { offset, score } = this.bestOffset(correlation, geometry);
    const decoded = new Uint8Array(bits);
    const strength = new Float64Array(bits);
    for (let b = 0; b < bits; b++) {
      const value = correlation[offset * bits + b];
      // The sync bits come from the correlation, never from the known pattern.
      // A copied pattern would turn the sync test in parseBlock into a no-op.
      decoded[b] = value > 0 ? 1 : 0;
      strength[b] = Math.abs(value);
    }

    return {
      syncScore: score,
      blockOffset: offset,
      sampleShift,
      decoded,
      strength,
      activeFrames,
      totalFrames: residual.length,
    };
  }

  /**
   * Pick the block alignment that agrees best with the sync pattern.
   * The score is a signed sum, so an alignment that disagrees scores low.
   */
  private bestOffset(
    correlation: Float64Array,
    geometry: Geometry,
  ): { offset: number; score: number } {
    const pattern = syncBits();
    let bestOffset = 0;
    let bestScore = -Infinity;
    for (let offset = 0; offset < geometry.blockFrames; offset++) {
      let score = 0;
      for (let b = 0; b < SYNC_BITS; b++) {
        const sign = pattern[b] ? 1 : -1;
        score += sign * correlation[offset * geometry.bits + b];
      }
      if (score > bestScore) {
        bestScore = score;
        bestOffset = offset;
      }
    }
    return { offset: bestOffset, score: bestScore };
  }
}
