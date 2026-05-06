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
  FileSpreadsheet,
  FileDown,
} from 'lucide-react';
import { Landmark } from 'lucide-react';
import { exportToExcel, exportToPdf, type ExportSection } from '@/lib/exports';
import { getProfile } from '@/lib/data/profiles';
import { listReceiptItemsByYear } from '@/lib/data/receipts';
import {
  getLibroAccionistaData,
  getMyUtilitiesByYear,
  getUserUtilitiesByYear,
  type MonthlyUtility,
} from '@/lib/data/loans';
import { computeLoanBook, LOAN_STATUS_LABELS } from '@/lib/loans';
import { cop, monthLabel } from '@/lib/format';
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
  // === APORTES ===
  // Acciones ordinarias (concept = 'acciones').
  approvedShares: number;
  approvedAmount: number;
  pendingShares: number;
  pendingAmount: number;
  rejectedShares: number;
  // Acciones por préstamo (concept = 'acciones_prestamo').
  approvedLoanShares: number;
  approvedLoanShareAmount: number;
  pendingLoanShares: number;
  pendingLoanShareAmount: number;
  // Multas (concept = 'multa_acciones').
  approvedFines: number;
  pendingFines: number;
  projectedFine: number;
  // Capitalización (concept = 'capitalizacion').
  approvedCapitalization: number;
  pendingCapitalization: number;

  // === PRÉSTAMOS ===
  // Monto desembolsado al accionista en este mes (suma de loans con
  // disbursed_at en este mes calendario).
  disbursedAmount: number;
  // Pagos a capital y a intereses con target_month = este mes (de
  // recibos aprobados).
  paidCapital: number;
  paidInterest: number;

  // === UTILIDADES ===
  // % de participación del accionista al cierre del mes (0..1).
  participation: number;
  // Pool total de intereses pagados por TODOS con target_month = mes.
  utilitiesPool: number;
  // Lo que le corresponde a este accionista (= participation * pool).
  distribution: number;
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
    total_paid_capital: number;
    total_paid_interest: number;
  }>;
};

// Movimientos mensuales asociados a préstamos: el accionista los ve en
// el detalle del extracto (sección "Préstamos").
type LoanMonthlyMap = {
  // 'YYYY-MM' → monto desembolsado en ese mes (suma de loans con
  // disbursed_at en ese mes).
  disbursedByMonth: Map<string, number>;
  // 'YYYY-MM' → suma de pagos a capital con target_month en ese mes,
  // SOLO de recibos aprobados.
  paidCapitalByMonth: Map<string, number>;
  // Idem para pagos a intereses.
  paidInterestByMonth: Map<string, number>;
};


// Tipos del componente reusable. Cuando `targetUserId` está presente, el
// viewer es admin y vemos el extracto de otro accionista. Cuando no
// está, usamos el accionista autenticado.
export type ExtractoViewProps = {
  targetUserId?: string;
};

export default function ExtractoPage(props: ExtractoViewProps = {}) {
  return <ExtractoView {...props} />;
}

