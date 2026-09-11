/**
 * Supported behaviour after real sample-rate conversion.
 *
 * `bench/resample.ts` runs the full evaluation with five pairs per case. This
 * test runs one pair per conversion and signal class through the same
 * external resampler, as a regression check on the supported configurations.
 *
 * The test needs `sox` or `afconvert`. When neither is installed, the test
 * fails with an explicit message. A silent skip would hide an incomplete
 * validation. Set `WAVERUNE_ALLOW_SKIP_RESAMPLE=1` to turn that failure into
 * a skip on a machine that cannot run the tool.
 */
import { expect, test } from 'bun:test';

import { PerceptualWatermarker } from '~/watermarkers/perceptual';

import { keyPayloadPairs } from './helpers/lcg';
import { RESAMPLE_CASES, RESAMPLE_PAIRS, type SignalClass } from './helpers/matrix';
import { findResampler, resampleExternal } from './helpers/resampler';
import { musicLike, speechLike } from './helpers/signals';

const TMP = new URL('./tmp/', import.meta.url).pathname;
const info = findResampler();
const allowSkip = process.env.WAVERUNE_ALLOW_SKIP_RESAMPLE === '1';

if (!info && !allowSkip) {
  test('an external resampler is available for the resampling validation', () => {
    throw new Error(
      'Resampling validation is incomplete: neither sox nor afconvert was found. ' +
        'Install sox, or set WAVERUNE_ALLOW_SKIP_RESAMPLE=1 to skip on this machine.',
    );
  });
}

const BUILDERS: Record<
  SignalClass,
  (seconds: number, sr: number) => ReturnType<typeof speechLike>
> = {
  tonal: speechLike,
  broadband: musicLike,
};
const SIGNAL_CLASSES: SignalClass[] = ['tonal', 'broadband'];

const watermarker = new PerceptualWatermarker();
const pair = keyPayloadPairs(RESAMPLE_PAIRS.seed, 1)[0];

for (const { fromHz, toHz } of RESAMPLE_CASES) {
  for (const signal of SIGNAL_CLASSES) {
    const run = info ? test : test.skip;
    run(
      `${fromHz} -> ${toHz} Hz keeps exact recovery through ${info?.tool ?? 'an external resampler'} (${signal})`,
      async () => {
        const marked = watermarker.applyWatermark(BUILDERS[signal](6, fromHz), pair);
        const converted = await resampleExternal(marked, toHz, info!, TMP);
        expect(converted.sampleRate).toBe(toHz);
        const result = watermarker.getWatermark(converted, { key: pair.key });
        expect(result.detected).toBe(true);
        expect(result.payload).toBe(pair.payload);
      },
      60000,
    );
  }
}
