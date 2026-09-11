/** Decorative bar chart of a signal with a highlighted band where the identifier sits. */
export function SignalArt() {
  return (
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
            Math.pow(Math.sin(i * 0.37), 2) * (18 + 82 * Math.pow(Math.sin((i / 64) * Math.PI), 2));
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
  );
}
