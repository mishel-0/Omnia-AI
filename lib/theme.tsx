'use client';

/**
 * Light/dark theme, shared.
 *
 * The toggle logic already existed — but only inside app/page.tsx, the setup
 * screen. Once a pathologist reached the dashboard there was no way to change
 * it, on an application people sit in front of for a full shift, in rooms whose
 * lighting is not up to them.
 *
 * The choice is stored under `omnia_theme` and applied by an inline script in
 * app/layout.tsx before first paint, so a dark-mode user never sees a white
 * flash on load. This hook only has to stay consistent with that key.
 */

import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'omnia_theme';

function read(): Theme {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* private mode, or storage disabled */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  // Starts at 'light' rather than reading storage, because the server render
  // has no localStorage and a mismatch here is a hydration error. The real
  // value lands in the effect below; the document already carries the right
  // theme from the boot script, so nothing flickers.
  const [theme, setThemeState] = useState<Theme>('light');

  useEffect(() => {
    const current = (document.documentElement.getAttribute('data-theme') as Theme) || read();
    setThemeState(current);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(KEY, next); } catch { /* nothing to do */ }
  }, []);

  const toggle = useCallback(() => {
    setTheme((document.documentElement.getAttribute('data-theme') as Theme) === 'dark'
      ? 'light' : 'dark');
  }, [setTheme]);

  return { theme, setTheme, toggle };
}
