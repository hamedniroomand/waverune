import { expect, test } from 'bun:test';

import { frameGate, maskingThreshold, planBand, slotEnergy } from '~/codec/mask';
import { stft } from '~/dsp/stft';
import { calculateAudioMetrics } from '~/metrics';
import { type AudioBuffer, WatermarkingError } from '~/types';
import { DEFAULT_CONFIG, PerceptualWatermarker } from '~/watermarkers/perceptual';

import { musicLike, speechLike } from './helpers/signals';

const SR = 44100;

test('embed then extract recovers the exact payload', () => {
  const wm = new PerceptualWatermarker();
  const audio = speechLike(4);
  const marked = wm.applyWatermark(audio, { key: 'secret', payload: 0xdeadbeefn });
  const result = wm.getWatermark(marked, { key: 'secret' });
  expect(result.detected).toBe(true);
  expect(result.payload).toBe(0xdeadbeefn);
});

test('the wrong key does not produce a false detection', () => {
  const wm = new PerceptualWatermarker();
  const marked = wm.applyWatermark(speechLike(4), { key: 'secret', payload: 0x1234n });
  expect(wm.getWatermark(marked, { key: 'wrong' }).detected).toBe(false);
});

test('unwatermarked audio does not produce a false detection', () => {
  const wm = new PerceptualWatermarker();
  expect(wm.getWatermark(speechLike(4), { key: 'secret' }).detected).toBe(false);
});

