import { expect, test } from 'bun:test';

import { encodeWav } from '~/audio/wav';
import { EXIT_NOT_DETECTED, EXIT_VERIFY_FAILED, verifyRecovery } from '~/cli';
import type { AudioBuffer, DetectionResult } from '~/types';

const SR = 44100;
const CLI = new URL('../src/cli.ts', import.meta.url).pathname;
const TMP = new URL('./tmp/', import.meta.url).pathname;

/**
 * Build a tonal test signal with an amplitude envelope.
 *
 * The signal sums three sine tones and applies a slow envelope. Five seconds
 * gives the perceptual watermarker more than one block to detect.
 *
 * @param seconds - the length of the signal, in seconds.
 * @returns a one-channel audio buffer.
 */
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

/** Run the CLI as a child process and collect its output and exit code. */
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

/** A fabricated detection result, for the verification unit tests. */
function fakeResult(detected: boolean, payload: bigint | null): DetectionResult {
  return {
    detected,
    payload,
    correlationScore: 0.2,
    syncErrorRate: 0,
    band: { lowHz: 500, highHz: 5000 },
    diagnostics: {
      syncValid: detected,
      checksumValid: detected,
      candidatePayload: payload ?? 0n,
      blockOffset: 0,
      sampleShift: 0,
      activeFrames: 1,
      totalFrames: 1,
      meanCorrelation: 0.25,
      minCorrelation: 0.1,
      channel: 0,
    },
  };
}

test('verifyRecovery passes only on an exact id match', () => {
  expect(verifyRecovery(42n, fakeResult(true, 42n))).toEqual({
    verified: true,
    failure: null,
    requestedId: 42n,
    recoveredId: 42n,
  });
});

// A detected block with a different id is a failure. This case cannot be
// produced on demand through the real detector without a checksum collision,
// so the test exercises the comparison directly.
test('verifyRecovery reports an id mismatch as a failure', () => {
  const v = verifyRecovery(42n, fakeResult(true, 43n));
  expect(v.verified).toBe(false);
  expect(v.failure).toBe('id-mismatch');
  expect(v.recoveredId).toBe(43n);
});

test('verifyRecovery reports a rejected block as not detected', () => {
  const v = verifyRecovery(42n, fakeResult(false, null));
  expect(v.verified).toBe(false);
  expect(v.failure).toBe('not-detected');
  expect(v.recoveredId).toBeNull();
});

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
  const embedResult = JSON.parse(lines[0]);
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
  const detectResult = JSON.parse(detect.stdout);
  expect(detectResult.detected).toBe(true);
  expect(detectResult.id).toBe('42');
  expect(typeof detectResult.correlationScore).toBe('number');
  expect(typeof detectResult.syncErrorRate).toBe('number');
}, 60000);

// Alpha zero writes an unmarked copy. The saved file cannot verify, so the
// command must say so and exit with the verification code, while keeping the
// file. This is the failure path that the old CLI reported as success.
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
  const result = JSON.parse(embed.stdout);
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

test('embed without --id generates a random id and reports it', async () => {
  const input = await writeFixture('embed-random-input.wav', tone(5));
  const output = `${TMP}embed-random-output.wav`;

  const embed = await runCli(['embed', input, '-o', output, '--key', 'k2', '--json']);
  expect(embed.exitCode).toBe(0);
  const embedResult = JSON.parse(embed.stdout);
  expect(embedResult.generatedId).toBe(true);
  expect(typeof embedResult.requestedId).toBe('string');
  expect(embedResult.recoveredId).toBe(embedResult.requestedId);

  const detect = await runCli(['detect', output, '--key', 'k2', '--json']);
  const detectResult = JSON.parse(detect.stdout);
  expect(detectResult.id).toBe(embedResult.requestedId);
}, 60000);

test('metrics --json output parses as JSON', async () => {
  const input = await writeFixture('metrics-input.wav', tone(5));
  const output = `${TMP}metrics-output.wav`;
  await runCli(['embed', input, '-o', output, '--id', '7', '--key', 'k3']);

  const metrics = await runCli(['metrics', input, output, '--json']);
  expect(metrics.exitCode).toBe(0);
  const parsed = JSON.parse(metrics.stdout);
  expect(typeof parsed.snr).toBe('number');
  expect(typeof parsed.mse).toBe('number');
  expect(typeof parsed.psnr).toBe('number');
}, 60000);

test('detect on clean unwatermarked audio exits 2', async () => {
  const input = await writeFixture('clean.wav', tone(5));
  const detect = await runCli(['detect', input, '--key', 'k4', '--json']);
  expect(detect.exitCode).toBe(EXIT_NOT_DETECTED);
  const parsed = JSON.parse(detect.stdout);
  expect(parsed.detected).toBe(false);
  expect(parsed.id).toBeNull();
  expect(typeof parsed.diagnostics.candidateId).toBe('string');
}, 60000);

test('an infinite --alpha exits 1 without writing a file', async () => {
  const input = await writeFixture('embed-alpha-inf-input.wav', tone(1));
  const output = `${TMP}embed-alpha-inf-output.wav`;
  await Bun.file(output)
    .delete()
    .catch(() => undefined);
  const embed = await runCli(['embed', input, '-o', output, '--alpha', 'Infinity', '--id', '1']);
  expect(embed.exitCode).toBe(1);
  expect(embed.stderr).toContain('--alpha');
  expect(await Bun.file(output).exists()).toBe(false);
});

test('a missing input file exits 1', async () => {
  const detect = await runCli(['detect', `${TMP}does-not-exist.wav`]);
  expect(detect.exitCode).toBe(1);
  expect(detect.stderr.length).toBeGreaterThan(0);
});
