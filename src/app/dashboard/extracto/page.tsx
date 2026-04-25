'use client';

// Extracto del accionista — resumen mensual del año.
//
// Muestra, para cada mes del año seleccionado, cuántas acciones compró
// (aprobadas), en qué estado está cada recibo relacionado y si tiene
// multa acumulada. Sirve como "cartola" comparable a la que entregaban
// manualmente antes del sistema.
//
// Reglas de display:
//   - Los totales "efectivos" (acciones acumuladas, aporte total, multas
//     pagadas) SOLO cuentan recibos aprobados. Pending/rejected aparecen
//     marcados aparte para que el accionista sepa qué le falta.
//   - Si el mes está en mora y el accionista aún no tiene una multa
//     registrada por ese mes (ni en pending/approved), mostramos la
//     multa "en curso" como preview informativo.

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { showToast } from '@/components/ui/Toast';
import {
  ClipboardList,
  TrendingUp,
  Coins,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock,
  XCircle,
  ArrowRight,
  FileSpreadsheet,
  FileDown,
} from 'lucide-react';
import { Landmark } from 'lucide-react';
import { exportToExcel, exportToPdf, type ExportSection } from '@/lib/exports';
import { getProfile } from '@/lib/data/profiles';
import { listReceiptItemsByYear } from '@/lib/data/receipts';
import { getLibroAccionistaData } from '@/lib/data/loans';
import { computeLoanBook, LOAN_STATUS_LABELS } from '@/lib/loans';
import { cop, monthLabel, receiptStatusLabel } from '@/lib/format';
import {
  computeFineForMonth,
  DEFAULT_PURCHASE_RULES,
  getBogotaCurrentMonth,
  getBogotaToday,
  listAllMonthsOfYear,
  type PurchaseRules,
} from '@/lib/fines';
import type { ReceiptStatus } from '@/types/entities';

// Shape que devuelve listReceiptItemsByYear con receipts!inner embebido.
type ItemRow = {
  id: string;
  receipt_id: string;
  concept: string;
  target_month: string;
  share_count: number | null;
  unit_value: number | null;
  amount: number;
  auto_generated: boolean;
  receipts: {
    id: string;
    receipt_number: string | null;
    user_id: string;
    status: ReceiptStatus;
    submitted_at: string;
    reviewed_at: string | null;
  };
};

type MonthSummary = {
  month: string; // 'YYYY-MM-01'
  monthIndex: number;
  label: string;
  approvedShares: number;
  approvedAmount: number; // solo 'acciones' aprobadas
  pendingShares: number;
  pendingAmount: number;
  rejectedShares: number;
  approvedFines: number;
  pendingFines: number;
  projectedFine: number; // multa en curso (si aplica y no existe aún)
  approvedCapitalization: number; // capitalización aprobada (suma al patrimonio)
  pendingCapitalization: number;
  // Recibos que tocaron este mes (target_month = este mes)
  receipts: Array<{
    id: string;
    number: string;
    status: ReceiptStatus;
  }>;
};

type LoanSummaryData = {
  count: number;
  total_requested: number;
  total_paid_capital: number;
  total_paid_interest: number;
  total_interest_debt: number;
  current_capital_balance: number;
  next_installment_amount: number | null;
  next_installment_month: string | null;
  loans: Array<{
    disbursement_number: string | null;
    status: string;
    disbursed_at: string | null;
    requested_amount: number;
    interest_rate: number;
    payment_plan_months: number | null;
    current_capital_balance: number;
    total_interest_debt: number;
  }>;
};

function statusTone(status: ReceiptStatus): 'warn' | 'success' | 'danger' {
  if (status === 'pending') return 'warn';
  if (status === 'approved') return 'success';
  return 'danger';
}

function statusIcon(status: ReceiptStatus) {
  if (status === 'approved') return CheckCircle2;
  if (status === 'pending') return Clock;
  return XCircle;
}

