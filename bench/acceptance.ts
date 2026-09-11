/**
 * Run the required acceptance matrix and write every trial to disk.
 *
 * Usage: bun bench/acceptance.ts [--steps N] [--tag name]
 */
import {
  runCleanRecovery,
  runGainCases,
  runPrefixCases,
  runRejection,
} from '../tests/helpers/acceptance';
import * as matrix from '../tests/helpers/matrix';
import type { Trial } from '../tests/helpers/trial';
import {
  benchArgs,
  effectiveConfig,
  elapsed,
  environment,
  makeWatermarker,
  writeResult,
} from './lib';

const opts = benchArgs();
const watermarker = makeWatermarker(opts.steps);
const start = performance.now();

const trials: Trial[] = [];
for (const fixtureId of matrix.CLEAN_FIXTURES)
  trials.push(...runCleanRecovery(watermarker, fixtureId));
trials.push(...runGainCases(watermarker), ...runPrefixCases(watermarker));
const rejection = runRejection(watermarker);

function count(name: string): { total: number; exact: number } {
  const set = trials.filter((t) => t.case === name);
  return { total: set.length, exact: set.filter((t) => t.exact).length };
}

const summary = {
  clean: count('clean'),
  wavRoundTrip: count('wav-round-trip'),
  gain: count('gain'),
  prefixRemoval: count('prefix-removal'),
  rejection: {
    trials: rejection.length,
    accepted: rejection.filter((t) => t.detected).length,
    syncValidOnly: rejection.filter((t) => t.syncValid && !t.checksumValid).length,
    checksumValidOnly: rejection.filter((t) => !t.syncValid && t.checksumValid).length,
    maxCorrelationScore: Math.max(...rejection.map((t) => t.correlationScore)),
  },
};

const path = await writeResult('acceptance', opts.tag, {
  environment: environment(),
  config: effectiveConfig(opts.steps),
  manifest: {
    cleanPairs: matrix.CLEAN_PAIRS,
    cleanFixtures: matrix.CLEAN_FIXTURES,
    robustness: matrix.ROBUSTNESS,
    robustnessFixtures: matrix.ROBUSTNESS_FIXTURES,
    gains: matrix.GAINS,
    prefixCases: matrix.PREFIX_CASES,
    rejection: matrix.REJECTION,
  },
  summary,
  trials,
  rejectionTrials: rejection,
});

console.log(JSON.stringify(summary, null, 2));
const failed = trials.filter((t) => !t.exact);
for (const t of failed) {
  console.log(
    `UNMET ${t.case} ${t.fixture} ${JSON.stringify(t.params)} sync=${t.syncValid} crc=${t.checksumValid}`,
  );
}
console.log(
  `${failed.length} unmet recovery cases, ${summary.rejection.accepted} false acceptances; wrote ${path} in ${elapsed(start)}`,
);
