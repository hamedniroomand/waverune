/** The `fmt ` chunk tag for integer PCM samples. */
export const FMT_PCM = 1;

/** The `fmt ` chunk tag for IEEE float samples. */
export const FMT_FLOAT = 3;

export function readAscii(view: DataView, offset: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

export function writeAscii(bytes: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
}
