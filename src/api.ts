/**
 * The functional entry points of the library.
 *
 * `embed` and `detect` wrap `PerceptualWatermarker` for callers who want
 * one call and the default configuration. The class stays available for
 * callers who tune the configuration or reuse one instance.
 */
import type { AudioBuffer, DetectOptions, DetectionResult, EmbedOptions } from '~/types';
import { type PerceptualConfig, PerceptualWatermarker } from '~/watermarkers/perceptual';

/**
 * Embed a payload into every channel of `audio`.
 *
 * @param audio - the audio to mark. The function does not change it.
 * @param opts - the key, payload and strength. See `EmbedOptions`.
 * @param config - overrides for the watermarker geometry. Detection must use the same values.
 * @returns a new, watermarked `AudioBuffer`.
 */
export function embed(
  audio: AudioBuffer,
  opts?: EmbedOptions,
  config?: Partial<PerceptualConfig>,
): AudioBuffer {
  return new PerceptualWatermarker(config).applyWatermark(audio, opts);
}

/**
 * Detect a payload in `audio`, blind, with the key alone.
 *
 * @param audio - the audio to check.
 * @param opts - the key and payload width. See `DetectOptions`.
 * @param config - the same overrides that `embed` used, if any.
 * @returns the detection result. `payload` is `null` unless `detected` is true.
 */
export function detect(
  audio: AudioBuffer,
  opts?: DetectOptions,
  config?: Partial<PerceptualConfig>,
): DetectionResult {
  return new PerceptualWatermarker(config).getWatermark(audio, opts);
}
