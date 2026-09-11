import type { DetectionResult } from '../../src/types';
import type { EmbeddedOutput, JobKind } from '../hooks/useWatermarkJob';
import { ResultDetails } from './ResultDetails';

interface ResultsPanelProps {
  file: File | null;
  originalUrl: string | null;
  busy: JobKind | null;
  embedded: EmbeddedOutput | null;
  detected: DetectionResult | null;
}

export function ResultsPanel({ file, originalUrl, busy, embedded, detected }: ResultsPanelProps) {
  return (
    <div className="results-panel">
      <div className="panel-heading">
        <h2>Playback & results</h2>
        <span className="local-label">Local processing</span>
      </div>
      {!file && <EmptyState />}
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
        {embedded && <EmbedOutput embedded={embedded} />}
        {detected && <DetectOutput detected={detected} />}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
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
        Choose a WAV file to listen to the original. Embed a watermark to compare the output and
        download it.
      </p>
    </div>
  );
}

function EmbedOutput({ embedded }: { embedded: EmbeddedOutput }) {
  return (
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
      <ResultDetails
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
          The saved file did not recover the requested ID. Try a longer clip or a different
          recording.
        </p>
      )}
    </section>
  );
}

function DetectOutput({ detected }: { detected: DetectionResult }) {
  return (
    <section className="output-section">
      <div className={`result-status ${detected.detected ? 'success' : 'warning'}`}>
        {detected.detected ? 'Watermark detected' : 'No watermark detected'}
      </div>
      {!detected.detected && (
        <p className="panel-description">
          Check the key and try the full recording. A rejection does not prove that a file was never
          watermarked.
        </p>
      )}
      <ResultDetails detection={detected} />
    </section>
  );
}
