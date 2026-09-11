import type { DetectionResult } from '../../src/types';

interface ResultDetailsProps {
  detection: DetectionResult;
  requestedId?: bigint;
  verified?: boolean;
}

export function ResultDetails({ detection, requestedId, verified }: ResultDetailsProps) {
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
