import { REPO } from '../links';

export function AboutGrid() {
  return (
    <section
      className="about-grid"
      aria-label="About WaveRune"
    >
      <article>
        <h2>Use it in your project</h2>
        <p>
          A TypeScript library and CLI with zero runtime dependencies. Runs on Node.js 22+ and Bun.
        </p>
        <code className="install-command">npm install waverune</code>
        <a href={`${REPO}#quick-start`}>Read the quick start</a>
      </article>
      <article>
        <h2>Know what to expect</h2>
        <p>
          Tested on synthetic signals and nine recordings. Short clips and audio edits can prevent
          recovery. The watermark is not proof of ownership.
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
  );
}
