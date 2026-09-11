import { expect, test } from 'bun:test';

import { assignCells, deriveSeed, makeRng } from '~/codec/prng';

test('rng is deterministic for a seed and varies across seeds', () => {
  const a = makeRng(deriveSeed('secret', 'cells')),
    b = makeRng(deriveSeed('secret', 'cells'));
  const c = makeRng(deriveSeed('other', 'cells'));
  const seqA = Array.from({ length: 8 }, a);
  expect(Array.from({ length: 8 }, b)).toEqual(seqA);
  expect(Array.from({ length: 8 }, c)).not.toEqual(seqA);
});

test('domains give independent streams for the same key', () => {
  const cells = Array.from({ length: 8 }, makeRng(deriveSeed('secret', 'cells')));
  const chips = Array.from({ length: 8 }, makeRng(deriveSeed('secret', 'chips')));
  expect(chips).not.toEqual(cells);
});

test('derived seed is 128 bits and never all zero', () => {
  const seed = deriveSeed('secret', 'cells');
  expect(seed.length).toBe(4);
  expect(seed.some((w: number) => w !== 0)).toBe(true);
});

test('cells are balanced across bits', () => {
  const { bitIndex } = assignCells('k', 100, 48, 56);
  const counts = Array.from({ length: 56 }, () => 0);
  for (const b of bitIndex) counts[b]++;
  expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
});

test('chips are balanced and keyed', () => {
  const { chip } = assignCells('k', 100, 48, 56);
  const sum = chip.reduce((a: number, b: number) => a + b, 0);
  expect(Math.abs(sum)).toBeLessThan(chip.length * 0.1);
  const other = assignCells('different', 100, 48, 56);
  let same = 0;
  for (let i = 0; i < chip.length; i++) if (chip[i] === other.chip[i]) same++;
  expect(same / chip.length).toBeLessThan(0.65);
});

test('assignment is reproducible', () => {
  const a = assignCells('k', 20, 8, 16),
    b = assignCells('k', 20, 8, 16);
  expect(Array.from(a.bitIndex)).toEqual(Array.from(b.bitIndex));
});
