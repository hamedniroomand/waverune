/**
 * Measure prefix removal and fixed-duration excerpts.
 *
 * Part one removes prefixes from 0 to two hops in fine steps on both
 * six-second fixtures. For each offset it records the exact-recovery flag and
 * the weakest bit correlation. Part two cuts excerpts on the declared duration
 * grid at the declared start positions and reports the shortest passing
 * duration per fixture and start.
 *
 * Usage: bun bench/crop.ts [--steps N] [--tag name] [--fine]
 */
import { robustnessMarked } from '../tests/helpers/acceptance';
import { excerpt, removePrefix } from '../tests/helpers/attacks';
import {
  EXCERPT_GRID,
  HOP_44K,
  ROBUSTNESS,
  ROBUSTNESS_FIXTURES,
  SAMPLE_RATE,
} from '../tests/helpers/matrix';
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

const opts = benchArgs({ fine: { type: 'boolean' } });
const watermarker = makeWatermarker(opts.steps);
const start = performance.now();

const sweepStep = opts.values.fine ? 7 : 21;
const sweepOffsets: number[] = [];
for (let n = 0; n <= 2 * HOP_44K; n += sweepStep) sweepOffsets.push(n);

interface SweepRow extends Trial {
  minCorrelation: number;
  meanCorrelation: number;
}

const sweep: SweepRow[] = [];
for (const fixtureId of ROBUSTNESS_FIXTURES) {
  const marked = robustnessMarked(watermarker, fixtureId);
  for (const n of sweepOffsets) {
    const result = watermarker.getWatermark(mono(removePrefix(marked, n).signal), {
      key: ROBUSTNESS.key,
    });
    sweep.push({
      ...trial(
        'prefix-sweep',
        fixtureId,
        ROBUSTNESS.key,
        ROBUSTNESS.payload,
        { samples: n, hopFraction: Number((n / HOP_44K).toFixed(3)) },
        result,
      ),
      minCorrelation: result.diagnostics.minCorrelation,
      meanCorrelation: result.diagnostics.meanCorrelation,
    });
  }
}

const excerpts: Trial[] = [];
for (const fixtureId of ROBUSTNESS_FIXTURES) {
  const marked = robustnessMarked(watermarker, fixtureId);
  for (const startSeconds of EXCERPT_GRID.startsSeconds) {
    for (const duration of EXCERPT_GRID.durationsSeconds) {
      const first = Math.round(startSeconds * SAMPLE_RATE);
      const length = Math.round(duration * SAMPLE_RATE);
      if (first + length > marked.length) continue;
      const result = watermarker.getWatermark(mono(excerpt(marked, first, length).signal), {
        key: ROBUSTNESS.key,
      });
      excerpts.push(
        trial(
          'excerpt',
          fixtureId,
          ROBUSTNESS.key,
          ROBUSTNESS.payload,
          { startSeconds, durationSeconds: duration, startSample: first, lengthSamples: length },
          result,
        ),
      );
    }
  }
}

/** The shortest passing duration per fixture and start. `allLongerPass` says if every longer duration also passed. */
const shortest: {
  fixture: string;
  startSeconds: number;
  shortestPassing: number | null;
  allLongerPass: boolean;
}[] = [];
for (const fixtureId of ROBUSTNESS_FIXTURES) {
  for (const startSeconds of EXCERPT_GRID.startsSeconds) {
    const rows = excerpts
      .filter((t) => t.fixture === fixtureId && t.params.startSeconds === startSeconds)
      .toSorted((a, b) => Number(a.params.durationSeconds) - Number(b.params.durationSeconds));
    const firstPass = rows.find((t) => t.exact);
    const shortestPassing = firstPass ? Number(firstPass.params.durationSeconds) : null;
    const allLongerPass =
      shortestPassing !== null &&
      rows.filter((t) => Number(t.params.durationSeconds) >= shortestPassing).every((t) => t.exact);
    shortest.push({ fixture: fixtureId, startSeconds, shortestPassing, allLongerPass });
  }
}

const sweepSummary = ROBUSTNESS_FIXTURES.map((fixtureId) => {
  const rows = sweep.filter((t) => t.fixture === fixtureId);
  return {
    fixture: fixtureId,
    offsets: rows.length,
    exact: rows.filter((t) => t.exact).length,
    failingOffsets: rows.filter((t) => !t.exact).map((t) => t.params.samples),
    minCorrelationMin: Math.min(...rows.map((t) => t.minCorrelation)),
    acceptedWrongPayload: rows.filter((t) => t.detected && !t.exact).length,
  };
});

const path = await writeResult('crop', opts.tag, {
  environment: await environment(),
  config: effectiveConfig(opts.steps),
  sweep: { step: sweepStep, offsets: sweepOffsets, summary: sweepSummary, trials: sweep },
  excerpts: {
    grid: EXCERPT_GRID,
    shortest,
    trials: excerpts,
    acceptedWrongPayload: excerpts.filter((t) => t.detected && !t.exact).length,
  },
});

console.log('Prefix sweep (samples removed, every ' + sweepStep + ' samples up to two hops):');
for (const s of sweepSummary)
  console.log(
    `  ${s.fixture}: ${s.exact}/${s.offsets} exact, min bit correlation ${fmt(s.minCorrelationMin)}, failing offsets: ${s.failingOffsets.join(' ') || 'none'}`,
  );
console.log('\nExcerpt grid:');
console.log(
  markdownTable(
    [
      'fixture',
      'start (s)',
      ...EXCERPT_GRID.durationsSeconds.map((d) => `${d} s`),
      'shortest pass',
    ],
    ROBUSTNESS_FIXTURES.flatMap((fixtureId) =>
      EXCERPT_GRID.startsSeconds.map((startSeconds) => {
        const cells = EXCERPT_GRID.durationsSeconds.map((d) => {
          const t = excerpts.find(
            (x) =>
              x.fixture === fixtureId &&
              x.params.startSeconds === startSeconds &&
              x.params.durationSeconds === d,
          );
          return t ? (t.exact ? 'ok' : t.detected ? 'WRONG' : 'reject') : 'n/a';
        });
        const s = shortest.find((x) => x.fixture === fixtureId && x.startSeconds === startSeconds)!;
        return [
          fixtureId,
          startSeconds,
          ...cells,
          s.shortestPassing === null
            ? 'none'
            : `${s.shortestPassing} s${s.allLongerPass ? '' : ' (not monotonic)'}`,
        ];
      }),
    ),
  ),
);
console.log(`\nwrote ${path} in ${elapsed(start)}`);
