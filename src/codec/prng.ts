import { hmacSha256 } from '~/platform/hmac';

/**
 * Derive a 128-bit seed from a key and a domain string.
 *
 * The domain separates independent random streams for the same key. The seed
 * is the first 16 bytes of HMAC-SHA256(key, domain), read as little-endian words.
 *
 * @param key - the watermark key.
 * @param domain - a short label, for example "cells" or "chips".
 * @returns four u32 words.
 */
export function deriveSeed(key: string, domain: string): Uint32Array {
  const digest = hmacSha256(key, domain);
  const seed = new Uint32Array(4);
  for (let i = 0; i < 4; i++) {
    const o = i * 4;
    seed[i] =
      (digest[o] | (digest[o + 1] << 8) | (digest[o + 2] << 16) | (digest[o + 3] << 24)) >>> 0;
  }
  // An all-zero state never advances under xoshiro128**. Set one bit.
  if (seed.every((word) => word === 0)) {
    seed[0] = 1;
  }
  return seed;
}

function rotl(x: number, bits: number): number {
  return ((x << bits) | (x >>> (32 - bits))) >>> 0;
}

/**
 * Build a xoshiro128** generator from a seed.
 *
 * @param seed - four u32 words. Use `deriveSeed` to create one.
 * @returns a function that returns the next pseudo-random u32 value.
 */
export function makeRng(seed: Uint32Array): () => number {
  let s0 = seed[0] >>> 0;
  let s1 = seed[1] >>> 0;
  let s2 = seed[2] >>> 0;
  let s3 = seed[3] >>> 0;

  return function next(): number {
    const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;

    const t = (s1 << 9) >>> 0;

    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;

    s2 = (s2 ^ t) >>> 0;
    s3 = rotl(s3, 11);

    return result;
  };
}
