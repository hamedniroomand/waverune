import { expect, test } from "bun:test";
import { stft, istft } from "../src/dsp/stft";

function chirp(n: number): Float32Array {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.6 * Math.sin(2 * Math.PI * (200 + (i / n) * 2000) * (i / 44100));
  return x;
}

test("stft to istft round-trips the signal", () => {
  const sig = chirp(20000);
  const spec = stft(sig, { nFft: 2048, hop: 441 });
  const back = istft(spec);
  expect(back.length).toBe(sig.length);
  let worst = 0;
  for (let i = 0; i < sig.length; i++) worst = Math.max(worst, Math.abs(back[i] - sig[i]));
  expect(worst).toBeLessThan(1e-5);
});

test("stft reports the expected shape", () => {
  const spec = stft(chirp(10000), { nFft: 1024, hop: 256 });
  expect(spec.magnitude.length).toBe(spec.phase.length);
  expect(spec.magnitude[0].length).toBe(513);
  expect(spec.length).toBe(10000);
});

test("a pure tone concentrates energy in the right bin", () => {
  const sr = 16000, n = 8192, nFft = 1024;
  const sig = new Float32Array(n);
  for (let i = 0; i < n; i++) sig[i] = Math.sin((2 * Math.PI * 1000 * i) / sr);
  const spec = stft(sig, { nFft, hop: 256 });
  const frame = spec.magnitude[8];
  let peak = 0;
  for (let k = 1; k < frame.length; k++) if (frame[k] > frame[peak]) peak = k;
  expect(Math.abs(peak - Math.round((1000 * nFft) / sr))).toBeLessThanOrEqual(1);
});
