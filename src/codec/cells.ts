import { deriveSeed, makeRng } from '~/codec/prng';

/** The keyed assignment of time-frequency cells to watermark bits. */
export interface CellAssignment {
  /** The bit index of each cell. The length is `blockFrames * slots`. */
  bitIndex: Int32Array;
  /** The chip sign of each cell, -1 or +1. Same indexing as `bitIndex`. */
  chip: Int8Array;
}

/**
 * Assign each time-frequency cell in a block to a watermark bit and a chip sign.
 *
 * The cell at position `frame * slots + slot` gets one bit index and one chip
 * sign. The function shuffles the cells with Fisher-Yates, then deals them to
 * the bits in round-robin order. Every bit then gets the same number of cells,
 * plus or minus one. A hash-modulo assignment does not give this balance. Some
 * bits then get fewer cells, and those bits decode with more errors.
 *
 * @param key - the watermark key. It seeds the shuffle and the chip signs.
 * @param blockFrames - the number of frames in one block.
 * @param slots - the number of frequency slots per frame.
 * @param totalBits - the number of watermark bits.
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

  const shuffleRng = makeRng(deriveSeed(key, 'cells'));
  for (let i = cellCount - 1; i > 0; i--) {
    const j = shuffleRng() % (i + 1);
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }

  const bitIndex = new Int32Array(cellCount);
  for (let i = 0; i < cellCount; i++) {
    bitIndex[order[i]] = i % totalBits;
  }

  const chipRng = makeRng(deriveSeed(key, 'chips'));
  const chip = new Int8Array(cellCount);
  for (let i = 0; i < cellCount; i++) {
    chip[i] = (chipRng() & 1) === 1 ? 1 : -1;
  }

  return { bitIndex, chip };
}
