/**
 * The required acceptance matrix. `tests/helpers/matrix.ts` declares the
 * cases and `docs/reliability-report.md` records the measured results.
 *
 * Every case in this directory is a supported-behaviour claim. A failure is a
 * regression in the support envelope, not a benchmark data point.
 */
import { expect, test } from 'bun:test';

import { CLEAN_FIXTURES, matrixSeedsMatch } from '../helpers/matrix';

test('the seeded offsets in the manifest match their generators', () => {
  expect(matrixSeedsMatch()).toBe(true);
});

// Each clean fixture has its own test file, so the cases run in parallel.
// Adding a fixture to the matrix means adding a file next to these.
test('every clean fixture has a test file', () => {
  expect(CLEAN_FIXTURES).toEqual(['tonal-4s-44k', 'broadband-4s-44k']);
});
