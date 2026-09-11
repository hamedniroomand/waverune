/**
 * The demo's bridge to the library.
 *
 * It imports the codec modules directly, not the package index, so the
 * browser bundle never pulls in the Node file-system layer. Everything runs
 * in the page. No server is involved.
 */
import { decodeWav, encodeWav } from '../src/audio/wav';
import type { DetectionResult } from '../src/types';
import { PerceptualWatermarker } from '../src/watermarkers/perceptual';

/**
 * The longest file that the demo accepts.
 *
 * This limit applies to the demo page only. Embedding plus verification run
 * at about 0.4 s per second of mono audio, and twice that for stereo, on the
 * main thread. A longer file would freeze the page for minutes. The library
 * and the CLI have no length limit.
 */
export const MAX_SECONDS = 120;

const watermarker = new PerceptualWatermarker();

export interface EmbedOutcome {
  id: bigint;
  verified: boolean;
  detection: DetectionResult;
  wav: Uint8Array;
  seconds: number;
}

/** Parse a 32-bit id. An empty string gives a random id. */
export function parseId(raw: string): bigint {
  const text = raw.trim();
  if (text === '') return BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
  try {
    const id = BigInt(text);
    if (id < 0n || id > 0xffff_ffffn) throw new Error();
    return id;
  } catch {
    throw new Error(`"${text}" is not a 32-bit id. Use a decimal or 0x-prefixed hex value.`);
  }
}

function decodeChecked(bytes: Uint8Array) {
  const audio = decodeWav(bytes);
  const seconds = audio.channels[0].length / audio.sampleRate;
  if (seconds > MAX_SECONDS) {
    throw new Error(
      `The file is ${seconds.toFixed(1)} s long. This demo page accepts up to ${MAX_SECONDS} s; the library and CLI have no limit.`,
    );
  }
  return { audio, seconds };
}

/** Embed, encode, decode the bytes again, and verify, as the CLI does. */
export function embed(bytes: Uint8Array, key: string, rawId: string): EmbedOutcome {
  if (!key.trim()) throw new Error('Enter a key.');
  const { audio, seconds } = decodeChecked(bytes);
  const id = parseId(rawId);
  const marked = watermarker.applyWatermark(audio, { key, payload: id });
  const wav = encodeWav(marked);
  const detection = watermarker.getWatermark(decodeWav(wav), { key });
  return { id, verified: detection.detected && detection.payload === id, detection, wav, seconds };
}

export function detect(bytes: Uint8Array, key: string): DetectionResult {
  if (!key.trim()) throw new Error('Enter a key.');
  return watermarker.getWatermark(decodeChecked(bytes).audio, { key });
}
