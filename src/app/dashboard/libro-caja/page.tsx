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
  Wallet,
  ArrowUp,
  ArrowDown,
  TrendingUp,
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

// Fila unificada del libro: recibo entrante o desembolso saliente.
// Sirven juntos en un solo feed cronológico, con ícono direccional para
// distinguir el tipo de movimiento.
type Movement =
  | { kind: 'receipt'; id: string; dateIso: string; receipt: ReceiptRow }
  | { kind: 'disbursement'; id: string; dateIso: string; loan: Loan };

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
  // Default: 'all' — el admin pidió ver todos los movimientos al entrar.
  const [status, setStatus] = useState<StatusFilter>('all');
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

  // Auth + carga inicial. Lo separamos del setup de realtime para que el
  // canal de Supabase NO se cancele/recree por identidad cambiante de
  // router o fetchAll — si re-suscribimos seguido, perdemos eventos en el
  // gap entre unsubscribe y subscribe.
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
    return () => {
      cancelled = true;
    };
  }, [router, fetchAll]);

  // Realtime: cualquier cambio en receipts, items o loans (desembolsos)
  // refresca el feed sin que el admin tenga que recargar la página. Deps
  // vacías porque fetchAll es useCallback estable; un único canal vivo
  // mientras el componente esté montado.
  useEffect(() => {
    const ch = supabase
      .channel('libro-caja-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'receipts' },
        () => fetchAll(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'receipt_items' },
        () => fetchAll(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'loans' },
        () => fetchAll(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== Filtros =====

  // Feed unificado: recibos (entradas) + desembolsos (salidas).
  const movements: Movement[] = useMemo(() => {
    const recMoves: Movement[] = receipts.map((r) => ({
      kind: 'receipt',
      id: `r-${r.id}`,
      dateIso: r.submitted_at ?? r.created_at ?? new Date(0).toISOString(),
      receipt: r,
    }));
    const disbMoves: Movement[] = disbursements.map((d) => ({
      kind: 'disbursement',
      id: `d-${d.id}`,
      dateIso: d.disbursed_at ?? new Date(0).toISOString(),
      loan: d,
    }));
    return [...recMoves, ...disbMoves].sort((a, b) =>
      b.dateIso.localeCompare(a.dateIso),
    );
  }, [receipts, disbursements]);

  const filteredMovements: Movement[] = useMemo(() => {
    return movements.filter((m) => {
      if (m.kind === 'receipt') {
        const r = m.receipt;
        if (status !== 'all' && r.status !== status) return false;
        if (userFilter !== 'all' && r.user_id !== userFilter) return false;
        if (conceptFilter !== 'all') {
          if (conceptFilter === 'desembolso') return false;
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
      }
      // kind === 'disbursement' — se comporta como salida ya aprobada.
      const d = m.loan;
      if (status !== 'all' && status !== 'approved') return false;
      if (userFilter !== 'all' && d.user_id !== userFilter) return false;
      if (conceptFilter !== 'all' && conceptFilter !== 'desembolso') return false;
      if (monthFilter !== 'all') {
        const monthStr = d.disbursed_at ? d.disbursed_at.slice(0, 7) : '';
        if (monthStr !== monthFilter) return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const borrower = (d as Record<string, unknown>).borrower as Record<string, string> | null;
        const name = borrower ? `${borrower.first_name} ${borrower.last_name}`.toLowerCase() : '';
        const num = (d.disbursement_number ?? '').toLowerCase();
        if (!name.includes(q) && !num.includes(q)) return false;
      }
      return true;
    });
  }, [movements, status, userFilter, conceptFilter, monthFilter, search]);

  // Subconjunto de recibos visibles — lo usa el export (que es específico de recibos).
  const filteredReceipts = useMemo(
    () =>
      filteredMovements
        .filter((m): m is Extract<Movement, { kind: 'receipt' }> => m.kind === 'receipt')
        .map((m) => m.receipt),
    [filteredMovements],
  );

  const counts = useMemo(() => {
    return {
      pending: receipts.filter((r) => r.status === 'pending').length,
      approved: receipts.filter((r) => r.status === 'approved').length,
      rejected: receipts.filter((r) => r.status === 'rejected').length,
      all: receipts.length,
    };
  }, [receipts]);

  // Stats del mes corriente (zona Bogotá) para el bloque "Saldo en caja".
  // Entradas = recibos aprobados del mes; Salidas = desembolsos del mes;
  // Movimientos = cantidad total de movimientos del mes (recibos
  // aprobados + desembolsos). Usamos solo aprobados/realizados para que
  // el número refleje plata real, no proyecciones.
  //
  // OJO: getBogotaCurrentMonth() devuelve 'YYYY-MM-01' (con día), por eso
  // comparamos sus primeros 7 chars contra los del timestamp.
  const monthStats = useMemo(() => {
    const ym = getBogotaCurrentMonth().slice(0, 7); // 'YYYY-MM'
    let inflow = 0;
    let outflow = 0;
    let count = 0;
    for (const r of receipts) {
      if (r.status !== 'approved') continue;
      const date = (r.reviewed_at ?? r.submitted_at ?? '').slice(0, 7);
      if (date !== ym) continue;
      inflow += Number(r.total_amount ?? 0);
      count += 1;
    }
    for (const d of disbursements) {
      const date = (d.disbursed_at ?? '').slice(0, 7);
      if (date !== ym) continue;
      outflow += Number(d.requested_amount ?? 0);
      count += 1;
    }
    return { inflow, outflow, count };
  }, [receipts, disbursements]);

  // Etiqueta del mes corriente en español ("abril", "mayo", …).
  const currentMonthLabel = useMemo(() => {
    const ym = getBogotaCurrentMonth(); // ya viene como 'YYYY-MM-01'
    return monthLabel(ym).split(' ')[0];
  }, []);

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
    if (filteredReceipts.length === 0) return;
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
        rows: filteredReceipts.map((r) => ({
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
              filteredReceipts.reduce((s, r) => s + Number(r.total_amount ?? 0), 0),
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
        rows: filteredReceipts.flatMap((r) =>
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
                Entradas (recibos) y salidas (desembolsos) de todos los accionistas.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {counts.pending > 0 && (
            <Badge tone="warn" dot>
              {counts.pending} pendiente{counts.pending === 1 ? '' : 's'}
            </Badge>
          )}
          <Button
            variant="secondary"
            size="sm"
            disabled={filteredReceipts.length === 0 || exporting}
            onClick={() => handleExport('xlsx')}
            title="Exportar resultados a Excel"
          >
            <FileSpreadsheet size={13} strokeWidth={1.75} />
            Excel
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={filteredReceipts.length === 0 || exporting}
            onClick={() => handleExport('pdf')}
            title="Exportar resultados a PDF"
          >
            <FileDown size={13} strokeWidth={1.75} />
            PDF
          </Button>
        </div>
      </header>

      {/* Saldo en caja — banner con stats del mes (entradas/salidas/movs).
          En desktop va horizontal con divisores; en mobile se apila en
          dos columnas (saldo arriba, stats abajo) para no romper la
          legibilidad. */}
      {cashBalance !== null && (
        <Card
          padding="lg"
          className="bg-[var(--color-success-soft)]/40 border-[var(--color-success)]/25"
        >
          <div className="flex flex-col md:flex-row md:items-center gap-5 md:gap-6">
            {/* Saldo principal */}
            <div className="flex items-start gap-4 md:flex-1 min-w-0">
              <div className="w-12 h-12 md:w-14 md:h-14 rounded-[14px] bg-[var(--color-success)]/20 text-[var(--color-success)] flex items-center justify-center shrink-0">
                <Wallet size={24} strokeWidth={1.75} />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[10px] font-semibold text-[var(--color-success)] uppercase tracking-[0.14em]">
                  Saldo en caja
                </span>
                <span className="text-[26px] md:text-[32px] font-semibold tracking-[-0.02em] text-[var(--color-success)] tabular leading-[1.1] mt-0.5">
                  {cop(cashBalance)}
                </span>
                <span className="text-[11px] text-[var(--color-text-muted)] mt-1 max-w-[260px]">
                  Disponible tras recibos aprobados y desembolsos.
                </span>
              </div>
            </div>

            {/* Stats del mes */}
            <div className="grid grid-cols-3 md:flex md:items-center md:gap-6 gap-3 md:shrink-0">
              <CashStat
                icon={ArrowUp}
                tone="success"
                label="Entradas"
                value={cop(monthStats.inflow)}
                sub={currentMonthLabel}
              />
              <CashStat
                icon={ArrowDown}
                tone="danger"
                label="Salidas"
                value={cop(monthStats.outflow)}
                sub={currentMonthLabel}
              />
              <CashStat
                icon={TrendingUp}
                tone="neutral"
                label="Movimientos"
                value={String(monthStats.count)}
                sub="este mes"
              />
            </div>
          </div>
        </Card>
      )}

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
              <option value="desembolso">Desembolso de préstamo</option>
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
      {filteredMovements.length === 0 ? (
        <Card padding="lg" className="text-center py-10">
          <div className="mx-auto w-12 h-12 rounded-full bg-[var(--color-surface-alt)] flex items-center justify-center text-[var(--color-text-subtle)] mb-3">
            <BookOpen size={20} strokeWidth={1.5} />
          </div>
          <h2 className="text-[15px] font-semibold tracking-tight">
            No hay movimientos con esos filtros
          </h2>
          <p className="text-[13px] text-[var(--color-text-muted)] mt-1">
            Ajusta los filtros para ver más.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredMovements.map((m) => {
            // ==== Fila de desembolso (salida de caja) ====
            if (m.kind === 'disbursement') {
              const d = m.loan;
              const borrower = (d as Record<string, unknown>).borrower as Record<string, string> | null;
              const borrowerName = borrower
                ? `${borrower.first_name} ${borrower.last_name}`.trim()
                : 'Accionista';
              const dateLabel = d.disbursed_at
                ? new Date(d.disbursed_at).toLocaleDateString('es-CO', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })
                : '—';
              // Desglose contable del CE: el "valor del crédito" es
              // requested_amount; del lado del cash sale (requested - 4x1000 -
              // acciones_prestamo si NO upfront). Las acciones_prestamo
              // descontadas van al accionista como movimiento separado.
              const requested = Number(d.requested_amount ?? 0);
              const sharesAmount = Number(d.loan_shares_amount ?? 0);
              const fpm = Number(d.four_per_thousand ?? 0);
              const upfront = Boolean(d.loan_shares_paid_upfront);
              const disbursedNet = Number(d.disbursed_amount ?? 0);
              const isExpanded = expanded.has(m.id);
              return (
                <Card key={m.id} padding="none" className="overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleExpand(m.id)}
                    className="w-full flex items-center gap-4 px-5 py-4 text-left cursor-pointer hover:bg-[var(--color-surface-alt)]/40 transition-colors"
                  >
                    <div
                      className="w-9 h-9 rounded-full bg-[var(--color-danger-soft)] text-[var(--color-danger)] flex items-center justify-center shrink-0"
                      title="Salida de caja — desembolso"
                    >
                      <ArrowUpRight size={16} strokeWidth={2} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[14px] font-semibold tracking-tight truncate">
                          {borrowerName}
                        </span>
                        <Badge tone="danger" dot>
                          Desembolso
                        </Badge>
                        {d.status === 'paid' && (
                          <Badge tone="success">Pagado</Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--color-text-subtle)] mt-0.5 truncate">
                        {d.disbursement_number ?? '—'} · {dateLabel}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[15px] font-semibold tabular text-[var(--color-danger)]">
                        − {cop(requested)}
                      </div>
                      <div className="text-[11px] text-[var(--color-text-subtle)]">
                        Crédito otorgado
                      </div>
                    </div>
                    <div
                      className="w-8 h-8 rounded-[8px] flex items-center justify-center text-[var(--color-text-subtle)] shrink-0"
                      aria-label={isExpanded ? 'Contraer' : 'Expandir'}
                    >
                      {isExpanded ? (
                        <ChevronUp size={18} strokeWidth={1.75} />
                      ) : (
                        <ChevronDown size={18} strokeWidth={1.75} />
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-5 pb-5 border-t border-[var(--color-border)] bg-[var(--color-surface-alt)]/40">
                      {/* Desglose */}
                      <div className="mt-4">
                        <div className="text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase mb-2">
                          Desglose del desembolso
                        </div>
                        <div className="divide-y divide-[var(--color-border)] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)]">
                          <DisbursementLine
                            label="Crédito otorgado"
                            sub="Valor total del préstamo"
                            amount={requested}
                          />
                          {sharesAmount > 0 && (
                            <DisbursementLine
                              label="Acciones por préstamo"
                              sub={
                                upfront
                                  ? 'Pagadas por adelantado (no se descuentan)'
                                  : 'Descontadas del desembolso · van al accionista'
                              }
                              amount={sharesAmount}
                              negative={!upfront}
                            />
                          )}
                          {fpm > 0 && (
                            <DisbursementLine
                              label="Retención 4×1000"
                              sub="Descontada al desembolso"
                              amount={fpm}
                              negative
                            />
                          )}
                          <div className="flex items-center gap-3 px-3.5 py-3 text-[13px] bg-[var(--color-surface-alt)]">
                            <span className="flex-1 font-semibold text-[var(--color-text)]">
                              Neto entregado al accionista
                            </span>
                            <span className="font-semibold tabular text-[var(--color-danger)]">
                              {cop(disbursedNet)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Comprobante */}
                      {d.disbursement_proof_path && (
                        <div className="mt-4 flex items-center gap-2 flex-wrap">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => openProof(d.disbursement_proof_path)}
                          >
                            <Download size={14} strokeWidth={1.75} />
                            Ver comprobante de transferencia
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              );
            }

            // ==== Fila de recibo (entrada de caja) ====
            const r = m.receipt;
            const isExpanded = expanded.has(r.id);
            const tone = statusTone(r.status);
            const fullName = r.user
              ? `${r.user.first_name} ${r.user.last_name}`.trim()
              : 'Sin perfil';
            // El ícono de entrada solo es "verde" cuando el recibo está aprobado;
            // pendientes y rechazados se pintan neutros para no mentir.
            const inIconTone =
              r.status === 'approved'
                ? 'bg-[var(--color-success-soft)] text-[var(--color-success)]'
                : 'bg-[var(--color-surface-alt)] text-[var(--color-text-subtle)]';

            return (
              <Card key={m.id} padding="none" className="overflow-hidden">
                <div className="flex items-center gap-4 px-5 py-4">
                  <button
                    type="button"
                    onClick={() => toggleExpand(r.id)}
                    className="flex-1 flex items-center gap-3 text-left min-w-0 cursor-pointer"
                  >
                    <div
                      className={`w-9 h-9 rounded-full ${inIconTone} flex items-center justify-center shrink-0`}
                      title="Entrada de caja — recibo"
                    >
                      <ArrowDownLeft size={16} strokeWidth={2} />
                    </div>
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
                      <div
                        className={`text-[15px] font-semibold tabular ${
                          r.status === 'approved'
                            ? 'text-[var(--color-success)]'
                            : r.status === 'rejected'
                              ? 'text-[var(--color-text-subtle)] line-through'
                              : 'text-[var(--color-text)]'
                        }`}
                      >
                        {'+ '}
                        {cop(Number(r.total_amount))}
                      </div>
                      <div className="text-[11px] text-[var(--color-text-subtle)]">
                        {r.items.length} {r.items.length === 1 ? 'línea' : 'líneas'}
                      </div>
                    </div>
                  </button>

                  {/* Acciones rápidas en estado pending — solo desktop. En
                      mobile se accede expandiendo el recibo (los botones
                      grandes ya viven dentro del panel expandido). */}
                  {r.status === 'pending' && (
                    <div className="hidden md:flex items-center gap-1.5 shrink-0">
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
                        {r.items.map((it) => {
                          const itLoanNumber = (
                            it as unknown as {
                              loan?: { disbursement_number: string | null } | null;
                            }
                          ).loan?.disbursement_number;
                          return (
                            <div
                              key={it.id}
                              className="flex items-center gap-3 px-3.5 py-2.5 text-[13px]"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="font-semibold text-[var(--color-text)] flex items-center gap-2 flex-wrap">
                                  {conceptLabel(it.concept)}
                                  {itLoanNumber && (
                                    <span className="text-[10px] font-semibold text-[var(--color-brand)] bg-[var(--color-brand-soft)] px-1.5 py-0.5 rounded uppercase tracking-wider">
                                      {itLoanNumber}
                                    </span>
                                  )}
                                  {it.auto_generated && (
                                    <span className="text-[10px] font-semibold text-[var(--color-warn)] tracking-wider uppercase">
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
                          );
                        })}
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

// Stat compacto del mes para el banner de "Saldo en caja". Renderiza
// icono coloreado + label + valor + subtítulo (mes o "este mes").
function CashStat({
  icon: Icon,
  tone,
  label,
  value,
  sub,
}: {
  icon: typeof ArrowUp;
  tone: 'success' | 'danger' | 'neutral';
  label: string;
  value: string;
  sub: string;
}) {
  const toneClass =
    tone === 'success'
      ? 'bg-[var(--color-success-soft)] text-[var(--color-success)]'
      : tone === 'danger'
        ? 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]'
        : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]';
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <div
        className={`w-9 h-9 rounded-[10px] ${toneClass} flex items-center justify-center shrink-0`}
      >
        <Icon size={15} strokeWidth={2} />
      </div>
      <div className="flex flex-col min-w-0">
        <span className="text-[10px] font-semibold text-[var(--color-text-subtle)] uppercase tracking-[0.12em]">
          {label}
        </span>
        <span className="text-[14px] md:text-[15px] font-semibold tracking-tight tabular truncate">
          {value}
        </span>
        <span className="text-[10.5px] text-[var(--color-text-subtle)] capitalize">
          {sub}
        </span>
      </div>
    </div>
  );
}

// Línea de detalle del desembolso (CE expandido). Pinta el monto en rojo
// cuando representa un descuento de caja, y en neutro cuando es el monto
// bruto del crédito otorgado.
function DisbursementLine({
  label,
  sub,
  amount,
  negative,
}: {
  label: string;
  sub?: string;
  amount: number;
  negative?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5 text-[13px]">
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-[var(--color-text)]">{label}</div>
        {sub && (
          <div className="text-[11px] text-[var(--color-text-subtle)]">
            {sub}
          </div>
        )}
      </div>
      <div
        className={`text-right font-semibold tabular ${
          negative ? 'text-[var(--color-danger)]' : ''
        }`}
      >
        {negative ? '− ' : ''}
        {cop(amount)}
      </div>
    </div>
  );
}
