import type {
  AudioBuffer,
  DetectOptions,
  DetectionResult,
  EmbedOptions,
  Watermarker,
} from '~/types';

/**
 * This class gives a trivial test double for the `Watermarker` interface.
 * It does not add a real watermark. `applyWatermark` only rounds each
 * sample to 5 decimal places, in the same way as Perth's dummy watermarker.
 */
export class DummyWatermarker implements Watermarker {
  applyWatermark(audio: AudioBuffer, _opts?: EmbedOptions): AudioBuffer {
    const channels = audio.channels.map((channel) => {
      const out = new Float32Array(channel.length);
      for (let i = 0; i < channel.length; i++) {
        out[i] = Math.round(channel[i] * 1e5) / 1e5;
      }
      return out;
    });
    return { sampleRate: audio.sampleRate, channels };
  }

  getWatermark(_audio: AudioBuffer, _opts?: DetectOptions): DetectionResult {
    return {
      detected: false,
      payload: null,
      correlationScore: 0,
      syncErrorRate: 1,
      band: { lowHz: 0, highHz: 0 },
      diagnostics: {
        syncValid: false,
        checksumValid: false,
        candidatePayload: 0n,
        blockOffset: 0,
        sampleShift: 0,
        activeFrames: 0,
        totalFrames: 0,
        meanCorrelation: 0,
        minCorrelation: 0,
        channel: 0,
      },
    };
  }
}
