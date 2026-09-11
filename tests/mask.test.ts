import { expect, test } from 'bun:test';

import { planBand, slotEnergy } from '~/codec/band';
import { frameGate } from '~/codec/gate';
import { maskingThreshold } from '~/codec/mask';
import { WatermarkingError } from '~/types';

test('band plan covers slots in order without gaps', () => {
  const plan = planBand(44100, 2048, 500, 5000, 48);
  expect(plan.slots).toBe(48);
  for (let s = 0; s < 48; s++) expect(plan.binEnd[s]).toBeGreaterThan(plan.binStart[s]);
  for (let s = 1; s < 48; s++) expect(plan.binStart[s]).toBe(plan.binEnd[s - 1]);
});

test('band plan clamps the top edge below nyquist', () => {
  const plan = planBand(8000, 1024, 500, 5000, 16);
  expect(plan.highHz).toBeLessThanOrEqual(0.95 * 4000);
});

// At 256 bins the 48 slot edges collide, so the boundary sweep must run.
test('the boundary sweep keeps every slot contiguous and non-empty', () => {
  const plan = planBand(44100, 256, 500, 5000, 48);
  for (let s = 0; s < 48; s++) expect(plan.binEnd[s]).toBe(plan.binStart[s] + 1);
  for (let s = 1; s < 48; s++) expect(plan.binStart[s]).toBe(plan.binEnd[s - 1]);
  expect(plan.binEnd[47] - plan.binStart[0]).toBe(48);
});

test('the reported band is the band that the slots occupy', () => {
  const plan = planBand(44100, 256, 500, 5000, 48);
  const hzPerBin = 44100 / 256;
  expect(plan.lowHz).toBeCloseTo(plan.binStart[0] * hzPerBin, 6);
  expect(plan.highHz).toBeCloseTo(plan.binEnd[47] * hzPerBin, 6);
  // The sweep pushed the top edge above the requested 5000 Hz.
  expect(plan.highHz).toBeGreaterThan(5000);
  expect(plan.highHz).toBeLessThanOrEqual(0.95 * 22050);
});

test('planBand throws when the slots do not fit below the clamp', () => {
  expect(() => planBand(8000, 256, 500, 5000, 128)).toThrow(WatermarkingError);
});

test('masking threshold sits below the masker and spreads to neighbours', () => {
  const plan = planBand(44100, 2048, 500, 5000, 48);
  const mag = [new Float64Array(1025)];
  for (let k = plan.binStart[20]; k < plan.binEnd[20]; k++) mag[0][k] = 1.0;
  const thr = maskingThreshold(slotEnergy(mag, plan), plan);
  expect(thr[0][20]).toBeLessThan(1.0);
  expect(thr[0][21]).toBeGreaterThan(0);
  expect(thr[0][21]).toBeLessThan(thr[0][20]);
});

test('frame gate rejects near-silent frames', () => {
  const loud = new Float64Array(129).fill(1);
  const quiet = new Float64Array(129).fill(0.001);
  const gate = frameGate([loud, quiet, loud]);
  expect(gate[0]).toBe(1);
  expect(gate[1]).toBe(0);
});
