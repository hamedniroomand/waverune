import { expect, test } from 'bun:test';

import { decodeWav, encodeWav } from '~/audio/wav';
import { WatermarkingError } from '~/types';

const DECODE_SUBPROCESS = new URL('./helpers/decode-subprocess.ts', import.meta.url).pathname;

function tone(n: number, sr: number): Float32Array {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr);
  return x;
}

function writeAscii(bytes: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
}

/**
 * Build a minimal WAV byte buffer for a malformed-header test.
 *
 * The header always uses a 44-byte RIFF/fmt/data layout. A caller can set a
 * field to an invalid value, or declare a data size that does not match the
 * bytes actually present, to reproduce a crafted file.
 *
 * @param opts - the header fields and the data bytes to use.
 * @returns the raw WAV byte buffer.
 */
function buildWav(opts: {
  numChannels?: number;
  bitsPerSample?: number;
  formatTag?: number;
  declaredDataSize?: number;
  dataBytes?: Uint8Array;
}): Uint8Array {
  const numChannels = opts.numChannels ?? 1;
  const bitsPerSample = opts.bitsPerSample ?? 16;
  const formatTag = opts.formatTag ?? 1;
  const dataBytes = opts.dataBytes ?? new Uint8Array(16);
  const declaredDataSize = opts.declaredDataSize ?? dataBytes.length;

  const buf = new Uint8Array(44 + dataBytes.length);
  const view = new DataView(buf.buffer);
  writeAscii(buf, 0, 'RIFF');
  view.setUint32(4, buf.length - 8, true);
  writeAscii(buf, 8, 'WAVE');
  writeAscii(buf, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, formatTag, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, 44100, true);
  view.setUint32(28, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(buf, 36, 'data');
  view.setUint32(40, declaredDataSize, true);
  buf.set(dataBytes, 44);
  return buf;
}

test.each([16, 24, 32] as const)('wav round-trips at %i-bit', (bitDepth) => {
  const audio = { sampleRate: 44100, channels: [tone(1000, 44100)] };
  const back = decodeWav(encodeWav(audio, { bitDepth }));
  expect(back.sampleRate).toBe(44100);
  expect(back.channels.length).toBe(1);
  const tol = bitDepth === 16 ? 1e-4 : 1e-6;
  for (let i = 0; i < 1000; i++) {
    expect(Math.abs(back.channels[0][i] - audio.channels[0][i])).toBeLessThan(tol);
  }
});

test('wav round-trips 32-bit float exactly', () => {
  const audio = { sampleRate: 48000, channels: [tone(512, 48000)] };
  const back = decodeWav(encodeWav(audio, { bitDepth: 32, float: true }));
  expect(Array.from(back.channels[0])).toEqual(Array.from(audio.channels[0]));
});

test('wav preserves stereo channel separation', () => {
  const left = tone(256, 44100);
  const right = new Float32Array(256).fill(-0.25);
  const back = decodeWav(
    encodeWav({ sampleRate: 44100, channels: [left, right] }, { bitDepth: 24 }),
  );
  expect(back.channels.length).toBe(2);
  expect(back.channels[1][10]).toBeCloseTo(-0.25, 5);
});

test('decodeWav rejects non-RIFF data', () => {
  expect(() => decodeWav(new Uint8Array(64))).toThrow();
});

// A zero channel count divides by zero in the frame count formula and makes
// the fill loop spin forever. A synchronous infinite loop blocks the test
// runner's event loop too, so a normal `expect(...).toThrow()` call in this
// process gives no signal on a regression. This test runs the decode in a
// separate process and applies an external timeout, so a regression fails
// fast instead of hanging the whole suite.
test('decodeWav rejects a zero channel count quickly instead of hanging', async () => {
  const bytes = buildWav({ numChannels: 0 });
  const hex = Buffer.from(bytes).toString('hex');
  const proc = Bun.spawn(['bun', DECODE_SUBPROCESS, hex], { stdout: 'ignore', stderr: 'ignore' });
  const killTimer = setTimeout(() => proc.kill(9), 3000);
  const exitCode = await proc.exited;
  clearTimeout(killTimer);
  expect(exitCode).toBe(1);
}, 5000);

test('decodeWav rejects a zero bits-per-sample value', () => {
  const bytes = buildWav({ bitsPerSample: 0 });
  expect(() => decodeWav(bytes)).toThrow(WatermarkingError);
});

test('decodeWav clamps a declared data size that exceeds the buffer', () => {
  // The header declares 1000 bytes of data, but only 16 real bytes follow.
  // decodeWav must use the bytes actually present, not throw a RangeError.
  const bytes = buildWav({ declaredDataSize: 1000, dataBytes: new Uint8Array(16) });
  const audio = decodeWav(bytes);
  expect(audio.channels.length).toBe(1);
  expect(audio.channels[0].length).toBe(8);
});

test('decodeWav clamps an oversized data chunk size instead of allocating it', () => {
  // The header declares a data chunk of 0xfffffff0 bytes (about 4 GB), but no
  // data bytes follow at all. decodeWav must clamp to what is present.
  const bytes = buildWav({ declaredDataSize: 0xfffffff0, dataBytes: new Uint8Array(0) });
  const audio = decodeWav(bytes);
  expect(audio.channels.length).toBe(1);
  expect(audio.channels[0].length).toBe(0);
});
