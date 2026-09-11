/**
 * File adapters for WAV data.
 *
 * The codec works on byte arrays and never touches the disk. These helpers
 * connect it to the file system through `node:fs/promises`, which Node and
 * Bun both provide.
 */
import { readFile, writeFile } from 'node:fs/promises';

import { decodeWav, encodeWav, type WavEncodeOptions } from '~/audio/wav';
import type { AudioBuffer } from '~/types';

/** The options of `writeWavFile`, the same as `encodeWav` accepts. */
export type WavWriteOptions = WavEncodeOptions;

/**
 * Read and decode one WAV file.
 *
 * @throws an `Error` when the file cannot be read, and a `WatermarkingError`
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

/** Encode audio and write it to one WAV file. An existing file is replaced. */
export async function writeWavFile(
  path: string,
  audio: AudioBuffer,
  opts: WavWriteOptions = {},
): Promise<void> {
  await writeFile(path, encodeWav(audio, opts));
}
