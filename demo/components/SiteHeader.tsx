import logo from '../favicon.svg';
import { REPO } from '../links';

export function SiteHeader() {
  return (
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
  );
}
