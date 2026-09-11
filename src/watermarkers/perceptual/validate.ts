import { type AudioBuffer, WatermarkingError } from '~/types';

/**
 * Check that an audio buffer can be analysed.
 *
 * A zero-length channel is valid input and behaves as silence.
 *
 * @throws WatermarkingError when the sample rate is not a positive finite
 *   number, when the buffer holds no channels, when the channels differ in
 *   length, or when any sample is NaN or infinite.
 */
export function validateAudio(audio: AudioBuffer): void {
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
