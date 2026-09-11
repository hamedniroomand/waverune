/**
 * This script runs `decodeWav` in a separate process.
 *
 * A test spawns this script and applies an external timeout. The parent
 * process can kill this process at the OS level. A synchronous infinite loop
 * inside `decodeWav` cannot block that kill, so the parent test stays fast
 * even when this script hangs.
 *
 * Usage: bun decode-subprocess.ts <hex-encoded-wav-bytes>
 *
 * Exit code 0 means `decodeWav` returned. Exit code 1 means it threw a
 * `WatermarkingError`. Exit code 2 means it threw a different error, or the
 * script itself failed to load.
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
