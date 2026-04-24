'use client';

// Libro de caja — vista admin de todos los recibos.
//
// Muestra la bandeja de recibos de todos los accionistas con filtros por
// estado / accionista / concepto / mes y permite aprobar o rechazar los
// pendientes. El accionista recibirá el cambio de estado al entrar al
// historial (o vía realtime si suscribe).
//
// Seguridad: el acceso real al endpoint está protegido por requireAdmin en
// el backend. Este componente solo chequea el role para evitar flashes de
// UI a un no-admin.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { showToast } from '@/components/ui/Toast';
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  Download,
  Search,
  AlertTriangle,
  X,
  FileSpreadsheet,
  FileDown,
  ArrowUpRight,
  ArrowDownLeft,
  Landmark,
} from 'lucide-react';
import { exportToExcel, exportToPdf, type ExportSection } from '@/lib/exports';
import { getProfileRole, listProfilesWithNames } from '@/lib/data/profiles';
import { listAllReceiptsWithItems } from '@/lib/data/receipts';
import { getCashBalance, getLoansWithDisbursement } from '@/lib/data/loans';
import type { Loan } from '@/types/entities';
import {
  cop,
  conceptLabel,
  formatDateTime,
  monthLabel,
  receiptStatusLabel,
  rejectionReasonLabel,
} from '@/lib/format';
import { listAllMonthsOfYear, getBogotaCurrentMonth } from '@/lib/fines';
import type {
  Receipt,
  ReceiptItem,
  ReceiptStatus,
  ReceiptRejectionReason,
} from '@/types/entities';

// Recibos enriquecidos con los datos del accionista y sus items.
type ReceiptRow = Receipt & {
  items: ReceiptItem[];
  user: {
    id: string;
    first_name: string;
    last_name: string;
    identity_document: string;
  } | null;
};

type StatusFilter = 'all' | ReceiptStatus;

const STATUS_CHIPS: { value: StatusFilter; label: string }[] = [
  { value: 'pending', label: 'Pendientes' },
  { value: 'approved', label: 'Aprobados' },
  { value: 'rejected', label: 'Rechazados' },
  { value: 'all', label: 'Todos' },
];

function statusTone(status: ReceiptStatus): 'warn' | 'success' | 'danger' {
  if (status === 'pending') return 'warn';
  if (status === 'approved') return 'success';
  return 'danger';
}

type ProfileLite = {
  id: string;
  first_name: string;
  last_name: string;
  identity_document: string;
};

