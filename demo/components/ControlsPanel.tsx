import type { JobKind } from '../hooks/useWatermarkJob';
import { MAX_SECONDS } from '../watermark';

interface ControlsPanelProps {
  file: File | null;
  keyValue: string;
  id: string;
  busy: JobKind | null;
  error: string | null;
  onFile: (file: File | null) => void;
  onKey: (key: string) => void;
  onId: (id: string) => void;
  onRun: (kind: JobKind) => void;
}

export function ControlsPanel({
  file,
  keyValue,
  id,
  busy,
  error,
  onFile,
  onKey,
  onId,
  onRun,
}: ControlsPanelProps) {
  const canRun = Boolean(file) && keyValue.trim() !== '' && busy === null;
  return (
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
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <div className="form-field">
          <label htmlFor="watermark-key">Watermark key</label>
          <input
            id="watermark-key"
            className="text-input"
            value={keyValue}
            spellCheck={false}
            autoComplete="off"
            aria-describedby="key-help"
            onChange={(e) => onKey(e.target.value)}
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
            onChange={(e) => onId(e.target.value)}
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
            disabled={!canRun}
            onClick={() => onRun('embed')}
          >
            {busy === 'embed' ? 'Embedding…' : 'Embed watermark'}
          </button>
          <button
            className="button button-secondary"
            disabled={!canRun}
            onClick={() => onRun('detect')}
          >
            {busy === 'detect' ? 'Detecting…' : 'Detect watermark'}
          </button>
        </div>
      </fieldset>
      <output className="processing-note">
        {busy
          ? 'Processing your audio. Larger files can take a minute or more; the page may pause.'
          : 'Start with a short clip. Recovery depends on the recording.'}
      </output>
      {error !== null && (
        <p
          className="error-message"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
