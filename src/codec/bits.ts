/** Unpack `bitCount` bits of a value, most significant bit first. */
export function bitsFromValue(value: bigint, bitCount: number): Uint8Array {
  const bits = new Uint8Array(bitCount);
  for (let i = 0; i < bitCount; i++) {
    const shift = BigInt(bitCount - 1 - i);
    bits[i] = Number((value >> shift) & 1n);
  }
  return bits;
}

/** Pack bits into a value, most significant bit first. */
export function valueFromBits(bits: Uint8Array): bigint {
  let value = 0n;
  for (let i = 0; i < bits.length; i++) {
    value = (value << 1n) | BigInt(bits[i] & 1);
  }
  return value;
}

export function bitsEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
