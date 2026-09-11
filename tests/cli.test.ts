import { expect, test } from 'bun:test';

import { encodeWav } from '~/audio/wav';
import { EXIT_NOT_DETECTED, EXIT_VERIFY_FAILED } from '~/cli/exit-codes';
import type { AudioBuffer } from '~/types';

import { parseJson } from './helpers/json';
import { musicLike } from './helpers/signals';

const SR = 44100;

interface DetectJson {
  detected: boolean;
  id: string | null;
  correlationScore: number;
  syncErrorRate: number;
  diagnostics: { syncValid: boolean; checksumValid: boolean; candidateId: string };
}

interface EmbedJson {
  requestedId: string;
  recoveredId: string | null;
  generatedId: boolean;
  verified: boolean;
  failure: string | null;
  output: string;
  detection: DetectJson;
  metrics: MetricsJson;
}

interface MetricsJson {
  snr: number;
  mse: number;
  psnr: number;
}
const CLI = new URL('../src/bin.ts', import.meta.url).pathname;
const TMP = new URL('./tmp/', import.meta.url).pathname;

/** A three-tone signal with a slow envelope. Five seconds hold more than one block. */
function tone(seconds: number): AudioBuffer {
  const n = Math.floor(seconds * SR);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2 * t);
    x[i] =
      env *
      0.3 *
      (Math.sin(2 * Math.PI * 220 * t) +
        0.5 * Math.sin(2 * Math.PI * 660 * t) +
        0.25 * Math.sin(2 * Math.PI * 1500 * t));
  }
  return { sampleRate: SR, channels: [x] };
}

