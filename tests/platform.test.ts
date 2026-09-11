import { expect, test } from 'bun:test';

import { deriveSeed } from '~/codec/prng';
import { hmacSha256 } from '~/platform/hmac';

const RECORDED_SEED_WAVERUNE_CELLS = ['b016049a', 'efdf0e3e', 'a8d077ee', '41801fc3'];

// Earlier versions derived seeds with `new Bun.CryptoHasher('sha256', key)`.
// That is HMAC-SHA256 with `key`, not a plain hash over the concatenation.
// The chip sequences of existing watermarks depend on this exact function.
test('hmacSha256 reproduces the Bun.CryptoHasher keyed digest', () => {
  for (const [key, message] of [
    ['waverune', 'cells'],
    ['waverune', 'chips'],
    ['secret', 'cells'],
    ['', 'chips'],
    ['k1', ''],
  ] as const) {
    const expected = new Bun.CryptoHasher('sha256', key).update(message).digest();
    expect(Array.from(hmacSha256(key, message))).toEqual(Array.from(expected));
  }
});

// A fixed vector, so a change in the derivation shows without Bun present.
// The Node compatibility suite checks the same words from the built package.
test('deriveSeed gives the recorded words for the default key', () => {
  const seed = deriveSeed('waverune', 'cells');
  const words = Array.from(seed).map((w) => w.toString(16).padStart(8, '0'));
  expect(words).toEqual(RECORDED_SEED_WAVERUNE_CELLS);
});
