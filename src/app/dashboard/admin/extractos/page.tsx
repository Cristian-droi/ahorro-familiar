'use client';

// Extractos (admin): visor del extracto de cualquier accionista, con
// la misma información que el accionista ve en /dashboard/extracto.
// Usa el componente <ExtractoView /> con targetUserId del seleccionado
// y un combobox buscable arriba.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { ClipboardList, Search, ChevronDown, Check, Users } from 'lucide-react';
import { getProfileRole, listProfilesWithNames } from '@/lib/data/profiles';
import { ExtractoView } from '@/app/dashboard/extracto/page';

type ProfileLite = {
  id: string;
  first_name: string;
  last_name: string;
  identity_document: string;
};

export default function AdminExtractosPage() {
  const router = useRouter();
  const [role, setRole] = useState<'admin' | 'accionista' | null>(null);
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<ProfileLite[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Combobox buscable — query controlado + dropdown abierto.
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/login');
        return;
      }
      const r = await getProfileRole(supabase, user.id);
      if (cancelled) return;
      if (r !== 'admin') {
        router.replace('/dashboard/accionista');
        return;
      }
      setRole(r);

      try {
        const list = await listProfilesWithNames(supabase);
        if (!cancelled) setProfiles(list);
      } catch (err) {
        console.error('Error listando accionistas:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Cierra el dropdown al click afuera o Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter((p) => {
      const name = `${p.first_name} ${p.last_name}`.toLowerCase();
      const doc = (p.identity_document ?? '').toLowerCase();
      return name.includes(q) || doc.includes(q);
    });
  }, [profiles, query]);

  const selected = useMemo(
    () => profiles.find((p) => p.id === selectedId) ?? null,
    [profiles, selectedId],
  );

  const pickProfile = (p: ProfileLite) => {
    setSelectedId(p.id);
    setQuery('');
    setOpen(false);
  };

  if (loading || role !== 'admin') {
    return (
      <div className="animate-pulse text-[var(--color-text-subtle)] text-sm">
        Cargando…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-300">
      {/* Header */}
      <header>
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-[11px] bg-[var(--color-brand-soft)] text-[var(--color-brand)] flex items-center justify-center">
            <ClipboardList size={20} strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-[26px] font-semibold tracking-[-0.025em] leading-[1.15]">
              Extractos
            </h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
              Selecciona un accionista para ver su extracto anual.
            </p>
          </div>
        </div>
      </header>

      {/* Picker */}
      <Card padding="md">
        <label className="text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase block mb-2">
          Accionista
        </label>
        <div className="relative" ref={wrapRef}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="w-full flex items-center gap-3 h-11 px-3 rounded-[10px] bg-[var(--color-surface-alt)] border border-[var(--color-border)] hover:border-[var(--color-brand)]/40 transition-colors text-left"
          >
            {selected ? (
              <>
                <Avatar name={selected.first_name} size={28} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold tracking-tight truncate">
                    {selected.first_name} {selected.last_name}
                  </div>
                  <div className="text-[11px] text-[var(--color-text-subtle)]">
                    CC {selected.identity_document}
                  </div>
                </div>
              </>
            ) : (
              <>
                <Users size={16} strokeWidth={1.75} className="text-[var(--color-text-subtle)]" />
                <span className="flex-1 text-[13px] text-[var(--color-text-subtle)]">
                  Elegí un accionista…
                </span>
              </>
            )}
            <ChevronDown
              size={16}
              strokeWidth={1.75}
              className={`text-[var(--color-text-subtle)] transition-transform ${
                open ? 'rotate-180' : ''
              }`}
            />
          </button>

          {open && (
            <div className="absolute z-30 left-0 right-0 mt-2 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg overflow-hidden">
              <div className="px-3 py-2 border-b border-[var(--color-border)] flex items-center gap-2">
                <Search
                  size={14}
                  strokeWidth={1.75}
                  className="text-[var(--color-text-subtle)] shrink-0"
                />
                <input
                  type="search"
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar por nombre o documento…"
                  className="flex-1 bg-transparent text-[13px] focus:outline-none text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] min-w-0"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
                  >
                    Limpiar
                  </button>
                )}
              </div>
              <div className="max-h-[280px] overflow-y-auto">
                {filtered.length === 0 ? (
                  <div className="px-4 py-6 text-center text-[12px] text-[var(--color-text-subtle)]">
                    Ningún accionista coincide.
                  </div>
                ) : (
                  filtered.map((p) => {
                    const isActive = p.id === selectedId;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => pickProfile(p)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                          isActive
                            ? 'bg-[var(--color-brand-soft)]/40'
                            : 'hover:bg-[var(--color-surface-alt)]'
                        }`}
                      >
                        <Avatar name={p.first_name} size={28} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-semibold tracking-tight truncate">
                            {p.first_name} {p.last_name}
                          </div>
                          <div className="text-[11px] text-[var(--color-text-subtle)]">
                            CC {p.identity_document}
                          </div>
                        </div>
                        {isActive && (
                          <Check
                            size={14}
                            strokeWidth={2}
                            className="text-[var(--color-brand)] shrink-0"
                          />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Vista del extracto */}
      {selectedId ? (
        <ExtractoView targetUserId={selectedId} />
      ) : (
        <Card padding="lg" className="text-center py-12">
          <div className="mx-auto w-12 h-12 rounded-full bg-[var(--color-surface-alt)] flex items-center justify-center text-[var(--color-text-subtle)] mb-3">
            <ClipboardList size={20} strokeWidth={1.5} />
          </div>
          <h2 className="text-[15px] font-semibold tracking-tight">
            Sin accionista seleccionado
          </h2>
          <p className="text-[13px] text-[var(--color-text-muted)] mt-1">
            Elegí un accionista en el selector de arriba para ver su extracto.
          </p>
        </Card>
      )}
    </div>
  );
}
