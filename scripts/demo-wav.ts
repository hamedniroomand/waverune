/**
 * Write a short deterministic WAV file for the README recording.
 *
 * Usage: bun scripts/demo-wav.ts <output.wav> [seconds]
 */
import { encodeWav } from '~/audio/wav';

import { musicLike } from '../tests/helpers/signals';

const [output, seconds = '6'] = process.argv.slice(2);
if (!output) {
  console.error('Usage: bun scripts/demo-wav.ts <output.wav> [seconds]');
  process.exit(1);
}
await Bun.write(output, encodeWav(musicLike(Number(seconds))));
