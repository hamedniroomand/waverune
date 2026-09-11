import { SignalArt } from './SignalArt';

export function Intro() {
  return (
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
      <SignalArt />
    </section>
  );
}
