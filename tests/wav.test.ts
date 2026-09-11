import { expect, test } from "bun:test";
import { decodeWav, encodeWav } from "../src/audio/wav";

function tone(n: number, sr: number): Float32Array {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr);
  return x;
}

test.each([16, 24, 32] as const)("wav round-trips at %i-bit", (bitDepth) => {
  const audio = { sampleRate: 44100, channels: [tone(1000, 44100)] };
  const back = decodeWav(encodeWav(audio, { bitDepth }));
  expect(back.sampleRate).toBe(44100);
  expect(back.channels.length).toBe(1);
  const tol = bitDepth === 16 ? 1e-4 : 1e-6;
  for (let i = 0; i < 1000; i++) {
    expect(Math.abs(back.channels[0][i] - audio.channels[0][i])).toBeLessThan(tol);
  }
});

test("wav round-trips 32-bit float exactly", () => {
  const audio = { sampleRate: 48000, channels: [tone(512, 48000)] };
  const back = decodeWav(encodeWav(audio, { bitDepth: 32, float: true }));
  expect(Array.from(back.channels[0])).toEqual(Array.from(audio.channels[0]));
});

test("wav preserves stereo channel separation", () => {
  const left = tone(256, 44100);
  const right = new Float32Array(256).fill(-0.25);
  const back = decodeWav(encodeWav({ sampleRate: 44100, channels: [left, right] }, { bitDepth: 24 }));
  expect(back.channels.length).toBe(2);
  expect(back.channels[1][10]).toBeCloseTo(-0.25, 5);
});

test("decodeWav rejects non-RIFF data", () => {
  expect(() => decodeWav(new Uint8Array(64))).toThrow();
});
