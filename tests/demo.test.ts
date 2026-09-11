/**
 * A smoke test for the demo server's two API routes.
 *
 * The test starts `demo/server.ts` on a free port, embeds an id into a short
 * synthetic WAV through `/api/embed`, decodes the returned file, and reads
 * the id back through `/api/detect`. It does not test the React page.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';

import { encodeWav } from '~/audio/wav';

import { musicLike } from './helpers/signals';

const ROOT = new URL('../', import.meta.url).pathname;
const PORT = 3900 + Math.floor(Math.random() * 100);
let server: ReturnType<typeof Bun.spawn>;

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/nope`);
      if (res.status === 404) return;
    } catch {
      // not up yet
    }
    await Bun.sleep(100);
  }
  throw new Error('the demo server did not start');
}

beforeAll(async () => {
  server = Bun.spawn(['bun', 'server.ts'], {
    cwd: `${ROOT}demo/`,
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production' },
    stdout: 'ignore',
    stderr: 'pipe',
  });
  await waitForServer();
});

afterAll(() => {
  server.kill();
});

/** Read a JSON reply as a plain record, without trusting its shape. */
async function record(res: Response): Promise<Record<string, unknown>> {
  const body: unknown = await res.json();
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('the reply is not a JSON object');
  }
  return { ...body };
}

function form(wav: Uint8Array, fields: Record<string, string>): FormData {
  const f = new FormData();
  f.set('file', new Blob([wav], { type: 'audio/wav' }), 'in.wav');
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

test('embed returns a verified marked file and detect reads the id back', async () => {
  const wav = encodeWav(musicLike(4));
  const embed = await fetch(`http://localhost:${PORT}/api/embed`, {
    method: 'POST',
    body: form(wav, { key: 'demo', id: '0x2a' }),
  });
  expect(embed.status).toBe(200);
  const reply = await record(embed);
  expect(reply.id).toBe('42');
  expect(reply.verified).toBe(true);
  expect(typeof reply.wavBase64).toBe('string');

  const marked = Uint8Array.from(Buffer.from(String(reply.wavBase64), 'base64'));
  const detect = await fetch(`http://localhost:${PORT}/api/detect`, {
    method: 'POST',
    body: form(marked, { key: 'demo' }),
  });
  expect(detect.status).toBe(200);
  const result = await record(detect);
  expect(result.detected).toBe(true);
  expect(result.id).toBe('42');

  const wrong = await fetch(`http://localhost:${PORT}/api/detect`, {
    method: 'POST',
    body: form(marked, { key: 'other' }),
  });
  const rejected = await record(wrong);
  expect(rejected.detected).toBe(false);
  expect(rejected.id).toBeNull();
}, 60000);

test('bad input gets a 400 with a message', async () => {
  const res = await fetch(`http://localhost:${PORT}/api/detect`, {
    method: 'POST',
    body: form(new Uint8Array([1, 2, 3]), { key: 'demo' }),
  });
  expect(res.status).toBe(400);
  const body = await record(res);
  expect(typeof body.error).toBe('string');
  expect(String(body.error).length).toBeGreaterThan(0);
});
