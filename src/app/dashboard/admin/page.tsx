import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { LoanRepository } from '@/lib/domain/repositories/LoanRepository';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import {
  Users,
  Wallet,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  FileText,
  Receipt,
  Landmark,
  ChevronRight,
  CheckCircle2,
  TrendingUp,
  Activity,
  PieChart,
} from 'lucide-react';
import { getProfile, listProfilesWithNames } from '@/lib/data/profiles';
import { listAllReceiptsWithItems, countPendingReceipts } from '@/lib/data/receipts';
import { countPendingMembershipRequests } from '@/lib/data/membership-requests';
import {
  computeFineForMonth,
  DEFAULT_PURCHASE_RULES,
  getBogotaCurrentMonth,
  getBogotaToday,
  type PurchaseRules,
} from '@/lib/fines';
import { cop } from '@/lib/format';
import { InflowOutflowChart, PortfolioDonutChart } from '@/components/dashboard/DashboardCharts';
import { AdminRealtime } from './AdminRealtime';

export const metadata = {
  title: 'Dashboard Administrador',
};

type ProfileLite = {
  id: string;
  first_name: string;
  last_name: string;
  identity_document: string;
};

type OverdueRow = {
  user: ProfileLite;
  monthsCount: number;
  monthsNames: string[];
  totalFineAmount: number;
};

