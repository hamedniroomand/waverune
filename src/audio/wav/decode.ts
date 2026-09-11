import { FMT_FLOAT, FMT_PCM, readAscii } from '~/audio/wav/format';
import type { AudioBuffer } from '~/types';
import { WatermarkingError } from '~/types';

interface FmtInfo {
  formatTag: number;
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
}

/**
 * Decode a WAV byte array into float channels in the range [-1, 1].
 *
 * The decoder accepts 16-, 24- and 32-bit PCM and 32-bit IEEE float. It
 * rejects header values that a crafted file can use to hang the loop or to
 * force a huge allocation.
 *
 * @throws WatermarkingError when the bytes are not a supported WAV file.
 */
export function decodeWav(data: Uint8Array): AudioBuffer {
  if (data.byteLength < 12) {
    throw new WatermarkingError('WAV data too short to contain a RIFF header');
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    throw new WatermarkingError('Not a valid RIFF/WAVE file');
  }

  let offset = 12;
  let fmt: FmtInfo | null = null;
  let dataOffset = -1;
  let dataLength = -1;

  // The loop steps through the chunks by size. It finds `fmt ` and `data` at
  // any position, after chunks such as `LIST` or `fact`.
  while (offset + 8 <= data.byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const bodyOffset = offset + 8;

    if (chunkId === 'fmt ') {
      fmt = {
        formatTag: view.getUint16(bodyOffset, true),
        numChannels: view.getUint16(bodyOffset + 2, true),
        sampleRate: view.getUint32(bodyOffset + 4, true),
        bitsPerSample: view.getUint16(bodyOffset + 14, true),
      };
    } else if (chunkId === 'data') {
      dataOffset = bodyOffset;
      dataLength = chunkSize;
    }

    // A chunk with an odd size has one pad byte.
    offset = bodyOffset + chunkSize + (chunkSize % 2);
  }

  if (!fmt) {
    throw new WatermarkingError('Missing fmt chunk in WAV data');
  }
  if (dataOffset < 0) {
    throw new WatermarkingError('Missing data chunk in WAV data');
  }
  if (fmt.formatTag !== FMT_PCM && fmt.formatTag !== FMT_FLOAT) {
    throw new WatermarkingError(`Unsupported WAV format tag: ${fmt.formatTag}`);
  }

  const { numChannels, sampleRate, bitsPerSample, formatTag } = fmt;

  if (numChannels < 1) {
    throw new WatermarkingError(`Invalid WAV channel count: ${numChannels}`);
  }
  if (bitsPerSample !== 16 && bitsPerSample !== 24 && bitsPerSample !== 32) {
    throw new WatermarkingError(`Unsupported WAV bit depth: ${bitsPerSample}`);
  }
  if (formatTag === FMT_FLOAT && bitsPerSample !== 32) {
    throw new WatermarkingError(`Unsupported IEEE float bit depth: ${bitsPerSample}`);
  }
  const availableLength = Math.max(0, data.byteLength - dataOffset);
  if (dataLength > availableLength) {
    dataLength = availableLength;
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameCount = Math.floor(dataLength / (bytesPerSample * numChannels));
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(new Float32Array(frameCount));

  if (formatTag === FMT_FLOAT) {
    for (let i = 0; i < frameCount; i++) {
      for (let c = 0; c < numChannels; c++) {
        const pos = dataOffset + (i * numChannels + c) * bytesPerSample;
        channels[c][i] = view.getFloat32(pos, true);
      }
    }
    return { sampleRate, channels };
  }

  const scale = 2 ** (bitsPerSample - 1);
  for (let i = 0; i < frameCount; i++) {
    for (let c = 0; c < numChannels; c++) {
      const pos = dataOffset + (i * numChannels + c) * bytesPerSample;
      channels[c][i] = readPcm(view, pos, bitsPerSample) / scale;
    }
  }
  return { sampleRate, channels };
}

function readPcm(view: DataView, pos: number, bitsPerSample: number): number {
  if (bitsPerSample === 16) return view.getInt16(pos, true);
  if (bitsPerSample === 32) return view.getInt32(pos, true);
  // DataView has no 24-bit read. Assemble the bytes and extend the sign bit.
  const v = view.getUint8(pos) | (view.getUint8(pos + 1) << 8) | (view.getUint8(pos + 2) << 16);
  return v & 0x800000 ? v - 0x1000000 : v;
}
