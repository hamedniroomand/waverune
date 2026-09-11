// Keyed PRNG and cell-to-bit assignment for the watermark codec.

/**
 * Derive a 128-bit seed from a key and a domain string.
 * The domain separates independent random streams for the same key.
 *
 * @param key - the watermark key.
 * @param domain - a short label, for example "cells" or "chips".
 * @returns four u32 words in a Uint32Array.
 */
export function deriveSeed(key: string, domain: string): Uint32Array {
  const hasher = new Bun.CryptoHasher("sha256", key);
  hasher.update(domain);
  const digest = hasher.digest();
  const seed = new Uint32Array(4);
  for (let i = 0; i < 4; i++) {
    const o = i * 4;
    seed[i] =
      (digest[o]! | (digest[o + 1]! << 8) | (digest[o + 2]! << 16) | (digest[o + 3]! << 24)) >>> 0;
  }
  // An all-zero state never advances under xoshiro128**. Force one bit on.
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
 * Each call to the returned function returns the next u32 in the stream.
 *
 * @param seed - four u32 words. Use `deriveSeed` to create one.
 * @returns a function that returns the next pseudo-random u32 value.
 */
export function makeRng(seed: Uint32Array): () => number {
  let s0 = seed[0]! >>> 0;
  let s1 = seed[1]! >>> 0;
  let s2 = seed[2]! >>> 0;
  let s3 = seed[3]! >>> 0;

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

/** The result of a keyed cell-to-bit assignment. */
export interface CellAssignment {
  /** The bit index for each cell. Length is blockFrames*slots. */
  bitIndex: Int32Array;
  /** The chip sign for each cell, either -1 or +1. Same indexing as bitIndex. */
  chip: Int8Array;
}

/**
 * Assign each time-frequency cell in a block to a watermark bit and a chip sign.
 * The cell at position `frame*slots + slot` gets a bit index and a chip sign.
 *
 * @param key - the watermark key. It seeds both the shuffle and the chip signs.
 * @param blockFrames - the number of frames in one block.
 * @param slots - the number of frequency slots per frame.
 * @param totalBits - the number of watermark bits to spread cells across.
 * @returns a CellAssignment with balanced bit coverage.
 */
export function assignCells(
  key: string,
  blockFrames: number,
  slots: number,
  totalBits: number,
): CellAssignment {
  const cellCount = blockFrames * slots;
  const order = new Int32Array(cellCount);
  for (let i = 0; i < cellCount; i++) {
    order[i] = i;
  }

  // Shuffle cells with Fisher-Yates, then deal them to bits round-robin in
  // shuffled order. This spreads cells evenly across bits.
  // A hash-modulo assignment does not spread cells evenly. Some bits then
  // get fewer cells, and those bits get a higher decode error rate.
  const shuffleRng = makeRng(deriveSeed(key, "cells"));
  for (let i = cellCount - 1; i > 0; i--) {
    const j = shuffleRng() % (i + 1);
    const tmp = order[i]!;
    order[i] = order[j]!;
    order[j] = tmp!;
  }

  const bitIndex = new Int32Array(cellCount);
  for (let i = 0; i < cellCount; i++) {
    bitIndex[order[i]!] = i % totalBits;
  }

  const chipRng = makeRng(deriveSeed(key, "chips"));
  const chip = new Int8Array(cellCount);
  for (let i = 0; i < cellCount; i++) {
    chip[i] = (chipRng() & 1) === 1 ? 1 : -1;
  }

  return { bitIndex, chip };
}
