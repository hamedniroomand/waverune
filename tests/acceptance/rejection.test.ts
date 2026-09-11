import { expect, test } from 'bun:test';

import {
  runLowEnergyRejection,
  runSilenceRejection,
  runUnmarkedRejection,
  runWrongKeyRejection,
} from '../helpers/acceptance';
import { CLEAN_FIXTURES, REJECTION, ROBUSTNESS_FIXTURES } from '../helpers/matrix';
import { accepted, watermarker } from './shared';

// The cross-pair category has its own file; it is as long as these four together.
test('unmarked, wrong-key, silent and low-energy audio produce no acceptance', () => {
  const trials = [
    ...runUnmarkedRejection(watermarker),
    ...runWrongKeyRejection(watermarker),
    ...runSilenceRejection(watermarker),
    ...runLowEnergyRejection(watermarker),
  ];
  const expected =
    REJECTION.cleanFixtures.length * REJECTION.cleanKeys.length +
    ROBUSTNESS_FIXTURES.length * REJECTION.wrongKeys.length +
    REJECTION.silenceSeconds.length * REJECTION.silenceKeys.length +
    CLEAN_FIXTURES.length * REJECTION.cleanKeys.length;
  expect(trials.length).toBe(expected);
  expect(accepted(trials)).toEqual([]);
}, 240000);
