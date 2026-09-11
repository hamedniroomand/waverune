// Cross-runtime interoperability. Requires `node` and `bun` on PATH and a
// built `dist/`. Checks four embed/detect combinations and the protocol
// fingerprint. Exit code 0 means every check passed.
//
//   bun embed  -> bun detect       node embed -> node detect
//   bun embed  -> node detect      node embed -> bun detect
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DIST_BIN, DIST_INDEX, makeTempDir, run, tone } from '../node/helpers.mjs';

const FINGERPRINT = fileURLToPath(new URL('./fingerprint.mjs', import.meta.url));
const RUNTIMES = {
  node: process.execPath,
  bun: process.env.BUN_BIN ?? 'bun',
};

async function version(runtime) {
  const result = await run(RUNTIMES[runtime], ['--version']);
  if (result.exitCode !== 0) throw new Error(`${runtime} is not runnable: ${result.stderr}`);
  return result.stdout.trim();
}

async function cli(runtime, args) {
  return run(RUNTIMES[runtime], [DIST_BIN, ...args]);
}

let failures = 0;
function report(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
}

console.log(`node ${await version('node')}, bun ${await version('bun')}`);

// Fingerprint: CRC, seeds, blocks and checksums must be byte-identical.
const fingerprints = {};
for (const runtime of Object.keys(RUNTIMES)) {
  const result = await run(RUNTIMES[runtime], [FINGERPRINT]);
  assert.equal(result.exitCode, 0, `${runtime} fingerprint failed: ${result.stderr}`);
  fingerprints[runtime] = result.stdout.trim();
}
report('protocol fingerprint identical under bun and node', fingerprints.bun === fingerprints.node);

// Embed under one runtime, detect under the other, for every combination.
const dir = await makeTempDir('waverune-interop-');
const { writeWavFile } = await import(DIST_INDEX);
const input = join(dir, 'input.wav');
await writeWavFile(input, tone(5));

const ID = '3735928559'; // 0xDEADBEEF
const KEY = 'interop';

for (const embedder of ['bun', 'node']) {
  const output = join(dir, `marked-by-${embedder}.wav`);
  const embed = await cli(embedder, [
    'embed',
    input,
    '-o',
    output,
    '--id',
    ID,
    '--key',
    KEY,
    '--json',
  ]);
  const embedOk = embed.exitCode === 0 && JSON.parse(embed.stdout || '{}').verified === true;
  report(`${embedder} embed verifies its own file`, embedOk, embedOk ? '' : embed.stderr.trim());
  if (!embedOk) continue;

  for (const detector of ['bun', 'node']) {
    const detect = await cli(detector, ['detect', output, '--key', KEY, '--json']);
    let ok = detect.exitCode === 0;
    let detail = '';
    if (ok) {
      const parsed = JSON.parse(detect.stdout);
      ok = parsed.detected === true && parsed.id === ID;
      detail = `id=${parsed.id} score=${parsed.correlationScore?.toFixed(3)}`;
    } else {
      detail = detect.stderr.trim();
    }
    report(`${embedder} embed -> ${detector} detect`, ok, detail);
  }
}

if (failures > 0) {
  console.error(`${failures} interoperability check(s) failed`);
  process.exit(1);
}
console.log('all interoperability checks passed');
