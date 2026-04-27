'use client';

import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

// Lee el tema actual desde el DOM (que ya quedó pintado por el script
// inline de RootLayout). Solo se usa en el cliente — en SSR siempre
// devolvemos 'light' como placeholder neutro.
function readThemeFromDom(): Theme {
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
//
// Importante: el state inicial es SIEMPRE 'light' en SSR/primer render del
// cliente para evitar hydration mismatch. Después del mount sincronizamos
// con el DOM (que ya tiene la clase correcta gracias al script inline de
// RootLayout). `mounted` indica si ya se sincronizó — los componentes
// pueden usarlo para renderizar el icono real solo después del mount y
// evitar el flash Moon→Sun.
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Sincronizamos el state con lo que el script inline ya aplicó al
    // <html>. Si el user tenía dark guardado, esto baja 'dark' al state.
    setThemeState(readThemeFromDom());
    setMounted(true);

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

  return { theme, setTheme, toggle, mounted };
}
