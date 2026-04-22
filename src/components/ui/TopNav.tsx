'use client';

import React, { useEffect, useState } from 'react';
import { Search, Moon, Sun, Bell } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Avatar } from '@/components/ui/Avatar';
import { useTheme } from '@/lib/theme';
import { getProfile } from '@/lib/data/profiles';

export function TopNav() {
  const { theme, toggle } = useTheme();
  const [firstName, setFirstName] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user || cancelled) return;
      try {
        const profile = await getProfile(supabase, data.user.id);
        if (!cancelled && profile?.first_name) setFirstName(profile.first_name);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isDark = theme === 'dark';

  return (
    <header className="h-16 shrink-0 px-6 lg:px-8 flex items-center gap-4 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
      {/* Search pill */}
      <div className="flex-1 max-w-[420px] h-9 bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-[9px] flex items-center gap-2.5 px-3">
        <Search size={15} strokeWidth={1.75} className="text-[var(--color-text-subtle)] shrink-0" />
        <span className="text-[13px] text-[var(--color-text-subtle)] truncate">
          Buscar accionistas, solicitudes, aportes…
        </span>
        <span className="ml-auto text-[11px] text-[var(--color-text-subtle)] px-1.5 py-0.5 border border-[var(--color-border)] rounded-[4px] bg-[var(--color-surface)] font-mono tracking-tight hidden sm:inline-flex">
          ⌘ K
        </span>
      </div>

      <div className="flex-1" />

      {/* Theme toggle */}
      <button
        type="button"
        onClick={toggle}
        title={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
        aria-label={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
        className="w-9 h-9 rounded-[9px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] flex items-center justify-center hover:text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] transition-colors"
      >
        {isDark ? (
          <Sun size={16} strokeWidth={1.75} />
        ) : (
          <Moon size={16} strokeWidth={1.75} />
        )}
      </button>

      {/* Bell with notification dot */}
      <button
        type="button"
        title="Notificaciones"
        aria-label="Notificaciones"
        className="relative w-9 h-9 rounded-[9px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] flex items-center justify-center hover:text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] transition-colors"
      >
        <Bell size={16} strokeWidth={1.75} />
        <span
          aria-hidden
          className="absolute top-1.5 right-1.5 w-[7px] h-[7px] rounded-full bg-[var(--color-danger)] ring-[1.5px] ring-[var(--color-surface)]"
        />
      </button>

      {/* Divider */}
      <div className="w-px h-[22px] bg-[var(--color-border)]" />

      {/* Avatar */}
      <Avatar name={firstName || '?'} size={32} />
    </header>
  );
}
