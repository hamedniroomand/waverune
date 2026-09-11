/**
 * Measure the watermark residual against the simplified masking threshold.
 *
 * The runner embeds into each four-second fixture, computes the residual as
 * marked minus host, and compares the per-cell slot energy of the residual
 * with the masking threshold of the host. It reports the exclusion rule, the
 * cell counts, the fraction of included cells whose residual exceeds the
 * threshold, and the distribution of the residual-to-threshold ratio.
 *
 * This is a measurement of the model, not a listening test. The model is a
 * simplified spreading function. It does not prove that the watermark is
 * inaudible.
 *
 * Usage: bun bench/masking.ts [--tag name]
 */
import { planBand, slotEnergy } from '~/codec/band';
import { frameGate } from '~/codec/gate';
import { maskingThreshold } from '~/codec/mask';
import { stft } from '~/dsp/stft';
import { calculateAudioMetrics } from '~/metrics';
import { DEFAULT_CONFIG, PerceptualWatermarker } from '~/watermarkers/perceptual';

import { buildFixture, CLEAN_FIXTURES, SAMPLE_RATE } from '../tests/helpers/matrix';
import { benchArgs, elapsed, environment, fmt, markdownTable, writeResult } from './lib';

const opts = benchArgs();
const start = performance.now();
const watermarker = new PerceptualWatermarker();

/** Cells more than this many decibels below the loudest slot of their frame are excluded. */
const FLOOR_DB = 60;

/** The value at quantile `p` of a sorted array. */
function q(arr: number[], p: number): number {
  return arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))] : Number.NaN;
}

const results = CLEAN_FIXTURES.map((fixtureId) => {
  const audio = buildFixture(fixtureId);
  const marked = watermarker.applyWatermark(audio, { key: 'secret', payload: 7n });
  const host = audio.channels[0];
  const residual = new Float32Array(host.length);
  for (let i = 0; i < host.length; i++) residual[i] = marked.channels[0][i] - host[i];

  const nFft = 2 ** Math.round(Math.log2(SAMPLE_RATE * DEFAULT_CONFIG.windowSeconds));
  const hop = Math.round(SAMPLE_RATE * DEFAULT_CONFIG.hopSeconds);
  const plan = planBand(
    SAMPLE_RATE,
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

  let totalCells = 0;
  let gatedOut = 0;
  let belowFloor = 0;
  const ratios: number[] = [];
  const excludedRatios: number[] = [];
  for (let f = 0; f < hostSpec.magnitude.length; f++) {
    for (let s = 0; s < plan.slots; s++) totalCells++;
    if (gate[f] === 0) {
      gatedOut += plan.slots;
      continue;
    }
    let peak = 0;
    for (let s = 0; s < plan.slots; s++) peak = Math.max(peak, hostEnergy[f][s]);
    const floor = peak * 10 ** (-FLOOR_DB / 20);
    for (let s = 0; s < plan.slots; s++) {
      if (threshold[f][s] <= 0) continue;
      const ratio = residualEnergy[f][s] / threshold[f][s];
      if (hostEnergy[f][s] >= floor) ratios.push(ratio);
      else {
        belowFloor++;
        excludedRatios.push(ratio);
      }
    }
  }
  ratios.sort((a, b) => a - b);
  excludedRatios.sort((a, b) => a - b);
  const metrics = calculateAudioMetrics(host, marked.channels[0]);
  return {
    fixture: fixtureId,
    exclusionRule: `frames below the energy gate (5% of the loudest frame's magnitude sum) and cells more than ${FLOOR_DB} dB below the loudest slot of their frame`,
    totalCells,
    gatedOutCells: gatedOut,
    belowFloorCells: belowFloor,
    includedCells: ratios.length,
    includedFraction: ratios.length / totalCells,
    exceedingCells: ratios.filter((r) => r > 1).length,
    exceedingFraction: ratios.filter((r) => r > 1).length / ratios.length,
    ratio: {
      median: q(ratios, 0.5),
      p90: q(ratios, 0.9),
      p99: q(ratios, 0.99),
      max: ratios[ratios.length - 1],
    },
    excludedRatio: {
      median: q(excludedRatios, 0.5),
      p90: q(excludedRatios, 0.9),
      max: excludedRatios[excludedRatios.length - 1] ?? Number.NaN,
    },
    snrDb: metrics.snr,
    psnrDb: metrics.psnr,
  };
});

const path = await writeResult('masking', opts.tag, {
  environment: await environment(),
  config: DEFAULT_CONFIG,
  floorDb: FLOOR_DB,
  results,
});

console.log(
  markdownTable(
    [
      'fixture',
      'cells',
      'gated out',
      'below floor',
      'included',
      'exceeding',
      'exceed %',
      'ratio median',
      'p90',
      'p99',
      'max',
      'excluded median',
      'excluded max',
      'SNR dB',
    ],
    results.map((r) => [
      r.fixture,
      r.totalCells,
      r.gatedOutCells,
      r.belowFloorCells,
      r.includedCells,
      r.exceedingCells,
      fmt(100 * r.exceedingFraction, 2),
      fmt(r.ratio.median),
      fmt(r.ratio.p90),
      fmt(r.ratio.p99),
      fmt(r.ratio.max),
      fmt(r.excludedRatio.median),
      fmt(r.excludedRatio.max),
      fmt(r.snrDb, 2),
    ]),
  ),
);
console.log(`\nwrote ${path} in ${elapsed(start)}`);
