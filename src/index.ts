export * from '~/types';
export * from '~/api';
export * from '~/audio/wav';
export * from '~/platform/fs';
export * from '~/watermarkers/dummy';
export * from '~/watermarkers/perceptual';
export * from '~/metrics';
export * from '~/json';

// Protocol primitives. These are deterministic by contract: the same input
// gives the same bits under every supported runtime.
export { crc32 } from '~/codec/crc32';
export {
  CRC_BITS,
  SYNC_BITS,
  SYNC_PATTERN,
  buildBlock,
  checksumBits,
  parseBlock,
  totalBits,
  type ParsedBlock,
} from '~/codec/payload';
export { deriveSeed } from '~/codec/prng';
