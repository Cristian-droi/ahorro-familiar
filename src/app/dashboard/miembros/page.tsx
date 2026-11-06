'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAccesoAdmin } from '@/app/dashboard/AccesoAdminContext';
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
  Search,
  TrendingUp,
  X,
  PauseCircle,
  PlayCircle,
  Unlock,
  Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { listMembershipRequests } from '@/lib/data/membership-requests';
import { listProfiles } from '@/lib/data/profiles';
import {
  listOpenPeriodShareValueChangesAllowed,
  listOpenPeriodShareValues,
  listProfilesWithShareReceiptsInOpenPeriod,
} from '@/lib/data/share-value';
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
  // Open-period share value (RN-2.2); null while not chosen.
  share_value: number | null;
  // The admin allowed one change of the share value (RN-2.2).
  share_value_change_allowed: boolean;
  // A pending or approved share receipt exists in the open period: the value
  // is fixed until the next period (RN-2.2).
  has_share_receipts: boolean;
  profile_id?: string;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_type: 'ahorros' | 'corriente' | null;
};

const cop = (n: number) => '$ ' + new Intl.NumberFormat('es-CO').format(n);

export default function MiembrosPage() {
  const { soloLectura } = useAccesoAdmin();
  const [members, setMembers] = useState<MemberData[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

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
      const [requests, profiles, shareValues, changesAllowed, withShareReceipts] =
        await Promise.all([
          listMembershipRequests(supabase),
          listProfiles(supabase),
          listOpenPeriodShareValues(supabase),
          listOpenPeriodShareValueChangesAllowed(supabase),
          listProfilesWithShareReceiptsInOpenPeriod(supabase),
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
          share_value: profile ? (shareValues.get(profile.id) ?? null) : null,
          share_value_change_allowed: profile ? changesAllowed.has(profile.id) : false,
          has_share_receipts: profile ? withShareReceipts.has(profile.id) : false,
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

  // Profile whose share value permission is being saved.
  const [shareChangeSaving, setShareChangeSaving] = useState<string | null>(null);

  const setShareValueChange = async (member: MemberData, allow: boolean) => {
    if (!member.profile_id) return;
    setShareChangeSaving(member.profile_id);
    try {
      const res = await fetch('/api/admin/share-value-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: member.profile_id, allow }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        showToast('error', body?.error ?? 'No se pudo actualizar el permiso.');
        return;
      }
      await fetchMembers();
      showToast(
        'success',
        allow
          ? 'Cambio de valor habilitado. El accionista podrá cambiarlo una vez.'
          : 'Permiso de cambio de valor revocado.',
      );
    } catch (err) {
      console.error('Error actualizando el permiso de cambio de valor:', err);
      showToast('error', 'No se pudo actualizar el permiso.');
    } finally {
      setShareChangeSaving(null);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast('success', 'Copiado al portapapeles');
  };

  const { activeCount, pendingCount, missingShareCount } = useMemo(() => {
    return {
      activeCount: members.filter((m) => m.has_profile && m.share_value)
        .length,
      pendingCount: members.filter((m) => !m.has_profile).length,
      missingShareCount: members.filter(
        (m) => m.has_profile && !m.share_value,
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
                      ) : !member.share_value ? (
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
                              {cop(member.share_value)}
                            </span>
                            <span className="text-[11px] text-[var(--color-text-subtle)]">
                              /acción
                            </span>
                          </div>
                          {/* Cambio del valor de la acción (RN-2.2) */}
                          {member.profile_id && (
                            member.has_share_receipts ? (
                              <span
                                className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-text-subtle)]"
                                title="Ya compró acciones en este periodo"
                              >
                                <Lock size={11} strokeWidth={1.75} />
                                Valor fijo hasta el próximo periodo
                              </span>
                            ) : member.share_value_change_allowed ? (
                              <div className="flex flex-col gap-0.5">
                                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-success)]">
                                  <Unlock size={11} strokeWidth={1.75} />
                                  Cambio de valor habilitado
                                </span>
                                {!soloLectura && <button
                                  type="button"
                                  disabled={shareChangeSaving === member.profile_id}
                                  onClick={() => setShareValueChange(member, false)}
                                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-text-muted)] hover:underline transition-colors w-fit disabled:opacity-60 cursor-pointer"
                                >
                                  {shareChangeSaving === member.profile_id ? 'Guardando…' : 'Revocar permiso'}
                                </button>}
                              </div>
                            ) : soloLectura ? null : (
                              <button
                                type="button"
                                disabled={shareChangeSaving === member.profile_id}
                                onClick={() => setShareValueChange(member, true)}
                                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-brand)] hover:underline transition-colors w-fit disabled:opacity-60 cursor-pointer"
                                title="Permite que el accionista cambie su valor una sola vez"
                              >
                                <Unlock size={11} strokeWidth={1.75} />
                                {shareChangeSaving === member.profile_id ? 'Guardando…' : 'Habilitar cambio de valor'}
                              </button>
                            )
                          )}
                          {/* Capitalización individual */}
                          {member.profile_id && (() => {
                            const w = userCapWindowByUserId.get(member.profile_id);
                            return w ? (
                              <button
                                type="button"
                                disabled={soloLectura}
                                onClick={() => openCapModal(member)}
                                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-success)] enabled:hover:underline transition-colors"
                                title={`Capitalización activa hasta ${w.deadline}`}
                              >
                                <TrendingUp size={11} strokeWidth={1.75} />
                                Cap. activa · {cop(w.used_amount)} / {cop(w.max_amount ?? 0)}
                              </button>
                            ) : soloLectura ? null : (
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