export default function LibroCajaPage() {
  const router = useRouter();

  const [role, setRole] = useState<'admin' | 'accionista' | null>(null);
  const [loading, setLoading] = useState(true);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileLite[]>([]);
  const [cashBalance, setCashBalance] = useState<number | null>(null);
  const [disbursements, setDisbursements] = useState<Loan[]>([]);

  // Filtros
  const [status, setStatus] = useState<StatusFilter>('pending');
  const [userFilter, setUserFilter] = useState<string>('all');
  const [conceptFilter, setConceptFilter] = useState<string>('all');
  const [monthFilter, setMonthFilter] = useState<string>('all');
  const [search, setSearch] = useState<string>('');

  // Acciones
  const [actionId, setActionId] = useState<string | null>(null); // receipt.id en vuelo
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  // Modal de rechazo
  const [rejectingFor, setRejectingFor] = useState<ReceiptRow | null>(null);
  const [rejectReason, setRejectReason] =
    useState<ReceiptRejectionReason>('amount_mismatch');
  const [rejectNote, setRejectNote] = useState('');

  const currentYear = Number(getBogotaCurrentMonth().slice(0, 4));
  const monthOptions = useMemo(
    () => listAllMonthsOfYear(currentYear),
    [currentYear],
  );

  const fetchAll = useCallback(async () => {
    try {
      const [rawReceipts, rawProfiles, balance, disbList] = await Promise.all([
        listAllReceiptsWithItems(supabase),
        listProfilesWithNames(supabase),
        getCashBalance(supabase).catch(() => null),
        getLoansWithDisbursement(supabase).catch(() => [] as Loan[]),
      ]);

      const byId = new Map(rawProfiles.map((p) => [p.id, p]));
      const rows: ReceiptRow[] = rawReceipts.map((r) => ({
        ...r,
        items: (r.receipt_items ?? []) as ReceiptItem[],
        user: byId.get(r.user_id) ?? null,
      })) as ReceiptRow[];

      setReceipts(rows);
      setProfiles(rawProfiles);
      setCashBalance(balance);
      setDisbursements(disbList);
    } catch (err) {
      console.error('Error cargando libro de caja:', err);
      showToast('error', 'No se pudo cargar el Libro de caja.');
    }
  }, []);

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

      const userRole = await getProfileRole(supabase, user.id);
      if (cancelled) return;

      if (userRole !== 'admin') {
        router.replace('/dashboard/accionista');
        return;
      }
      setRole(userRole);

      await fetchAll();
      if (!cancelled) setLoading(false);
    })();

    // Realtime: cualquier cambio en receipts o items refresca.
    const ch = supabase
      .channel('libro-caja-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'receipts' },
        () => !cancelled && fetchAll(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'receipt_items' },
        () => !cancelled && fetchAll(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [router, fetchAll]);

  // ===== Filtros =====

  const filtered = useMemo(() => {
    return receipts.filter((r) => {
      if (status !== 'all' && r.status !== status) return false;
      if (userFilter !== 'all' && r.user_id !== userFilter) return false;
      if (conceptFilter !== 'all') {
        if (!r.items.some((it) => it.concept === conceptFilter)) return false;
      }
      if (monthFilter !== 'all') {
        if (!r.items.some((it) => it.target_month === monthFilter)) return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const name = r.user
          ? `${r.user.first_name} ${r.user.last_name}`.toLowerCase()
          : '';
        const doc = r.user?.identity_document ?? '';
        const num = (r.receipt_number ?? '').toLowerCase();
        if (!name.includes(q) && !doc.includes(q) && !num.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [receipts, status, userFilter, conceptFilter, monthFilter, search]);

  const counts = useMemo(() => {
    return {
      pending: receipts.filter((r) => r.status === 'pending').length,
      approved: receipts.filter((r) => r.status === 'approved').length,
      rejected: receipts.filter((r) => r.status === 'rejected').length,
      all: receipts.length,
    };
  }, [receipts]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, r) => {
        acc.count += 1;
        acc.amount += Number(r.total_amount ?? 0);
        return acc;
      },
      { count: 0, amount: 0 },
    );
  }, [filtered]);

  // ===== Acciones =====

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openProof = async (path: string | null) => {
    if (!path) return;
    const { data, error } = await supabase.storage
      .from('payment-proofs')
      .createSignedUrl(path, 60);
    if (error || !data?.signedUrl) {
      showToast('error', 'No se pudo abrir el comprobante.');
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const approve = async (r: ReceiptRow) => {
    setActionId(r.id);
    try {
      const res = await fetch(`/api/receipts/${r.id}/approve`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok) {
        showToast('error', json?.error ?? 'No se pudo aprobar.');
        return;
      }
      showToast('success', `Recibo ${r.receipt_number ?? ''} aprobado.`);
      await fetchAll();
    } catch (err) {
      console.error(err);
      showToast('error', 'Error al aprobar el recibo.');
    } finally {
      setActionId(null);
    }
  };

  const openReject = (r: ReceiptRow) => {
    setRejectingFor(r);
    setRejectReason('amount_mismatch');
    setRejectNote('');
  };

  const cancelReject = () => {
    setRejectingFor(null);
    setRejectNote('');
  };

  const submitReject = async () => {
    if (!rejectingFor) return;
    setActionId(rejectingFor.id);
    try {
      const res = await fetch(`/api/receipts/${rejectingFor.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: rejectReason,
          note: rejectNote.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast('error', json?.error ?? 'No se pudo rechazar.');
        return;
      }
      showToast('info', `Recibo ${rejectingFor.receipt_number ?? ''} rechazado.`);
      setRejectingFor(null);
      setRejectNote('');
      await fetchAll();
    } catch (err) {
      console.error(err);
      showToast('error', 'Error al rechazar el recibo.');
    } finally {
      setActionId(null);
    }
  };

  // ===== Export =====

  const handleExport = async (format: 'xlsx' | 'pdf') => {
    if (filtered.length === 0) return;
    setExporting(true);
    try {
      const receiptsSection: ExportSection = {
        name: 'Recibos',
        title: 'Libro de caja — Recibos',
        columns: [
          { header: 'Número', key: 'number', width: 14 },
          { header: 'Accionista', key: 'name', width: 26 },
          { header: 'Documento', key: 'doc', width: 14 },
          { header: 'Estado', key: 'status', width: 14 },
          { header: 'Enviado', key: 'submitted', width: 22 },
          { header: 'Revisado', key: 'reviewed', width: 22 },
          { header: 'Líneas', key: 'lines', width: 8, align: 'center' },
          { header: 'Total', key: 'total', width: 16, align: 'right' },
          { header: 'Motivo rechazo', key: 'reason', width: 28 },
        ],
        rows: filtered.map((r) => ({
          number: r.receipt_number ?? '—',
          name: r.user
            ? `${r.user.first_name} ${r.user.last_name}`.trim()
            : 'Sin perfil',
          doc: r.user?.identity_document ?? '',
          status: receiptStatusLabel(r.status),
          submitted: formatDateTime(r.submitted_at),
          reviewed: r.reviewed_at ? formatDateTime(r.reviewed_at) : '',
          lines: r.items.length,
          total: cop(Number(r.total_amount)),
          reason:
            r.rejection_reason
              ? rejectionReasonLabel(r.rejection_reason) +
                (r.rejection_note ? ` — ${r.rejection_note}` : '')
              : '',
        })),
        totals: {
          label: 'Total',
          values: {
            total: cop(
              filtered.reduce((s, r) => s + Number(r.total_amount ?? 0), 0),
            ),
          },
        },
      };

      const itemsSection: ExportSection = {
        name: 'Detalle',
        title: 'Detalle por línea',
        columns: [
          { header: 'Recibo', key: 'number', width: 14 },
          { header: 'Accionista', key: 'name', width: 26 },
          { header: 'Estado', key: 'status', width: 14 },
          { header: 'Concepto', key: 'concept', width: 22 },
          { header: 'Mes', key: 'month', width: 18 },
          { header: 'Acciones', key: 'shares', width: 10, align: 'center' },
          { header: 'Valor acción', key: 'unit_value', width: 16, align: 'right' },
          { header: 'Monto', key: 'amount', width: 16, align: 'right' },
          { header: 'Auto', key: 'auto', width: 8, align: 'center' },
        ],
        rows: filtered.flatMap((r) =>
          r.items.map((it) => ({
            number: r.receipt_number ?? '—',
            name: r.user
              ? `${r.user.first_name} ${r.user.last_name}`.trim()
              : 'Sin perfil',
            status: receiptStatusLabel(r.status),
            concept: conceptLabel(it.concept),
            month: monthLabel(it.target_month, true),
            shares: it.share_count ?? '',
            unit_value: it.unit_value ? cop(Number(it.unit_value)) : '',
            amount: cop(Number(it.amount)),
            auto: it.auto_generated ? 'Sí' : 'No',
          })),
        ),
      };

      const filterSummary = [
        status === 'all' ? 'Todos los estados' : receiptStatusLabel(status),
        userFilter !== 'all' ? (() => {
          const p = profiles.find((x) => x.id === userFilter);
          return p ? `${p.first_name} ${p.last_name}` : 'Accionista';
        })() : null,
        conceptFilter !== 'all' ? conceptLabel(conceptFilter) : null,
        monthFilter !== 'all'
          ? monthLabel(monthFilter, true)
          : null,
      ]
        .filter(Boolean)
        .join(' · ');

      const meta = {
        title: 'Libro de caja',
        subtitle: filterSummary || 'Todos los recibos',
      };
      const filename = `libro-caja-${new Date().toISOString().slice(0, 10)}`;

      if (format === 'xlsx') {
        await exportToExcel(filename, meta, [receiptsSection, itemsSection]);
      } else {
        await exportToPdf(filename, meta, [receiptsSection, itemsSection]);
      }
      showToast('success', 'Archivo generado.');
    } catch (err) {
      console.error('Export error:', err);
      showToast('error', 'No se pudo generar el archivo.');
    } finally {
      setExporting(false);
    }
  };

  // ===== Render =====

  if (loading || role !== 'admin') {
    return (
      <div className="animate-pulse text-[var(--color-text-subtle)] text-sm">
        Cargando…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-7 animate-in fade-in duration-300">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-[11px] bg-[var(--color-brand-soft)] text-[var(--color-brand)] flex items-center justify-center">
              <BookOpen size={20} strokeWidth={1.75} />
            </div>
            <div>
              <h1 className="text-[26px] font-semibold tracking-[-0.025em] leading-[1.15]">
                Libro de caja
              </h1>
              <p className="text-sm text-[var(--color-text-muted)] mt-0.5 max-w-xl">
                Revisa y aprueba los recibos enviados por los accionistas.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {cashBalance !== null && (
            <div className="flex items-center gap-1.5 h-8 px-3 rounded-full bg-[var(--color-success-soft)] text-[var(--color-success)] text-[12px] font-semibold">
              <Landmark size={13} strokeWidth={1.75} />
              Saldo en caja: {cop(cashBalance)}
            </div>
          )}
          {counts.pending > 0 && (
            <Badge tone="warn" dot>
              {counts.pending} pendiente{counts.pending === 1 ? '' : 's'}
            </Badge>
          )}
          <Badge tone="neutral">
            {totals.count} recibos · {cop(totals.amount)}
          </Badge>
          <Button
            variant="secondary"
            size="sm"
            disabled={filtered.length === 0 || exporting}
            onClick={() => handleExport('xlsx')}
            title="Exportar resultados a Excel"
          >
            <FileSpreadsheet size={13} strokeWidth={1.75} />
            Excel
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={filtered.length === 0 || exporting}
            onClick={() => handleExport('pdf')}
            title="Exportar resultados a PDF"
          >
            <FileDown size={13} strokeWidth={1.75} />
            PDF
          </Button>
        </div>
      </header>

      {/* Filtros */}
      <Card padding="md">
        <div className="flex flex-col gap-3">
          {/* Chips de estado */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {STATUS_CHIPS.map((s) => {
              const active = status === s.value;
              const count = counts[s.value as keyof typeof counts];
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setStatus(s.value)}
                  className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] font-semibold tracking-tight transition-colors cursor-pointer ${
                    active
                      ? 'bg-[var(--color-brand)] text-white dark:text-[var(--color-brand-ink)]'
                      : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {s.label}
                  <span
                    className={`text-[10px] font-bold ${
                      active
                        ? 'opacity-90'
                        : 'text-[var(--color-text-subtle)]'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Filtros adicionales */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5">
            {/* Búsqueda */}
            <div className="md:col-span-1 flex items-center h-10 px-3 rounded-[9px] bg-[var(--color-surface-alt)] border border-[var(--color-border)]">
              <Search
                size={15}
                strokeWidth={1.75}
                className="text-[var(--color-text-subtle)] mr-2 shrink-0"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre, documento o RC-…"
                className="flex-1 bg-transparent text-[13px] focus:outline-none text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]"
              />
            </div>

            <select
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              className="h-10 rounded-[9px] bg-[var(--color-surface-alt)] border border-[var(--color-border)] px-3 text-[13px] font-medium focus:outline-none focus:border-[var(--color-brand)]"
            >
              <option value="all">Todos los accionistas</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.first_name} {p.last_name}
                </option>
              ))}
            </select>

            <select
              value={conceptFilter}
              onChange={(e) => setConceptFilter(e.target.value)}
              className="h-10 rounded-[9px] bg-[var(--color-surface-alt)] border border-[var(--color-border)] px-3 text-[13px] font-medium focus:outline-none focus:border-[var(--color-brand)]"
            >
              <option value="all">Todos los conceptos</option>
              <option value="acciones">Acciones</option>
              <option value="capitalizacion">Capitalización</option>
              <option value="multa_acciones">Multa por mora</option>
            </select>

            <select
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="h-10 rounded-[9px] bg-[var(--color-surface-alt)] border border-[var(--color-border)] px-3 text-[13px] font-medium focus:outline-none focus:border-[var(--color-brand)]"
            >
              <option value="all">Todos los meses</option>
              {monthOptions.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label} {currentYear}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Lista */}
      {filtered.length === 0 ? (
        <Card padding="lg" className="text-center py-10">
          <div className="mx-auto w-12 h-12 rounded-full bg-[var(--color-surface-alt)] flex items-center justify-center text-[var(--color-text-subtle)] mb-3">
            <BookOpen size={20} strokeWidth={1.5} />
          </div>
          <h2 className="text-[15px] font-semibold tracking-tight">
            No hay recibos con esos filtros
          </h2>
          <p className="text-[13px] text-[var(--color-text-muted)] mt-1">
            Ajusta los filtros para ver más.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((r) => {
            const isExpanded = expanded.has(r.id);
            const tone = statusTone(r.status);
            const fullName = r.user
              ? `${r.user.first_name} ${r.user.last_name}`.trim()
              : 'Sin perfil';

            return (
              <Card key={r.id} padding="none" className="overflow-hidden">
                <div className="flex items-center gap-4 px-5 py-4">
                  <button
                    type="button"
                    onClick={() => toggleExpand(r.id)}
                    className="flex-1 flex items-center gap-3 text-left min-w-0 cursor-pointer"
                  >
                    <Avatar name={r.user?.first_name || '?'} size={36} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[14px] font-semibold tracking-tight truncate">
                          {fullName}
                        </span>
                        <Badge tone={tone} dot>
                          {receiptStatusLabel(r.status)}
                        </Badge>
                      </div>
                      <div className="text-[11px] text-[var(--color-text-subtle)] mt-0.5 truncate">
                        {r.receipt_number ?? '—'} · {formatDateTime(r.submitted_at)}
                        {r.user?.identity_document &&
                          ` · CC ${r.user.identity_document}`}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[15px] font-semibold tabular">
                        {cop(Number(r.total_amount))}
                      </div>
                      <div className="text-[11px] text-[var(--color-text-subtle)]">
                        {r.items.length} {r.items.length === 1 ? 'línea' : 'líneas'}
                      </div>
                    </div>
                  </button>

                  {/* Acciones rápidas en estado pending */}
                  {r.status === 'pending' && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        variant="success"
                        size="sm"
                        disabled={actionId === r.id}
                        onClick={() => approve(r)}
                      >
                        <CheckCircle2 size={14} strokeWidth={2} />
                        Aprobar
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={actionId === r.id}
                        onClick={() => openReject(r)}
                      >
                        <XCircle size={14} strokeWidth={2} />
                        Rechazar
                      </Button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => toggleExpand(r.id)}
                    className="w-8 h-8 rounded-[8px] flex items-center justify-center text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] cursor-pointer shrink-0"
                    aria-label={isExpanded ? 'Contraer' : 'Expandir'}
                  >
                    {isExpanded ? (
                      <ChevronUp size={18} strokeWidth={1.75} />
                    ) : (
                      <ChevronDown size={18} strokeWidth={1.75} />
                    )}
                  </button>
                </div>

                {isExpanded && (
                  <div className="px-5 pb-5 border-t border-[var(--color-border)] bg-[var(--color-surface-alt)]/40">
                    {/* Banner rechazo */}
                    {r.status === 'rejected' && (
                      <div className="mt-4 flex items-start gap-3 p-3.5 rounded-[10px] bg-[var(--color-danger-soft)]/60 border border-[var(--color-danger)]/40">
                        <AlertTriangle
                          size={16}
                          strokeWidth={1.75}
                          className="text-[var(--color-danger)] mt-0.5 shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="text-[13px] font-semibold text-[var(--color-danger)]">
                            Rechazado
                          </div>
                          <div className="text-[12px] text-[var(--color-text)] mt-0.5">
                            {rejectionReasonLabel(r.rejection_reason)}
                          </div>
                          {r.rejection_note && (
                            <div className="text-[12px] text-[var(--color-text-muted)] mt-1 italic">
                              Nota: {r.rejection_note}
                            </div>
                          )}
                          {r.reviewed_at && (
                            <div className="text-[11px] text-[var(--color-text-subtle)] mt-1">
                              Revisado: {formatDateTime(r.reviewed_at)}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {r.status === 'approved' && r.reviewed_at && (
                      <div className="mt-4 flex items-start gap-3 p-3.5 rounded-[10px] bg-[var(--color-success-soft)]/60 border border-[var(--color-success)]/40">
                        <CheckCircle2
                          size={16}
                          strokeWidth={1.75}
                          className="text-[var(--color-success)] mt-0.5 shrink-0"
                        />
                        <div>
                          <div className="text-[13px] font-semibold text-[var(--color-success)]">
                            Aprobado
                          </div>
                          <div className="text-[11px] text-[var(--color-text-subtle)] mt-0.5">
                            {formatDateTime(r.reviewed_at)}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Items */}
                    <div className="mt-4">
                      <div className="text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase mb-2">
                        Detalle
                      </div>
                      <div className="divide-y divide-[var(--color-border)] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)]">
                        {r.items.map((it) => (
                          <div
                            key={it.id}
                            className="flex items-center gap-3 px-3.5 py-2.5 text-[13px]"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-[var(--color-text)]">
                                {conceptLabel(it.concept)}
                                {it.auto_generated && (
                                  <span className="ml-2 text-[10px] font-semibold text-[var(--color-warn)] tracking-wider uppercase">
                                    Auto
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-[var(--color-text-subtle)]">
                                {monthLabel(it.target_month, true)}
                                {it.share_count ? ` · ${it.share_count} acciones` : ''}
                                {it.unit_value
                                  ? ` · ${cop(Number(it.unit_value))} c/u`
                                  : ''}
                              </div>
                            </div>
                            <div className="text-right font-semibold tabular">
                              {cop(Number(it.amount))}
                            </div>
                          </div>
                        ))}
                        <div className="flex items-center gap-3 px-3.5 py-2.5 text-[13px] bg-[var(--color-surface-alt)]">
                          <span className="flex-1 font-semibold text-[var(--color-text)]">
                            Total
                          </span>
                          <span className="font-semibold tabular">
                            {cop(Number(r.total_amount))}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center gap-2 flex-wrap">
                      {r.payment_proof_path && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openProof(r.payment_proof_path)}
                        >
                          <Download size={14} strokeWidth={1.75} />
                          Ver comprobante
                        </Button>
                      )}
                      {r.status === 'pending' && (
                        <>
                          <Button
                            variant="success"
                            size="sm"
                            disabled={actionId === r.id}
                            onClick={() => approve(r)}
                          >
                            <CheckCircle2 size={14} strokeWidth={2} />
                            Aprobar recibo
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={actionId === r.id}
                            onClick={() => openReject(r)}
                          >
                            <XCircle size={14} strokeWidth={2} />
                            Rechazar
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Sección de desembolsos (salidas de caja CE-XXXXX) */}
      {disbursements.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-[8px] bg-[var(--color-danger-soft)] text-[var(--color-danger)] flex items-center justify-center">
              <ArrowDownLeft size={14} strokeWidth={1.75} />
            </div>
            <div>
              <div className="text-[14px] font-semibold tracking-tight">Desembolsos de préstamos</div>
              <div className="text-[11px] text-[var(--color-text-subtle)]">Salidas de caja — consecutivo CE-</div>
            </div>
            <div className="ml-auto text-[13px] font-semibold text-[var(--color-danger)] tabular">
              − {cop(disbursements.reduce((s, d) => s + Number(d.disbursed_amount ?? 0), 0))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {disbursements.map((d) => {
              const borrower = (d as Record<string, unknown>).borrower as Record<string, string> | null;
              const borrowerName = borrower ? `${borrower.first_name} ${borrower.last_name}` : 'Accionista';
              return (
                <div
                  key={d.id}
                  className="flex items-center gap-4 px-5 py-3.5 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]"
                >
                  <div className="w-8 h-8 rounded-full bg-[var(--color-danger-soft)] flex items-center justify-center shrink-0">
                    <ArrowUpRight size={14} strokeWidth={1.75} className="text-[var(--color-danger)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold">{borrowerName}</div>
                    <div className="text-[11px] text-[var(--color-text-subtle)] mt-0.5">
                      {d.disbursement_number} · {d.disbursed_at ? new Date(d.disbursed_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[14px] font-semibold tabular text-[var(--color-danger)]">
                      − {cop(Number(d.disbursed_amount ?? 0))}
                    </div>
                    <div className="text-[11px] text-[var(--color-text-subtle)]">
                      {d.status === 'paid' ? 'Pagado' : 'Activo'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Modal de rechazo */}
      {rejectingFor && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/40 animate-in fade-in duration-150"
          onClick={cancelReject}
        >
          <div
            className="w-full max-w-md bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[14px] shadow-lg-soft p-6 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3 className="text-[16px] font-semibold tracking-tight">
                  Rechazar recibo
                </h3>
                <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">
                  {rejectingFor.receipt_number} ·{' '}
                  {rejectingFor.user
                    ? `${rejectingFor.user.first_name} ${rejectingFor.user.last_name}`
                    : 'Sin nombre'}
                </p>
              </div>
              <button
                type="button"
                onClick={cancelReject}
                className="w-8 h-8 rounded-[8px] flex items-center justify-center text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] cursor-pointer"
                aria-label="Cerrar"
              >
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase">
                  Motivo
                </span>
                <select
                  value={rejectReason}
                  onChange={(e) =>
                    setRejectReason(e.target.value as ReceiptRejectionReason)
                  }
                  className="h-11 rounded-[10px] bg-[var(--color-surface)] border border-[var(--color-border)] px-3 text-[13px] font-medium focus:outline-none focus:border-[var(--color-brand)]"
                >
                  <option value="amount_mismatch">
                    El monto no coincide con la transferencia
                  </option>
                  <option value="payment_not_received">
                    La transferencia no llegó a la cuenta
                  </option>
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase">
                  Nota (opcional)
                </span>
                <textarea
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value.slice(0, 500))}
                  rows={3}
                  placeholder="Agrega detalles que ayuden al accionista a corregir el recibo."
                  className="rounded-[10px] bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2 text-[13px] focus:outline-none focus:border-[var(--color-brand)] resize-none"
                />
                <span className="text-[11px] text-[var(--color-text-subtle)] text-right">
                  {rejectNote.length}/500
                </span>
              </label>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <Button variant="ghost" size="md" onClick={cancelReject}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                size="md"
                disabled={actionId === rejectingFor.id}
                onClick={submitReject}
              >
                <XCircle size={15} strokeWidth={2} />
                {actionId === rejectingFor.id
                  ? 'Rechazando…'
                  : 'Confirmar rechazo'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
