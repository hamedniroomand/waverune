// Shared helpers for the Node compatibility suite. Plain JavaScript on
// purpose: this suite must run with `node --test` and nothing else.
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const DIST_INDEX = join(ROOT, 'dist', 'index.js');
export const DIST_BIN = join(ROOT, 'dist', 'bin.js');

export const SAMPLE_RATE = 44100;

/** A tonal test signal with a slow amplitude envelope, as in the Bun CLI test. */
export function tone(seconds) {
  const n = Math.floor(seconds * SAMPLE_RATE);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2 * t);
    x[i] =
      env *
      0.3 *
      (Math.sin(2 * Math.PI * 220 * t) +
        0.5 * Math.sin(2 * Math.PI * 660 * t) +
        0.25 * Math.sin(2 * Math.PI * 1500 * t));
  }
  return { sampleRate: SAMPLE_RATE, channels: [x] };
}

export async function makeTempDir(prefix = 'waverune-node-') {
  return mkdtemp(join(tmpdir(), prefix));
}

/** Run a command and collect stdout, stderr and the exit code. */
export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ stdout, stderr, exitCode }));
  });
}

/** Run the built CLI under the current Node executable. */
export function runCli(args, options = {}) {
  return run(process.execPath, [DIST_BIN, ...args], options);
}
