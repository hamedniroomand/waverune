import { useState } from 'react';
import { createRoot } from 'react-dom/client';

interface Detection {
  detected: boolean;
  id: string | null;
  correlationScore: number;
  syncErrorRate: number;
  diagnostics: {
    syncValid: boolean;
    checksumValid: boolean;
    activeFrames: number;
    totalFrames: number;
  };
}

interface EmbedReply {
  id: string;
  verified: boolean;
  detection: Detection;
  wavBase64: string;
}

function base64ToUrl(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}

async function post<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(path, { method: 'POST', body: form });
  const body: unknown = await res.json();
  if (!res.ok) {
    const message =
      body !== null && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `Request failed (${res.status})`;
    throw new Error(message);
  }
  // The server is ours and built this reply one line away; no runtime schema needed for a demo.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return body as T;
}

const field =
  'w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none';
const button =
  'rounded-md px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40';

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState('secret');
  const [id, setId] = useState('');
  const [busy, setBusy] = useState<'embed' | 'detect' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [embed, setEmbed] = useState<(EmbedReply & { url: string }) | null>(null);
  const [detect, setDetect] = useState<Detection | null>(null);
  const originalUrl = file ? URL.createObjectURL(file) : null;

  function form(): FormData {
    if (!file) throw new Error('Choose a WAV file first.');
    const f = new FormData();
    f.set('file', file);
    f.set('key', key);
    f.set('id', id);
    return f;
  }

  async function run(kind: 'embed' | 'detect') {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'embed') {
        const reply = await post<EmbedReply>('/api/embed', form());
        setEmbed({ ...reply, url: base64ToUrl(reply.wavBase64) });
        setDetect(null);
      } else {
        setDetect(await post<Detection>('/api/detect', form()));
        setEmbed(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-12">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">waverune</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Hide a 32-bit id in a WAV file. Find it again with the key alone. WAV only, up to 30 s.
        </p>
      </header>

      <section className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-400">WAV file</span>
          <input
            type="file"
            accept=".wav,audio/wav,audio/x-wav"
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-zinc-100"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setEmbed(null);
              setDetect(null);
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
        <div className="flex gap-3">
          <button
            className={`${button} bg-emerald-500 text-zinc-950 hover:bg-emerald-400`}
            disabled={!file || busy !== null}
            onClick={() => run('embed')}
          >
            {busy === 'embed' ? 'Embedding…' : 'Embed'}
          </button>
          <button
            className={`${button} bg-zinc-800 text-zinc-100 hover:bg-zinc-700`}
            disabled={!file || busy !== null}
            onClick={() => run('detect')}
          >
            {busy === 'detect' ? 'Detecting…' : 'Detect'}
          </button>
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

      {embed && (
        <section className="flex flex-col gap-3 rounded-lg border border-emerald-900/60 bg-emerald-950/30 p-4">
          <h2 className="text-sm text-emerald-300">Watermarked</h2>
          <audio
            controls
            src={embed.url}
            className="w-full"
          />
          <Result
            detection={embed.detection}
            requestedId={embed.id}
            verified={embed.verified}
          />
          <a
            className="self-start rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400"
            href={embed.url}
            download={`marked-${embed.id}.wav`}
          >
            Download marked WAV
          </a>
        </section>
      )}

      {detect && (
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="mb-3 text-sm text-zinc-400">Detection</h2>
          <Result detection={detect} />
        </section>
      )}

      <footer className="text-xs text-zinc-500">
        The id survives volume changes, cropping, resampling and WAV round trips on the test
        signals. A rejection returns no id. The checksum is an integrity check, not authentication.
      </footer>
    </main>
  );
}

function Result({
  detection,
  requestedId,
  verified,
}: {
  detection: Detection;
  requestedId?: string;
  verified?: boolean;
}) {
  const rows: [string, string][] = [
    ['Detected', detection.detected ? 'yes' : 'no'],
    ['Id', detection.id ?? 'none'],
    ...(requestedId ? ([['Requested id', requestedId]] as [string, string][]) : []),
    ...(verified !== undefined
      ? ([['Verified', verified ? 'yes, the saved file decodes to the requested id' : 'no']] as [
          string,
          string,
        ][])
      : []),
    ['Correlation score', detection.correlationScore.toFixed(3)],
    ['Sync errors', `${Math.round(detection.syncErrorRate * 16)} of 16`],
    ['Checksum', detection.diagnostics.checksumValid ? 'valid' : 'invalid'],
    [
      'Active frames',
      `${detection.diagnostics.activeFrames} of ${detection.diagnostics.totalFrames}`,
    ],
  ];
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
