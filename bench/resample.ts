/**
 * Measure recovery after real sample-rate conversion.
 *
 * Each case embeds `RESAMPLE_PAIRS.count` deterministic pairs into both
 * six-second signal classes at the source rate, converts the marked audio with
 * an external resampler, and detects at the target rate. The result records
 * the tool, its version and settings, the output rate and length, and every
 * trial.
 *
 * When no external resampler is installed, the runner exits with code 2 and
 * writes a result file that says so. It never reports success in that case.
 *
 * Usage: bun bench/resample.ts [--steps N] [--tag name]
 */
import { keyPayloadPairs } from '../tests/helpers/lcg';
import { RESAMPLE_CASES, RESAMPLE_PAIRS, type SignalClass } from '../tests/helpers/matrix';
import { findResampler, resampleExternal } from '../tests/helpers/resampler';
import { musicLike, speechLike } from '../tests/helpers/signals';
import { trial, type Trial } from '../tests/helpers/trial';
import {
  benchArgs,
  effectiveConfig,
  elapsed,
  environment,
  fmt,
  makeWatermarker,
  markdownTable,
  RESULTS_DIR,
  writeResult,
} from './lib';

const opts = benchArgs();
const watermarker = makeWatermarker(opts.steps);
const start = performance.now();
const info = findResampler();

if (!info) {
  const path = await writeResult('resample', opts.tag, {
    environment: environment(),
    status: 'incomplete',
    reason: 'no external resampler found (sox or afconvert)',
  });
  console.error('Resampling evaluation INCOMPLETE: neither sox nor afconvert is installed.');
  console.error(`Wrote ${path}.`);
  process.exit(2);
}

const BUILDERS: Record<
  SignalClass,
  (seconds: number, sr: number) => ReturnType<typeof speechLike>
> = {
  tonal: speechLike,
  broadband: musicLike,
};
const SIGNAL_CLASSES: SignalClass[] = ['tonal', 'broadband'];
const SECONDS = 6;
const pairs = keyPayloadPairs(RESAMPLE_PAIRS.seed, RESAMPLE_PAIRS.count);

interface ResampleTrial extends Trial {
  fromHz: number;
  toHz: number;
  inputSamples: number;
  outputSamples: number;
  expectedOutputSamples: number;
}

const trials: ResampleTrial[] = [];
for (const { fromHz, toHz } of RESAMPLE_CASES) {
  for (const signal of SIGNAL_CLASSES) {
    const audio = BUILDERS[signal](SECONDS, fromHz);
    const fixtureId = `${signal}-${SECONDS}s-${fromHz}`;
    for (const { key, payload } of pairs) {
      const marked = watermarker.applyWatermark(audio, { key, payload });
      const converted = await resampleExternal(marked, toHz, info, RESULTS_DIR);
      const result = watermarker.getWatermark(converted, { key });
      trials.push({
        ...trial('resample', fixtureId, key, payload, { fromHz, toHz }, result),
        fromHz,
        toHz,
        inputSamples: marked.channels[0].length,
        outputSamples: converted.channels[0].length,
        expectedOutputSamples: Math.round((marked.channels[0].length * toHz) / fromHz),
      });
    }
  }
}

const summary = RESAMPLE_CASES.flatMap(({ fromHz, toHz }) =>
  SIGNAL_CLASSES.map((signal) => {
    const rows = trials.filter(
      (t) => t.fromHz === fromHz && t.toHz === toHz && t.fixture.startsWith(signal),
    );
    return {
      fromHz,
      toHz,
      signal,
      trials: rows.length,
      exact: rows.filter((t) => t.exact).length,
      acceptedWrongPayload: rows.filter((t) => t.detected && !t.exact).length,
      minCorrelationScore: Math.min(...rows.map((t) => t.correlationScore)),
      maxSyncErrorRate: Math.max(...rows.map((t) => t.syncErrorRate)),
      checksumValid: rows.filter((t) => t.checksumValid).length,
      outputSamples: rows[0]?.outputSamples,
      expectedOutputSamples: rows[0]?.expectedOutputSamples,
    };
  }),
);

const path = await writeResult('resample', opts.tag, {
  environment: environment(),
  config: effectiveConfig(opts.steps),
  status: 'complete',
  resampler: info,
  pairs: RESAMPLE_PAIRS,
  seconds: SECONDS,
  summary,
  trials,
});

console.log(`Resampler: ${info.version}`);
console.log(`Settings: ${info.settings}`);
console.log(
  markdownTable(
    [
      'from',
      'to',
      'signal',
      'exact',
      'wrong accepted',
      'min score',
      'max sync err',
      'crc valid',
      'out samples (expected)',
    ],
    summary.map((s) => [
      s.fromHz,
      s.toHz,
      s.signal,
      `${s.exact}/${s.trials}`,
      s.acceptedWrongPayload,
      fmt(s.minCorrelationScore),
      fmt(s.maxSyncErrorRate),
      `${s.checksumValid}/${s.trials}`,
      `${s.outputSamples} (${s.expectedOutputSamples})`,
    ]),
  ),
);
console.log(`\nwrote ${path} in ${elapsed(start)}`);
