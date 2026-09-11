/**
 * The required acceptance matrix. See `tests/helpers/matrix.ts` for the
 * declared cases and `docs/reliability-report.md` for the measured results.
 *
 * Every case here is a supported-behaviour claim. A failure here is a
 * regression in the support envelope, not a benchmark data point.
 */
import { expect, test } from 'bun:test';

import { PerceptualWatermarker } from '~/watermarkers/perceptual';

import {
  runCleanRecovery,
  runGainCases,
  runPrefixCases,
  runRejection,
  type Trial,
} from './helpers/acceptance';
import { CLEAN_FIXTURES, matrixSeedsMatch } from './helpers/matrix';

const watermarker = new PerceptualWatermarker();

function describeFailure(t: Trial): string {
  return `${t.case} ${t.fixture} key=${t.key} payload=${t.payload} ${JSON.stringify(t.params)} -> detected=${t.detected} recovered=${t.recovered} sync=${t.syncValid} crc=${t.checksumValid} shift=${t.sampleShift}`;
}

test('the seeded offsets in the manifest match their generators', () => {
  expect(matrixSeedsMatch()).toBe(true);
});

for (const fixtureId of CLEAN_FIXTURES) {
  test(`20 pairs recover exactly, clean and after a 16-bit WAV round trip (${fixtureId})`, () => {
    const trials = runCleanRecovery(watermarker, fixtureId);
    expect(trials.length).toBe(40);
    expect(trials.filter((t) => !t.exact).map(describeFailure)).toEqual([]);
  }, 240000);
}

test('gains of 0.5 and 2.0 keep exact recovery on both six-second fixtures', () => {
  const trials = runGainCases(watermarker);
  expect(trials.length).toBe(4);
  expect(trials.filter((t) => !t.exact).map(describeFailure)).toEqual([]);
}, 120000);

test('every declared prefix removal keeps exact recovery on both six-second fixtures', () => {
  const trials = runPrefixCases(watermarker);
  expect(trials.length).toBe(34);
  expect(trials.filter((t) => !t.exact).map(describeFailure)).toEqual([]);
}, 240000);

test('the deterministic rejection set produces no acceptance', () => {
  const trials = runRejection(watermarker);
  expect(trials.length).toBeGreaterThan(100);
  const accepted = trials.filter((t) => t.detected || t.recovered !== null);
  expect(accepted.map(describeFailure)).toEqual([]);
}, 240000);
