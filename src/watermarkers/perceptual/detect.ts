import { slotEnergy } from '~/codec/band';
import type { CellAssignment } from '~/codec/cells';
import { frameGate } from '~/codec/gate';
import { SYNC_BITS, parseBlock, syncBits } from '~/codec/payload';
import { stft } from '~/dsp/stft';
import type { DetectionDiagnostics, DetectionResult } from '~/types';
import type { Geometry } from '~/watermarkers/perceptual/geometry';
import { localNoisePower, whiten } from '~/watermarkers/perceptual/whiten';

/**
 * The floor added to the local noise power, in decibels squared.
 *
 * The correlator divides each residual by the local noise power, so cells
 * inside a transient count for less and cells in steady passages count for
 * more. The floor stops a neighbourhood with almost no residual, such as a
 * numerically empty band in a synthetic signal, from dominating the sum.
 *
 * Real recordings measure about 60 dB² of residual power, so a floor of
 * 10 dB² costs them little. The score on the tuning file moved from 0.157 to
 * 0.148. On the synthetic tonal fixture, after requantization or resampling,
 * the floor decides between recovery and rejection. Floors of 2 and 30 were
 * also measured.
 */
const VARIANCE_FLOOR = 10;

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
 * Count the errors on the sync bits.
 *
 * The sync bits hold known values, so the count is a real measurement of
 * those 16 bits. It says nothing direct about the payload bits. The alignment
 * search picks the alignment that agrees best with the sync pattern, so the
 * sync bits are biased toward the correct value.
 *
 * @returns the fraction of the sync bits that decoded incorrectly.
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
 * Pick the block alignment that agrees best with the sync pattern.
 *
 * The score is a signed sum, so an alignment that disagrees scores low.
 */
function bestOffset(
  correlation: Float64Array,
  geometry: Geometry,
): { offset: number; score: number } {
  const pattern = syncBits();
  let chosen = 0;
  let chosenScore = -Infinity;
  for (let offset = 0; offset < geometry.blockFrames; offset++) {
    let score = 0;
    for (let b = 0; b < SYNC_BITS; b++) {
      const sign = pattern[b] ? 1 : -1;
      score += sign * correlation[offset * geometry.bits + b];
    }
    if (score > chosenScore) {
      chosenScore = score;
      chosen = offset;
    }
  }
  return { offset: chosen, score: chosenScore };
}

/** Correlate one shifted channel against the chips at every block alignment. */
function decodeAtShift(
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
        // Inverse-variance weighting: a matched filter for a signal of near
        // constant size in noise whose power differs from cell to cell.
        const value = row[s] / (rowNoise[s] + VARIANCE_FLOOR);
        sum[index] += cells.chip[cell] * value;
        sumSquares[index] += value * value;
        counts[index]++;
      }
    }
  }

  // The correlation divides by the root mean square of its inputs and by the
  // input count. The result is a mean, so bits and alignments with different
  // cell counts stay comparable.
  const correlation = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    const count = counts[i];
    if (count === 0) continue;
    const rms = Math.sqrt(sumSquares[i] / count);
    if (rms > 0) correlation[i] = sum[i] / (rms * count);
  }

  const { offset, score } = bestOffset(correlation, geometry);
  const decoded = new Uint8Array(bits);
  const strength = new Float64Array(bits);
  for (let b = 0; b < bits; b++) {
    const value = correlation[offset * bits + b];
    // The sync bits come from the correlation, never from the known pattern.
    // A copied pattern would make the sync test in parseBlock always pass.
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
 * Decode one channel.
 *
 * The function analyses the channel at every sub-hop shift and every block
 * alignment, keeps the candidate with the best sync agreement, and applies
 * the acceptance rule to that candidate alone.
 *
 * @param alignmentSteps - the number of sub-hop shifts to search.
 * @param channelIndex - the channel index, for the diagnostics.
 */
export function detectChannel(
  channel: Float32Array,
  geometry: Geometry,
  cells: CellAssignment,
  payloadBits: number,
  alignmentSteps: number,
  channelIndex: number,
): DetectionResult {
  const { plan, bits } = geometry;

  let best: Candidate | null = null;
  for (let step = 0; step < alignmentSteps; step++) {
    const shift = Math.round((step * geometry.hop) / alignmentSteps);
    if (shift >= channel.length && channel.length > 0) break;
    const candidate = decodeAtShift(channel.subarray(shift), shift, geometry, cells);
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
