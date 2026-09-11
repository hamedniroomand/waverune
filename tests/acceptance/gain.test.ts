import { expect, test } from 'bun:test';

import { runGainCases } from '../helpers/acceptance';
import { inexact, watermarker } from './shared';

test('gains of 0.5 and 2.0 keep exact recovery on both six-second fixtures', () => {
  const trials = runGainCases(watermarker);
  expect(trials.length).toBe(4);
  expect(inexact(trials)).toEqual([]);
}, 120000);
