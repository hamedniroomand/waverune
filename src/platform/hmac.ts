import { SHA256_BLOCK, sha256 } from '~/platform/sha256';

/**
 * Compute HMAC-SHA256 (RFC 2104) over a UTF-8 message with a UTF-8 key.
 *
 * Seeds, and so watermarks, depend on this exact function. A change here
 * makes existing watermarks undetectable.
 *
 * @returns the 32-byte digest.
 */
export function hmacSha256(key: string, message: string): Uint8Array {
  const encoder = new TextEncoder();
  const rawKey = encoder.encode(key);
  const keyBytes: Uint8Array = rawKey.length > SHA256_BLOCK ? sha256(rawKey) : rawKey;
  const padded = new Uint8Array(SHA256_BLOCK);
  padded.set(keyBytes);

  const inner = new Uint8Array(SHA256_BLOCK);
  const outer = new Uint8Array(SHA256_BLOCK);
  for (let i = 0; i < SHA256_BLOCK; i++) {
    inner[i] = padded[i] ^ 0x36;
    outer[i] = padded[i] ^ 0x5c;
  }

  const messageBytes = encoder.encode(message);
  const innerInput = new Uint8Array(SHA256_BLOCK + messageBytes.length);
  innerInput.set(inner);
  innerInput.set(messageBytes, SHA256_BLOCK);
  const innerHash = sha256(innerInput);

  const outerInput = new Uint8Array(SHA256_BLOCK + 32);
  outerInput.set(outer);
  outerInput.set(innerHash, SHA256_BLOCK);
  return sha256(outerInput);
}
