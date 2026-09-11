import { REPO } from '../links';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <span>WaveRune · MIT licensed</span>
      <div>
        <a href={`${REPO}/blob/main/docs/api.md`}>API reference</a>
        <a href={`${REPO}/issues`}>Report an issue</a>
        <a href={REPO}>Star on GitHub</a>
      </div>
    </footer>
  );
}
