/**
 * Measure the experimental attacks with their achieved severity.
 *
 * For every attack the runner records what changed, as a sample count and a
 * fraction, the achieved severity, and the detection outcome. An outcome is
 * `exact`, `reject`, or `WRONG` for an accepted wrong payload. The runner
 * throws when an attack changed nothing, because such an attack proves nothing.
 *
 * Usage: bun bench/attacks.ts [--steps N] [--tag name]
 */
import { robustnessMarked } from '../tests/helpers/acceptance';
import {
  addNoise,
  clipAtPeakFraction,
  insertSilence,
  padLeading,
  padTrailing,
  peak,
  requantize,
  type Attacked,
} from '../tests/helpers/attacks';
import {
  CLIP_FRACTIONS,
  NOISE,
  QUANTIZE_BITS,
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

const opts = benchArgs();
const watermarker = makeWatermarker(opts.steps);
const start = performance.now();

interface AttackTrial extends Trial {
  changedSamples: number;
  changedFraction: number;
  severity: Record<string, number>;
  outcome: 'exact' | 'reject' | 'WRONG';
}

const trials: AttackTrial[] = [];
function record(
  name: string,
  fixtureId: string,
  attacked: Attacked<Record<string, number>>,
  params: Record<string, number | string>,
): void {
  if (attacked.changedSamples === 0) throw new Error(`${name} on ${fixtureId} changed nothing`);
  const result = watermarker.getWatermark(mono(attacked.signal), { key: ROBUSTNESS.key });
  const t = trial(name, fixtureId, ROBUSTNESS.key, ROBUSTNESS.payload, params, result);
  trials.push({
    ...t,
    changedSamples: attacked.changedSamples,
    changedFraction: attacked.changedFraction,
    severity: attacked.severity,
    outcome: t.exact ? 'exact' : t.detected ? 'WRONG' : 'reject',
  });
}

for (const fixtureId of ROBUSTNESS_FIXTURES) {
  const marked = robustnessMarked(watermarker, fixtureId);
  const markedPeak = peak(marked);
  for (const fraction of CLIP_FRACTIONS) {
    record('clip', fixtureId, clipAtPeakFraction(marked, fraction), {
      peakFraction: fraction,
      markedPeak: Number(markedPeak.toFixed(4)),
    });
  }
  for (const snrDb of NOISE.snrDb)
    record('noise', fixtureId, addNoise(marked, snrDb, NOISE.seed), {
      targetSnrDb: snrDb,
      seed: NOISE.seed,
    });
  for (const bits of QUANTIZE_BITS)
    record('requantize', fixtureId, requantize(marked, bits), { bits });
  const half = Math.round(0.5 * SAMPLE_RATE);
  record('pad-leading', fixtureId, padLeading(marked, half), { seconds: 0.5 });
  record('pad-trailing', fixtureId, padTrailing(marked, half), { seconds: 0.5 });
  for (const at of [1.0, 3.0, 4.5]) {
    record('insert-silence', fixtureId, insertSilence(marked, Math.round(at * SAMPLE_RATE), half), {
      atSeconds: at,
      seconds: 0.5,
    });
  }
}

const path = await writeResult('attacks', opts.tag, {
  environment: await environment(),
  config: effectiveConfig(opts.steps),
  parameters: { clipFractions: CLIP_FRACTIONS, noise: NOISE, quantizeBits: QUANTIZE_BITS },
  acceptedWrongPayload: trials.filter((t) => t.outcome === 'WRONG').length,
  trials,
});

console.log(
  markdownTable(
    [
      'attack',
      'fixture',
      'params',
      'changed samples',
      'changed %',
      'achieved severity',
      'outcome',
      'sync err',
      'score',
    ],
    trials.map((t) => [
      t.case,
      t.fixture,
      JSON.stringify(t.params),
      t.changedSamples,
      fmt(100 * t.changedFraction, 2),
      t.case === 'noise'
        ? `${fmt(t.severity.achievedSnrDb, 2)} dB SNR`
        : t.case === 'clip'
          ? `limit ${fmt(t.severity.limit, 4)} (${fmt(t.severity.limitOverPeak, 2)} of peak)`
          : '',
      t.outcome,
      fmt(t.syncErrorRate, 4),
      fmt(t.correlationScore),
    ]),
  ),
);
console.log(
  `\n${trials.filter((t) => t.outcome === 'WRONG').length} accepted wrong payloads; wrote ${path} in ${elapsed(start)}`,
);
