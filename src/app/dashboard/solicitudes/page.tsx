'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { ChevronDown, Download, Filter, Send } from 'lucide-react';
import { RejectionModal } from '@/components/admin/RejectionModal';
import { showToast } from '@/components/ui/Toast';
import {
  listMembershipRequests,
  type MembershipRequestRow,
} from '@/lib/data/membership-requests';

type MembershipRequest = MembershipRequestRow;
type RequestStatus = MembershipRequest['status'];
type FilterKey = RequestStatus | 'all';

const cop = (n: number) => '$ ' + new Intl.NumberFormat('es-CO').format(n);

const TIME_FORMATTER = new Intl.DateTimeFormat('es-CO', {
  day: '2-digit',
  month: 'short',
});

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'hace instantes';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'ayer';
  if (days < 7) return `hace ${days} d`;
  return TIME_FORMATTER.format(new Date(iso));
}

function StatusBadge({ status }: { status: RequestStatus }) {
  if (status === 'pending') return <Badge tone="warn" dot>Pendiente</Badge>;
  if (status === 'approved') return <Badge tone="success" dot>Aprobada</Badge>;
  return <Badge tone="danger" dot>Rechazada</Badge>;
}

export default function SolicitudesPage() {
  const [requests, setRequests] = useState<MembershipRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('pending');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  // Tracking por-fila para el botón "Reenviar correo", así el spinner solo
  // aparece sobre la fila que el admin clickeó, no sobre toda la tabla.
  const [resendingId, setResendingId] = useState<string | null>(null);

  const fetchRequests = async () => {
    try {
      const data = await listMembershipRequests(supabase);
      setRequests(data);
    } catch (err) {
      console.error('Error listando solicitudes:', err);
    }
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      await fetchRequests();
      if (!cancelled) setLoading(false);
    })();

    const channel = supabase
      .channel('membership-requests-admin')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'membership_requests' },
        () => {
          if (!cancelled) fetchRequests();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  const counts = useMemo(() => {
    const acc = { all: requests.length, pending: 0, approved: 0, rejected: 0 };
    for (const r of requests) acc[r.status] += 1;
    return acc;
  }, [requests]);

  const filteredRequests = useMemo(
    () =>
      filter === 'all' ? requests : requests.filter((r) => r.status === filter),
    [filter, requests],
  );

  const handleApprove = async (id: string) => {
    setActionLoading(true);
    try {
      const response = await fetch('/api/solicitudes/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await response.json();
      if (response.ok) {
        setRequests((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status: 'approved' } : r)),
        );
        showToast('success', 'Usuario registrado y correo despachado en segundo plano');
        if (data.warning) console.warn(data.warning);
      } else {
        console.error('API Error:', data.error);
        showToast('error', `Error al aprobar: ${data.error}`);
      }
    } catch (error) {
      console.error('Network Error:', error);
      showToast('error', 'Error de conexión con el servidor.');
    }
    setActionLoading(false);
  };

  const handleRejectClick = (id: string) => {
    setSelectedRequestId(id);
    setIsModalOpen(true);
  };

  const handleResend = async (id: string) => {
    setResendingId(id);
    try {
      const response = await fetch('/api/solicitudes/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await response.json();
      if (response.ok) {
        const kind = data.type === 'approval' ? 'de activación' : 'de rechazo';
        showToast('success', `Correo ${kind} reenviado correctamente`);
      } else {
        console.error('API Error:', data.error);
        showToast('error', `No se pudo reenviar: ${data.error ?? 'error desconocido'}`);
      }
    } catch (error) {
      console.error('Network Error:', error);
      showToast('error', 'Error de conexión con el servidor.');
    }
    setResendingId(null);
  };

  const handleRejectConfirm = async (reason: string) => {
    if (!selectedRequestId) return;
    setActionLoading(true);
    try {
      const response = await fetch('/api/solicitudes/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedRequestId, reason }),
      });
      const data = await response.json();
      if (response.ok) {
        setRequests((prev) =>
          prev.map((r) =>
            r.id === selectedRequestId
              ? { ...r, status: 'rejected', rejection_reason: reason }
              : r,
          ),
        );
        setIsModalOpen(false);
        showToast('success', 'Solicitud rechazada, notificando en segundo plano');
        if (data.warning) console.warn(data.warning);
      } else {
        console.error('API Error:', data.error);
        showToast('error', `Error al rechazar: ${data.error}`);
      }
    } catch (error) {
      console.error('Network Error:', error);
      showToast('error', 'Error de conexión con el servidor.');
    }
    setActionLoading(false);
    setSelectedRequestId(null);
  };

  const tabs: { key: FilterKey; label: string }[] = [
    { key: 'all', label: 'Todas' },
    { key: 'pending', label: 'Pendientes' },
    { key: 'approved', label: 'Aprobadas' },
    { key: 'rejected', label: 'Rechazadas' },
  ];

  const headerSubtitle =
    filter === 'pending'
      ? `${counts.pending} ${counts.pending === 1 ? 'solicitud pendiente' : 'solicitudes pendientes'}`
      : filter === 'approved'
        ? `${counts.approved} aprobadas`
        : filter === 'rejected'
          ? `${counts.rejected} rechazadas`
          : `${counts.all} en total`;

  return (
    <div className="flex flex-col gap-7 animate-in fade-in duration-300">
      {/* Page header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-5">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.025em] leading-[1.15]">
            Solicitudes de ingreso
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1.5">
            Revisa y aprueba nuevos accionistas del fondo.
          </p>
        </div>
        <div className="flex gap-2.5">
          <Button variant="secondary" size="md">
            <Download size={15} strokeWidth={1.75} />
            Exportar
          </Button>
          <Button variant="secondary" size="md">
            <Filter size={15} strokeWidth={1.75} />
            Filtrar
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="inline-flex p-1 gap-0.5 bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-[10px] self-start">
        {tabs.map((tab) => {
          const active = filter === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`px-3.5 py-1.5 rounded-[7px] text-[13px] font-semibold tracking-tight inline-flex items-center gap-2 transition-colors ${
                active
                  ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm-soft'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              {tab.label}
              <span
                className={`text-[11px] px-1.5 py-px rounded-[4px] ${
                  active
                    ? 'bg-[var(--color-surface-alt)] text-[var(--color-text-subtle)]'
                    : 'text-[var(--color-text-subtle)]'
                }`}
              >
                {counts[tab.key]}
              </span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex justify-center p-12">
          <span className="text-[var(--color-text-muted)] font-medium animate-pulse">
            Cargando datos...
          </span>
        </div>
      ) : filteredRequests.length === 0 ? (
        <Card padding="lg" className="text-center">
          <p className="text-sm text-[var(--color-text-muted)] font-medium">
            No se encontraron solicitudes en esta categoría.
          </p>
        </Card>
      ) : (
        <Card padding="none" className="overflow-hidden">
          <div className="px-[22px] py-4 flex items-center justify-between border-b border-[var(--color-border)]">
            <div className="text-sm font-semibold tracking-tight">
              {headerSubtitle}
            </div>
            <div className="hidden sm:flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
              <span>
                Ordenar por:{' '}
                <b className="text-[var(--color-text)] font-semibold">Más recientes</b>
              </span>
              <ChevronDown
                size={13}
                strokeWidth={1.75}
                className="text-[var(--color-text-muted)]"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[var(--color-surface-sunken)] text-[var(--color-text-muted)] text-[11px] uppercase tracking-[0.08em] font-semibold">
                  <th className="px-[22px] py-2.5 font-semibold">Aspirante</th>
                  <th className="px-3 py-2.5 font-semibold">Documento</th>
                  <th className="px-3 py-2.5 font-semibold">Contacto</th>
                  <th className="px-3 py-2.5 font-semibold text-right">
                    Ingreso mensual
                  </th>
                  <th className="px-3 py-2.5 font-semibold">Estado</th>
                  <th className="px-[22px] py-2.5 font-semibold text-right">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRequests.map((req) => {
                  const fullName = `${req.first_name} ${req.last_name}`.trim();
                  return (
                    <tr
                      key={req.id}
                      className="border-t border-[var(--color-border)]"
                    >
                      <td className="px-[22px] py-3.5">
                        <div className="flex items-center gap-3">
                          <Avatar name={req.first_name || '?'} size={34} />
                          <div className="min-w-0">
                            <div className="text-[13px] font-semibold tracking-tight truncate">
                              {fullName}
                            </div>
                            <div className="text-[11px] text-[var(--color-text-subtle)] mt-0.5">
                              {formatRelative(req.created_at)}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3.5 text-[13px] text-[var(--color-text-muted)] tabular-nums whitespace-nowrap">
                        CC {req.identity_document}
                      </td>
                      <td className="px-3 py-3.5 text-xs">
                        <div className="text-[var(--color-text)] truncate max-w-[220px]">
                          {req.email}
                        </div>
                        <div className="text-[var(--color-text-subtle)] mt-0.5">
                          {req.phone}
                        </div>
                      </td>
                      <td className="px-3 py-3.5 text-[13px] font-semibold text-right text-[var(--color-text)] tabular-nums whitespace-nowrap">
                        {cop(req.monthly_income)}
                      </td>
                      <td className="px-3 py-3.5">
                        <StatusBadge status={req.status} />
                      </td>
                      <td className="px-[22px] py-3.5">
                        {req.status === 'pending' ? (
                          <div className="flex gap-1.5 justify-end">
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => handleRejectClick(req.id)}
                              disabled={actionLoading}
                            >
                              Rechazar
                            </Button>
                            <Button
                              variant="success"
                              size="sm"
                              onClick={() => handleApprove(req.id)}
                              disabled={actionLoading}
                            >
                              Aprobar
                            </Button>
                          </div>
                        ) : (
                          <div className="flex justify-end">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleResend(req.id)}
                              disabled={resendingId === req.id}
                              title={
                                req.status === 'approved'
                                  ? 'Reenviar correo de activación con un link nuevo'
                                  : 'Reenviar correo de rechazo'
                              }
                            >
                              <Send size={13} strokeWidth={1.75} />
                              {resendingId === req.id ? 'Enviando...' : 'Reenviar correo'}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-[22px] py-3 border-t border-[var(--color-border)] flex justify-between items-center text-xs text-[var(--color-text-muted)]">
            <span>
              Mostrando {filteredRequests.length} de {requests.length} solicitudes
            </span>
            <div className="hidden sm:flex gap-1.5">
              <span className="px-2.5 py-1 border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] cursor-default">
                ‹
              </span>
              <span className="px-2.5 py-1 border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text)] font-semibold">
                1
              </span>
              <span className="px-2.5 py-1 border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] cursor-default">
                ›
              </span>
            </div>
          </div>
        </Card>
      )}

      <RejectionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConfirm={handleRejectConfirm}
        isLoading={actionLoading}
      />
    </div>
  );
}
