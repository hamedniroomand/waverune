/**
 * The demo page runs the library in the browser, so this test checks two
 * things without a browser: that the single-file build succeeds and inlines
 * its script, and that the browser bundle of the library is interchangeable
 * with the native one. The second check matters because the browser bundle
 * replaces `node:crypto` with a polyfill; if that polyfill's HMAC differed,
 * a file embedded in the browser would not detect on Node or Bun.
 */
import { expect, test } from 'bun:test';

import { decodeWav, encodeWav } from '~/audio/wav';
import type { AudioBuffer, DetectionResult, DetectOptions, EmbedOptions } from '~/types';
import { PerceptualWatermarker } from '~/watermarkers/perceptual';

import { musicLike } from './helpers/signals';

const ROOT = new URL('../', import.meta.url).pathname;
const OUT = `${ROOT}tests/tmp/browser-bundle/`;

interface BrowserLibrary {
  PerceptualWatermarker: new () => {
    applyWatermark(audio: AudioBuffer, opts?: EmbedOptions): AudioBuffer;
    getWatermark(audio: AudioBuffer, opts?: DetectOptions): DetectionResult;
  };
  decodeWav(bytes: Uint8Array): AudioBuffer;
  encodeWav(audio: AudioBuffer): Uint8Array;
}

test('the single-file demo build succeeds and inlines its script and favicon', async () => {
  const proc = Bun.spawn(['bun', 'build.ts'], {
    cwd: `${ROOT}demo/`,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  expect(stderr).toBe('');
  expect(exitCode).toBe(0);
  const html = await Bun.file(`${ROOT}dist-demo/index.html`).text();
  expect(html).toContain('<script');
  expect(html).not.toMatch(/<script[^>]+src="[^"]*\.js"/);
  expect(html).toContain('waverune');
  expect(html).toContain('data:image/svg+xml');
}, 120000);

test('a file embedded by the browser bundle detects natively, and the reverse', async () => {
  const result = await Bun.build({
    entrypoints: [`${ROOT}tests/helpers/browser-entry.ts`],
    outdir: OUT,
    target: 'browser',
    naming: 'library.js',
  });
  expect(result.success).toBe(true);
  // The bundle is built two lines up from a two-export entry file; its shape is known.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const browser = (await import(`${OUT}library.js`)) as BrowserLibrary;

  const audio = musicLike(4);
  const native = new PerceptualWatermarker();
  const inBrowser = new browser.PerceptualWatermarker();

  const fromBrowser = browser.encodeWav(
    inBrowser.applyWatermark(audio, { key: 'k', payload: 77n }),
  );
  const nativeRead = native.getWatermark(decodeWav(fromBrowser), { key: 'k' });
  expect(nativeRead.detected).toBe(true);
  expect(nativeRead.payload).toBe(77n);

  const fromNative = encodeWav(native.applyWatermark(audio, { key: 'k', payload: 78n }));
  const browserRead = inBrowser.getWatermark(browser.decodeWav(fromNative), { key: 'k' });
  expect(browserRead.detected).toBe(true);
  expect(browserRead.payload).toBe(78n);
}, 120000);
