import { expect, test } from 'bun:test';

import { runCrossPairRejection } from '../helpers/acceptance';
import { CLEAN_FIXTURES, REJECTION } from '../helpers/matrix';
import { accepted, watermarker } from './shared';

test('a fixture marked with one pair rejects under every other pair key', () => {
  const trials = runCrossPairRejection(watermarker);
  const { count } = REJECTION.crossPairs;
  expect(trials.length).toBe(CLEAN_FIXTURES.length * count * (count - 1));
  expect(accepted(trials)).toEqual([]);
}, 240000);
