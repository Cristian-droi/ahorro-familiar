'use client';

import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

// Lee el tema actual sin romper SSR. Se usa como lazy initializer de useState.
export function readInitialTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

// Aplica el tema al <html> y lo persiste.
export function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
  try {
    localStorage.setItem('theme', theme);
  } catch {
    /* localStorage puede fallar en modo privado; no es crítico */
  }
}

// Hook de conveniencia: expone el tema actual y un toggle que lo persiste.
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);

  // Sincroniza con cambios externos (ej: otro tab escribe en localStorage).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'theme' && (e.newValue === 'light' || e.newValue === 'dark')) {
        applyTheme(e.newValue);
        setThemeState(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setTheme = (next: Theme) => {
    applyTheme(next);
    setThemeState(next);
  };

  const toggle = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  return { theme, setTheme, toggle };
}