export function ExtractoView({ targetUserId }: ExtractoViewProps = {}) {
  const router = useRouter();
  const isAdminView = !!targetUserId;

  const [userId, setUserId] = useState<string | null>(null);
  const [firstName, setFirstName] = useState<string>('');
  const [lastName, setLastName] = useState<string>('');
  const [shareValue, setShareValue] = useState<number | null>(null);
  const [rules, setRules] = useState<PurchaseRules>(DEFAULT_PURCHASE_RULES);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loanSummary, setLoanSummary] = useState<LoanSummaryData | null>(null);
  const [loanMonthly, setLoanMonthly] = useState<LoanMonthlyMap>({
    disbursedByMonth: new Map(),
    paidCapitalByMonth: new Map(),
    paidInterestByMonth: new Map(),
  });
  // Utilidades por mes del año seleccionado.
  const [utilities, setUtilities] = useState<MonthlyUtility[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  // Año en curso + navegador de año (por si a futuro hay más de uno).
  const currentYear = Number(getBogotaCurrentMonth().slice(0, 4));
  const [year, setYear] = useState<number>(currentYear);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Si vienen como admin viendo a otro accionista, NO redirigimos por
      // auth (la página admin ya valida acceso) — solo usamos targetUserId.
      let effectiveUserId: string | null = targetUserId ?? null;
      if (!effectiveUserId) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          router.replace('/login');
          return;
        }
        effectiveUserId = user.id;
      }
      if (cancelled) return;
      setUserId(effectiveUserId);

      try {
        const profile = await getProfile(supabase, effectiveUserId);
        if (cancelled) return;
        setFirstName(profile.first_name ?? '');
        setLastName(profile.last_name ?? '');
        if (profile.selected_share_value != null) {
          setShareValue(Number(profile.selected_share_value));
        } else {
          setShareValue(null);
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
  }, [router, targetUserId]);

  // Cada vez que cambie el usuario o el año, releemos los items.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const utilitiesPromise = isAdminView
          ? getUserUtilitiesByYear(supabase, userId, year).catch((err) => {
              console.error('Error cargando utilidades:', err);
              return [] as MonthlyUtility[];
            })
          : getMyUtilitiesByYear(supabase, year).catch((err) => {
              console.error('Error cargando utilidades:', err);
              return [] as MonthlyUtility[];
            });
        const [rows, utilitiesRows] = await Promise.all([
          listReceiptItemsByYear(supabase, { userId, year }),
          utilitiesPromise,
        ]);
        if (!cancelled) {
          setItems(rows as unknown as ItemRow[]);
          setUtilities(utilitiesRows);
        }
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
  }, [userId, year, isAdminView]);

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
            total_paid_capital: b.book.summary.total_paid_capital,
            total_paid_interest: b.book.summary.total_paid_interest,
          })),
        });

        // Mapas mensuales para el detalle del extracto.
        const disbursedByMonth = new Map<string, number>();
        const paidCapitalByMonth = new Map<string, number>();
        const paidInterestByMonth = new Map<string, number>();
        for (const l of entry.loans) {
          if (l.loan.disbursed_at) {
            const key = l.loan.disbursed_at.slice(0, 7);
            disbursedByMonth.set(
              key,
              (disbursedByMonth.get(key) ?? 0) +
                Number(l.loan.requested_amount),
            );
          }
          for (const p of l.payments) {
            const key = p.target_month.slice(0, 7);
            if (p.concept === 'pago_capital') {
              paidCapitalByMonth.set(
                key,
                (paidCapitalByMonth.get(key) ?? 0) + Number(p.amount),
              );
            } else if (p.concept === 'pago_intereses') {
              paidInterestByMonth.set(
                key,
                (paidInterestByMonth.get(key) ?? 0) + Number(p.amount),
              );
            }
          }
        }
        setLoanMonthly({
          disbursedByMonth,
          paidCapitalByMonth,
          paidInterestByMonth,
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
      const monthKey = m.value.slice(0, 7);

      // Aportes — acciones ordinarias.
      let approvedShares = 0;
      let approvedAmount = 0;
      let pendingShares = 0;
      let pendingAmount = 0;
      let rejectedShares = 0;
      // Aportes — acciones por préstamo (separadas de las ordinarias).
      let approvedLoanShares = 0;
      let approvedLoanShareAmount = 0;
      let pendingLoanShares = 0;
      let pendingLoanShareAmount = 0;
      // Multas + capitalización.
      let approvedFines = 0;
      let pendingFines = 0;
      let approvedCapitalization = 0;
      let pendingCapitalization = 0;

      for (const it of forMonth) {
        const status = it.receipts.status;

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
        } else if (it.concept === 'acciones_prestamo') {
          const shares = it.share_count ?? 0;
          const amount = Number(it.amount);
          if (status === 'approved') {
            approvedLoanShares += shares;
            approvedLoanShareAmount += amount;
          } else if (status === 'pending') {
            pendingLoanShares += shares;
            pendingLoanShareAmount += amount;
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

      // Préstamos del mes (vienen de loanMonthly).
      const disbursedAmount = loanMonthly.disbursedByMonth.get(monthKey) ?? 0;
      const paidCapital = loanMonthly.paidCapitalByMonth.get(monthKey) ?? 0;
      const paidInterest = loanMonthly.paidInterestByMonth.get(monthKey) ?? 0;

      // Utilidades del mes (RPC). monthIndex en listAllMonthsOfYear ya
      // viene 1-12 (no 0-11), igual que el month_number que devuelve el
      // RPC — match directo, sin +1.
      const util = utilities.find((u) => u.month_number === m.monthIndex);
      const participation = util?.participation ?? 0;
      const utilitiesPool = util?.utilities_pool ?? 0;
      const distribution = util?.distribution ?? 0;

      return {
        month: m.value,
        monthIndex: m.monthIndex,
        label: m.label,
        approvedShares,
        approvedAmount,
        pendingShares,
        pendingAmount,
        rejectedShares,
        approvedLoanShares,
        approvedLoanShareAmount,
        pendingLoanShares,
        pendingLoanShareAmount,
        approvedFines,
        pendingFines,
        projectedFine,
        approvedCapitalization,
        pendingCapitalization,
        disbursedAmount,
        paidCapital,
        paidInterest,
        participation,
        utilitiesPool,
        distribution,
      };
    });
  }, [items, year, rules, loanMonthly, utilities]);

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
        acc.approvedLoanShares += m.approvedLoanShares;
        acc.approvedLoanShareAmount += m.approvedLoanShareAmount;
        acc.disbursedAmount += m.disbursedAmount;
        acc.paidCapital += m.paidCapital;
        acc.paidInterest += m.paidInterest;
        acc.utilitiesPool += m.utilitiesPool;
        acc.distribution += m.distribution;
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
        approvedLoanShares: 0,
        approvedLoanShareAmount: 0,
        disbursedAmount: 0,
        paidCapital: 0,
        paidInterest: 0,
        utilitiesPool: 0,
        distribution: 0,
      },
    );
  }, [monthSummaries]);

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
          { header: 'N° acciones', key: 'shares', width: 10, align: 'center' },
          { header: 'Valor acciones', key: 'sharesAmount', width: 16, align: 'right' },
          { header: 'Multas', key: 'fines', width: 14, align: 'right' },
          { header: 'N° acc. préstamo', key: 'loanShares', width: 12, align: 'center' },
          { header: 'Valor acc. préstamo', key: 'loanShareAmount', width: 18, align: 'right' },
          { header: 'Capitalización', key: 'cap', width: 16, align: 'right' },
          { header: 'Préstamo', key: 'disbursed', width: 16, align: 'right' },
          { header: 'Pago capital', key: 'paidCapital', width: 16, align: 'right' },
          { header: 'Pago intereses', key: 'paidInterest', width: 16, align: 'right' },
          { header: '% participación', key: 'participation', width: 14, align: 'right' },
          { header: 'Util. mes', key: 'utilitiesPool', width: 16, align: 'right' },
          { header: 'Distribución', key: 'distribution', width: 16, align: 'right' },
        ],
        rows: monthSummaries.map((m) => ({
          month: m.label,
          shares: m.approvedShares || '',
          sharesAmount: m.approvedAmount > 0 ? cop(m.approvedAmount) : '',
          fines: m.approvedFines > 0 ? cop(m.approvedFines) : '',
          loanShares: m.approvedLoanShares || '',
          loanShareAmount:
            m.approvedLoanShareAmount > 0
              ? cop(m.approvedLoanShareAmount)
              : '',
          cap: m.approvedCapitalization > 0 ? cop(m.approvedCapitalization) : '',
          disbursed: m.disbursedAmount > 0 ? cop(m.disbursedAmount) : '',
          paidCapital: m.paidCapital > 0 ? cop(m.paidCapital) : '',
          paidInterest: m.paidInterest > 0 ? cop(m.paidInterest) : '',
          participation:
            m.participation > 0
              ? `${(m.participation * 100).toFixed(2)}%`
              : '',
          utilitiesPool:
            m.utilitiesPool > 0 ? cop(m.utilitiesPool) : '',
          distribution: m.distribution > 0 ? cop(m.distribution) : '',
        })),
        totals: {
          label: `Total ${year}`,
          values: {
            shares: annualTotals.approvedShares,
            sharesAmount: cop(annualTotals.approvedAmount),
            fines: cop(annualTotals.approvedFines),
            loanShares: annualTotals.approvedLoanShares,
            loanShareAmount: cop(annualTotals.approvedLoanShareAmount),
            cap: cop(annualTotals.approvedCapitalization),
            disbursed: cop(annualTotals.disbursedAmount),
            paidCapital: cop(annualTotals.paidCapital),
            paidInterest: cop(annualTotals.paidInterest),
            utilitiesPool: cop(annualTotals.utilitiesPool),
            distribution: cop(annualTotals.distribution),
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

      {/* Tarjetas de resumen anual — los 5 totales que el accionista
          quiere ver de un vistazo. */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
        {/* 1. Acciones — valor total como número principal, count como hint
            (ordinarias + por préstamo). */}
        <SummaryCard
          icon={TrendingUp}
          tone="brand"
          label="Acciones"
          value={cop(
            annualTotals.approvedAmount + annualTotals.approvedLoanShareAmount,
          )}
          hint={
            (() => {
              const totalShares =
                annualTotals.approvedShares + annualTotals.approvedLoanShares;
              return totalShares > 0
                ? `${totalShares} ${totalShares === 1 ? 'acción' : 'acciones'}`
                : undefined;
            })()
          }
        />

        {/* 2. Capitalizaciones */}
        <SummaryCard
          icon={Coins}
          tone="brand"
          label="Capitalizaciones"
          value={cop(annualTotals.approvedCapitalization)}
          hint={
            annualTotals.pendingCapitalization > 0
              ? `${cop(annualTotals.pendingCapitalization)} en revisión`
              : undefined
          }
        />

        {/* 3. Multas pagadas — con la proyección del año si hay mes en mora */}
        <SummaryCard
          icon={AlertTriangle}
          tone="warn"
          label="Multas pagadas"
          value={cop(annualTotals.approvedFines)}
          hint={
            annualTotals.projectedFine > 0
              ? `≈ ${cop(annualTotals.projectedFine)} proyectada`
              : annualTotals.pendingFines > 0
                ? `${cop(annualTotals.pendingFines)} en revisión`
                : undefined
          }
        />

        {/* 4. Préstamos — total desembolsado en el año */}
        <SummaryCard
          icon={Landmark}
          tone="success"
          label="Préstamos"
          value={cop(annualTotals.disbursedAmount)}
          hint={
            loanSummary && loanSummary.current_capital_balance > 0
              ? `Saldo: ${cop(loanSummary.current_capital_balance)}`
              : undefined
          }
        />

        {/* 5. Distribución de utilidades — suma anual de lo que le
            corresponde al accionista del pool de intereses cobrados. */}
        <SummaryCard
          icon={TrendingUp}
          tone="brand"
          label="Distribución"
          value={cop(annualTotals.distribution)}
          hint={
            annualTotals.utilitiesPool > 0
              ? `Pool anual ${cop(annualTotals.utilitiesPool)}`
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
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-[12px] tabular border-collapse">
              <thead>
                {/* Fila de secciones agrupadas */}
                <tr className="bg-[var(--color-surface-alt)]/60 text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                  <th
                    rowSpan={2}
                    className="text-left font-semibold px-3 py-2 align-middle border-b border-[var(--color-border)]"
                  >
                    Mes
                  </th>
                  <th
                    colSpan={6}
                    className="text-center font-semibold px-3 py-1.5 border-b border-l border-[var(--color-border)] bg-[var(--color-info-soft)]/40 text-[var(--color-info)]"
                  >
                    Aportes
                  </th>
                  <th
                    colSpan={3}
                    className="text-center font-semibold px-3 py-1.5 border-b border-l border-[var(--color-border)] bg-[var(--color-warn-soft)]/40 text-[var(--color-warn)]"
                  >
                    Préstamos
                  </th>
                  <th
                    colSpan={3}
                    className="text-center font-semibold px-3 py-1.5 border-b border-l border-[var(--color-border)] bg-[var(--color-brand-soft)]/40 text-[var(--color-brand)]"
                  >
                    Utilidades
                  </th>
                </tr>
                {/* Sub-encabezado por columna */}
                <tr className="bg-[var(--color-surface-alt)]/40 text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                  {/* Aportes */}
                  <th className="text-center font-semibold px-3 py-2 border-b border-l border-[var(--color-border)]">
                    N° acciones
                  </th>
                  <th className="text-right font-semibold px-3 py-2 border-b border-[var(--color-border)]">
                    Valor acciones
                  </th>
                  <th className="text-right font-semibold px-3 py-2 border-b border-[var(--color-border)]">
                    Multas
                  </th>
                  <th className="text-center font-semibold px-3 py-2 border-b border-[var(--color-border)]">
                    N° acc. préstamo
                  </th>
                  <th className="text-right font-semibold px-3 py-2 border-b border-[var(--color-border)]">
                    Valor acc. préstamo
                  </th>
                  <th className="text-right font-semibold px-3 py-2 border-b border-[var(--color-border)]">
                    Capitalización
                  </th>
                  {/* Préstamos */}
                  <th className="text-right font-semibold px-3 py-2 border-b border-l border-[var(--color-border)]">
                    Préstamo
                  </th>
                  <th className="text-right font-semibold px-3 py-2 border-b border-[var(--color-border)]">
                    Pago capital
                  </th>
                  <th className="text-right font-semibold px-3 py-2 border-b border-[var(--color-border)]">
                    Pago intereses
                  </th>
                  {/* Utilidades */}
                  <th className="text-right font-semibold px-3 py-2 border-b border-l border-[var(--color-border)]">
                    % part.
                  </th>
                  <th className="text-right font-semibold px-3 py-2 border-b border-[var(--color-border)]">
                    Util. mes
                  </th>
                  <th className="text-right font-semibold px-3 py-2 border-b border-[var(--color-border)]">
                    Distribución
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {monthSummaries.map((m) => (
                  <MonthRow key={m.month} row={m} />
                ))}
              </tbody>
              <tfoot className="bg-[var(--color-surface-alt)] text-[12px] font-semibold">
                <tr>
                  <td className="px-3 py-2.5 border-t-2 border-[var(--color-border)]">
                    Total año
                  </td>
                  <td className="text-center px-3 py-2.5 border-t-2 border-l border-[var(--color-border)] tabular">
                    {annualTotals.approvedShares}
                  </td>
                  <td className="text-right px-3 py-2.5 border-t-2 border-[var(--color-border)] tabular">
                    {cop(annualTotals.approvedAmount)}
                  </td>
                  <td className="text-right px-3 py-2.5 border-t-2 border-[var(--color-border)] tabular text-[var(--color-warn)]">
                    {annualTotals.approvedFines > 0
                      ? cop(annualTotals.approvedFines)
                      : '—'}
                  </td>
                  <td className="text-center px-3 py-2.5 border-t-2 border-[var(--color-border)] tabular">
                    {annualTotals.approvedLoanShares}
                  </td>
                  <td className="text-right px-3 py-2.5 border-t-2 border-[var(--color-border)] tabular">
                    {annualTotals.approvedLoanShareAmount > 0
                      ? cop(annualTotals.approvedLoanShareAmount)
                      : '—'}
                  </td>
                  <td className="text-right px-3 py-2.5 border-t-2 border-[var(--color-border)] tabular text-[var(--color-brand)]">
                    {annualTotals.approvedCapitalization > 0
                      ? cop(annualTotals.approvedCapitalization)
                      : '—'}
                  </td>
                  <td className="text-right px-3 py-2.5 border-t-2 border-l border-[var(--color-border)] tabular">
                    {annualTotals.disbursedAmount > 0
                      ? cop(annualTotals.disbursedAmount)
                      : '—'}
                  </td>
                  <td className="text-right px-3 py-2.5 border-t-2 border-[var(--color-border)] tabular text-[var(--color-success)]">
                    {annualTotals.paidCapital > 0
                      ? cop(annualTotals.paidCapital)
                      : '—'}
                  </td>
                  <td className="text-right px-3 py-2.5 border-t-2 border-[var(--color-border)] tabular text-[var(--color-success)]">
                    {annualTotals.paidInterest > 0
                      ? cop(annualTotals.paidInterest)
                      : '—'}
                  </td>
                  <td className="text-right px-3 py-2.5 border-t-2 border-l border-[var(--color-border)] text-[var(--color-text-subtle)]">
                    —
                  </td>
                  <td className="text-right px-3 py-2.5 border-t-2 border-[var(--color-border)] tabular text-[var(--color-text-muted)]">
                    {annualTotals.utilitiesPool > 0
                      ? cop(annualTotals.utilitiesPool)
                      : '—'}
                  </td>
                  <td className="text-right px-3 py-2.5 border-t-2 border-[var(--color-border)] tabular text-[var(--color-brand)]">
                    {annualTotals.distribution > 0
                      ? cop(annualTotals.distribution)
                      : '—'}
                  </td>
                </tr>
              </tfoot>
            </table>
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
                  <th className="text-right font-semibold px-4 py-2.5">Capital pagado</th>
                  <th className="text-right font-semibold px-4 py-2.5">Intereses pagados</th>
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
                    <td
                      className={`px-4 py-2.5 text-right ${
                        l.total_paid_capital > 0
                          ? 'text-[var(--color-success)] font-semibold'
                          : 'text-[var(--color-text-subtle)]'
                      }`}
                    >
                      {l.total_paid_capital > 0
                        ? cop(l.total_paid_capital)
                        : '—'}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right ${
                        l.total_paid_interest > 0
                          ? 'text-[var(--color-success)] font-semibold'
                          : 'text-[var(--color-text-subtle)]'
                      }`}
                    >
                      {l.total_paid_interest > 0
                        ? cop(l.total_paid_interest)
                        : '—'}
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
  // Helper para mostrar pendientes en revisión bajo el valor aprobado.
  const cell = (approved: number, pending: number, fmt: (n: number) => string, tone?: string) => (
    <>
      <div className={`tabular font-medium ${approved > 0 ? tone ?? '' : 'text-[var(--color-text-subtle)]'}`}>
        {approved > 0 ? fmt(approved) : '—'}
      </div>
      {pending > 0 && (
        <div className="text-[10px] text-[var(--color-warn)] font-semibold">
          +{fmt(pending)} en rev.
        </div>
      )}
    </>
  );

  // Multas: si no hay aprobada/pendiente y el mes está en mora, mostramos
  // proyección en rojo.
  const finesCell = () => {
    if (row.approvedFines > 0)
      return (
        <div className="tabular font-medium text-[var(--color-warn)]">
          {cop(row.approvedFines)}
        </div>
      );
    if (row.pendingFines > 0)
      return (
        <div className="tabular font-medium text-[var(--color-warn)]">
          {cop(row.pendingFines)}
          <div className="text-[10px] font-semibold">en rev.</div>
        </div>
      );
    if (row.projectedFine > 0)
      return (
        <div className="tabular font-medium text-[var(--color-danger)]">
          ≈ {cop(row.projectedFine)}
          <div className="text-[10px] font-semibold">proyectada</div>
        </div>
      );
    return <span className="text-[var(--color-text-subtle)]">—</span>;
  };

  return (
    <tr className="hover:bg-[var(--color-surface-alt)]/40 transition-colors">
      <td className="px-3 py-2.5 align-top">
        <div className="font-semibold text-[var(--color-text)]">
          {row.label}
        </div>
        {row.projectedFine > 0 && (
          <div className="text-[10px] font-semibold text-[var(--color-danger)] tracking-wide">
            En mora
          </div>
        )}
      </td>

      {/* Aportes — N° acciones */}
      <td className="text-center px-3 py-2.5 align-top tabular font-medium">
        {row.approvedShares > 0 ? row.approvedShares : '—'}
        {row.pendingShares > 0 && (
          <div className="text-[10px] text-[var(--color-warn)] font-semibold">
            +{row.pendingShares} en rev.
          </div>
        )}
      </td>
      {/* Aportes — Valor acciones */}
      <td className="text-right px-3 py-2.5 align-top">
        {cell(row.approvedAmount, row.pendingAmount, cop, 'text-[var(--color-success)]')}
      </td>
      {/* Aportes — Multas */}
      <td className="text-right px-3 py-2.5 align-top">{finesCell()}</td>
      {/* Aportes — N° acciones por préstamo */}
      <td className="text-center px-3 py-2.5 align-top tabular font-medium">
        {row.approvedLoanShares > 0 ? row.approvedLoanShares : '—'}
        {row.pendingLoanShares > 0 && (
          <div className="text-[10px] text-[var(--color-warn)] font-semibold">
            +{row.pendingLoanShares} en rev.
          </div>
        )}
      </td>
      {/* Aportes — Valor acciones por préstamo */}
      <td className="text-right px-3 py-2.5 align-top">
        {cell(
          row.approvedLoanShareAmount,
          row.pendingLoanShareAmount,
          cop,
          'text-[var(--color-success)]',
        )}
      </td>
      {/* Aportes — Capitalización */}
      <td className="text-right px-3 py-2.5 align-top">
        {cell(
          row.approvedCapitalization,
          row.pendingCapitalization,
          cop,
          'text-[var(--color-brand)]',
        )}
      </td>

      {/* Préstamos — Préstamo desembolsado */}
      <td className="text-right px-3 py-2.5 align-top tabular font-medium border-l border-[var(--color-border)]/60">
        {row.disbursedAmount > 0 ? cop(row.disbursedAmount) : '—'}
      </td>
      {/* Préstamos — Pago capital */}
      <td className="text-right px-3 py-2.5 align-top">
        <div
          className={`tabular font-medium ${
            row.paidCapital > 0
              ? 'text-[var(--color-success)]'
              : 'text-[var(--color-text-subtle)]'
          }`}
        >
          {row.paidCapital > 0 ? cop(row.paidCapital) : '—'}
        </div>
      </td>
      {/* Préstamos — Pago intereses */}
      <td className="text-right px-3 py-2.5 align-top">
        <div
          className={`tabular font-medium ${
            row.paidInterest > 0
              ? 'text-[var(--color-success)]'
              : 'text-[var(--color-text-subtle)]'
          }`}
        >
          {row.paidInterest > 0 ? cop(row.paidInterest) : '—'}
        </div>
      </td>

      {/* Utilidades */}
      <td className="text-right px-3 py-2.5 align-top tabular border-l border-[var(--color-border)]/60">
        {row.participation > 0
          ? `${(row.participation * 100).toFixed(2)}%`
          : '—'}
      </td>
      <td className="text-right px-3 py-2.5 align-top tabular text-[var(--color-text-muted)]">
        {row.utilitiesPool > 0 ? cop(row.utilitiesPool) : '—'}
      </td>
      <td className="text-right px-3 py-2.5 align-top tabular font-medium">
        {row.distribution > 0 ? (
          <span className="text-[var(--color-brand)]">
            {cop(row.distribution)}
          </span>
        ) : (
          <span className="text-[var(--color-text-subtle)]">—</span>
        )}
      </td>
    </tr>
  );
}

function MonthCardMobile({ row }: { row: MonthSummary }) {
  const aportesTotal =
    row.approvedAmount +
    row.approvedLoanShareAmount +
    row.approvedCapitalization +
    row.approvedFines;
  const prestamosTotal = row.paidCapital + row.paidInterest;

  return (
    <div className="px-5 py-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[14px] font-semibold">{row.label}</span>
        {row.projectedFine > 0 && (
          <Badge tone="danger">Mora</Badge>
        )}
      </div>

      {/* Aportes */}
      {(aportesTotal > 0 ||
        row.pendingAmount > 0 ||
        row.pendingCapitalization > 0) && (
        <div className="flex flex-col gap-1 p-2.5 rounded-[8px] bg-[var(--color-info-soft)]/30">
          <div className="text-[10px] font-semibold text-[var(--color-info)] uppercase tracking-wider">
            Aportes
          </div>
          <div className="text-[12px] text-[var(--color-text-muted)] flex flex-wrap gap-x-3 gap-y-0.5">
            {row.approvedShares > 0 && (
              <span>
                {row.approvedShares} acc · {cop(row.approvedAmount)}
              </span>
            )}
            {row.approvedLoanShares > 0 && (
              <span>
                {row.approvedLoanShares} acc. préstamo ·{' '}
                {cop(row.approvedLoanShareAmount)}
              </span>
            )}
            {row.approvedCapitalization > 0 && (
              <span className="text-[var(--color-brand)] font-semibold">
                Capitaliz. {cop(row.approvedCapitalization)}
              </span>
            )}
            {row.approvedFines > 0 && (
              <span className="text-[var(--color-warn)] font-semibold">
                Multa {cop(row.approvedFines)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Préstamos */}
      {(row.disbursedAmount > 0 || prestamosTotal > 0) && (
        <div className="flex flex-col gap-1 p-2.5 rounded-[8px] bg-[var(--color-warn-soft)]/30">
          <div className="text-[10px] font-semibold text-[var(--color-warn)] uppercase tracking-wider">
            Préstamos
          </div>
          <div className="text-[12px] text-[var(--color-text-muted)] flex flex-wrap gap-x-3 gap-y-0.5">
            {row.disbursedAmount > 0 && (
              <span>Desembolso {cop(row.disbursedAmount)}</span>
            )}
            {row.paidCapital > 0 && (
              <span className="text-[var(--color-success)] font-semibold">
                Capital {cop(row.paidCapital)}
              </span>
            )}
            {row.paidInterest > 0 && (
              <span className="text-[var(--color-success)] font-semibold">
                Intereses {cop(row.paidInterest)}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
