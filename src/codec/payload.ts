import { WatermarkingError } from '~/types';

export const SYNC_BITS = 16;
export const CRC_BITS = 8;
export const SYNC_PATTERN = 0xace1;

/**
 * Return the total bit count of a block.
 * A block holds the sync word, the payload, and the checksum, in that order.
 *
 * @param payloadBits - the number of payload bits.
 * @returns the total bit count of the block.
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
 * The checksum uses 8 bits, not 32, to leave more cells for the payload bits.
 *
 * @param bits - the bits to check.
 * @returns the 8 checksum bits, most significant bit first.
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
  const low8 = crc & 0xff;
  return bitsFromValue(BigInt(low8), CRC_BITS);
}

/**
 * Build a full block from a payload value.
 * The block holds, in order, the sync bits, the payload bits, and the checksum bits.
 * This function throws WatermarkingError when the payload does not fit in payloadBits.
 *
 * @param payload - the payload value to encode.
 * @param payloadBits - the number of bits to encode the payload in.
 * @returns the full block as a bit array.
 */
export function buildBlock(payload: bigint, payloadBits: number): Uint8Array {
  const maxValue = (1n << BigInt(payloadBits)) - 1n;
  if (payload < 0n || payload > maxValue) {
    throw new WatermarkingError(`Payload ${payload} does not fit in ${payloadBits} bits`);
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
 * The result's valid field is true only when the checksum matches and the
 * sync bits match exactly.
 *
 * @param bits - the full block to parse.
 * @param payloadBits - the number of payload bits in the block.
 * @returns the payload value and whether the block is valid.
 */
export function parseBlock(
  bits: Uint8Array,
  payloadBits: number,
): { valid: boolean; payload: bigint } {
  const receivedSync = bits.subarray(0, SYNC_BITS);
  const payloadBitArray = bits.subarray(SYNC_BITS, SYNC_BITS + payloadBits);
  const receivedChecksum = bits.subarray(SYNC_BITS + payloadBits, totalBits(payloadBits));

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
