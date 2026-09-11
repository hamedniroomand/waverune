import type { AudioBuffer } from "../../src/types";

const DEFAULT_SAMPLE_RATE = 44100;

/**
 * Build a speech-like test signal.
 *
 * The signal holds three harmonics below 1400 Hz. A slow envelope changes the
 * level. The signal is tonal, so most of the watermark band holds no content.
 *
 * @param seconds - the length of the signal, in seconds.
 * @param sr - the sample rate, in hertz.
 * @returns a one-channel audio buffer.
 */
export function speechLike(seconds: number, sr = DEFAULT_SAMPLE_RATE): AudioBuffer {
  const n = Math.floor(seconds * sr);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2.3 * t);
    x[i] =
      env *
      0.3 *
      (Math.sin(2 * Math.PI * 180 * t) +
        0.5 * Math.sin(2 * Math.PI * 540 * t) +
        0.25 * Math.sin(2 * Math.PI * 1300 * t));
  }
  return { sampleRate: sr, channels: [x] };
}

/**
 * Build a music-like test signal.
 *
 * The signal holds four harmonics and a band of filtered noise. The noise
 * gives content in every slot of the watermark band, so this signal shows the
 * behaviour of the watermarker on broadband audio.
 *
 * A fixed seed drives the noise, so the signal is the same on every run.
 *
 * @param seconds - the length of the signal, in seconds.
 * @param sr - the sample rate, in hertz.
 * @returns a one-channel audio buffer.
 */
export function musicLike(seconds: number, sr = DEFAULT_SAMPLE_RATE): AudioBuffer {
  const n = Math.floor(seconds * sr);
  const x = new Float32Array(n);
  let state = 4242;
  let lowpass = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const noise = state / 4294967296 - 0.5;
    lowpass = 0.75 * lowpass + 0.25 * noise;
    const env = 0.6 + 0.4 * Math.sin(2 * Math.PI * 1.7 * t);
    x[i] =
      env *
      (0.18 *
        (Math.sin(2 * Math.PI * 220 * t) +
          0.6 * Math.sin(2 * Math.PI * 660 * t) +
          0.4 * Math.sin(2 * Math.PI * 1540 * t) +
          0.3 * Math.sin(2 * Math.PI * 3300 * t)) +
        0.35 * lowpass);
  }
  return { sampleRate: sr, channels: [x] };
}
