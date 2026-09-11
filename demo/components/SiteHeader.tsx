import logo from '../favicon.svg';
import { useTheme } from '../hooks/useTheme';
import { REPO } from '../links';
import { ThemeSwitch } from './ThemeSwitch';

export function SiteHeader() {
  const { theme, setTheme } = useTheme();
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
        <ThemeSwitch
          theme={theme}
          onChange={setTheme}
        />
      </nav>
    </header>
  );
}
