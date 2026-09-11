import { bitsEqual, bitsFromValue, valueFromBits } from '~/codec/bits';
import { crc32 } from '~/codec/crc32';
import { WatermarkingError } from '~/types';

export const SYNC_BITS = 16;
export const CRC_BITS = 8;
export const SYNC_PATTERN = 0xace1;

/** Return the bit count of a block: the sync word, the payload and the checksum. */
export function totalBits(payloadBits: number): number {
  return SYNC_BITS + payloadBits + CRC_BITS;
}

/** Return the 16 sync bits, most significant bit first. */
export function syncBits(): Uint8Array {
  return bitsFromValue(BigInt(SYNC_PATTERN), SYNC_BITS);
}

/**
 * Compute the 8-bit checksum of a bit array.
 *
 * The function packs the bits into bytes, most significant bit first, and pads
 * the last byte with zeros on the right. The checksum is the low 8 bits of the
 * CRC-32 of those bytes. Eight bits, not 32, leave more cells for the payload.
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
  const crc = crc32(bytes);
  return bitsFromValue(BigInt(crc & 0xff), CRC_BITS);
}

/**
 * Build a block from a payload value.
 *
 * The block holds the sync bits, the payload bits and the checksum bits, in
 * that order.
 *
 * @param payload - the payload value.
 * @param payloadBits - the width of the payload, in bits.
 * @throws WatermarkingError when the payload does not fit in `payloadBits`.
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

/** The result of parsing one block. */
export interface ParsedBlock {
  /** True only when `syncValid` and `checksumValid` are both true. */
  valid: boolean;
  /** The received sync bits equal the sync pattern. */
  syncValid: boolean;
  /** The received checksum equals the checksum of the received payload bits. */
  checksumValid: boolean;
  /** The received payload bits as a value, valid or not. */
  payload: bigint;
}

/**
 * Parse a block back into a payload value.
 *
 * The checksum is an integrity check against decoding errors. It is not
 * authentication. Anyone who knows the key can build a block that passes.
 *
 * @param bits - the full block.
 * @param payloadBits - the width of the payload, in bits.
 */
export function parseBlock(bits: Uint8Array, payloadBits: number): ParsedBlock {
  const receivedSync = bits.subarray(0, SYNC_BITS);
  const payloadBitArray = bits.subarray(SYNC_BITS, SYNC_BITS + payloadBits);
  const receivedChecksum = bits.subarray(SYNC_BITS + payloadBits, totalBits(payloadBits));

  const syncValid = bitsEqual(receivedSync, syncBits());
  const checksumValid = bitsEqual(receivedChecksum, checksumBits(payloadBitArray));

  return {
    valid: syncValid && checksumValid,
    syncValid,
    checksumValid,
    payload: valueFromBits(payloadBitArray),
  };
}
