/**
 * A fixed-seed linear congruential generator.
 *
 * Tests and benchmarks use it to derive deterministic keys, payloads and
 * offsets. The same seed always yields the same sequence, so every declared
 * case is reproducible from its seed alone.
 */
export function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

/** Derive `count` deterministic key and payload pairs from one seed. */
export function keyPayloadPairs(seed: number, count: number): { key: string; payload: bigint }[] {
  const next = lcg(seed);
  const pairs: { key: string; payload: bigint }[] = [];
  for (let i = 0; i < count; i++) {
    const key = `key-${next() % 100000}`;
    const payload = BigInt(next());
    pairs.push({ key, payload });
  }
  return pairs;
}
