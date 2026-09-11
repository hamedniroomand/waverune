// Node compatibility: the built CLI runs under `node` and behaves as documented.
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { DIST_BIN, DIST_INDEX, makeTempDir, runCli, tone } from './helpers.mjs';

async function writeFixture(dir, name, audio) {
  const { writeWavFile } = await import(DIST_INDEX);
  const path = join(dir, name);
  await writeWavFile(path, audio);
  return path;
}

test('the CLI entry has a node shebang and is executable', async () => {
  const source = await readFile(DIST_BIN, 'utf8');
  assert.ok(source.startsWith('#!/usr/bin/env node\n'), 'shebang must target node');
  if (process.platform !== 'win32') {
    const mode = (await stat(DIST_BIN)).mode;
    assert.ok(mode & 0o111, 'bin.js must be executable');
  }
});

test('no command prints usage and exits 1', async () => {
  const result = await runCli([]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Usage:/u);
  assert.match(result.stderr, /waverune embed/u);
});

test('embed verifies the saved file and detect recovers the id', async () => {
  const dir = await makeTempDir();
  const input = await writeFixture(dir, 'input.wav', tone(5));
  const output = join(dir, 'output.wav');

  const embed = await runCli([
    'embed',
    input,
    '-o',
    output,
    '--id',
    '0x2a',
    '--key',
    'k1',
    '--json',
  ]);
  assert.equal(embed.exitCode, 0, embed.stderr);
  const embedResult = JSON.parse(embed.stdout);
  assert.equal(embedResult.requestedId, '42');
  assert.equal(embedResult.recoveredId, '42');
  assert.equal(embedResult.verified, true);
  assert.equal(embedResult.detection.detected, true);
  assert.equal(typeof embedResult.metrics.snr, 'number');

  const detect = await runCli(['detect', output, '--key', 'k1', '--json']);
  assert.equal(detect.exitCode, 0);
  const detectResult = JSON.parse(detect.stdout);
  assert.equal(detectResult.detected, true);
  assert.equal(detectResult.id, '42');

  const text = await runCli(['detect', output, '--key', 'k1']);
  assert.equal(text.exitCode, 0);
  assert.match(text.stdout, /Watermark found\. Id: 42/u);

  const metrics = await runCli(['metrics', input, output, '--json']);
  assert.equal(metrics.exitCode, 0);
  const parsed = JSON.parse(metrics.stdout);
  assert.equal(typeof parsed.snr, 'number');
  assert.equal(typeof parsed.psnr, 'number');
});

test('detect on clean audio exits 2 and reports no id', async () => {
  const dir = await makeTempDir();
  const input = await writeFixture(dir, 'clean.wav', tone(5));
  const detect = await runCli(['detect', input, '--key', 'k4', '--json']);
  assert.equal(detect.exitCode, 2);
  const parsed = JSON.parse(detect.stdout);
  assert.equal(parsed.detected, false);
  assert.equal(parsed.id, null);
});

test('embed with --alpha 0 keeps the file and exits 3', async () => {
  const dir = await makeTempDir();
  const input = await writeFixture(dir, 'input.wav', tone(4));
  const output = join(dir, 'unmarked.wav');
  const embed = await runCli([
    'embed',
    input,
    '-o',
    output,
    '--alpha',
    '0',
    '--id',
    '42',
    '--json',
  ]);
  assert.equal(embed.exitCode, 3);
  const result = JSON.parse(embed.stdout);
  assert.equal(result.verified, false);
  assert.equal(result.failure, 'not-detected');
  await stat(output);
});

test('a missing input file exits 1 with a message', async () => {
  const dir = await makeTempDir();
  const detect = await runCli(['detect', join(dir, 'does-not-exist.wav')]);
  assert.equal(detect.exitCode, 1);
  assert.match(detect.stderr, /Cannot read the file/u);
});
