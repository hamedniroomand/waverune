export type Theme = 'light' | 'dark' | 'system';

export const THEMES: readonly Theme[] = ['system', 'light', 'dark'];
export const THEME_STORAGE_KEY = 'waverune-theme';

/** Also inlined in index.html so the first paint uses the saved theme. */
export function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Storage can be blocked; fall back to the system theme.
  }
  return 'system';
}

export function storeTheme(theme: Theme) {
  try {
    if (theme === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be blocked; the choice then lasts for this page only.
  }
}

export const darkSchemeQuery = () => matchMedia('(prefers-color-scheme: dark)');

export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return darkSchemeQuery().matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(root).getPropertyValue('--page-bg').trim();
}
