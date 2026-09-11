import { expect, test } from "bun:test";
import { PerceptualWatermarker } from "../src/watermarkers/perceptual";
import { calculateAudioMetrics } from "../src/metrics";
import type { AudioBuffer } from "../src/types";

const SR = 44100;

// Speech-like: a few harmonics with a wandering envelope.
export function speechLike(seconds: number, sr = SR): AudioBuffer {
  const n = Math.floor(seconds * sr);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2.3 * t);
    x[i] = env * 0.3 * (Math.sin(2 * Math.PI * 180 * t) + 0.5 * Math.sin(2 * Math.PI * 540 * t) + 0.25 * Math.sin(2 * Math.PI * 1300 * t));
  }
  return { sampleRate: sr, channels: [x] };
}

test("embed then extract recovers the exact payload", () => {
  const wm = new PerceptualWatermarker();
  const audio = speechLike(4);
  const marked = wm.applyWatermark(audio, { key: "secret", payload: 0xdeadbeefn });
  const result = wm.getWatermark(marked, { key: "secret" });
  expect(result.detected).toBe(true);
  expect(result.payload).toBe(0xdeadbeefn);
});

test("the wrong key does not produce a false detection", () => {
  const wm = new PerceptualWatermarker();
  const marked = wm.applyWatermark(speechLike(4), { key: "secret", payload: 0x1234n });
  expect(wm.getWatermark(marked, { key: "wrong" }).detected).toBe(false);
});

test("unwatermarked audio does not produce a false detection", () => {
  const wm = new PerceptualWatermarker();
  expect(wm.getWatermark(speechLike(4), { key: "secret" }).detected).toBe(false);
});

test("the watermark is quiet", () => {
  const wm = new PerceptualWatermarker();
  const audio = speechLike(4);
  const marked = wm.applyWatermark(audio, { key: "secret", payload: 7n });
  expect(calculateAudioMetrics(audio.channels[0], marked.channels[0]).snr).toBeGreaterThan(25);
});

test("the input buffer is not mutated", () => {
  const wm = new PerceptualWatermarker();
  const audio = speechLike(2);
  const before = Float32Array.from(audio.channels[0]);
  wm.applyWatermark(audio, { key: "k", payload: 1n });
  expect(Array.from(audio.channels[0])).toEqual(Array.from(before));
});

test("stereo audio round-trips", () => {
  const wm = new PerceptualWatermarker();
  const mono = speechLike(4);
  const stereo: AudioBuffer = { sampleRate: SR, channels: [mono.channels[0], Float32Array.from(mono.channels[0])] };
  const marked = wm.applyWatermark(stereo, { key: "k", payload: 99n });
  expect(marked.channels.length).toBe(2);
  expect(wm.getWatermark(marked, { key: "k" }).payload).toBe(99n);
});
