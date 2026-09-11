import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import type { DetectionResult } from '../src/types';
import logo from './favicon.svg';
import { MAX_SECONDS, detect, embed, type EmbedOutcome } from './watermark';

const field =
  'w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none';
const button =
  'rounded-md px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40';

/** Let the browser paint the "working" state before the main thread is busy. */
const paint = () => new Promise<void>((resolve) => setTimeout(resolve, 30));

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState('secret');
  const [id, setId] = useState('');
  const [busy, setBusy] = useState<'embed' | 'detect' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [embedded, setEmbedded] = useState<(EmbedOutcome & { url: string }) | null>(null);
  const [detected, setDetected] = useState<DetectionResult | null>(null);
  const originalUrl = file ? URL.createObjectURL(file) : null;

  async function run(kind: 'embed' | 'detect') {
    if (!file) return;
    setBusy(kind);
    setError(null);
    await paint();
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (kind === 'embed') {
        const outcome = embed(bytes, key, id);
        // A Blob wants a plain ArrayBuffer-backed view; copy the encoded bytes into one.
        const copy = new Uint8Array(new ArrayBuffer(outcome.wav.byteLength));
        copy.set(outcome.wav);
        const url = URL.createObjectURL(new Blob([copy], { type: 'audio/wav' }));
        setEmbedded({ ...outcome, url });
        setDetected(null);
      } else {
        setDetected(detect(bytes, key));
        setEmbedded(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-12">
      <header className="flex items-center gap-4">
        <img
          src={logo}
          alt=""
          width={48}
          height={48}
          className="rounded-xl"
        />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">waverune</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Hide a 32-bit id in a WAV file. Find it again with the key alone. Everything runs in
            this page; nothing is uploaded.
          </p>
        </div>
      </header>

      <section className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-400">WAV file (up to {MAX_SECONDS} s on this page)</span>
          <input
            type="file"
            accept=".wav,audio/wav,audio/x-wav"
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-zinc-100"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setEmbedded(null);
              setDetected(null);
              setError(null);
            }}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-400">Key</span>
            <input
              className={field}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-400">Id (optional, embed only)</span>
            <input
              className={field}
              placeholder="random"
              value={id}
              onChange={(e) => setId(e.target.value)}
            />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            className={`${button} bg-emerald-500 text-zinc-950 hover:bg-emerald-400`}
            disabled={!file || busy !== null}
            onClick={() => void run('embed')}
          >
            {busy === 'embed' ? 'Embedding…' : 'Embed'}
          </button>
          <button
            className={`${button} bg-zinc-800 text-zinc-100 hover:bg-zinc-700`}
            disabled={!file || busy !== null}
            onClick={() => void run('detect')}
          >
            {busy === 'detect' ? 'Detecting…' : 'Detect'}
          </button>
          {busy && (
            <span className="text-xs text-zinc-500">
              Working on the main thread; the page pauses for a few seconds.
            </span>
          )}
        </div>
        {error && <p className="text-sm text-rose-400">{error}</p>}
      </section>

      {originalUrl && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm text-zinc-400">Original</h2>
          <audio
            controls
            src={originalUrl}
            className="w-full"
          />
        </section>
      )}

      {embedded && (
        <section className="flex flex-col gap-3 rounded-lg border border-emerald-900/60 bg-emerald-950/30 p-4">
          <h2 className="text-sm text-emerald-300">Watermarked</h2>
          <audio
            controls
            src={embedded.url}
            className="w-full"
          />
          <Result
            detection={embedded.detection}
            requestedId={embedded.id}
            verified={embedded.verified}
          />
          <a
            className="self-start rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400"
            href={embedded.url}
            download={`marked-${embedded.id}.wav`}
          >
            Download marked WAV
          </a>
        </section>
      )}

      {detected && (
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="mb-3 text-sm text-zinc-400">Detection</h2>
          <Result detection={detected} />
        </section>
      )}

      <footer className="text-xs text-zinc-500">
        Measured on synthetic fixtures and nine downloaded recordings; see the README for what holds
        and what does not. A rejection returns no id. The checksum is an integrity check, not
        authentication. The {MAX_SECONDS} s cap is this page's, not the library's.
      </footer>
    </main>
  );
}

function Result({
  detection,
  requestedId,
  verified,
}: {
  detection: DetectionResult;
  requestedId?: bigint;
  verified?: boolean;
}) {
  const d = detection.diagnostics;
  const rows: [string, string][] = [
    ['Detected', detection.detected ? 'yes' : 'no'],
    ['Id', detection.payload === null ? 'none' : detection.payload.toString()],
  ];
  if (requestedId !== undefined) rows.push(['Requested id', requestedId.toString()]);
  if (verified !== undefined) {
    rows.push(['Verified', verified ? 'yes, the saved file decodes to the requested id' : 'no']);
  }
  rows.push(
    ['Correlation score', detection.correlationScore.toFixed(3)],
    ['Sync errors', `${Math.round(detection.syncErrorRate * 16)} of 16`],
    ['Checksum', d.checksumValid ? 'valid' : 'invalid'],
    ['Active frames', `${d.activeFrames} of ${d.totalFrames}`],
  );
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map(([k, v]) => (
        <div
          key={k}
          className="contents"
        >
          <dt className="text-zinc-400">{k}</dt>
          <dd className="font-mono text-zinc-100">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
