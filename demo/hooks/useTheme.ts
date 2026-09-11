import { useEffect, useState } from 'react';

import { applyTheme, darkSchemeQuery, readStoredTheme, storeTheme, type Theme } from '../theme';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    storeTheme(theme);
    const query = darkSchemeQuery();
    const onChange = () => applyTheme('system');
    if (theme === 'system') query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [theme]);

  return { theme, setTheme };
}