async function runCli(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(['bun', CLI, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function writeFixture(name: string, audio: AudioBuffer): Promise<string> {
  const path = `${TMP}${name}`;
  await Bun.write(path, encodeWav(audio));
  return path;
}

test('embed verifies the saved file and detect recovers the id', async () => {
  const input = await writeFixture('embed-input.wav', tone(5));
  const output = `${TMP}embed-output.wav`;

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
  expect(embed.exitCode).toBe(0);
  const lines = embed.stdout.trim().split('\n');
  expect(lines.length).toBe(1);
  const embedResult = parseJson<EmbedJson>(lines[0]);
  expect(embedResult.requestedId).toBe('42');
  expect(embedResult.recoveredId).toBe('42');
  expect(embedResult.verified).toBe(true);
  expect(embedResult.failure).toBeNull();
  expect(embedResult.output).toBe(output);
  expect(embedResult.detection.detected).toBe(true);
  expect(embedResult.detection.diagnostics.syncValid).toBe(true);
  expect(embedResult.detection.diagnostics.checksumValid).toBe(true);
  expect(typeof embedResult.metrics.snr).toBe('number');

  const detect = await runCli(['detect', output, '--key', 'k1', '--json']);
  expect(detect.exitCode).toBe(0);
  const detectResult = parseJson<DetectJson>(detect.stdout);
  expect(detectResult.detected).toBe(true);
  expect(detectResult.id).toBe('42');
  expect(typeof detectResult.correlationScore).toBe('number');
  expect(typeof detectResult.syncErrorRate).toBe('number');
}, 60000);

// An alpha of zero writes an unmarked copy. The saved file cannot verify, so
// the command must report the failure, keep the file, and exit with the
// verification code. An earlier CLI reported this case as a success.
test('embed with --alpha 0 keeps the file, reports the failure, and exits 3', async () => {
  const input = await writeFixture('embed-alpha0-input.wav', tone(4));
  const output = `${TMP}embed-alpha0-output.wav`;

  const embed = await runCli([
    'embed',
    input,
    '-o',
    output,
    '--alpha',
    '0',
    '--id',
    '42',
    '--key',
    'review',
    '--json',
  ]);
  expect(embed.exitCode).toBe(EXIT_VERIFY_FAILED);
  const result = parseJson<EmbedJson>(embed.stdout);
  expect(result.verified).toBe(false);
  expect(result.failure).toBe('not-detected');
  expect(result.requestedId).toBe('42');
  expect(result.recoveredId).toBeNull();
  expect(result.detection.detected).toBe(false);
  expect(await Bun.file(output).exists()).toBe(true);
}, 60000);

test('embed with --alpha 0 in text mode exits 3 and explains on stderr', async () => {
  const input = await writeFixture('embed-alpha0-text-input.wav', tone(4));
  const output = `${TMP}embed-alpha0-text-output.wav`;
  const embed = await runCli(['embed', input, '-o', output, '--alpha', '0', '--id', '42']);
  expect(embed.exitCode).toBe(EXIT_VERIFY_FAILED);
  expect(embed.stderr).toContain('Verification failed');
  expect(embed.stdout).toContain('Recovered id: none');
}, 60000);

// This test checks id generation, so it uses the broadband signal. The
// three-tone fixture above does not recover every random id, and a flaky
// test would say nothing about id generation.
test('embed without --id generates a random id and reports it', async () => {
  const input = await writeFixture('embed-random-input.wav', musicLike(5));
  const output = `${TMP}embed-random-output.wav`;

  const embed = await runCli(['embed', input, '-o', output, '--key', 'k2', '--json']);
  expect(embed.exitCode).toBe(0);
  const embedResult = parseJson<EmbedJson>(embed.stdout);
  expect(embedResult.generatedId).toBe(true);
  expect(typeof embedResult.requestedId).toBe('string');
  expect(embedResult.recoveredId).toBe(embedResult.requestedId);

  const detect = await runCli(['detect', output, '--key', 'k2', '--json']);
  const detectResult = parseJson<DetectJson>(detect.stdout);
  expect(detectResult.id).toBe(embedResult.requestedId);
}, 60000);

test('metrics --json output parses as JSON', async () => {
  const input = await writeFixture('metrics-input.wav', tone(5));
  const output = `${TMP}metrics-output.wav`;
  await runCli(['embed', input, '-o', output, '--id', '7', '--key', 'k3']);

  const metrics = await runCli(['metrics', input, output, '--json']);
  expect(metrics.exitCode).toBe(0);
  const parsed = parseJson<MetricsJson>(metrics.stdout);
  expect(typeof parsed.snr).toBe('number');
  expect(typeof parsed.mse).toBe('number');
  expect(typeof parsed.psnr).toBe('number');
}, 60000);

test('detect on clean unwatermarked audio exits 2', async () => {
  const input = await writeFixture('clean.wav', tone(5));
  const detect = await runCli(['detect', input, '--key', 'k4', '--json']);
  expect(detect.exitCode).toBe(EXIT_NOT_DETECTED);
  const parsed = parseJson<DetectJson>(detect.stdout);
  expect(parsed.detected).toBe(false);
  expect(parsed.id).toBeNull();
  expect(typeof parsed.diagnostics.candidateId).toBe('string');
}, 60000);

test('an infinite --alpha exits 1 without writing a file', async () => {
  const input = await writeFixture('embed-alpha-inf-input.wav', tone(1));
  const output = `${TMP}embed-alpha-inf-output.wav`;
  await Bun.file(output)
    .delete()
    .catch(() => null);
  const embed = await runCli(['embed', input, '-o', output, '--alpha', 'Infinity', '--id', '1']);
  expect(embed.exitCode).toBe(1);
  expect(embed.stderr).toContain('--alpha');
  expect(await Bun.file(output).exists()).toBe(false);
});

test('--version prints the package version and exits 0', async () => {
  const run = await runCli(['--version']);
  expect(run.exitCode).toBe(0);
  expect(run.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/u);
});

test('--help prints the usage on stdout and exits 0', async () => {
  const run = await runCli(['--help']);
  expect(run.exitCode).toBe(0);
  expect(run.stdout).toContain('Usage:');
  expect(run.stdout).toContain('waverune embed');
  expect(run.stderr).toBe('');
});

test('an unknown command prints the usage on stderr and exits 1', async () => {
  const run = await runCli(['frobnicate']);
  expect(run.exitCode).toBe(1);
  expect(run.stderr).toContain('Usage:');
});

test('a missing input file exits 1', async () => {
  const detect = await runCli(['detect', `${TMP}does-not-exist.wav`]);
  expect(detect.exitCode).toBe(1);
  expect(detect.stderr.length).toBeGreaterThan(0);
});
