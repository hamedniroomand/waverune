import { useEffect, useState } from 'react';

import type { DetectionResult } from '../../src/types';
import { detect, embed, type EmbedOutcome } from '../watermark';

export type JobKind = 'embed' | 'detect';
export type EmbeddedOutput = EmbedOutcome & { url: string };

/** Let the browser paint the "working" state before the main thread is busy. */
const paint = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 30);
  });

export function useWatermarkJob() {
  const [file, setFileState] = useState<File | null>(null);
  const [key, setKeyState] = useState('secret');
  const [id, setIdState] = useState('');
  const [busy, setBusy] = useState<JobKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [embedded, setEmbedded] = useState<EmbeddedOutput | null>(null);
  const [detected, setDetected] = useState<DetectionResult | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (originalUrl !== null) URL.revokeObjectURL(originalUrl);
    };
  }, [originalUrl]);

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

  function setFile(next: File | null) {
    setFileState(next);
    setOriginalUrl(next === null ? null : URL.createObjectURL(next));
    clearResults();
  }

  function setKey(next: string) {
    setKeyState(next);
    clearResults();
  }

  function setId(next: string) {
    setIdState(next);
    clearResults();
  }

  async function run(kind: JobKind) {
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

  return {
    file,
    key,
    id,
    busy,
    error,
    embedded,
    detected,
    originalUrl,
    setFile,
    setKey,
    setId,
    run,
  };
}
