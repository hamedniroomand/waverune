/**
 * The keyed hash behind seed derivation.
 *
 * This is the only place the codec touches a platform crypto API. Node,
 * Bun and Deno all ship `node:crypto`, so the package needs no dependency
 * and no runtime check. The output is HMAC-SHA256, which is what the
 * original Bun implementation computed, so seeds and therefore watermarks
 * stay compatible.
 */
import { createHmac } from 'node:crypto';

/**
 * Compute HMAC-SHA256 over a message with a string key.
 *
 * @param key - the HMAC key, as UTF-8 text.
 * @param message - the message, as UTF-8 text.
 * @returns the 32-byte digest.
 */
export function hmacSha256(key: string, message: string): Uint8Array {
  const digest = createHmac('sha256', key).update(message).digest();
  return new Uint8Array(digest.buffer, digest.byteOffset, digest.byteLength);
}
