import { expect, test } from "bun:test";
import { DEFAULT_CONFIG, PerceptualWatermarker } from "../src/watermarkers/perceptual";
import { calculateAudioMetrics } from "../src/metrics";
import { frameGate, maskingThreshold, planBand, slotEnergy } from "../src/codec/mask";
import { stft } from "../src/dsp/stft";
import { musicLike, speechLike } from "./helpers/signals";
import type { AudioBuffer } from "../src/types";

const SR = 44100;

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

// The design claims that the change stays under the masking threshold. This
// test measures that claim. It compares the residual against the threshold of
// the host, cell by cell.
//
// The comparison covers only the cells where the host holds real content,
// within 60 dB of the loudest slot of the frame. Below that level the host of
// a synthetic signal is numerical noise, the threshold falls to the same
// level, and the ratio stops carrying meaning.
test("the watermark stays under the masking threshold", () => {
  const wm = new PerceptualWatermarker();
  const audio = speechLike(4);
  const marked = wm.applyWatermark(audio, { key: "secret", payload: 7n });

  const host = audio.channels[0];
  const residual = new Float32Array(host.length);
  for (let i = 0; i < host.length; i++) residual[i] = marked.channels[0][i] - host[i];

  const nFft = 2 ** Math.round(Math.log2(SR * DEFAULT_CONFIG.windowSeconds));
  const hop = Math.round(SR * DEFAULT_CONFIG.hopSeconds);
  const plan = planBand(
    SR,
    nFft,
    DEFAULT_CONFIG.lowHz,
    DEFAULT_CONFIG.highHz,
    DEFAULT_CONFIG.slots,
  );
  const hostSpec = stft(host, { nFft, hop });
  const gate = frameGate(hostSpec.magnitude);
  const hostEnergy = slotEnergy(hostSpec.magnitude, plan);
  const threshold = maskingThreshold(hostEnergy, plan);
  const residualEnergy = slotEnergy(stft(residual, { nFft, hop }).magnitude, plan);

  const ratios: number[] = [];
  for (let f = 0; f < hostSpec.magnitude.length; f++) {
    if (gate[f] === 0) continue;
    let peak = 0;
    for (let s = 0; s < plan.slots; s++) peak = Math.max(peak, hostEnergy[f][s]);
    const floor = peak * 10 ** (-60 / 20);
    for (let s = 0; s < plan.slots; s++) {
      if (hostEnergy[f][s] >= floor && threshold[f][s] > 0) {
        ratios.push(residualEnergy[f][s] / threshold[f][s]);
      }
    }
  }

  expect(ratios.length).toBeGreaterThan(1000);
  ratios.sort((a, b) => a - b);
  const median = ratios[ratios.length >> 1];
  const under = ratios.filter((r) => r <= 1).length / ratios.length;
  expect(median).toBeLessThan(1);
  expect(under).toBeGreaterThan(0.9);
});

// A backstop, not a perceptual claim. The masking test above carries the
// perceptual argument. This value comes from what the design produces, and it
// catches a gross regression in the level of the watermark.
test("the watermark is quiet", () => {
  const wm = new PerceptualWatermarker();
  const audio = speechLike(4);
  const marked = wm.applyWatermark(audio, { key: "secret", payload: 7n });
  expect(calculateAudioMetrics(audio.channels[0], marked.channels[0]).snr).toBeGreaterThan(20);
});

test("the input buffer is not mutated", () => {
  const wm = new PerceptualWatermarker();
  const audio = speechLike(2);
  const before = Float32Array.from(audio.channels[0]);
  wm.applyWatermark(audio, { key: "k", payload: 1n });
  expect(Array.from(audio.channels[0])).toEqual(Array.from(before));
});

// A fixed seed keeps the pairs the same on every run. The six tests above use
// six pairs that the watermarker is known to recover. This test samples the
// key and payload space, so a change that helps only those six fails here.
//
// The gate runs on both signal classes. A tonal signal leaves most of the band
// empty, and a broadband signal fills it. The two classes fail in different
// ways, so one class alone hides a defect of the other.
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

const GATE_SIGNALS: Record<string, (seconds: number, sr?: number) => AudioBuffer> = {
  tonal: speechLike,
  broadband: musicLike,
};

for (const [name, build] of Object.entries(GATE_SIGNALS)) {
  test(`twenty random key and payload pairs all recover exactly (${name})`, () => {
    const wm = new PerceptualWatermarker();
    const next = lcg(0x5eed1234);
    const audio = build(4, SR);
    const failures: string[] = [];

    for (let i = 0; i < 20; i++) {
      const key = `key-${next() % 100000}`;
      const payload = BigInt(next());
      const marked = wm.applyWatermark(audio, { key, payload });
      const result = wm.getWatermark(marked, { key });
      if (!result.detected || result.payload !== payload) {
        failures.push(`${key}/${payload} -> ${result.detected} ${result.payload}`);
      }
    }
    expect(failures).toEqual([]);
  }, 120000);
}

// The frame grid uses physical units (seconds), not a fixed sample count, so
// a file embedded at one sample rate must still decode after a plain
// sample-rate change. This test uses an exact 2:1 decimation, not a
// resampling library, so no resampler quality issue can hide a real defect.
test("a watermark survives an exact 2:1 decimation to a different sample rate", () => {
  const wm = new PerceptualWatermarker();
  const audio = musicLike(6, SR);
  const marked = wm.applyWatermark(audio, { key: "secret", payload: 0xabcd1234n });

  const decimated = new Float32Array(Math.floor(marked.channels[0].length / 2));
  for (let i = 0; i < decimated.length; i++) decimated[i] = marked.channels[0][i * 2];
  const halfRate: AudioBuffer = { sampleRate: SR / 2, channels: [decimated] };

  const result = wm.getWatermark(halfRate, { key: "secret" });
  expect(result.detected).toBe(true);
  expect(result.payload).toBe(0xabcd1234n);
});

test("stereo audio round-trips", () => {
  const wm = new PerceptualWatermarker();
  const mono = speechLike(4);
  const stereo: AudioBuffer = { sampleRate: SR, channels: [mono.channels[0], Float32Array.from(mono.channels[0])] };
  const marked = wm.applyWatermark(stereo, { key: "k", payload: 99n });
  expect(marked.channels.length).toBe(2);
  expect(wm.getWatermark(marked, { key: "k" }).payload).toBe(99n);
});
