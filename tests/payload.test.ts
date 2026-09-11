import { expect, test } from 'bun:test';

import { buildBlock, parseBlock, totalBits, checksumBits } from '~/codec/payload';

test('block round-trips a payload', () => {
  const bits = buildBlock(0xdeadbeefn, 32);
  expect(bits.length).toBe(totalBits(32));
  const parsed = parseBlock(bits, 32);
  expect(parsed.valid).toBe(true);
  expect(parsed.payload).toBe(0xdeadbeefn);
});

test('a flipped payload bit fails the checksum', () => {
  const bits = buildBlock(0x12345678n, 32);
  bits[20] ^= 1;
  expect(parseBlock(bits, 32).valid).toBe(false);
});

test('a corrupted sync word is rejected', () => {
  const bits = buildBlock(1n, 32);
  bits[0] ^= 1;
  expect(parseBlock(bits, 32).valid).toBe(false);
});

test('checksum differs for differing inputs and is 8 bits', () => {
  const a = checksumBits(Uint8Array.from([1, 0, 1, 1]));
  const b = checksumBits(Uint8Array.from([1, 0, 1, 0]));
  expect(a.length).toBe(8);
  expect(Array.from(a)).not.toEqual(Array.from(b));
});

test('oversized payloads are rejected', () => {
  expect(() => buildBlock(0x1_0000_0000n, 32)).toThrow();
});
