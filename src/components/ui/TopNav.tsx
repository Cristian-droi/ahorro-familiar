'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Search,
  Moon,
  Sun,
  Bell,
  CheckCircle2,
  Menu,
  X,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Avatar } from '@/components/ui/Avatar';
import { useTheme } from '@/lib/theme';
import { getProfile } from '@/lib/data/profiles';

// Cada item del dropdown de notificaciones. El layout decide qué items
// mandar según el role del usuario (admin / accionista). Si count = 0,
// el item se filtra fuera y no aporta al badge.
export type TopNavNotificationItem = {
  key: string;
  label: string;
  count: number;
  href: string;
  icon: LucideIcon;
};

type TopNavProps = {
  notifications?: TopNavNotificationItem[];
  // Toggle del sidebar (hamburguesa). El layout maneja el state; acá solo
  // mostramos el botón. `sidebarOpen` se usa para alternar el icono
  // (menu / x).
  onToggleSidebar?: () => void;
  sidebarOpen?: boolean;
};

// Botón cuadrado de utility (theme toggle, notificaciones, hamburguesa).
// Centralizado para que todos midan exactamente lo mismo.
const UTIL_BTN_CLASS =
  'w-9 h-9 shrink-0 rounded-[9px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] flex items-center justify-center hover:text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] transition-colors';

export function TopNav({ notifications, onToggleSidebar, sidebarOpen }: TopNavProps) {
  const { theme, toggle, mounted } = useTheme();
  const [firstName, setFirstName] = useState<string>('');
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

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

  // Cerrar el dropdown al click afuera o con Escape — UX estándar.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!dropdownRef.current) return;
      if (!dropdownRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const isDark = theme === 'dark';

  const items = useMemo(
    () => (notifications ?? []).filter((i) => i.count > 0),
    [notifications],
  );

  const total = useMemo(
    () => items.reduce((s, i) => s + i.count, 0),
    [items],
  );

  return (
    <header className="h-14 md:h-16 shrink-0 px-3 md:px-6 lg:px-8 flex items-center gap-2 md:gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
      {/* Toggle sidebar (siempre visible — sirve en mobile y desktop). */}
      {onToggleSidebar && (
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? 'Cerrar menú' : 'Abrir menú'}
          title={sidebarOpen ? 'Cerrar menú' : 'Abrir menú'}
          className={UTIL_BTN_CLASS}
        >
          {sidebarOpen ? (
            <X size={16} strokeWidth={1.75} />
          ) : (
            <Menu size={16} strokeWidth={1.75} />
          )}
        </button>
      )}

      {/* Search pill — solo a partir de md (en mobile no entra y se ve mal). */}
      <div className="hidden md:flex flex-1 max-w-[420px] h-9 bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-[9px] items-center gap-2.5 px-3">
        <Search
          size={15}
          strokeWidth={1.75}
          className="text-[var(--color-text-subtle)] shrink-0"
        />
        <span className="text-[13px] text-[var(--color-text-subtle)] truncate">
          Buscar accionistas, solicitudes, aportes…
        </span>
        <span className="ml-auto text-[11px] text-[var(--color-text-subtle)] px-1.5 py-0.5 border border-[var(--color-border)] rounded-[4px] bg-[var(--color-surface)] font-mono tracking-tight hidden lg:inline-flex">
          ⌘ K
        </span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Theme toggle. Hasta que mounted=true, renderizamos un placeholder
          neutro (ni Sun ni Moon) para evitar mismatch con el SSR. Una vez
          montado, mostramos el icono según el theme real leído del DOM. */}
      <button
        type="button"
        onClick={toggle}
        title={mounted ? (isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro') : 'Cambiar tema'}
        aria-label={mounted ? (isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro') : 'Cambiar tema'}
        className={UTIL_BTN_CLASS}
        suppressHydrationWarning
      >
        {!mounted ? (
          // Placeholder transparente del mismo tamaño — evita layout shift.
          <span className="w-4 h-4" aria-hidden />
        ) : isDark ? (
          <Sun size={16} strokeWidth={1.75} />
        ) : (
          <Moon size={16} strokeWidth={1.75} />
        )}
      </button>

      {/* Bell con dropdown */}
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          title="Notificaciones"
          aria-label="Notificaciones"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={`relative ${UTIL_BTN_CLASS}`}
        >
          <Bell size={16} strokeWidth={1.75} />
          {total > 0 ? (
            <span
              aria-label={`${total} pendientes`}
              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--color-danger)] text-white text-[10px] font-bold inline-flex items-center justify-center ring-[1.5px] ring-[var(--color-bg)]"
            >
              {total > 99 ? '99+' : total}
            </span>
          ) : null}
        </button>

        {open ? (
          <div
            role="menu"
            className="fixed right-3 left-3 sm:left-auto sm:absolute sm:right-0 mt-2 sm:w-[320px] rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg z-50 overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-[var(--color-border)]">
              <div className="text-[13px] font-semibold tracking-tight">
                Notificaciones
              </div>
              <div className="text-[11px] text-[var(--color-text-subtle)] mt-0.5">
                {total > 0
                  ? `${total} ${total === 1 ? 'pendiente' : 'pendientes'} de tu acción`
                  : 'Estás al día'}
              </div>
            </div>

            <div className="max-h-[320px] overflow-y-auto">
              {items.length === 0 ? (
                <div className="px-4 py-8 flex flex-col items-center gap-2 text-center">
                  <CheckCircle2
                    size={28}
                    strokeWidth={1.5}
                    className="text-[var(--color-success)]"
                  />
                  <div className="text-[12px] text-[var(--color-text-muted)]">
                    No hay nada pendiente por ahora.
                  </div>
                </div>
              ) : (
                items.map((it) => {
                  const Icon = it.icon;
                  return (
                    <Link
                      key={it.key}
                      href={it.href}
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--color-surface-alt)] transition-colors border-b border-[var(--color-border)] last:border-b-0"
                    >
                      <div className="w-8 h-8 rounded-[8px] bg-[var(--color-surface-alt)] flex items-center justify-center text-[var(--color-text-muted)] shrink-0">
                        <Icon size={15} strokeWidth={1.75} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] font-medium tracking-tight text-[var(--color-text)] truncate">
                          {it.label}
                        </div>
                      </div>
                      <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-[var(--color-brand)] text-white dark:text-[var(--color-brand-ink)] text-[11px] font-bold inline-flex items-center justify-center">
                        {it.count}
                      </span>
                    </Link>
                  );
                })
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Divider — solo desktop, en mobile el avatar va pegado al bell */}
      <div className="hidden md:block w-px h-[22px] bg-[var(--color-border)]" />

      {/* Avatar — tamaño fijo y shrink-0 para que no lo recorte el flex */}
      <div className="shrink-0">
        <Avatar name={firstName || '?'} size={32} />
      </div>
    </header>
  );
}