// The design targets a change under the masking threshold. This test measures
// how close the embedder gets. It compares the residual against the threshold
// of the host, cell by cell, and asserts the median and a 90% fraction. It does
// not assert an absolute bound, because the measured residual exceeds the
// threshold in about 7% of the included cells on this fixture (see
// `bench/masking.ts` and the reliability report).
//
// The comparison covers only the cells where the host holds real content,
// within 60 dB of the loudest slot of the frame. That excludes 89% of the
// cells of this tonal fixture. Below that level the host of a synthetic signal
// is numerical noise, the threshold falls to the same level, and the ratio
// stops carrying meaning.
test('the watermark residual stays under the masking threshold in most included cells', () => {
  const wm = new PerceptualWatermarker();
  const audio = speechLike(4);
  const marked = wm.applyWatermark(audio, { key: 'secret', payload: 7n });

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
test('the watermark is quiet', () => {
  const wm = new PerceptualWatermarker();
  const audio = speechLike(4);
  const marked = wm.applyWatermark(audio, { key: 'secret', payload: 7n });
  expect(calculateAudioMetrics(audio.channels[0], marked.channels[0]).snr).toBeGreaterThan(20);
});

test('the input buffer is not mutated', () => {
  const wm = new PerceptualWatermarker();
  const audio = speechLike(2);
  const before = Float32Array.from(audio.channels[0]);
  wm.applyWatermark(audio, { key: 'k', payload: 1n });
  expect(Array.from(audio.channels[0])).toEqual(Array.from(before));
});

// A limited diagnostic, not a resampling claim. The frame grid uses seconds,
// so the geometry should line up after a sample-rate change, and this test
// checks that with an exact 2:1 decimation. The decimation has no anti-alias
// filter, and one fixture, key and payload is one data point. The measured
// resampling matrix lives in `bench/resample.ts` and `tests/resample.test.ts`.
test('diagnostic: a watermark survives an unfiltered 2:1 decimation on one broadband fixture', () => {
  const wm = new PerceptualWatermarker();
  const audio = musicLike(6, SR);
  const marked = wm.applyWatermark(audio, { key: 'secret', payload: 0xabcd1234n });

  const decimated = new Float32Array(Math.floor(marked.channels[0].length / 2));
  for (let i = 0; i < decimated.length; i++) decimated[i] = marked.channels[0][i * 2];
  const halfRate: AudioBuffer = { sampleRate: SR / 2, channels: [decimated] };

  const result = wm.getWatermark(halfRate, { key: 'secret' });
  expect(result.detected).toBe(true);
  expect(result.payload).toBe(0xabcd1234n);
});

test('stereo audio round-trips', () => {
  const wm = new PerceptualWatermarker();
  const mono = speechLike(4);
  const stereo: AudioBuffer = {
    sampleRate: SR,
    channels: [mono.channels[0], Float32Array.from(mono.channels[0])],
  };
  const marked = wm.applyWatermark(stereo, { key: 'k', payload: 99n });
  expect(marked.channels.length).toBe(2);
  expect(wm.getWatermark(marked, { key: 'k' }).payload).toBe(99n);
});

test('detection on digital silence rejects with a zero score and no active frames', () => {
  const wm = new PerceptualWatermarker();
  const result = wm.getWatermark(
    { sampleRate: SR, channels: [new Float32Array(4 * SR)] },
    { key: 'k' },
  );
  expect(result.detected).toBe(false);
  expect(result.payload).toBeNull();
  expect(result.correlationScore).toBe(0);
  expect(result.diagnostics.activeFrames).toBe(0);
  expect(result.diagnostics.syncValid).toBe(false);
});

test('the correlation score stays at or below 0.5', () => {
  const wm = new PerceptualWatermarker();
  const marked = wm.applyWatermark(speechLike(4), { key: 'secret', payload: 5n });
  const result = wm.getWatermark(marked, { key: 'secret' });
  expect(result.correlationScore).toBeGreaterThan(0);
  expect(result.correlationScore).toBeLessThanOrEqual(0.5);
  expect(result.diagnostics.meanCorrelation).toBeLessThanOrEqual(1);
});

test('a rejected result keeps the payload null and exposes the candidate as a diagnostic', () => {
  const wm = new PerceptualWatermarker();
  const marked = wm.applyWatermark(speechLike(4), { key: 'secret', payload: 0x1234n });
  const result = wm.getWatermark(marked, { key: 'wrong' });
  expect(result.detected).toBe(false);
  expect(result.payload).toBeNull();
  expect(typeof result.diagnostics.candidatePayload).toBe('bigint');
  expect(result.diagnostics.syncValid && result.diagnostics.checksumValid).toBe(false);
});

test('invalid audio buffers throw WatermarkingError', () => {
  const wm = new PerceptualWatermarker();
  expect(() => wm.getWatermark({ sampleRate: SR, channels: [] })).toThrow(WatermarkingError);
  expect(() => wm.getWatermark({ sampleRate: 0, channels: [new Float32Array(10)] })).toThrow(
    WatermarkingError,
  );
  expect(() =>
    wm.getWatermark({ sampleRate: Number.NaN, channels: [new Float32Array(10)] }),
  ).toThrow(WatermarkingError);
  expect(() =>
    wm.applyWatermark({ sampleRate: SR, channels: [new Float32Array(10), new Float32Array(9)] }),
  ).toThrow(WatermarkingError);
});

test('a zero-length channel behaves as silence', () => {
  const wm = new PerceptualWatermarker();
  const marked = wm.applyWatermark(
    { sampleRate: SR, channels: [new Float32Array(0)] },
    { key: 'k' },
  );
  expect(marked.channels[0].length).toBe(0);
  const result = wm.getWatermark(marked, { key: 'k' });
  expect(result.detected).toBe(false);
  expect(result.diagnostics.activeFrames).toBe(0);
});

test('a non-finite or negative alpha throws instead of writing non-finite audio', () => {
  const wm = new PerceptualWatermarker();
  const audio = speechLike(0.5);
  for (const alpha of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0.1]) {
    expect(() => wm.applyWatermark(audio, { alpha })).toThrow(WatermarkingError);
  }
  const zero = wm.applyWatermark(audio, { alpha: 0 });
  expect(zero.channels[0].every((x) => Number.isFinite(x))).toBe(true);
});

test('a NaN or infinite sample throws WatermarkingError', () => {
  const wm = new PerceptualWatermarker();
  const bad = speechLike(0.5);
  bad.channels[0][100] = Number.NaN;
  expect(() => wm.getWatermark(bad)).toThrow(WatermarkingError);
  bad.channels[0][100] = Number.POSITIVE_INFINITY;
  expect(() => wm.applyWatermark(bad)).toThrow(WatermarkingError);
});

test('the energy gate is relative, so quiet audio keeps active frames', () => {
  const wm = new PerceptualWatermarker();
  const quiet = speechLike(2).channels[0].map((x) => x * 1e-8);
  const result = wm.getWatermark({ sampleRate: SR, channels: [quiet] }, { key: 'k' });
  expect(result.diagnostics.activeFrames).toBeGreaterThan(0);
  expect(result.detected).toBe(false);
});