export default async function AdminDashboardPage() {
  const supabase = await createSupabaseServerClient();
  const repo = new LoanRepository(supabase);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login');
  }

  const profile = await getProfile(supabase, user.id).catch(() => null);
  const firstName = profile?.first_name || '';

  const ym = getBogotaCurrentMonth().slice(0, 7);
  const currentYear = ym.slice(0, 4);
  const today = getBogotaToday();

  // Carga paralela de KPIs y listados en el Servidor
  const [
    shareholdersRes,
    balance,
    receipts,
    disbursements,
    pendReceipts,
    pendMembership,
    pendLoans,
    profiles,
    rulesRes,
    allLoans,
  ] = await Promise.all([
    supabase.rpc('count_active_shareholders'),
    repo.getCashBalance().catch(() => 0),
    listAllReceiptsWithItems(supabase, { status: 'approved' }).catch(() => []),
    repo.getLoansWithDisbursement().catch(() => []),
    countPendingReceipts(supabase).catch(() => 0),
    countPendingMembershipRequests(supabase).catch(() => 0),
    repo.countAdminPendingLoans().catch(() => ({
      pendingReview: 0,
      pendingDisbursement: 0,
      total: 0,
    })),
    listProfilesWithNames(supabase).catch(() => []),
    supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'purchase_rules')
      .maybeSingle(),
    repo.getAllLoans().catch(() => []),
  ]);

  const activeShareholders = Number(shareholdersRes.data ?? 0);
  const cashBalance = Number(balance);

  // 1. Ingresos y egresos totales del año actual
  let inflowYear = 0;
  for (const r of receipts) {
    const date = (r.reviewed_at ?? r.submitted_at ?? '').slice(0, 4);
    if (date === currentYear) inflowYear += Number(r.total_amount ?? 0);
  }

  let outflowYear = 0;
  for (const d of disbursements) {
    const date = (d.disbursed_at ?? '').slice(0, 4);
    if (date === currentYear) outflowYear += Number(d.requested_amount ?? 0);
  }

  // 2. Histórico de 6 meses para la gráfica comparativa
  const last6Months: { month: string; ym: string; inflow: number; outflow: number }[] = [];
  const currentDate = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
    const label = d.toLocaleDateString('es-CO', { month: 'short' });
    const yearMonth = d.toISOString().slice(0, 7);
    const formattedLabel = label.charAt(0).toUpperCase() + label.slice(1).replace('.', '');
    last6Months.push({ month: formattedLabel, ym: yearMonth, inflow: 0, outflow: 0 });
  }

  // Llenar ingresos históricos
  for (const r of receipts) {
    const dateStr = r.reviewed_at ?? r.submitted_at ?? '';
    if (!dateStr) continue;
    const dateYM = dateStr.slice(0, 7);
    const match = last6Months.find((m) => m.ym === dateYM);
    if (match) match.inflow += Number(r.total_amount ?? 0);
  }

  // Llenar egresos históricos
  for (const d of disbursements) {
    const dateStr = d.disbursed_at ?? '';
    if (!dateStr) continue;
    const dateYM = dateStr.slice(0, 7);
    const match = last6Months.find((m) => m.ym === dateYM);
    if (match) match.outflow += Number(d.requested_amount ?? 0);
  }

  // 3. Distribución del portafolio de préstamos
  const activeLoansCount = allLoans.filter((l) => l.status === 'active').length;
  const pendingLoansCount = allLoans.filter((l) =>
    ['pending_review', 'pending_shareholder_vote', 'pending_disbursement'].includes(l.status),
  ).length;
  const paidLoansCount = allLoans.filter((l) => l.status === 'paid').length;

  const donutItems = [
    { name: 'Préstamos Activos', value: activeLoansCount, color: 'var(--color-success)' },
    { name: 'En Votación / Espera', value: pendingLoansCount, color: 'var(--color-brand)' },
    { name: 'Pagados', value: paidLoansCount, color: 'var(--color-text-subtle)' },
  ];

  // 4. Calcular multas proyectadas
  const rules: PurchaseRules = rulesRes?.data?.value
    ? {
        ...DEFAULT_PURCHASE_RULES,
        ...(rulesRes.data.value as Partial<PurchaseRules>),
      }
    : DEFAULT_PURCHASE_RULES;

  const currentYearNum = Number(ym.slice(0, 4));
  const currMonthNum = Number(ym.slice(5, 7));

  // Determinar meses a validar en el año en curso
  const monthsToValidate: string[] = [];
  for (let m = 1; m <= currMonthNum; m++) {
    monthsToValidate.push(`${currentYearNum}-${String(m).padStart(2, '0')}-01`);
  }

  // Si hoy aún está en periodo de gracia del mes actual, no exigimos el mes actual todavía
  const graceEnd = new Date(Date.UTC(currentYearNum, currMonthNum - 1, rules.grace_period_days));
  if (today.getTime() <= graceEnd.getTime() && monthsToValidate.length > 0) {
    monthsToValidate.pop();
  }

  // Consultar recibos aprobados de acciones y multas de todo el año
  const startOfYear = `${currentYearNum}-01-01`;
  const endOfYear = `${currentYearNum + 1}-01-01`;

  const { data: allApprovedItems } = await supabase
    .from('receipt_items')
    .select('concept, target_month, share_count, receipts!inner(status, user_id)')
    .eq('receipts.status', 'approved')
    .gte('target_month', startOfYear)
    .lt('target_month', endOfYear);

  const sharesByUserAndMonth = new Map<string, Map<string, number>>();
  const finesPaidByUserAndMonth = new Map<string, Set<string>>();

  for (const item of allApprovedItems || []) {
    const receipts = item.receipts as unknown as { user_id: string } | null;
    const uid = receipts?.user_id;
    if (!uid) continue;

    if (item.concept === 'acciones') {
      if (!sharesByUserAndMonth.has(uid)) sharesByUserAndMonth.set(uid, new Map());
      sharesByUserAndMonth.get(uid)!.set(item.target_month, (sharesByUserAndMonth.get(uid)!.get(item.target_month) || 0) + (item.share_count || 0));
    } else if (item.concept === 'multa_acciones') {
      if (!finesPaidByUserAndMonth.has(uid)) finesPaidByUserAndMonth.set(uid, new Set());
      finesPaidByUserAndMonth.get(uid)!.add(item.target_month);
    }
  }

  const monthNamesEs = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  const overdueList: OverdueRow[] = [];

  for (const p of profiles) {
    const uShares = sharesByUserAndMonth.get(p.id) || new Map();
    const uFinesPaid = finesPaidByUserAndMonth.get(p.id) || new Set();

    let totalFineAmount = 0;
    const overdueMonths: string[] = [];

    for (const monthStr of monthsToValidate) {
      const approvedShares = uShares.get(monthStr) || 0;
      const sharesOwed = Math.max(0, rules.min_shares_per_month - approvedShares);

      if (sharesOwed > 0) {
        const mIdx = Number(monthStr.split('-')[1]) - 1;
        overdueMonths.push(monthNamesEs[mIdx]);

        // Si pasamos el periodo de gracia del mes y no se ha pagado la multa, se calcula la multa
        const [y, m] = monthStr.split('-').map(Number);
        const limitDate = new Date(Date.UTC(y, m - 1, rules.grace_period_days));
        if (today.getTime() > limitDate.getTime()) {
          const finePaid = uFinesPaid.has(monthStr);
          if (!finePaid) {
            const fineOwed = computeFineForMonth(monthStr, today, rules);
            totalFineAmount += fineOwed;
          }
        }
      }
    }

    if (overdueMonths.length > 0) {
      overdueList.push({
        user: p,
        monthsCount: overdueMonths.length,
        monthsNames: overdueMonths,
        totalFineAmount,
      });
    }
  }

  overdueList.sort((a, b) => b.totalFineAmount - a.totalFineAmount);

  const greeting = firstName ? `Buen día, ${firstName}` : 'Buen día';
  const monthLabelEs = new Date().toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });

  const totalPendingActions =
    pendReceipts +
    pendMembership +
    pendLoans.pendingReview +
    pendLoans.pendingDisbursement;

  return (
    <div className="flex flex-col gap-7 animate-in fade-in duration-300">
      <AdminRealtime />

      {/* Page header */}
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.025em] leading-[1.15]">
          {greeting}
        </h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1.5 capitalize">
          Resumen del fondo · {monthLabelEs}
        </p>
      </div>

      {/* KPIs principales */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <Kpi
          icon={Users}
          tone="brand"
          label="Accionistas activos"
          value={`${activeShareholders}`}
          href="/dashboard/miembros"
        />
        <Kpi
          icon={Wallet}
          tone="success"
          label="Saldo en caja"
          value={cop(cashBalance)}
          href="/dashboard/libro-caja"
        />
        <Kpi
          icon={ArrowUp}
          tone="success"
          label={`Ingresos del año (${currentYear})`}
          value={cop(inflowYear)}
          href="/dashboard/libro-caja"
        />
        <Kpi
          icon={ArrowDown}
          tone="danger"
          label={`Egresos del año (${currentYear})`}
          value={cop(outflowYear)}
          href="/dashboard/libro-caja"
        />
      </div>

      {/* Operaciones del Admin (Multas y Bandeja de Tareas) - ARRIBA */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
        {/* Multas pendientes del mes */}
        <Card padding="none" className="overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[var(--color-border)] flex items-center gap-3">
            <div className="w-9 h-9 rounded-[10px] bg-[var(--color-warn-soft)] text-[var(--color-warn)] flex items-center justify-center shrink-0">
              <AlertTriangle size={16} strokeWidth={1.75} />
            </div>
            <div className="flex-1 min-w-0 text-left">
              <h2 className="text-[14px] font-semibold tracking-tight">
                Accionistas con mora / multas pendientes
              </h2>
              <p className="text-[11px] text-[var(--color-text-subtle)] mt-0.5">
                Socios con meses en mora o multas por no comprar acciones a tiempo en {currentYear}.
              </p>
            </div>
            {overdueList.length > 0 && (
              <Badge tone="warn">
                {overdueList.length}{' '}
                {overdueList.length === 1 ? 'en mora' : 'en mora'}
              </Badge>
            )}
          </div>

          {overdueList.length === 0 ? (
            <div className="px-5 py-10 flex flex-col items-center gap-2 text-center">
              <CheckCircle2
                size={28}
                strokeWidth={1.5}
                className="text-[var(--color-success)]"
              />
              <p className="text-[13px] font-semibold">
                Todos al día por ahora
              </p>
              <p className="text-[11px] text-[var(--color-text-subtle)] max-w-xs">
                No hay accionistas con meses pendientes ni multas por mora en lo que va del año.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {overdueList.map((o) => (
                <div
                  key={o.user.id}
                  className="flex items-center gap-3 px-5 py-3"
                >
                  <Avatar name={o.user.first_name} size={32} />
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-[13px] font-semibold tracking-tight truncate">
                      {o.user.first_name} {o.user.last_name}
                    </div>
                    <div className="text-[11px] text-[var(--color-text-subtle)] truncate">
                      CC {o.user.identity_document} · {o.monthsCount}{' '}
                      {o.monthsCount === 1 ? 'mes debiendo' : 'meses debiendo'}{' '}
                      <span className="text-[var(--color-text-muted)] font-medium">({o.monthsNames.join(', ')})</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[13px] font-semibold tabular text-[var(--color-warn)]">
                      {cop(o.totalFineAmount)}
                    </div>
                    <div className="text-[10px] text-[var(--color-text-subtle)]">
                      multas acumuladas
                    </div>
                  </div>
                </div>
              ))}
              <div className="px-5 py-3 bg-[var(--color-surface-alt)] flex items-center justify-between">
                <span className="text-[12px] font-semibold text-[var(--color-text-muted)]">
                  Total multas acumuladas en mora
                </span>
                <span className="text-[14px] font-semibold tabular text-[var(--color-warn)]">
                  {cop(overdueList.reduce((s, o) => s + o.totalFineAmount, 0))}
                </span>
              </div>
            </div>
          )}
        </Card>

        {/* Acciones pendientes del admin */}
        <Card padding="none" className="overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[var(--color-border)] flex items-center gap-3">
            <div className="w-9 h-9 rounded-[10px] bg-[var(--color-brand-soft)] text-[var(--color-brand)] flex items-center justify-center shrink-0">
              <TrendingUp size={16} strokeWidth={1.75} />
            </div>
            <div className="flex-1 min-w-0 text-left">
              <h2 className="text-[14px] font-semibold tracking-tight">
                Tu bandeja
              </h2>
              <p className="text-[11px] text-[var(--color-text-subtle)] mt-0.5">
                {totalPendingActions === 0
                  ? 'Estás al día'
                  : `${totalPendingActions} ${totalPendingActions === 1 ? 'tarea' : 'tareas'}`}
              </p>
            </div>
          </div>

          {totalPendingActions === 0 ? (
            <div className="px-5 py-10 flex flex-col items-center gap-2 text-center">
              <CheckCircle2
                size={28}
                strokeWidth={1.5}
                className="text-[var(--color-success)]"
              />
              <p className="text-[13px] font-semibold">Sin pendientes</p>
              <p className="text-[11px] text-[var(--color-text-subtle)] max-w-xs">
                Cuando llegue una solicitud o un recibo aparecerán acá.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {pendMembership > 0 && (
                <InboxRow
                  icon={FileText}
                  label="Solicitudes de ingreso"
                  count={pendMembership}
                  href="/dashboard/solicitudes"
                />
              )}
              {pendReceipts > 0 && (
                <InboxRow
                  icon={Receipt}
                  label="Recibos por aprobar"
                  count={pendReceipts}
                  href="/dashboard/libro-caja"
                />
              )}
              {pendLoans.pendingReview > 0 && (
                <InboxRow
                  icon={Landmark}
                  label="Préstamos en revisión"
                  count={pendLoans.pendingReview}
                  href="/dashboard/admin/prestamos"
                />
              )}
              {pendLoans.pendingDisbursement > 0 && (
                <InboxRow
                  icon={Landmark}
                  label="Préstamos por desembolsar"
                  count={pendLoans.pendingDisbursement}
                  href="/dashboard/admin/prestamos"
                />
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Gráficos del Fondo - ABAJO */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-[8px] bg-[var(--color-brand-soft)] text-[var(--color-brand)] flex items-center justify-center">
              <Activity size={15} strokeWidth={2} />
            </div>
            <div className="text-left">
              <h2 className="text-sm font-semibold tracking-tight">Rendimiento Histórico</h2>
              <p className="text-[11px] text-[var(--color-text-subtle)]">
                Flujo comparativo de Ingresos vs Egresos de los últimos 6 meses.
              </p>
            </div>
          </div>
          <InflowOutflowChart data={last6Months} />
        </Card>

        <Card>
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-[8px] bg-[var(--color-success-soft)] text-[var(--color-success)] flex items-center justify-center">
              <PieChart size={15} strokeWidth={2} />
            </div>
            <div className="text-left">
              <h2 className="text-sm font-semibold tracking-tight">Distribución de Préstamos</h2>
              <p className="text-[11px] text-[var(--color-text-subtle)]">
                Comportamiento de solicitudes.
              </p>
            </div>
          </div>
          <PortfolioDonutChart
            items={donutItems}
            totalLabel="Préstamos"
            totalValue={allLoans.length}
          />
        </Card>
      </div>
    </div>
  );
}

// =============================================================================
// Subcomponentes
// =============================================================================

function Kpi({
  icon: Icon,
  tone,
  label,
  value,
  href,
}: {
  icon: React.ComponentType<{ size: number; strokeWidth: number }>;
  tone: 'brand' | 'success' | 'danger' | 'warn';
  label: string;
  value: string;
  href: string;
}) {
  const toneBg: Record<typeof tone, string> = {
    brand: 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]',
    success: 'bg-[var(--color-success-soft)] text-[var(--color-success)]',
    danger: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
    warn: 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]',
  };
  return (
    <Link href={href} className="block group">
      <Card padding="md" className="group-hover:border-[var(--color-brand)]/40 transition-colors">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div
            className={`w-9 h-9 rounded-[10px] flex items-center justify-center ${toneBg[tone]}`}
          >
            <Icon size={16} strokeWidth={1.75} />
          </div>
          <ChevronRight
            size={14}
            strokeWidth={1.75}
            className="text-[var(--color-text-subtle)] opacity-0 group-hover:opacity-100 transition-opacity"
          />
        </div>
        <div className="text-[11px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase text-left">
          {label}
        </div>
        <div className="text-[20px] font-semibold tracking-[-0.02em] tabular mt-0.5 text-left">
          {value}
        </div>
      </Card>
    </Link>
  );
}

function InboxRow({
  icon: Icon,
  label,
  count,
  href,
}: {
  icon: React.ComponentType<{ size: number; strokeWidth: number }>;
  label: string;
  count: number;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-surface-alt)] transition-colors"
    >
      <div className="w-8 h-8 rounded-[8px] bg-[var(--color-surface-alt)] flex items-center justify-center text-[var(--color-text-muted)] shrink-0">
        <Icon size={14} strokeWidth={1.75} />
      </div>
      <div className="flex-1 min-w-0 text-left">
        <div className="text-[12.5px] font-medium tracking-tight text-[var(--color-text)] truncate">
          {label}
        </div>
      </div>
      <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-[var(--color-brand)] text-white dark:text-[var(--color-brand-ink)] text-[11px] font-bold inline-flex items-center justify-center shrink-0">
        {count}
      </span>
      <ChevronRight
        size={14}
        strokeWidth={1.75}
        className="text-[var(--color-text-subtle)] shrink-0"
      />
    </Link>
  );
}
