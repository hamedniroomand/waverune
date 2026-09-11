import { FMT_FLOAT, FMT_PCM, writeAscii } from '~/audio/wav/format';
import type { AudioBuffer } from '~/types';
import { WatermarkingError } from '~/types';

export interface WavEncodeOptions {
  bitDepth?: 16 | 24 | 32;
  float?: boolean;
}

/**
 * Encode audio as a WAV byte array.
 *
 * The default is 16-bit PCM. PCM samples are rounded and clipped to the
 * integer range of the bit depth.
 *
 * @throws WatermarkingError when `float` is set with a bit depth other than 32.
 */
export function encodeWav(audio: AudioBuffer, opts: WavEncodeOptions = {}): Uint8Array {
  const bitDepth = opts.bitDepth ?? 16;
  const float = opts.float ?? false;

  if (float && bitDepth !== 32) {
    throw new WatermarkingError('Float encoding requires a bitDepth of 32');
  }

  const numChannels = audio.channels.length;
  const frameCount = numChannels > 0 ? audio.channels[0].length : 0;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = bytesPerSample * numChannels;
  const dataSize = frameCount * blockAlign;
  const byteRate = audio.sampleRate * blockAlign;
  const formatTag = float ? FMT_FLOAT : FMT_PCM;
  const fmtChunkSize = 16;
  const headerSize = 12 + (8 + fmtChunkSize) + 8;
  const totalSize = headerSize + dataSize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  let offset = 0;
  writeAscii(bytes, offset, 'RIFF');
  offset += 4;
  view.setUint32(offset, totalSize - 8, true);
  offset += 4;
  writeAscii(bytes, offset, 'WAVE');
  offset += 4;

  writeAscii(bytes, offset, 'fmt ');
  offset += 4;
  view.setUint32(offset, fmtChunkSize, true);
  offset += 4;
  view.setUint16(offset, formatTag, true);
  offset += 2;
  view.setUint16(offset, numChannels, true);
  offset += 2;
  view.setUint32(offset, audio.sampleRate, true);
  offset += 4;
  view.setUint32(offset, byteRate, true);
  offset += 4;
  view.setUint16(offset, blockAlign, true);
  offset += 2;
  view.setUint16(offset, bitDepth, true);
  offset += 2;

  writeAscii(bytes, offset, 'data');
  offset += 4;
  view.setUint32(offset, dataSize, true);
  offset += 4;

  const dataOffset = offset;

  if (float) {
    for (let i = 0; i < frameCount; i++) {
      for (let c = 0; c < numChannels; c++) {
        const pos = dataOffset + (i * numChannels + c) * bytesPerSample;
        view.setFloat32(pos, audio.channels[c][i], true);
      }
    }
    return bytes;
  }

  const maxPositive = 2 ** (bitDepth - 1) - 1;
  const minNegative = -(2 ** (bitDepth - 1));
  for (let i = 0; i < frameCount; i++) {
    for (let c = 0; c < numChannels; c++) {
      const pos = dataOffset + (i * numChannels + c) * bytesPerSample;
      let sample = Math.round(audio.channels[c][i] * maxPositive);
      if (sample > maxPositive) sample = maxPositive;
      if (sample < minNegative) sample = minNegative;
      writePcm(view, bytes, pos, sample, bitDepth);
    }
  }
  return bytes;
}

function writePcm(
  view: DataView,
  bytes: Uint8Array,
  pos: number,
  sample: number,
  bitDepth: number,
): void {
  if (bitDepth === 16) {
    view.setInt16(pos, sample, true);
  } else if (bitDepth === 32) {
    view.setInt32(pos, sample, true);
  } else {
    // DataView has no 24-bit write. Write the three bytes in little-endian order.
    bytes[pos] = sample & 0xff;
    bytes[pos + 1] = (sample >> 8) & 0xff;
    bytes[pos + 2] = (sample >> 16) & 0xff;
  }
}
