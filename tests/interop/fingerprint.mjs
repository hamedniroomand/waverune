// Print the deterministic protocol values from the built package as one
// JSON line. `run.mjs` executes this file under Bun and under Node and
// requires the two outputs to be identical.
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../../dist/index.js', import.meta.url));
const { crc32, deriveSeed, buildBlock, checksumBits } = await import(dist);

const encoder = new TextEncoder();
const vectors = ['', 'a', '123456789', 'waverune', 'The quick brown fox jumps over the lazy dog'];
const keys = ['waverune', 'secret', 'k1', '', 'ünïcödé'];
const payloads = [0n, 1n, 0x2an, 0xdeadbeefn, 0xffffffffn];

const fingerprint = {
  crc32: vectors.map((v) => crc32(encoder.encode(v))),
  seeds: keys.flatMap((k) => ['cells', 'chips'].map((d) => Array.from(deriveSeed(k, d)))),
  blocks: payloads.map((p) => Array.from(buildBlock(p, 32)).join('')),
  checksums: payloads.map((p) =>
    Array.from(checksumBits(buildBlock(p, 32).subarray(16, 48))).join(''),
  ),
};

process.stdout.write(`${JSON.stringify(fingerprint)}\n`);
