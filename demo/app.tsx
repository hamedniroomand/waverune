import { createRoot } from 'react-dom/client';

import { AboutGrid } from './components/AboutGrid';
import { Intro } from './components/Intro';
import { SiteFooter } from './components/SiteFooter';
import { SiteHeader } from './components/SiteHeader';
import { Workbench } from './components/Workbench';

function App() {
  return (
    <div className="page-shell">
      <a
        className="skip-link"
        href="#workbench"
      >
        Skip to the demo
      </a>
      <SiteHeader />
      <main>
        <Intro />
        <Workbench />
        <AboutGrid />
      </main>
      <SiteFooter />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
