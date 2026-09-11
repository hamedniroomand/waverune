/**
 * CRC-32 (IEEE 802.3), the checksum that `zlib`, PNG and gzip use.
 *
 * The implementation is plain JavaScript on purpose. The checksum is part of
 * the watermark protocol, so it has to give the same bits under every
 * runtime, and it must not pull a platform API into the codec layer.
 */

const TABLE = buildTable();

function buildTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

/**
 * Compute the CRC-32 of a byte array.
 *
 * @param bytes - the bytes to check.
 * @returns the checksum as an unsigned 32-bit integer.
 */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
