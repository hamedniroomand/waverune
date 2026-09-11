import { expect, test } from 'bun:test';

import { DummyWatermarker } from '~/watermarkers/dummy';

test('dummy preserves shape and reports no detection', () => {
  const wm = new DummyWatermarker();
  const audio = { sampleRate: 44100, channels: [new Float32Array([0.1234567, -0.9])] };
  const out = wm.applyWatermark(audio);
  expect(out.channels[0].length).toBe(2);
  expect(out.channels[0][0]).toBeCloseTo(0.12346, 5);
  expect(wm.getWatermark(out).detected).toBe(false);
});
