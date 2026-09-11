import { useWatermarkJob } from '../hooks/useWatermarkJob';
import { ControlsPanel } from './ControlsPanel';
import { ResultsPanel } from './ResultsPanel';

export function Workbench() {
  const job = useWatermarkJob();
  return (
    <section
      id="workbench"
      className="workbench"
      aria-label="Watermark demo"
      aria-busy={job.busy !== null}
    >
      <ControlsPanel
        file={job.file}
        keyValue={job.key}
        id={job.id}
        busy={job.busy}
        error={job.error}
        onFile={job.setFile}
        onKey={job.setKey}
        onId={job.setId}
        onRun={(kind) => void job.run(kind)}
      />
      <ResultsPanel
        file={job.file}
        originalUrl={job.originalUrl}
        busy={job.busy}
        embedded={job.embedded}
        detected={job.detected}
      />
    </section>
  );
}
