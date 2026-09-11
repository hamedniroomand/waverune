/**
 * The larger false-acceptance benchmark.
 *
 * This set is separate from the CI rejection set in `tests/helpers/matrix.ts`
 * and uses its own seeds, so nobody can validate a threshold on the cases
 * that tuned it. The runner reports trial counts and observed acceptances per
 * category. Zero observed acceptances is a count, not a probability.
 *
 * Categories:
 * - unmarked: clean fixtures under many keys
 * - wrong-key: marked fixtures under many wrong keys
 * - low-energy: unmarked fixtures scaled far below full scale
 * - silence-with-dither: a fixed-seed noise floor at 1e-4 peak with no signal
 *
 * Usage: bun bench/rejection.ts [--steps N] [--tag name] [--keys N]
 */
import { rms, scale, whiteNoise } from '../tests/helpers/attacks';
import { keyPayloadPairs, lcg } from '../tests/helpers/lcg';
import { buildFixture, SAMPLE_RATE } from '../tests/helpers/matrix';
import { mono, trial, type Trial } from '../tests/helpers/trial';
import {
  benchArgs,
  effectiveConfig,
  elapsed,
  environment,
  fmt,
  makeWatermarker,
  markdownTable,
  writeResult,
} from './lib';

const opts = benchArgs({ keys: { type: 'string' } });
const watermarker = makeWatermarker(opts.steps);
const start = performance.now();
const keyCount = opts.values.keys === undefined ? 100 : Number(opts.values.keys);

const SEED = 0xfa15e;
const next = lcg(SEED);
const keys: string[] = [];
for (let i = 0; i < keyCount; i++) keys.push(`bench-key-${next().toString(16)}`);

const trials: Trial[] = [];
const unmarkedFixtures = ['tonal-4s-44k', 'broadband-4s-44k'];
for (const fixtureId of unmarkedFixtures) {
  const audio = buildFixture(fixtureId);
  for (const key of keys)
    trials.push(
      trial('unmarked', fixtureId, key, null, {}, watermarker.getWatermark(audio, { key })),
    );
  const quiet = mono(scale(audio.channels[0], 1e-3).signal);
  for (const key of keys.slice(0, Math.ceil(keyCount / 4))) {
    trials.push(
      trial(
        'low-energy',
        fixtureId,
        key,
        null,
        { gain: 1e-3 },
        watermarker.getWatermark(quiet, { key }),
      ),
    );
  }
}

const embedded = keyPayloadPairs(0xe3bed, 4);
for (const fixtureId of unmarkedFixtures) {
  const audio = buildFixture(fixtureId);
  for (const pair of embedded) {
    const marked = watermarker.applyWatermark(audio, pair);
    for (const key of keys.slice(0, Math.ceil(keyCount / 4))) {
      trials.push(
        trial(
          'wrong-key',
          fixtureId,
          key,
          null,
          { embeddedKey: pair.key, embeddedPayload: pair.payload.toString(16) },
          watermarker.getWatermark(marked, { key }),
        ),
      );
    }
  }
}

// A noise floor at an absolute level of 1e-4, about -80 dBFS peak, with no
// signal. `addNoise` scales by the input RMS and would give silence here.
const DITHER_AMPLITUDE = 1e-4;
const dither = whiteNoise(4 * SAMPLE_RATE, DITHER_AMPLITUDE, 99);
if (rms(dither) === 0) throw new Error('the dither buffer holds no noise');
for (const key of keys.slice(0, Math.ceil(keyCount / 4))) {
  trials.push(
    trial(
      'silence-with-dither',
      'dither-4s',
      key,
      null,
      { amplitude: DITHER_AMPLITUDE, rms: Number(rms(dither).toExponential(3)) },
      watermarker.getWatermark(mono(dither), { key }),
    ),
  );
}

const categories = [...new Set(trials.map((t) => t.case))];
const summary = categories.map((c) => {
  const rows = trials.filter((t) => t.case === c);
  const scores = rows.map((t) => t.correlationScore).toSorted((a, b) => a - b);
  return {
    category: c,
    trials: rows.length,
    accepted: rows.filter((t) => t.detected).length,
    syncValid: rows.filter((t) => t.syncValid).length,
    checksumValid: rows.filter((t) => t.checksumValid).length,
    bothValid: rows.filter((t) => t.syncValid && t.checksumValid).length,
    minSyncErrors: Math.min(...rows.map((t) => Math.round(t.syncErrorRate * 16))),
    scoreMedian: scores[scores.length >> 1],
    scoreMax: scores[scores.length - 1],
  };
});

const path = await writeResult('rejection', opts.tag, {
  environment: await environment(),
  config: effectiveConfig(opts.steps),
  seed: SEED,
  keyCount,
  summary,
  totalTrials: trials.length,
  totalAccepted: trials.filter((t) => t.detected).length,
  trials,
});

console.log(
  markdownTable(
    [
      'category',
      'trials',
      'accepted',
      'sync valid',
      'crc valid',
      'both',
      'min sync errors /16',
      'score median',
      'score max',
    ],
    summary.map((s) => [
      s.category,
      s.trials,
      s.accepted,
      s.syncValid,
      s.checksumValid,
      s.bothValid,
      s.minSyncErrors,
      fmt(s.scoreMedian),
      fmt(s.scoreMax),
    ]),
  ),
);
console.log(
  `\n${trials.length} trials, ${trials.filter((t) => t.detected).length} accepted; wrote ${path} in ${elapsed(start)}`,
);
