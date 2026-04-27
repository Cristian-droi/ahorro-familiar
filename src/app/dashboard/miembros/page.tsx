'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import {
  Users,
  Mail,
  Phone,
  Landmark,
  AlertCircle,
  CheckCircle2,
  Copy,
  Lock,
  Unlock,
  Search,
  TrendingUp,
  X,
  PauseCircle,
  PlayCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { listMembershipRequests } from '@/lib/data/membership-requests';
import { listProfiles } from '@/lib/data/profiles';
import {
  closeCapitalizationWindowV2,
  listAdminCapitalizationWindows,
  openUserCapitalizationWindow,
  type AdminCapWindow,
} from '@/lib/data/capitalization';
import { showToast } from '@/components/ui/Toast';

type MemberData = {
  request_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  identity_document: string;
  monthly_income: number;
  has_profile: boolean;
  selected_share_value: number | null;
  share_value_change_allowed: boolean;
  profile_id?: string;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_type: 'ahorros' | 'corriente' | null;
};

const cop = (n: number) => '$ ' + new Intl.NumberFormat('es-CO').format(n);

export default function MiembrosPage() {
  const [members, setMembers] = useState<MemberData[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // Marca qué profile está en vuelo para deshabilitar su botón y evitar
  // doble-click mientras la API responde.
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Ventanas activas de capitalización — para mostrar estado por accionista.
  // Solo cargamos las ACTIVAS (la global + las individuales abiertas).
  const [capWindows, setCapWindows] = useState<AdminCapWindow[]>([]);

  // Modal de capitalización individual.
  const [capModalFor, setCapModalFor] = useState<MemberData | null>(null);
  const [capModalAmount, setCapModalAmount] = useState('');
  const [capModalDeadline, setCapModalDeadline] = useState('');
  const [capModalLoading, setCapModalLoading] = useState(false);

  const fetchMembers = async () => {
    try {
      const [requests, profiles] = await Promise.all([
        listMembershipRequests(supabase),
        listProfiles(supabase),
      ]);

      const approved = requests.filter((r) => r.status === 'approved');
      const rows: MemberData[] = approved.map((req) => {
        const profile = profiles.find(
          (p) => p.identity_document === req.identity_document,
        );
        return {
          request_id: req.id,
          first_name: req.first_name,
          last_name: req.last_name,
          email: req.email,
          phone: req.phone,
          identity_document: req.identity_document,
          monthly_income: req.monthly_income,
          has_profile: !!profile,
          selected_share_value: profile?.selected_share_value ?? null,
          share_value_change_allowed: profile?.share_value_change_allowed ?? true,
          profile_id: profile?.id,
          bank_name: profile?.bank_name ?? null,
          bank_account_number: profile?.bank_account_number ?? null,
          bank_account_type: profile?.bank_account_type ?? null,
        };
      });

      setMembers(rows);
    } catch (err) {
      console.error('Error listando miembros:', err);
    }
  };

  const fetchCapWindows = async () => {
    try {
      const list = await listAdminCapitalizationWindows(supabase);
      setCapWindows(list);
    } catch (err) {
      console.error('Error cargando ventanas de capitalización:', err);
    }
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      await Promise.all([fetchMembers(), fetchCapWindows()]);
      if (!cancelled) setLoading(false);
    })();

    const channel = supabase
      .channel('miembros-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'membership_requests' },
        () => {
          if (!cancelled) fetchMembers();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        () => {
          if (!cancelled) fetchMembers();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'capitalization_windows' },
        () => {
          if (!cancelled) fetchCapWindows();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  // Mapa user_id → ventana individual activa, para pintar el badge en cada fila.
  const userCapWindowByUserId = useMemo(() => {
    const map = new Map<string, AdminCapWindow>();
    for (const w of capWindows) {
      if (w.scope === 'user' && w.user_id) map.set(w.user_id, w);
    }
    return map;
  }, [capWindows]);

  const openCapModal = (member: MemberData) => {
    setCapModalFor(member);
    setCapModalAmount('');
    setCapModalDeadline('');
  };

  const closeCapModal = () => {
    if (capModalLoading) return;
    setCapModalFor(null);
    setCapModalAmount('');
    setCapModalDeadline('');
  };

  const submitCapModal = async () => {
    if (!capModalFor?.profile_id) return;
    const amount = Number(capModalAmount.replace(/[^\d]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast('error', 'Indica un monto válido.');
      return;
    }
    if (!capModalDeadline) {
      showToast('error', 'Indica una fecha límite.');
      return;
    }
    setCapModalLoading(true);
    try {
      await openUserCapitalizationWindow(supabase, {
        userId: capModalFor.profile_id,
        maxAmount: amount,
        deadline: capModalDeadline,
      });
      await fetchCapWindows();
      showToast('success', 'Ventana de capitalización individual abierta.');
      closeCapModal();
    } catch (err: unknown) {
      const e = err as { message?: string; hint?: string } | null;
      const msg = e?.message ?? '';
      const hint = e?.hint ?? '';
      if (msg.includes('forbidden')) {
        showToast('error', 'Solo el administrador puede abrir ventanas.');
      } else if (msg.includes('invalid_deadline')) {
        showToast('error', hint || 'La fecha no es válida.');
      } else if (msg.includes('invalid_max_amount')) {
        showToast('error', hint || 'El monto no es válido.');
      } else {
        console.error('Error abriendo ventana individual:', err);
        showToast('error', 'No se pudo abrir la ventana.');
      }
    } finally {
      setCapModalLoading(false);
    }
  };

  const closeUserCapWindow = async (windowId: string) => {
    setCapModalLoading(true);
    try {
      await closeCapitalizationWindowV2(supabase, windowId);
      await fetchCapWindows();
      showToast('success', 'Ventana cerrada.');
      closeCapModal();
    } catch (err) {
      console.error('Error cerrando ventana:', err);
      showToast('error', 'No se pudo cerrar la ventana.');
    } finally {
      setCapModalLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast('success', 'Copiado al portapapeles');
  };

  const toggleShareValueLock = async (profileId: string, allow: boolean) => {
    setTogglingId(profileId);
    try {
      const res = await fetch('/api/admin/share-value-unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'user', userId: profileId, allow }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        showToast('error', body?.error ?? 'No se pudo aplicar el cambio');
        return;
      }
      showToast(
        'success',
        allow ? 'Cambio de valor habilitado' : 'Cambio de valor bloqueado',
      );
      // La realtime subscription sobre `profiles` disparará un refetch
      // automático, pero también actualizamos local para feedback inmediato.
      setMembers((prev) =>
        prev.map((m) =>
          m.profile_id === profileId ? { ...m, share_value_change_allowed: allow } : m,
        ),
      );
    } catch (err) {
      console.error('Error toggling share value lock:', err);
      showToast('error', 'No se pudo aplicar el cambio');
    } finally {
      setTogglingId(null);
    }
  };

  const { activeCount, pendingCount, missingShareCount } = useMemo(() => {
    return {
      activeCount: members.filter((m) => m.has_profile && m.selected_share_value)
        .length,
      pendingCount: members.filter((m) => !m.has_profile).length,
      missingShareCount: members.filter(
        (m) => m.has_profile && !m.selected_share_value,
      ).length,
    };
  }, [members]);

  // Filtra por nombre, documento, email o teléfono. Los stats arriba siguen
  // contando el total — solo la tabla se filtra para no esconder métricas.
  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => {
      const name = `${m.first_name} ${m.last_name}`.toLowerCase();
      const doc = (m.identity_document ?? '').toLowerCase();
      const email = (m.email ?? '').toLowerCase();
      const phone = (m.phone ?? '').toLowerCase();
      return (
        name.includes(q) ||
        doc.includes(q) ||
        email.includes(q) ||
        phone.includes(q)
      );
    });
  }, [members, search]);

  return (
    <div className="flex flex-col gap-7 animate-in fade-in duration-300">
      {/* Page header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-5">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.025em] leading-[1.15]">
            Directorio de accionistas
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1.5">
            Gestión y estado de todos los miembros aprobados en la plataforma.
          </p>
        </div>

        {/* Summary chips */}
        <div className="flex flex-wrap gap-2">
          <Badge tone="success">
            <CheckCircle2 size={12} strokeWidth={1.75} />
            {activeCount} activos
          </Badge>
          <Badge tone="warn">
            <AlertCircle size={12} strokeWidth={1.75} />
            {missingShareCount} sin valor
          </Badge>
          <Badge tone="neutral">
            <Users size={12} strokeWidth={1.75} />
            {pendingCount} no registrados
          </Badge>
        </div>
      </div>

      {/* Barra de búsqueda */}
      <div className="flex items-center h-10 px-3 rounded-[10px] bg-[var(--color-surface-alt)] border border-[var(--color-border)]">
        <Search
          size={15}
          strokeWidth={1.75}
          className="text-[var(--color-text-subtle)] mr-2 shrink-0"
        />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, documento, email o teléfono…"
          className="flex-1 bg-transparent text-[13px] focus:outline-none text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
          >
            Limpiar
          </button>
        )}
      </div>

      {/* Modal capitalización individual */}
      {capModalFor && (
        <CapitalizationUserModal
          member={capModalFor}
          existing={
            capModalFor.profile_id
              ? userCapWindowByUserId.get(capModalFor.profile_id) ?? null
              : null
          }
          amount={capModalAmount}
          setAmount={setCapModalAmount}
          deadline={capModalDeadline}
          setDeadline={setCapModalDeadline}
          loading={capModalLoading}
          onClose={closeCapModal}
          onSubmit={submitCapModal}
          onCloseExisting={closeUserCapWindow}
        />
      )}

      <Card padding="none" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[var(--color-surface-sunken)] text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-muted)] font-semibold">
                <th className="px-6 py-3 font-semibold">Accionista</th>
                <th className="px-6 py-3 font-semibold">Documento</th>
                <th className="px-6 py-3 font-semibold">Contacto</th>
                <th className="px-6 py-3 font-semibold">Cuenta bancaria</th>
                <th className="px-6 py-3 font-semibold text-right">
                  Ingreso reportado
                </th>
                <th className="px-6 py-3 font-semibold">Estado / Valor de acción</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-12 text-center text-[var(--color-text-muted)] text-sm"
                  >
                    Cargando directorio...
                  </td>
                </tr>
              ) : filteredMembers.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-12 text-center text-[var(--color-text-muted)] text-sm"
                  >
                    <div className="flex flex-col items-center gap-3">
                      <Users
                        size={32}
                        strokeWidth={1.5}
                        className="opacity-30"
                      />
                      {search.trim()
                        ? `Ningún accionista coincide con "${search.trim()}".`
                        : 'No hay miembros aprobados por el momento.'}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredMembers.map((member) => (
                  <tr
                    key={member.request_id}
                    className="border-t border-[var(--color-border)]"
                  >
                    {/* Accionista */}
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-3">
                        <Avatar name={member.first_name} size={32} />
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold tracking-tight truncate">
                            {member.first_name} {member.last_name}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Documento */}
                    <td className="px-6 py-3.5">
                      <button
                        type="button"
                        onClick={() => copyToClipboard(member.identity_document)}
                        className="group inline-flex items-center gap-2 text-[13px] text-[var(--color-text-muted)] tabular-nums hover:text-[var(--color-text)] transition-colors"
                      >
                        <span>{member.identity_document}</span>
                        <Copy
                          size={12}
                          strokeWidth={1.75}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-[var(--color-brand)]"
                        />
                      </button>
                    </td>

                    {/* Contacto */}
                    <td className="px-6 py-3.5">
                      <div
                        className="flex items-center gap-2 text-xs text-[var(--color-text)] break-all"
                        title={member.email}
                      >
                        <Mail
                          size={12}
                          strokeWidth={1.75}
                          className="text-[var(--color-brand)] shrink-0"
                        />
                        {member.email}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-[var(--color-text-subtle)] mt-1">
                        <Phone
                          size={12}
                          strokeWidth={1.75}
                          className="text-[var(--color-brand)] shrink-0"
                        />
                        {member.phone}
                      </div>
                    </td>

                    {/* Cuenta bancaria */}
                    <td className="px-6 py-3.5">
                      {member.bank_account_number ? (
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2 text-xs text-[var(--color-text)]">
                            <Landmark
                              size={12}
                              strokeWidth={1.75}
                              className="text-[var(--color-brand)] shrink-0"
                            />
                            <span className="font-semibold truncate max-w-[160px]">
                              {member.bank_name || 'Sin banco'}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              copyToClipboard(member.bank_account_number!)
                            }
                            className="group inline-flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] tabular-nums hover:text-[var(--color-text)] transition-colors self-start"
                            title="Copiar número de cuenta"
                          >
                            <span>{member.bank_account_number}</span>
                            <Copy
                              size={11}
                              strokeWidth={1.75}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-[var(--color-brand)]"
                            />
                          </button>
                          {member.bank_account_type && (
                            <span className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--color-text-subtle)] mt-0.5">
                              {member.bank_account_type === 'ahorros'
                                ? 'Ahorros'
                                : 'Corriente'}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--color-text-subtle)] italic">
                          Sin registrar
                        </span>
                      )}
                    </td>

                    {/* Ingreso */}
                    <td className="px-6 py-3.5 text-right text-[13px] text-[var(--color-text)] tabular-nums font-semibold whitespace-nowrap">
                      {cop(member.monthly_income)}
                    </td>

                    {/* Estado / Valor */}
                    <td className="px-6 py-3.5">
                      {!member.has_profile ? (
                        <Badge tone="neutral">
                          <AlertCircle size={12} strokeWidth={1.75} />
                          Pendiente registro
                        </Badge>
                      ) : !member.selected_share_value ? (
                        <Badge tone="warn">
                          <AlertCircle size={12} strokeWidth={1.75} />
                          Falta selección
                        </Badge>
                      ) : (
                        <div className="flex flex-col gap-1.5">
                          <Badge tone="success" className="w-fit">
                            <CheckCircle2 size={12} strokeWidth={1.75} />
                            Cuenta activa
                          </Badge>
                          <div className="flex items-center gap-1.5 text-[var(--color-text)]">
                            <Landmark
                              size={13}
                              strokeWidth={1.75}
                              className="text-[var(--color-brand)]"
                            />
                            <span className="text-sm font-semibold tabular-nums">
                              {cop(member.selected_share_value)}
                            </span>
                            <span className="text-[11px] text-[var(--color-text-subtle)]">
                              /acción
                            </span>
                          </div>
                          {/* Control admin: permitir/bloquear cambio del valor
                              de acción. Solo tiene sentido cuando el usuario ya
                              tiene un valor seleccionado — antes de eso puede
                              elegir libremente la primera vez. */}
                          {member.profile_id &&
                            (member.share_value_change_allowed ? (
                              <button
                                type="button"
                                onClick={() =>
                                  toggleShareValueLock(member.profile_id!, false)
                                }
                                disabled={togglingId === member.profile_id}
                                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50 transition-colors"
                                title="Bloquear cambio del valor de acción"
                              >
                                <Unlock
                                  size={11}
                                  strokeWidth={1.75}
                                  className="text-[var(--color-success)]"
                                />
                                Cambio habilitado · bloquear
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  toggleShareValueLock(member.profile_id!, true)
                                }
                                disabled={togglingId === member.profile_id}
                                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-brand)] hover:underline disabled:opacity-50 transition-colors"
                                title="Permitir que el accionista cambie su valor de acción"
                              >
                                <Lock size={11} strokeWidth={1.75} />
                                Permitir cambio
                              </button>
                            ))}

                          {/* Capitalización individual */}
                          {member.profile_id && (() => {
                            const w = userCapWindowByUserId.get(member.profile_id);
                            return w ? (
                              <button
                                type="button"
                                onClick={() => openCapModal(member)}
                                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-success)] hover:underline transition-colors"
                                title={`Capitalización activa hasta ${w.deadline}`}
                              >
                                <TrendingUp size={11} strokeWidth={1.75} />
                                Cap. activa · {cop(w.used_amount)} / {cop(w.max_amount ?? 0)}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => openCapModal(member)}
                                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-brand)] hover:underline transition-colors"
                                title="Habilitar capitalización personal"
                              >
                                <TrendingUp size={11} strokeWidth={1.75} />
                                Habilitar capitalización
                              </button>
                            );
                          })()}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// Modal para abrir/cerrar la ventana de capitalización individual de un
