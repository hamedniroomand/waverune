import { expect, test } from 'bun:test';

import { crc32 } from '~/codec/crc32';

// The check value from the CRC catalogue: CRC-32/ISO-HDLC over "123456789".
test('crc32 matches the published check value', () => {
  expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  expect(crc32(new Uint8Array(0))).toBe(0);
});

// Earlier versions used Bun's native CRC. Every watermark written by them
// carries a checksum from it, so the plain implementation must agree bit for bit.
test('crc32 agrees with Bun.hash.crc32 on random inputs', () => {
  for (let trial = 0; trial < 200; trial++) {
    const bytes = new Uint8Array(trial % 17);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (trial * 31 + i * 131) & 0xff;
    expect(crc32(bytes)).toBe(Bun.hash.crc32(bytes));
  }
});
