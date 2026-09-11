/**
 * The pure-TypeScript SHA-256 and HMAC must match `node:crypto` exactly,
 * otherwise seeds, cell assignments and therefore watermarks would differ
 * between the browser bundle and Node or Bun.
 */
import { expect, test } from 'bun:test';
import { createHash, createHmac } from 'node:crypto';

import { hmacSha256, sha256 } from '~/platform/crypto';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

test('sha256 matches node:crypto on known vectors and block boundaries', () => {
  const encoder = new TextEncoder();
  expect(hex(sha256(new Uint8Array(0)))).toBe(
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  expect(hex(sha256(encoder.encode('abc')))).toBe(
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  for (const length of [55, 56, 63, 64, 65, 119, 120, 128, 1000]) {
    const data = new Uint8Array(length);
    for (let i = 0; i < length; i++) data[i] = (i * 31 + 7) & 0xff;
    expect(hex(sha256(data))).toBe(createHash('sha256').update(data).digest('hex'));
  }
});

test('hmacSha256 matches node:crypto for short, long and non-ASCII keys', () => {
  const cases: [string, string][] = [
    ['wavemark', 'cells'],
    ['robustness', 'chips'],
    ['', ''],
    ['k'.repeat(64), 'exactly one block of key'],
    ['k'.repeat(65), 'a key longer than one block is hashed first'],
    ['clé-ключ-鍵-🔑', 'unicode key and message: ñ 音'],
  ];
  for (const [key, message] of cases) {
    expect(hex(hmacSha256(key, message))).toBe(
      createHmac('sha256', key).update(message).digest('hex'),
    );
  }
});
