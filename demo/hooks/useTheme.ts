import { useEffect, useState } from 'react';

import { applyTheme, darkSchemeQuery, readStoredTheme, storeTheme, type Theme } from '../theme';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    storeTheme(theme);
    if (theme !== 'system') return undefined;
    const query = darkSchemeQuery();
    const onChange = () => applyTheme('system');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [theme]);

  return { theme, setTheme };
}
