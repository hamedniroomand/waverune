import type { AudioBuffer } from "../types";
import { WatermarkingError } from "../types";

const FMT_PCM = 1;
const FMT_FLOAT = 3;

function readAscii(view: DataView, offset: number, length: number): string {
  let s = "";
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

function writeAscii(bytes: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
}

interface FmtInfo {
  formatTag: number;
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
}

export function decodeWav(data: Uint8Array): AudioBuffer {
  if (data.byteLength < 12) {
    throw new WatermarkingError("WAV data too short to contain a RIFF header");
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  if (readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") {
    throw new WatermarkingError("Not a valid RIFF/WAVE file");
  }

  let offset = 12;
  let fmt: FmtInfo | null = null;
  let dataOffset = -1;
  let dataLength = -1;

  // The code walks each chunk by its size. This method finds "fmt " and
  // "data" at any position, after chunks such as "LIST" or "fact".
  while (offset + 8 <= data.byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const bodyOffset = offset + 8;

    if (chunkId === "fmt ") {
      fmt = {
        formatTag: view.getUint16(bodyOffset, true),
        numChannels: view.getUint16(bodyOffset + 2, true),
        sampleRate: view.getUint32(bodyOffset + 4, true),
        bitsPerSample: view.getUint16(bodyOffset + 14, true),
      };
    } else if (chunkId === "data") {
      dataOffset = bodyOffset;
      dataLength = chunkSize;
    }

    // Each chunk pads to an even byte count. The code adds one byte when the size is odd.
    offset = bodyOffset + chunkSize + (chunkSize % 2);
  }

  if (!fmt) {
    throw new WatermarkingError("Missing fmt chunk in WAV data");
  }
  if (dataOffset < 0) {
    throw new WatermarkingError("Missing data chunk in WAV data");
  }
  if (fmt.formatTag !== FMT_PCM && fmt.formatTag !== FMT_FLOAT) {
    throw new WatermarkingError(`Unsupported WAV format tag: ${fmt.formatTag}`);
  }

  const { numChannels, sampleRate, bitsPerSample, formatTag } = fmt;
  const bytesPerSample = bitsPerSample / 8;
  const frameCount = Math.floor(dataLength / (bytesPerSample * numChannels));
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(new Float32Array(frameCount));

  if (formatTag === FMT_FLOAT) {
    if (bitsPerSample !== 32) {
      throw new WatermarkingError(`Unsupported IEEE float bit depth: ${bitsPerSample}`);
    }
    for (let i = 0; i < frameCount; i++) {
      for (let c = 0; c < numChannels; c++) {
        const pos = dataOffset + (i * numChannels + c) * bytesPerSample;
        channels[c][i] = view.getFloat32(pos, true);
      }
    }
  } else {
    const scale = 2 ** (bitsPerSample - 1);
    for (let i = 0; i < frameCount; i++) {
      for (let c = 0; c < numChannels; c++) {
        const pos = dataOffset + (i * numChannels + c) * bytesPerSample;
        let sample: number;
        if (bitsPerSample === 16) {
          sample = view.getInt16(pos, true);
        } else if (bitsPerSample === 24) {
          const b0 = view.getUint8(pos);
          const b1 = view.getUint8(pos + 1);
          const b2 = view.getUint8(pos + 2);
          let v = b0 | (b1 << 8) | (b2 << 16);
          // A 24-bit value has no native read method. The code must extend
          // the sign bit by hand to get a correct negative value.
          if (v & 0x800000) v -= 0x1000000;
          sample = v;
        } else if (bitsPerSample === 32) {
          sample = view.getInt32(pos, true);
        } else {
          throw new WatermarkingError(`Unsupported PCM bit depth: ${bitsPerSample}`);
        }
        channels[c][i] = sample / scale;
      }
    }
  }

  return { sampleRate, channels };
}

export function encodeWav(
  audio: AudioBuffer,
  opts: { bitDepth?: 16 | 24 | 32; float?: boolean } = {},
): Uint8Array {
  const bitDepth = opts.bitDepth ?? 16;
  const float = opts.float ?? false;

  if (float && bitDepth !== 32) {
    throw new WatermarkingError("Float encoding requires a bitDepth of 32");
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
  writeAscii(bytes, offset, "RIFF");
  offset += 4;
  view.setUint32(offset, totalSize - 8, true);
  offset += 4;
  writeAscii(bytes, offset, "WAVE");
  offset += 4;

  writeAscii(bytes, offset, "fmt ");
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

  writeAscii(bytes, offset, "data");
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
  } else {
    const maxPositive = 2 ** (bitDepth - 1) - 1;
    const minNegative = -(2 ** (bitDepth - 1));
    for (let i = 0; i < frameCount; i++) {
      for (let c = 0; c < numChannels; c++) {
        const pos = dataOffset + (i * numChannels + c) * bytesPerSample;
        let sample = Math.round(audio.channels[c][i] * maxPositive);
        if (sample > maxPositive) sample = maxPositive;
        if (sample < minNegative) sample = minNegative;
        if (bitDepth === 16) {
          view.setInt16(pos, sample, true);
        } else if (bitDepth === 24) {
          // DataView has no 24-bit write method. The code writes the three
          // bytes by hand, in little-endian order.
          bytes[pos] = sample & 0xff;
          bytes[pos + 1] = (sample >> 8) & 0xff;
          bytes[pos + 2] = (sample >> 16) & 0xff;
        } else if (bitDepth === 32) {
          view.setInt32(pos, sample, true);
        } else {
          throw new WatermarkingError(`Unsupported bit depth: ${bitDepth}`);
        }
      }
    }
  }

  return bytes;
}
