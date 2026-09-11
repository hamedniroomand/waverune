import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import type { DetectionResult } from '../src/types';
import logo from './favicon.svg';
import { MAX_SECONDS, detect, embed, type EmbedOutcome } from './watermark';

const REPO = 'https://github.com/hamedniroomand/waverune';

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
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setOriginalUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setOriginalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    return () => {
      if (embedded) URL.revokeObjectURL(embedded.url);
    };
  }, [embedded]);

  function clearResults() {
    setEmbedded(null);
    setDetected(null);
    setError(null);
  }

  async function run(kind: 'embed' | 'detect') {
    if (!file) return;
    setBusy(kind);
    clearResults();
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
    <div className="page-shell">
      <a
        className="skip-link"
        href="#workbench"
      >
        Skip to the demo
      </a>
      <header className="site-header">
        <a
          className="brand"
          href="./"
          aria-label="WaveRune home"
        >
          <img
            src={logo}
            alt=""
            width={36}
            height={36}
          />
          <span>WaveRune</span>
        </a>
        <nav aria-label="Main navigation">
          <a href={`${REPO}/blob/main/docs/api.md`}>Documentation</a>
          <a
            className="repo-link"
            href={REPO}
          >
            View on GitHub <span aria-hidden="true">↗</span>
          </a>
        </nav>
      </header>

      <main>
        <section
          className="intro"
          aria-labelledby="page-title"
        >
          <div>
            <p className="intro-label">Open-source audio watermarking</p>
            <h1 id="page-title">
              A small signature.
              <br />
              Carried by sound.
            </h1>
            <p className="intro-copy">
              Embed a 32-bit identifier in a WAV file. Read it back with the same key, without the
              original recording.
            </p>
            <p className="privacy-note">
              <span
                aria-hidden="true"
                className="status-dot"
              />
              Your audio stays in your browser. Nothing is uploaded.
            </p>
          </div>
          <div
            className="signal-art"
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 420 160"
              fill="none"
            >
              <path
                className="signal-grid"
                d="M0 40H420M0 80H420M0 120H420M70 0V160M140 0V160M210 0V160M280 0V160M350 0V160"
              />
              {Array.from({ length: 65 }, (_, i) => {
                const height =
                  8 +
                  Math.pow(Math.sin(i * 0.37), 2) *
                    (18 + 82 * Math.pow(Math.sin((i / 64) * Math.PI), 2));
                return (
                  <path
                    key={i}
                    className={i > 29 && i < 36 ? 'signal-mark' : 'signal-wave'}
                    d={`M${18 + i * 6} ${80 - height / 2}v${height}`}
                  />
                );
              })}
            </svg>
            <div className="signal-caption">
              <span>Audio signal</span>
              <span>Embedded identifier</span>
            </div>
          </div>
        </section>

        <section
          id="workbench"
          className="workbench"
          aria-label="Watermark demo"
          aria-busy={busy !== null}
        >
          <div className="controls-panel">
            <div className="panel-heading">
              <h2>Try it with your audio</h2>
              <span className="file-tag">WAV</span>
            </div>
            <p className="panel-description">Choose a file, set a key, then embed or detect.</p>
            <fieldset disabled={busy !== null}>
              <label className={`file-picker ${file ? 'has-file' : ''}`}>
                <svg
                  width="30"
                  height="30"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" />
                </svg>
                <span className="file-name">{file ? file.name : 'Choose a WAV file'}</span>
                <span className="file-hint">
                  {file
                    ? `${(file.size / 1024 / 1024).toFixed(2)} MB · Click to replace`
                    : `Up to ${MAX_SECONDS} seconds · Click to browse`}
                </span>
                <input
                  type="file"
                  accept=".wav,audio/wav,audio/x-wav"
                  aria-label="Choose a WAV file"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    clearResults();
                  }}
                />
              </label>
              <div className="form-field">
                <label htmlFor="watermark-key">Watermark key</label>
                <input
                  id="watermark-key"
                  className="text-input"
                  value={key}
                  spellCheck={false}
                  autoComplete="off"
                  aria-describedby="key-help"
                  onChange={(e) => {
                    setKey(e.target.value);
                    clearResults();
                  }}
                />
                <p
                  id="key-help"
                  className="field-help"
                >
                  Use the same key to embed and detect.
                </p>
              </div>
              <div className="form-field">
                <label htmlFor="watermark-id">
                  Identifier <span className="optional">Optional</span>
                </label>
                <input
                  id="watermark-id"
                  className="text-input"
                  placeholder="e.g. 42 or 0xDEADBEEF"
                  value={id}
                  spellCheck={false}
                  aria-describedby="id-help"
                  onChange={(e) => {
                    setId(e.target.value);
                    clearResults();
                  }}
                />
                <p
                  id="id-help"
                  className="field-help"
                >
                  Leave blank for a random ID. Used only when embedding.
                </p>
              </div>
              <div className="actions">
                <button
                  className="button button-primary"
                  disabled={!file || !key.trim() || busy !== null}
                  onClick={() => void run('embed')}
                >
                  {busy === 'embed' ? 'Embedding…' : 'Embed watermark'}
                </button>
                <button
                  className="button button-secondary"
                  disabled={!file || !key.trim() || busy !== null}
                  onClick={() => void run('detect')}
                >
                  {busy === 'detect' ? 'Detecting…' : 'Detect watermark'}
                </button>
              </div>
            </fieldset>
            <p
              className="processing-note"
              role="status"
            >
              {busy
                ? 'Processing your audio. Larger files can take a minute or more; the page may pause.'
                : 'Start with a short clip. Recovery depends on the recording.'}
            </p>
            {error && (
              <p
                className="error-message"
                role="alert"
              >
                {error}
              </p>
            )}
          </div>

          <div className="results-panel">
            <div className="panel-heading">
              <h2>Playback & results</h2>
              <span className="local-label">Local processing</span>
            </div>
            {!file && (
              <div className="empty-state">
                <div
                  className="empty-wave"
                  aria-hidden="true"
                >
                  {[12, 24, 38, 22, 48, 30, 18].map((h, i) => (
                    <span
                      key={i}
                      style={{ height: h }}
                    />
                  ))}
                </div>
                <h3>Your audio, before and after</h3>
                <p>
                  Choose a WAV file to listen to the original. Embed a watermark to compare the
                  output and download it.
                </p>
              </div>
            )}
            {originalUrl && (
              <section className="audio-section">
                <h3>Original audio</h3>
                <audio
                  controls
                  src={originalUrl}
                  aria-label="Original audio"
                />
              </section>
            )}
            {file && !embedded && !detected && (
              <div className="result-placeholder">
                <h3>{busy ? 'Working on your file…' : 'Ready when you are'}</h3>
                <p>
                  {busy
                    ? 'The result will appear here once processing finishes.'
                    : 'Embed a new identifier, or detect an existing watermark using its key.'}
                </p>
              </div>
            )}
            <div
              aria-live="polite"
              aria-atomic="true"
            >
              {embedded && (
                <section className="output-section">
                  <div className={`result-status ${embedded.verified ? 'success' : 'warning'}`}>
                    {embedded.verified
                      ? 'Watermark embedded and verified'
                      : 'Output created, but verification failed'}
                  </div>
                  <h3>Watermarked audio</h3>
                  <audio
                    controls
                    src={embedded.url}
                    aria-label="Watermarked audio"
                  />
                  <Result
                    detection={embedded.detection}
                    requestedId={embedded.id}
                    verified={embedded.verified}
                  />
                  <a
                    className="button button-primary download-link"
                    href={embedded.url}
                    download={`marked-${embedded.id}.wav`}
                  >
                    Download {embedded.verified ? 'watermarked' : 'unverified'} WAV
                  </a>
                  {!embedded.verified && (
                    <p className="field-help">
                      The saved file did not recover the requested ID. Try a longer clip or a
                      different recording.
                    </p>
                  )}
                </section>
              )}
              {detected && (
                <section className="output-section">
                  <div className={`result-status ${detected.detected ? 'success' : 'warning'}`}>
                    {detected.detected ? 'Watermark detected' : 'No watermark detected'}
                  </div>
                  {!detected.detected && (
                    <p className="panel-description">
                      Check the key and try the full recording. A rejection does not prove that a
                      file was never watermarked.
                    </p>
                  )}
                  <Result detection={detected} />
                </section>
              )}
            </div>
          </div>
        </section>

        <section
          className="about-grid"
          aria-label="About WaveRune"
        >
          <article>
            <h2>Use it in your project</h2>
            <p>
              A TypeScript library and CLI with zero runtime dependencies. Runs on Node.js 22+ and
              Bun.
            </p>
            <code className="install-command">npm install waverune</code>
            <a href={`${REPO}#quick-start`}>Read the quick start</a>
          </article>
          <article>
            <h2>Know what to expect</h2>
            <p>
              Tested on synthetic signals and nine recordings. Short clips and audio edits can
              prevent recovery. The watermark is not proof of ownership.
            </p>
            <a href={`${REPO}/blob/main/docs/reliability-report.md`}>
              See measured results and limitations
            </a>
          </article>
          <article>
            <h2>Make it better</h2>
            <p>
              Found a case that fails? Share the steps to reproduce it. Bug reports, documentation
              fixes, and reproducible tests are welcome.
            </p>
            <a href={`${REPO}/blob/main/CONTRIBUTING.md`}>Contribute on GitHub</a>
          </article>
        </section>
      </main>
      <footer className="site-footer">
        <span>WaveRune · MIT licensed</span>
        <div>
          <a href={`${REPO}/blob/main/docs/api.md`}>API reference</a>
          <a href={`${REPO}/issues`}>Report an issue</a>
          <a href={REPO}>Star on GitHub</a>
        </div>
      </footer>
    </div>
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
    rows.push(['Verified', verified ? 'Saved file matches the requested ID' : 'no']);
  }
  rows.push(
    ['Correlation score', detection.correlationScore.toFixed(3)],
    ['Sync errors', `${Math.round(detection.syncErrorRate * 16)} of 16`],
    ['Checksum', d.checksumValid ? 'valid' : 'invalid'],
    ['Active frames', `${d.activeFrames} of ${d.totalFrames}`],
  );
  return (
    <dl className="result-details">
      {rows.map(([k, v]) => (
        <div
          key={k}
          className="result-row"
        >
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
