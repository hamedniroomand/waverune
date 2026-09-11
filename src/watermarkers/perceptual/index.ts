import { assignCells } from '~/codec/cells';
import { buildBlock } from '~/codec/payload';
import {
  type AudioBuffer,
  type DetectOptions,
  type DetectionResult,
  type EmbedOptions,
  type Watermarker,
  WatermarkingError,
} from '~/types';
import {
  DEFAULT_CONFIG,
  DEFAULT_KEY,
  type PerceptualConfig,
} from '~/watermarkers/perceptual/config';
import { detectChannel } from '~/watermarkers/perceptual/detect';
import { embedChannel } from '~/watermarkers/perceptual/embed';
import { deriveGeometry } from '~/watermarkers/perceptual/geometry';
import { validateAudio } from '~/watermarkers/perceptual/validate';

export { DEFAULT_CONFIG, type PerceptualConfig } from '~/watermarkers/perceptual/config';

/**
 * A blind watermarker that spreads a payload over the magnitude spectrum.
 *
 * The watermarker modulates the short-time magnitudes inside one frequency
 * band. A keyed chip sequence carries each payload bit over many cells. A
 * simplified masking model scales the change to the local spectral energy.
 * Detection needs the key only, not the original audio.
 *
 * The embedding format has not changed since v0.2.0. Files embedded by v0.2.0
 * still detect.
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
   * @param opts - the key, the payload and the strength.
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

    const geometry = deriveGeometry(this.config, audio.sampleRate, payloadBits);
    const block = buildBlock(payload, payloadBits);
    const cells = assignCells(key, geometry.blockFrames, geometry.plan.slots, geometry.bits);

    const channels = audio.channels.map((channel) =>
      embedChannel(channel, geometry, block, cells, alpha),
    );
    return { sampleRate: audio.sampleRate, channels };
  }

  /**
   * Recover a payload from the audio with the key alone.
   *
   * The acceptance rule is deterministic. A channel is accepted when its 16
   * decoded sync bits equal the sync pattern and its 8 decoded checksum bits
   * equal the checksum of its decoded payload bits, at the alignment that
   * agrees best with the sync pattern. No correlation threshold applies.
   *
   * The function reads every channel and returns the first accepted result.
   * When no channel is accepted, it returns the result with the highest
   * correlation score, with `detected` false and `payload` null.
   *
   * Digital silence gates out every frame. The correlation is then zero, the
   * decoded bits are all zero, and the result is a rejection with a
   * correlation score of 0. The gate is relative to the loudest frame, so
   * quiet audio is analysed like loud audio. Only frames below 5% of the
   * loudest frame's magnitude sum are gated. Audio shorter than the measured
   * minimum runs through the same rule. See the README for the measured
   * durations.
   *
   * @param audio - the audio to examine.
   * @param opts - the key and the payload width.
   * @throws WatermarkingError on invalid audio.
   */
  getWatermark(audio: AudioBuffer, opts?: DetectOptions): DetectionResult {
    validateAudio(audio);
    const key = opts?.key ?? DEFAULT_KEY;
    const payloadBits = opts?.payloadBits ?? this.config.payloadBits;
    const geometry = deriveGeometry(this.config, audio.sampleRate, payloadBits);
    const cells = assignCells(key, geometry.blockFrames, geometry.plan.slots, geometry.bits);
    const steps = this.config.alignmentSteps;

    let best: DetectionResult | null = null;
    for (let c = 0; c < audio.channels.length; c++) {
      const result = detectChannel(audio.channels[c], geometry, cells, payloadBits, steps, c);
      if (result.detected) return result;
      if (best === null || result.correlationScore > best.correlationScore) best = result;
    }
    return best!;
  }
}
