// Node compatibility: the built package imports and works under Node alone.
// The `.smoke.mjs` suffix keeps these files out of `bun test`, which would
// otherwise pick up any `*.test.*` file. Run them with `bun run test:node`.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { DIST_INDEX, ROOT, makeTempDir, tone } from './helpers.mjs';

test('this suite runs under Node, with no Bun global', () => {
  assert.equal(typeof globalThis.Bun, 'undefined');
  assert.ok(process.versions.node);
});

test('the built package imports and exposes the public API', async () => {
  const pkg = await import(DIST_INDEX);
  for (const name of [
    'embed',
    'detect',
    'PerceptualWatermarker',
    'DummyWatermarker',
    'DEFAULT_CONFIG',
    'decodeWav',
    'encodeWav',
    'readWavFile',
    'writeWavFile',
    'calculateAudioMetrics',
    'WatermarkingError',
    'crc32',
    'deriveSeed',
    'buildBlock',
    'parseBlock',
  ]) {
    assert.ok(name in pkg, `missing export ${name}`);
  }
});

test('package.json points every entry at built JavaScript', async () => {
  const manifest = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(manifest.main, './dist/index.js');
  assert.equal(manifest.types, './dist/index.d.ts');
  assert.equal(manifest.bin.waverune, 'dist/bin.js');
  assert.equal(manifest.exports['.'].import, './dist/index.js');
  assert.equal(manifest.exports['.'].types, './dist/index.d.ts');
  assert.match(manifest.engines.node, /22/u);
  for (const value of [manifest.main, manifest.bin.waverune, manifest.exports['.'].import]) {
    assert.ok(!value.endsWith('.ts'), `${value} points at TypeScript source`);
  }
});

test('crc32 gives the published check value', async () => {
  const { crc32 } = await import(DIST_INDEX);
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('deriveSeed is HMAC-SHA256 and matches the recorded vector', async () => {
  const { deriveSeed } = await import(DIST_INDEX);
  const { createHmac } = await import('node:crypto');
  const digest = createHmac('sha256', 'waverune').update('cells').digest();
  const expected = [];
  for (let i = 0; i < 4; i++) expected.push(digest.readUInt32LE(i * 4));
  assert.deepEqual(Array.from(deriveSeed('waverune', 'cells')), expected);
});

test('buildBlock and parseBlock round-trip a payload', async () => {
  const { buildBlock, parseBlock, totalBits } = await import(DIST_INDEX);
  const block = buildBlock(0xdeadbeefn, 32);
  assert.equal(block.length, totalBits(32));
  const parsed = parseBlock(block, 32);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.payload, 0xdeadbeefn);
});

test('embed then detect recovers the payload in memory', async () => {
  const { embed, detect } = await import(DIST_INDEX);
  const audio = tone(5);
  const marked = embed(audio, { key: 'node-key', payload: 0x2an });
  assert.equal(marked.channels[0].length, audio.channels[0].length);
  const result = detect(marked, { key: 'node-key' });
  assert.equal(result.detected, true);
  assert.equal(result.payload, 0x2an);
  const wrongKey = detect(marked, { key: 'other' });
  assert.equal(wrongKey.detected, false);
  assert.equal(wrongKey.payload, null);
});

test('readWavFile and writeWavFile round-trip through the filesystem', async () => {
  const { readWavFile, writeWavFile, embed, detect } = await import(DIST_INDEX);
  const dir = await makeTempDir();
  const path = join(dir, 'marked.wav');
  await writeWavFile(path, embed(tone(5), { key: 'fs-key', payload: 7n }));
  const saved = await readWavFile(path);
  assert.equal(saved.sampleRate, 44100);
  const result = detect(saved, { key: 'fs-key' });
  assert.equal(result.detected, true);
  assert.equal(result.payload, 7n);
});
