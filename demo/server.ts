/**
 * The demo server.
 *
 * One page and two API routes. The page is bundled by Bun from `index.html`
 * (React, TSX and Tailwind). The routes call the library directly, so the
 * browser never runs the codec.
 *
 *   bun run demo          # from the repo root: http://localhost:3000, hot reload.
 *                         # This runs `bun --hot server.ts` inside demo/, where
 *                         # bunfig.toml configures the Tailwind plugin.
 */
import {
  type AudioBuffer,
  PerceptualWatermarker,
  decodeWav,
  detectionToJson,
  encodeWav,
} from '../src/index';
import page from './index.html';

/** Files longer than this are refused so that one embed stays under a few seconds. */
const MAX_SECONDS = 30;

const watermarker = new PerceptualWatermarker();

function error(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

/** Read the WAV, key and id fields from a multipart form. */
async function readForm(req: Request): Promise<{ audio: AudioBuffer; key: string; id?: string }> {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof Blob)) throw new Error('Choose a WAV file.');
  const audio = decodeWav(new Uint8Array(await file.arrayBuffer()));
  const seconds = audio.channels[0].length / audio.sampleRate;
  if (seconds > MAX_SECONDS) {
    throw new Error(
      `The file is ${seconds.toFixed(1)} s long. The demo accepts up to ${MAX_SECONDS} s.`,
    );
  }
  const rawKey = form.get('key');
  const key = typeof rawKey === 'string' ? rawKey.trim() : '';
  if (!key) throw new Error('Enter a key.');
  const rawId = form.get('id');
  const id = typeof rawId === 'string' && rawId.trim() !== '' ? rawId.trim() : undefined;
  return { audio, key, id };
}

function parseId(raw: string | undefined): bigint {
  if (raw === undefined) return BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
  try {
    const id = BigInt(raw);
    if (id < 0n || id > 0xffff_ffffn) throw new Error();
    return id;
  } catch {
    throw new Error(`"${raw}" is not a 32-bit id. Use a decimal or 0x-prefixed hex value.`);
  }
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  development: process.env.NODE_ENV !== 'production',
  routes: {
    '/': page,

    '/api/embed': {
      async POST(req) {
        try {
          const { audio, key, id: rawId } = await readForm(req);
          const id = parseId(rawId);
          const marked = watermarker.applyWatermark(audio, { key, payload: id });
          const bytes = encodeWav(marked);
          // Verify what will be downloaded, the same way the CLI does.
          const detection = watermarker.getWatermark(decodeWav(bytes), { key });
          const verified = detection.detected && detection.payload === id;
          return Response.json({
            id: id.toString(),
            verified,
            detection: detectionToJson(detection),
            // The marked file travels as base64 so one JSON reply carries both the result and the audio.
            wavBase64: Buffer.from(bytes).toString('base64'),
          });
        } catch (e) {
          return error(e instanceof Error ? e.message : String(e));
        }
      },
    },

    '/api/detect': {
      async POST(req) {
        try {
          const { audio, key } = await readForm(req);
          return Response.json(detectionToJson(watermarker.getWatermark(audio, { key })));
        } catch (e) {
          return error(e instanceof Error ? e.message : String(e));
        }
      },
    },
  },
  fetch() {
    return new Response('Not found', { status: 404 });
  },
});

console.log(`waverune demo: ${server.url}`);
