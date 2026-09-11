import { WatermarkingError } from "../types";

export const SYNC_BITS = 16;
export const CRC_BITS = 8;
export const SYNC_PATTERN = 0xace1;

/**
 * Return the total bit count of a block.
 * A block holds the sync word, the payload, and the checksum, in that order.
 */
export function totalBits(payloadBits: number): number {
  return SYNC_BITS + payloadBits + CRC_BITS;
}

/** Return the 16 sync bits, most significant bit first. */
export function syncBits(): Uint8Array {
  return bitsFromValue(BigInt(SYNC_PATTERN), SYNC_BITS);
}

/**
 * Compute the 8-bit checksum for the given bits.
 * Pack the bits MSB-first into bytes. Zero-pad the final partial byte on the right.
 * Keep only the low 8 bits of the CRC-32 result.
 *
 * The checksum keeps 8 bits rather than the full 32 on purpose. The block
 * budget is fixed, so every extra checksum bit takes cells away from the
 * payload bits and raises the bit-error rate. Eight checksum bits plus the
 * 16 sync bits already give a false-accept rate near 2^-24.
 */
export function checksumBits(bits: Uint8Array): Uint8Array {
  const byteCount = Math.ceil(bits.length / 8);
  const bytes = new Uint8Array(byteCount);
  for (let i = 0; i < bits.length; i++) {
    const byteIndex = Math.floor(i / 8);
    const bitIndex = 7 - (i % 8);
    bytes[byteIndex] |= (bits[i] & 1) << bitIndex;
  }
  const crc = Bun.hash.crc32(bytes);
  const low8 = Number(crc) & 0xff;
  return bitsFromValue(BigInt(low8), CRC_BITS);
}

/**
 * Build a full block from a payload value.
 * The block holds, in order, the sync bits, the payload bits, and the checksum bits.
 * Throw WatermarkingError when the payload does not fit in payloadBits.
 */
export function buildBlock(payload: bigint, payloadBits: number): Uint8Array {
  const maxValue = (1n << BigInt(payloadBits)) - 1n;
  if (payload < 0n || payload > maxValue) {
    throw new WatermarkingError(
      `Payload ${payload} does not fit in ${payloadBits} bits`,
    );
  }
  const payloadBitArray = bitsFromValue(payload, payloadBits);
  const checksum = checksumBits(payloadBitArray);

  const block = new Uint8Array(totalBits(payloadBits));
  block.set(syncBits(), 0);
  block.set(payloadBitArray, SYNC_BITS);
  block.set(checksum, SYNC_BITS + payloadBits);
  return block;
}

/**
 * Parse a full block back into a payload value.
 * Set valid to true only when the checksum matches and the sync bits match exactly.
 */
export function parseBlock(
  bits: Uint8Array,
  payloadBits: number,
): { valid: boolean; payload: bigint } {
  const receivedSync = bits.subarray(0, SYNC_BITS);
  const payloadBitArray = bits.subarray(SYNC_BITS, SYNC_BITS + payloadBits);
  const receivedChecksum = bits.subarray(
    SYNC_BITS + payloadBits,
    totalBits(payloadBits),
  );

  const syncMatches = arraysEqual(receivedSync, syncBits());
  const expectedChecksum = checksumBits(payloadBitArray);
  const checksumMatches = arraysEqual(receivedChecksum, expectedChecksum);

  const payload = valueFromBits(payloadBitArray);
  return { valid: syncMatches && checksumMatches, payload };
}

function bitsFromValue(value: bigint, bitCount: number): Uint8Array {
  const bits = new Uint8Array(bitCount);
  for (let i = 0; i < bitCount; i++) {
    const shift = BigInt(bitCount - 1 - i);
    bits[i] = Number((value >> shift) & 1n);
  }
  return bits;
}

function valueFromBits(bits: Uint8Array): bigint {
  let value = 0n;
  for (let i = 0; i < bits.length; i++) {
    value = (value << 1n) | BigInt(bits[i] & 1);
  }
  return value;
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
