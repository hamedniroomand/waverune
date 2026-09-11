/**
 * Run `decodeWav` in a separate process.
 *
 * A test spawns this script with an external timeout. The parent can kill
 * this process at the OS level, so a synchronous infinite loop inside
 * `decodeWav` cannot hang the test suite.
 *
 * Usage: bun decode-subprocess.ts <hex-encoded-wav-bytes>
 *
 * Exit code 0: `decodeWav` returned. Exit code 1: it threw a
 * `WatermarkingError`. Exit code 2: a different error, or the script failed
 * to load.
 */
import { decodeWav } from '~/audio/wav';
import { WatermarkingError } from '~/types';

const hex = process.argv[2] ?? '';
const bytes = new Uint8Array(hex.length / 2);
for (let i = 0; i < bytes.length; i++) {
  bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
}

try {
  decodeWav(bytes);
  process.exit(0);
} catch (e) {
  process.exit(e instanceof WatermarkingError ? 1 : 2);
}