// accionista. Si ya hay una activa, mostramos info + opción de cerrar y de
// reemplazar. Si no, formulario simple monto + fecha.
function CapitalizationUserModal({
  member,
  existing,
  amount,
  setAmount,
  deadline,
  setDeadline,
  loading,
  onClose,
  onSubmit,
  onCloseExisting,
}: {
  member: MemberData;
  existing: AdminCapWindow | null;
  amount: string;
  setAmount: (v: string) => void;
  deadline: string;
  setDeadline: (v: string) => void;
  loading: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onCloseExisting: (windowId: string) => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[14px] shadow-lg-soft p-6 animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h3 className="text-[16px] font-semibold tracking-tight flex items-center gap-2">
              <TrendingUp size={16} strokeWidth={1.75} className="text-[var(--color-brand)]" />
              Capitalización personal
            </h3>
            <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 truncate">
              {member.first_name} {member.last_name} · CC {member.identity_document}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-[8px] flex items-center justify-center text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] cursor-pointer"
            aria-label="Cerrar"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        {existing ? (
          <div className="flex flex-col gap-3 p-3 rounded-[10px] bg-[var(--color-success-soft)]/40 border border-[var(--color-success)]/30 mb-4">
            <div className="text-[12px] text-[var(--color-text)]">
              Hay una ventana activa hasta el{' '}
              <strong>{existing.deadline}</strong>.
            </div>
            <div className="text-[12px] text-[var(--color-text-muted)]">
              Cupo: <span className="font-semibold tabular text-[var(--color-text)]">{cop(existing.used_amount)}</span>{' '}
              de <span className="font-semibold tabular text-[var(--color-text)]">{cop(existing.max_amount ?? 0)}</span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={loading}
              onClick={() => onCloseExisting(existing.id)}
            >
              <PauseCircle size={13} strokeWidth={1.75} />
              {loading ? 'Cerrando…' : 'Cerrar ventana actual'}
            </Button>
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          <div className="text-[12px] text-[var(--color-text-muted)]">
            {existing
              ? 'O reemplaza por una ventana nueva con estos parámetros:'
              : 'Define el monto máximo que el accionista podrá capitalizar y la fecha límite.'}
          </div>

          <div>
            <label className="text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase mb-1 block">
              Monto máximo (COP)
            </label>
            <Input
              type="text"
              inputMode="numeric"
              placeholder="Ej. 500000"
              value={amount}
              onChange={(e) => {
                const digits = e.target.value.replace(/[^\d]/g, '');
                setAmount(
                  digits === ''
                    ? ''
                    : new Intl.NumberFormat('es-CO').format(Number(digits)),
                );
              }}
            />
          </div>

          <div>
            <label className="text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase mb-1 block">
              Fecha límite
            </label>
            <Input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" size="md" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={loading || !amount || !deadline}
            onClick={onSubmit}
          >
            <PlayCircle size={15} strokeWidth={1.75} />
            {loading ? 'Guardando…' : existing ? 'Reemplazar' : 'Habilitar'}
          </Button>
        </div>
      </div>
    </div>
  );
}
