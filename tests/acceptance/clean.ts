import { expect, test } from 'bun:test';

import { runCleanRecovery } from '../helpers/acceptance';
import { inexact, watermarker } from './shared';

/** Register the clean-recovery and WAV round-trip case for one fixture. */
export function cleanRecoveryTest(fixtureId: string): void {
  test(`20 pairs recover exactly, clean and after a 16-bit WAV round trip (${fixtureId})`, () => {
    const trials = runCleanRecovery(watermarker, fixtureId);
    expect(trials.length).toBe(40);
    expect(inexact(trials)).toEqual([]);
  }, 240000);
}
