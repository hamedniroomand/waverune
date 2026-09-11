/**
 * File adapters for WAV data.
 *
 * The codec works on byte arrays and never touches the disk. These helpers
 * connect it to the filesystem with `node:fs/promises`, which Node and Bun
 * both provide. The CLI uses them, and library users can too.
 */
import { readFile, writeFile } from 'node:fs/promises';

import { decodeWav, encodeWav } from '~/audio/wav';
import type { AudioBuffer } from '~/types';

/** Options for `writeWavFile`, the same as `encodeWav` accepts. */
export interface WavWriteOptions {
  bitDepth?: 16 | 24 | 32;
  float?: boolean;
}

/**
 * Read and decode one WAV file.
 *
 * @param path - the file path to read.
 * @returns the decoded audio.
 * @throws an error when the file cannot be read, and `WatermarkingError`
 *   when the bytes are not a supported WAV file.
 */
export async function readWavFile(path: string): Promise<AudioBuffer> {
  let bytes: Uint8Array;
  try {
    bytes = await readFile(path);
  } catch {
    throw new Error(`Cannot read the file "${path}".`);
  }
  return decodeWav(bytes);
}

/**
 * Encode audio and write it to one WAV file.
 *
 * @param path - the destination path. An existing file is replaced.
 * @param audio - the audio to write.
 * @param opts - the bit depth and sample format. Defaults to 16-bit PCM.
 */
export async function writeWavFile(
  path: string,
  audio: AudioBuffer,
  opts: WavWriteOptions = {},
): Promise<void> {
  await writeFile(path, encodeWav(audio, opts));
}
