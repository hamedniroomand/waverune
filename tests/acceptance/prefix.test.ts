import { expect, test } from 'bun:test';

import { runPrefixCases } from '../helpers/acceptance';
import { inexact, watermarker } from './shared';

test('every declared prefix removal keeps exact recovery on both six-second fixtures', () => {
  const trials = runPrefixCases(watermarker);
  expect(trials.length).toBe(34);
  expect(inexact(trials)).toEqual([]);
}, 240000);