export default function ExtractoPage() {
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [firstName, setFirstName] = useState<string>('');
  const [lastName, setLastName] = useState<string>('');
  const [shareValue, setShareValue] = useState<number | null>(null);
  const [rules, setRules] = useState<PurchaseRules>(DEFAULT_PURCHASE_RULES);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loanSummary, setLoanSummary] = useState<LoanSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  // Año en curso + navegador de año (por si a futuro hay más de uno).
  const currentYear = Number(getBogotaCurrentMonth().slice(0, 4));
  const [year, setYear] = useState<number>(currentYear);

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
      if (cancelled) return;
      setUserId(user.id);

      try {
        const profile = await getProfile(supabase, user.id);
        if (cancelled) return;
        setFirstName(profile.first_name ?? '');
        setLastName(profile.last_name ?? '');
        if (profile.selected_share_value != null) {
          setShareValue(Number(profile.selected_share_value));
        }
      } catch (err) {
        console.error('Error perfil:', err);
      }

      try {
        const { data } = await supabase
          .from('system_settings')
          .select('value')
          .eq('key', 'purchase_rules')
          .maybeSingle();
        if (!cancelled && data?.value) {
          const v = data.value as Partial<PurchaseRules>;
          setRules({
            min_shares_per_month:
              v.min_shares_per_month ?? DEFAULT_PURCHASE_RULES.min_shares_per_month,
            max_shares_per_month:
              v.max_shares_per_month ?? DEFAULT_PURCHASE_RULES.max_shares_per_month,
            fine_per_day: v.fine_per_day ?? DEFAULT_PURCHASE_RULES.fine_per_day,
            fine_max_per_month:
              v.fine_max_per_month ?? DEFAULT_PURCHASE_RULES.fine_max_per_month,
            grace_period_days:
              v.grace_period_days ?? DEFAULT_PURCHASE_RULES.grace_period_days,
          });
        }
      } catch {
        /* defaults */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  // Cada vez que cambie el usuario o el año, releemos los items.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const rows = await listReceiptItemsByYear(supabase, { userId, year });
        if (!cancelled) setItems(rows as unknown as ItemRow[]);
      } catch (err) {
        console.error('Error cargando extracto:', err);
        showToast('error', 'No se pudo cargar el extracto.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, year]);

  // Resumen de préstamos del accionista (no depende del año).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    (async () => {
      try {
        const entries = await getLibroAccionistaData(supabase, userId);
        if (cancelled) return;
        if (entries.length === 0) {
          setLoanSummary(null);
          return;
        }
        const entry = entries[0];
        const books = entry.loans.map((l) => ({
          loan: l.loan,
          book: computeLoanBook({
            requestedAmount: Number(l.loan.requested_amount),
            plan: l.plan,
            payments: l.payments,
          }),
        }));
        const agg = books.reduce(
          (acc, b) => {
            acc.total_requested += b.book.summary.requested_amount;
            acc.total_paid_capital += b.book.summary.total_paid_capital;
            acc.total_paid_interest += b.book.summary.total_paid_interest;
            acc.total_interest_debt += b.book.summary.total_interest_debt;
            acc.current_capital_balance += b.book.summary.current_capital_balance;
            return acc;
          },
          {
            total_requested: 0,
            total_paid_capital: 0,
            total_paid_interest: 0,
            total_interest_debt: 0,
            current_capital_balance: 0,
          },
        );
        // Próxima cuota = la más cercana en el tiempo entre todos los préstamos.
        const nextCandidates = books
          .map((b) => b.book.summary)
          .filter((s) => s.next_installment_month !== null)
          .sort((a, b) =>
            (a.next_installment_month as string).localeCompare(
              b.next_installment_month as string,
            ),
          );
        const nextSummary = nextCandidates[0] ?? null;

        setLoanSummary({
          count: books.length,
          ...agg,
          next_installment_amount: nextSummary?.next_installment_amount ?? null,
          next_installment_month: nextSummary?.next_installment_month ?? null,
          loans: books.map((b) => ({
            disbursement_number: b.loan.disbursement_number,
            status: b.loan.status,
            disbursed_at: b.loan.disbursed_at,
            requested_amount: Number(b.loan.requested_amount),
            interest_rate: Number(b.loan.interest_rate),
            payment_plan_months: b.loan.payment_plan_months,
            current_capital_balance: b.book.summary.current_capital_balance,
            total_interest_debt: b.book.summary.total_interest_debt,
          })),
        });
      } catch (err) {
        console.error('Error cargando resumen de préstamos:', err);
        // Silencioso: la tabla mensual puede renderizar sin esto.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  // ===== Agregaciones por mes =====

  const monthSummaries = useMemo<MonthSummary[]>(() => {
    const months = listAllMonthsOfYear(year);
    const today = getBogotaToday();
    const currentMonth = getBogotaCurrentMonth();
    const currentYearValue = Number(currentMonth.slice(0, 4));

    return months.map((m) => {
      const forMonth = items.filter((it) => it.target_month === m.value);

      let approvedShares = 0;
      let approvedAmount = 0;
      let pendingShares = 0;
      let pendingAmount = 0;
      let rejectedShares = 0;
      let approvedFines = 0;
      let pendingFines = 0;
      let approvedCapitalization = 0;
      let pendingCapitalization = 0;

      // Set para no duplicar referencias al mismo recibo (si tiene varias
      // líneas con el mismo target_month).
      const receiptMap = new Map<
        string,
        { id: string; number: string; status: ReceiptStatus }
      >();

      for (const it of forMonth) {
        const status = it.receipts.status;
        receiptMap.set(it.receipts.id, {
          id: it.receipts.id,
          number: it.receipts.receipt_number ?? '—',
          status,
        });

        if (it.concept === 'acciones') {
          const shares = it.share_count ?? 0;
          const amount = Number(it.amount);
          if (status === 'approved') {
            approvedShares += shares;
            approvedAmount += amount;
          } else if (status === 'pending') {
            pendingShares += shares;
            pendingAmount += amount;
          } else {
            rejectedShares += shares;
          }
        } else if (it.concept === 'multa_acciones') {
          if (status === 'approved') approvedFines += Number(it.amount);
          else if (status === 'pending') pendingFines += Number(it.amount);
        } else if (it.concept === 'capitalizacion') {
          if (status === 'approved')
            approvedCapitalization += Number(it.amount);
          else if (status === 'pending')
            pendingCapitalization += Number(it.amount);
        }
      }

      // Proyección de multa: solo si no existe ya multa en pending/approved
      // y el mes es del año en curso (pasado o presente).
      const hasActiveFine = forMonth.some(
        (it) =>
          it.concept === 'multa_acciones' &&
          (it.receipts.status === 'pending' || it.receipts.status === 'approved'),
      );

      let projectedFine = 0;
      if (!hasActiveFine && year === currentYearValue) {
        projectedFine = computeFineForMonth(m.value, today, rules);
      }

      return {
        month: m.value,
        monthIndex: m.monthIndex,
        label: m.label,
        approvedShares,
        approvedAmount,
        pendingShares,
        pendingAmount,
        rejectedShares,
        approvedFines,
        pendingFines,
        projectedFine,
        approvedCapitalization,
        pendingCapitalization,
        receipts: Array.from(receiptMap.values()),
      };
    });
  }, [items, year, rules]);

  // ===== Totales anuales (solo aprobados cuentan como "real") =====

  const annualTotals = useMemo(() => {
    return monthSummaries.reduce(
      (acc, m) => {
        acc.approvedShares += m.approvedShares;
        acc.approvedAmount += m.approvedAmount;
        acc.approvedFines += m.approvedFines;
        acc.pendingShares += m.pendingShares;
        acc.pendingAmount += m.pendingAmount;
        acc.pendingFines += m.pendingFines;
        acc.projectedFine += m.projectedFine;
        acc.approvedCapitalization += m.approvedCapitalization;
        acc.pendingCapitalization += m.pendingCapitalization;
        return acc;
      },
      {
        approvedShares: 0,
        approvedAmount: 0,
        approvedFines: 0,
        pendingShares: 0,
        pendingAmount: 0,
        pendingFines: 0,
        projectedFine: 0,
        approvedCapitalization: 0,
        pendingCapitalization: 0,
      },
    );
  }, [monthSummaries]);

  const monthsInArrears = useMemo(
    () => monthSummaries.filter((m) => m.projectedFine > 0).length,
    [monthSummaries],
  );

  // ===== Export =====

  const fullName = `${firstName} ${lastName}`.trim() || 'Accionista';

  const handleExport = async (format: 'xlsx' | 'pdf') => {
    setExporting(true);
    try {
      const monthlySection: ExportSection = {
        name: `Extracto ${year}`,
        title: `Movimiento mensual ${year}`,
        columns: [
          { header: 'Mes', key: 'month', width: 14 },
          { header: 'Acciones aprobadas', key: 'approvedShares', width: 12, align: 'center' },
          { header: 'Acciones pendientes', key: 'pendingShares', width: 12, align: 'center' },
          { header: 'Aporte aprobado', key: 'approvedAmount', width: 16, align: 'right' },
          { header: 'Aporte pendiente', key: 'pendingAmount', width: 16, align: 'right' },
          { header: 'Capitalización aprobada', key: 'approvedCapitalization', width: 18, align: 'right' },
          { header: 'Capitalización pendiente', key: 'pendingCapitalization', width: 18, align: 'right' },
          { header: 'Multa aprobada', key: 'approvedFines', width: 16, align: 'right' },
          { header: 'Multa pendiente', key: 'pendingFines', width: 16, align: 'right' },
          { header: 'Multa proyectada', key: 'projectedFine', width: 16, align: 'right' },
          { header: 'Total mes', key: 'total', width: 16, align: 'right' },
          { header: 'Recibos', key: 'receipts', width: 24 },
        ],
        rows: monthSummaries.map((m) => ({
          month: m.label,
          approvedShares: m.approvedShares,
          pendingShares: m.pendingShares,
          approvedAmount: m.approvedAmount > 0 ? cop(m.approvedAmount) : '',
          pendingAmount: m.pendingAmount > 0 ? cop(m.pendingAmount) : '',
          approvedCapitalization:
            m.approvedCapitalization > 0 ? cop(m.approvedCapitalization) : '',
          pendingCapitalization:
            m.pendingCapitalization > 0 ? cop(m.pendingCapitalization) : '',
          approvedFines: m.approvedFines > 0 ? cop(m.approvedFines) : '',
          pendingFines: m.pendingFines > 0 ? cop(m.pendingFines) : '',
          projectedFine: m.projectedFine > 0 ? cop(m.projectedFine) : '',
          total:
            m.approvedAmount + m.approvedCapitalization + m.approvedFines > 0
              ? cop(
                  m.approvedAmount +
                    m.approvedCapitalization +
                    m.approvedFines,
                )
              : '',
          receipts: m.receipts
            .map((r) => `${r.number} (${receiptStatusLabel(r.status)})`)
            .join(', '),
        })),
        totals: {
          label: `Total ${year}`,
          values: {
            approvedShares: annualTotals.approvedShares,
            pendingShares: annualTotals.pendingShares,
            approvedAmount: cop(annualTotals.approvedAmount),
            pendingAmount: cop(annualTotals.pendingAmount),
            approvedCapitalization: cop(annualTotals.approvedCapitalization),
            pendingCapitalization: cop(annualTotals.pendingCapitalization),
            approvedFines: cop(annualTotals.approvedFines),
            pendingFines: cop(annualTotals.pendingFines),
            projectedFine: cop(annualTotals.projectedFine),
            total: cop(
              annualTotals.approvedAmount +
                annualTotals.approvedCapitalization +
                annualTotals.approvedFines,
            ),
          },
        },
      };

      const meta = {
        title: `Extracto ${year}`,
        subtitle:
          fullName + (shareValue != null ? ` · Valor acción ${cop(shareValue)}` : ''),
      };
      const filename = `extracto-${year}`;

      if (format === 'xlsx') {
        await exportToExcel(filename, meta, [monthlySection]);
      } else {
        await exportToPdf(filename, meta, [monthlySection]);
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

  return (
    <div className="flex flex-col gap-7 animate-in fade-in duration-300">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-[11px] bg-[var(--color-brand-soft)] text-[var(--color-brand)] flex items-center justify-center">
              <ClipboardList size={20} strokeWidth={1.75} />
            </div>
            <div>
              <h1 className="text-[26px] font-semibold tracking-[-0.025em] leading-[1.15]">
                Extracto {year}
              </h1>
              <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
                {fullName}
                {shareValue != null ? ` · Valor acción: ${cop(shareValue)}` : ''}
              </p>
            </div>
          </div>
        </div>

        {/* Navegador de año + export placeholder */}
        <div className="flex items-center gap-2 self-start md:self-auto">
          <div className="flex items-center h-10 rounded-[10px] bg-[var(--color-surface-alt)] border border-[var(--color-border)] overflow-hidden">
            <button
              type="button"
              onClick={() => setYear((y) => y - 1)}
              className="w-9 h-full flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] cursor-pointer"
              aria-label="Año anterior"
            >
              <ChevronLeft size={16} strokeWidth={1.75} />
            </button>
            <span className="px-3 text-[13px] font-semibold tabular">{year}</span>
            <button
              type="button"
              onClick={() => setYear((y) => y + 1)}
              disabled={year >= currentYear}
              className="w-9 h-full flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              aria-label="Año siguiente"
            >
              <ChevronRight size={16} strokeWidth={1.75} />
            </button>
          </div>
          <Button
            variant="secondary"
            size="md"
            disabled={exporting}
            onClick={() => handleExport('xlsx')}
            title="Exportar extracto a Excel"
          >
            <FileSpreadsheet size={14} strokeWidth={1.75} />
            Excel
          </Button>
          <Button
            variant="secondary"
            size="md"
            disabled={exporting}
            onClick={() => handleExport('pdf')}
            title="Exportar extracto a PDF"
          >
            <FileDown size={14} strokeWidth={1.75} />
            PDF
          </Button>
        </div>
      </header>

      {/* Tarjetas de resumen anual */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
        <SummaryCard
          icon={TrendingUp}
          tone="brand"
          label="Acciones aprobadas"
          value={`${annualTotals.approvedShares}`}
          hint={
            annualTotals.pendingShares > 0
              ? `+${annualTotals.pendingShares} en revisión`
              : undefined
          }
        />
        <SummaryCard
          icon={Coins}
          tone="success"
          label="Aporte en acciones"
          value={cop(annualTotals.approvedAmount)}
          hint={
            annualTotals.pendingAmount > 0
              ? `${cop(annualTotals.pendingAmount)} pendientes`
              : undefined
          }
        />
        <SummaryCard
          icon={Coins}
          tone="brand"
          label="Aporte capitalizado"
          value={cop(annualTotals.approvedCapitalization)}
          hint={
            annualTotals.pendingCapitalization > 0
              ? `${cop(annualTotals.pendingCapitalization)} en revisión`
              : undefined
          }
        />
        <SummaryCard
          icon={AlertTriangle}
          tone="warn"
          label="Multas pagadas"
          value={cop(annualTotals.approvedFines)}
          hint={
            annualTotals.pendingFines > 0
              ? `${cop(annualTotals.pendingFines)} en revisión`
              : undefined
          }
        />
        <SummaryCard
          icon={AlertTriangle}
          tone="danger"
          label={monthsInArrears === 1 ? 'Mes en mora' : 'Meses en mora'}
          value={`${monthsInArrears}`}
          hint={
            annualTotals.projectedFine > 0
              ? `≈ ${cop(annualTotals.projectedFine)} proyectado`
              : undefined
          }
        />
      </div>

      {/* Tabla mensual */}
      <Card padding="none" className="overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[var(--color-border)] flex items-center justify-between">
          <div>
            <h2 className="text-[14px] font-semibold tracking-tight">
              Detalle mensual
            </h2>
            <p className="text-[11px] text-[var(--color-text-subtle)] mt-0.5">
              Los totales en verde son los que ya cuentan para tu saldo.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-[var(--color-text-subtle)] text-sm animate-pulse">
            Cargando…
          </div>
        ) : (
          <div className="hidden md:block">
            {/* Cabecera tabla */}
            <div className="grid grid-cols-[110px_80px_1fr_1fr_1fr_1fr_1fr] items-center gap-3 px-5 py-2.5 text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]/40">
              <span>Mes</span>
              <span className="text-center">Acciones</span>
              <span className="text-right">Aporte</span>
              <span className="text-right">Capitalización</span>
              <span className="text-right">Multa</span>
              <span className="text-right">Total mes</span>
              <span>Recibos</span>
            </div>
            {monthSummaries.map((m) => (
              <MonthRow key={m.month} row={m} />
            ))}

            {/* Totales */}
            <div className="grid grid-cols-[110px_80px_1fr_1fr_1fr_1fr_1fr] items-center gap-3 px-5 py-3 border-t-2 border-[var(--color-border)] bg-[var(--color-surface-alt)]">
              <span className="text-[12px] font-semibold text-[var(--color-text)]">
                Total año
              </span>
              <span className="text-center text-[13px] font-semibold tabular">
                {annualTotals.approvedShares}
              </span>
              <span className="text-right text-[13px] font-semibold tabular">
                {cop(annualTotals.approvedAmount)}
              </span>
              <span className="text-right text-[13px] font-semibold tabular">
                {cop(annualTotals.approvedCapitalization)}
              </span>
              <span className="text-right text-[13px] font-semibold tabular">
                {cop(annualTotals.approvedFines)}
              </span>
              <span className="text-right text-[13px] font-semibold tabular">
                {cop(
                  annualTotals.approvedAmount +
                    annualTotals.approvedCapitalization +
                    annualTotals.approvedFines,
                )}
              </span>
              <span />
            </div>
          </div>
        )}

        {/* Mobile cards */}
        {!loading && (
          <div className="md:hidden divide-y divide-[var(--color-border)]">
            {monthSummaries.map((m) => (
              <MonthCardMobile key={m.month} row={m} />
            ))}
            <div className="px-5 py-4 bg-[var(--color-surface-alt)] flex items-center justify-between">
              <span className="text-[12px] font-semibold">Total año</span>
              <span className="text-[15px] font-semibold tabular">
                {cop(
                  annualTotals.approvedAmount +
                    annualTotals.approvedCapitalization +
                    annualTotals.approvedFines,
                )}
              </span>
            </div>
          </div>
        )}
      </Card>

      {/* Resumen de préstamos del accionista */}
      {loanSummary && loanSummary.count > 0 && (
        <Card padding="none" className="overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[var(--color-border)] flex items-center gap-3">
            <div className="w-9 h-9 rounded-[10px] bg-[var(--color-brand-soft)] text-[var(--color-brand)] flex items-center justify-center shrink-0">
              <Landmark size={16} strokeWidth={1.75} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-[14px] font-semibold tracking-tight">
                Resumen de préstamos
              </h2>
              <p className="text-[11px] text-[var(--color-text-subtle)] mt-0.5">
                {loanSummary.count} préstamo{loanSummary.count === 1 ? '' : 's'}{' '}
                · Total prestado {cop(loanSummary.total_requested)}
              </p>
            </div>
            {loanSummary.next_installment_amount !== null && (
              <div className="text-right shrink-0">
                <div className="text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase">
                  Próxima cuota
                </div>
                <div className="text-[14px] font-semibold tabular">
                  {cop(loanSummary.next_installment_amount)}
                </div>
                {loanSummary.next_installment_month && (
                  <div className="text-[10px] text-[var(--color-text-subtle)]">
                    {monthLabel(
                      loanSummary.next_installment_month.slice(0, 7),
                      true,
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-5">
            <LoanStat label="Capital pagado" value={cop(loanSummary.total_paid_capital)} tone="success" />
            <LoanStat label="Intereses pagados" value={cop(loanSummary.total_paid_interest)} tone="success" />
            <LoanStat
              label="Intereses en mora"
              value={cop(loanSummary.total_interest_debt)}
              tone={loanSummary.total_interest_debt > 0 ? 'danger' : undefined}
            />
            <LoanStat
              label="Saldo capital"
              value={cop(loanSummary.current_capital_balance)}
              tone="brand"
            />
          </div>

          <div className="border-t border-[var(--color-border)] overflow-x-auto">
            <table className="w-full text-[12px] tabular">
              <thead className="bg-[var(--color-surface-alt)]/60 text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                <tr>
                  <th className="text-left font-semibold px-4 py-2.5">Préstamo</th>
                  <th className="text-left font-semibold px-4 py-2.5">Estado</th>
                  <th className="text-right font-semibold px-4 py-2.5">Monto</th>
                  <th className="text-right font-semibold px-4 py-2.5">Plazo</th>
                  <th className="text-right font-semibold px-4 py-2.5">Saldo capital</th>
                  <th className="text-right font-semibold px-4 py-2.5">Intereses en mora</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {loanSummary.loans.map((l, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2.5 font-medium text-[var(--color-text)]">
                      {l.disbursement_number ?? '—'}
                      {l.disbursed_at && (
                        <div className="text-[10px] text-[var(--color-text-subtle)] mt-0.5">
                          {new Date(l.disbursed_at).toLocaleDateString('es-CO', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-text-muted)]">
                      {LOAN_STATUS_LABELS[l.status] ?? l.status}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[var(--color-text-muted)]">
                      {cop(l.requested_amount)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[var(--color-text-muted)]">
                      {l.payment_plan_months ?? '—'} meses ·{' '}
                      {(l.interest_rate * 100).toFixed(2)}%
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold">
                      {cop(l.current_capital_balance)}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right ${
                        l.total_interest_debt > 0
                          ? 'text-[var(--color-danger)] font-semibold'
                          : 'text-[var(--color-text-subtle)]'
                      }`}
                    >
                      {l.total_interest_debt > 0
                        ? cop(l.total_interest_debt)
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <p className="text-[11px] text-[var(--color-text-subtle)] px-1">
        Solo los recibos aprobados cuentan para el saldo. Los pendientes
        aparecen marcados para que sepas qué está por revisarse y los
        rechazados los puedes corregir desde{' '}
        <button
          type="button"
          onClick={() => router.push('/dashboard/historial')}
          className="underline hover:text-[var(--color-brand)] cursor-pointer"
        >
          Historial
        </button>
        .
      </p>
    </div>
  );
}

function LoanStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'brand' | 'success' | 'danger';
}) {
  const toneClass =
    tone === 'brand'
      ? 'text-[var(--color-brand)]'
      : tone === 'success'
        ? 'text-[var(--color-success)]'
        : tone === 'danger'
          ? 'text-[var(--color-danger)]'
          : 'text-[var(--color-text)]';
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase">
        {label}
      </span>
      <span className={`text-[17px] font-semibold tabular mt-1 ${toneClass}`}>
        {value}
      </span>
    </div>
  );
}

// ===== Subcomponentes =====

function SummaryCard({
  icon: Icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: typeof TrendingUp;
  tone: 'brand' | 'success' | 'warn' | 'danger';
  label: string;
  value: string;
  hint?: string;
}) {
  const toneBg: Record<typeof tone, string> = {
    brand: 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]',
    success: 'bg-[var(--color-success-soft)] text-[var(--color-success)]',
    warn: 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]',
    danger: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
  };
  return (
    <Card padding="md">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div
          className={`w-9 h-9 rounded-[10px] flex items-center justify-center ${toneBg[tone]}`}
        >
          <Icon size={16} strokeWidth={1.75} />
        </div>
      </div>
      <div className="text-[11px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase">
        {label}
      </div>
      <div className="text-[20px] font-semibold tracking-[-0.02em] tabular mt-0.5">
        {value}
      </div>
      {hint && (
        <div className="text-[11px] text-[var(--color-text-muted)] mt-1">
          {hint}
        </div>
      )}
    </Card>
  );
}

function MonthRow({ row }: { row: MonthSummary }) {
  const total =
    row.approvedAmount + row.approvedCapitalization + row.approvedFines;
  const hasPending =
    row.pendingShares > 0 ||
    row.pendingFines > 0 ||
    row.pendingCapitalization > 0;
  const hasActivity =
    row.approvedShares > 0 ||
    row.pendingShares > 0 ||
    row.rejectedShares > 0 ||
    row.approvedFines > 0 ||
    row.pendingFines > 0 ||
    row.approvedCapitalization > 0 ||
    row.pendingCapitalization > 0;

  return (
    <div className="grid grid-cols-[110px_80px_1fr_1fr_1fr_1fr_1fr] items-center gap-3 px-5 py-3 border-b border-[var(--color-border)] text-[13px] hover:bg-[var(--color-surface-alt)]/40 transition-colors">
      <div className="flex flex-col">
        <span className="font-semibold text-[var(--color-text)]">
          {row.label}
        </span>
        {row.projectedFine > 0 && (
          <span className="text-[10px] font-semibold text-[var(--color-danger)] tracking-wide">
            En mora
          </span>
        )}
      </div>

      <div className="text-center font-semibold tabular">
        {row.approvedShares}
        {row.pendingShares > 0 && (
          <span className="ml-1 text-[10px] text-[var(--color-warn)] font-semibold">
            +{row.pendingShares}
          </span>
        )}
      </div>

      <div className="text-right">
        <div
          className={`tabular font-semibold ${
            row.approvedAmount > 0
              ? 'text-[var(--color-success)]'
              : 'text-[var(--color-text-subtle)]'
          }`}
        >
          {row.approvedAmount > 0 ? cop(row.approvedAmount) : '—'}
        </div>
        {row.pendingAmount > 0 && (
          <div className="text-[10px] text-[var(--color-warn)] font-semibold">
            {cop(row.pendingAmount)} en revisión
          </div>
        )}
      </div>

      <div className="text-right">
        <div
          className={`tabular font-semibold ${
            row.approvedCapitalization > 0
              ? 'text-[var(--color-brand)]'
              : 'text-[var(--color-text-subtle)]'
          }`}
        >
          {row.approvedCapitalization > 0
            ? cop(row.approvedCapitalization)
            : '—'}
        </div>
        {row.pendingCapitalization > 0 && (
          <div className="text-[10px] text-[var(--color-warn)] font-semibold">
            {cop(row.pendingCapitalization)} en revisión
          </div>
        )}
      </div>

      <div className="text-right">
        {row.approvedFines > 0 ? (
          <div className="tabular font-semibold text-[var(--color-warn)]">
            {cop(row.approvedFines)}
          </div>
        ) : row.pendingFines > 0 ? (
          <div className="tabular font-semibold text-[var(--color-warn)]">
            {cop(row.pendingFines)}
            <div className="text-[10px] font-semibold">en revisión</div>
          </div>
        ) : row.projectedFine > 0 ? (
          <div className="tabular font-semibold text-[var(--color-danger)]">
            ≈ {cop(row.projectedFine)}
            <div className="text-[10px] font-semibold">proyectada</div>
          </div>
        ) : (
          <span className="text-[var(--color-text-subtle)]">—</span>
        )}
      </div>

      <div className="text-right tabular font-semibold">
        {total > 0 ? cop(total) : '—'}
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        {row.receipts.length === 0 ? (
          <span className="text-[var(--color-text-subtle)] text-[12px]">
            {hasActivity ? '—' : 'Sin movimiento'}
          </span>
        ) : (
          row.receipts.map((r) => {
            const Icon = statusIcon(r.status);
            const tone = statusTone(r.status);
            return (
              <span
                key={r.id}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                  tone === 'success'
                    ? 'bg-[var(--color-success-soft)] text-[var(--color-success)]'
                    : tone === 'warn'
                      ? 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]'
                      : 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]'
                }`}
                title={receiptStatusLabel(r.status)}
              >
                <Icon size={11} strokeWidth={2} />
                {r.number}
              </span>
            );
          })
        )}
        {hasPending && row.receipts.length > 0 && (
          <span className="inline-flex items-center">
            <ArrowRight size={10} strokeWidth={2} className="text-[var(--color-text-subtle)]" />
          </span>
        )}
      </div>
    </div>
  );
}

function MonthCardMobile({ row }: { row: MonthSummary }) {
  const total =
    row.approvedAmount + row.approvedCapitalization + row.approvedFines;
  return (
    <div className="px-5 py-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[14px] font-semibold">{row.label}</span>
        <span className="text-[14px] font-semibold tabular">
          {total > 0 ? cop(total) : '—'}
        </span>
      </div>
      <div className="flex items-center gap-3 text-[12px] text-[var(--color-text-muted)] flex-wrap">
        <span>
          {row.approvedShares} acciones
          {row.pendingShares > 0 && ` (+${row.pendingShares})`}
        </span>
        {row.approvedCapitalization > 0 && (
          <Badge tone="brand">
            Capitaliz. {cop(row.approvedCapitalization)}
          </Badge>
        )}
        {row.approvedFines > 0 && (
          <Badge tone="warn">Multa {cop(row.approvedFines)}</Badge>
        )}
        {row.projectedFine > 0 && (
          <Badge tone="danger">Mora {cop(row.projectedFine)}</Badge>
        )}
      </div>
      {row.receipts.length > 0 && (
        <div className="mt-1.5 flex items-center gap-1 flex-wrap">
          {row.receipts.map((r) => (
            <span
              key={r.id}
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]"
            >
              {r.number}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
