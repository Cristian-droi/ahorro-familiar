import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { LoanRepository } from '@/lib/domain/repositories/LoanRepository';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  Wallet,
  TrendingUp,
  Landmark,
  Coins,
  ChevronRight,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  Plus,
  ShoppingCart,
  Receipt,
  ArrowRight,
  Calendar,
} from 'lucide-react';
import { getProfile } from '@/lib/data/profiles';
import {
  countRejectedReceiptsForUser,
  listReceiptsForUser,
} from '@/lib/data/receipts';
import {
  cop,
  formatDateTime,
  receiptStatusLabel,
} from '@/lib/format';
import { getBogotaCurrentMonth } from '@/lib/fines';
import type { ReceiptStatus } from '@/types/entities';
import { SavingsGrowthChart } from '@/components/dashboard/DashboardCharts';
import { AccionistaRealtime } from './AccionistaRealtime';
import { NextYearCapitalizationWidget } from './NextYearCapitalizationWidget';

export const metadata = {
  title: 'Dashboard Accionista',
};

type ReceiptLite = {
  id: string;
  receipt_number: string | null;
  status: ReceiptStatus;
  submitted_at: string;
  total_amount: number;
};

export default async function AccionistaDashboardPage() {
  const supabase = await createSupabaseServerClient();
  const repo = new LoanRepository(supabase);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login');
  }
  const uid = user.id;

  // Carga del perfil en el servidor
  const profile = await getProfile(supabase, uid).catch(() => null);
  const firstName = profile?.first_name || '';
  const shareValue = profile?.selected_share_value ?? null;

  const year = Number(getBogotaCurrentMonth().slice(0, 4));

  // Carga paralela de KPIs
  const [
    itemsRes,
    loanDebts,
    utilities,
    pendingRejected,
    pendingVotes,
    pendingLoanAction,
    pendingLoanReady,
    pendingLoanActive,
    pendingLoanShares,
    receipts,
    settingsRes,
  ] = await Promise.all([
    // Aportes aprobados del año (acciones + acciones_prestamo + capitalizacion)
    supabase
      .from('receipt_items')
      .select('concept, share_count, amount, target_month, receipts!inner(user_id, status)')
      .eq('receipts.user_id', uid)
      .eq('receipts.status', 'approved')
      .in('concept', ['acciones', 'acciones_prestamo', 'capitalizacion'])
      .gte('target_month', `${year}-01-01`)
      .lt('target_month', `${year + 1}-01-01`),
    repo.getMyActiveLoansDebt().catch(() => []),
    repo.getMyUtilitiesByYear(year).catch(() => []),
    countRejectedReceiptsForUser(supabase, uid).catch(() => 0),
    repo.countLoansAwaitingMyVote(uid).catch(() => 0),
    repo.countLoansRequiringActionForUser(uid).catch(() => 0),
    repo.countLoansReadyForDisbursementForUser(uid).catch(() => 0),
    repo.countLoansActiveUnseenForUser(uid).catch(() => 0),
    repo.countMyPendingLoanSharePurchases().catch(() => 0),
    listReceiptsForUser(supabase, uid).catch(() => []),
    supabase
      .from('system_settings')
      .select('key, value')
      .in('key', ['resumen_next_year_shares_percentage', 'next_year_capitalization_active']),
  ]);

  // Extract settings
  const settingsList = settingsRes?.data || [];
  const nextYearCapitalizationActive = settingsList.find(s => s.key === 'next_year_capitalization_active')?.value === true;
  const nextYearSharesPercentage = Number(settingsList.find(s => s.key === 'resumen_next_year_shares_percentage')?.value ?? 0.30);

  // Calcular Capital y conteo de acciones
  let capitalAportes = 0;
  let capitalCount = 0;
  let valorAcciones = 0;
  let capitalizaciones = 0;
  for (const it of itemsRes.data ?? []) {
    const amt = Number(it.amount ?? 0);
    capitalAportes += amt;
    if (it.concept === 'acciones' || it.concept === 'acciones_prestamo') {
      capitalCount += Number(it.share_count ?? 0);
      valorAcciones += amt;
    } else if (it.concept === 'capitalizacion') {
      capitalizaciones += amt;
    }
  }

  const initialCapitalization = Number(profile?.next_year_capitalization ?? 0);

  // Calcular utilidades totales del año
  const utilitiesYearTotal = utilities.reduce((s, u) => s + u.distribution, 0);

  // Totales de préstamos
  const loanBalanceTotal = loanDebts.reduce((s, d) => s + d.outstanding_capital, 0);
  const interestOwedTotal = loanDebts.reduce((s, d) => s + d.interest_owed, 0);

  const totalPending =
    pendingRejected +
    pendingVotes +
    pendingLoanAction +
    pendingLoanReady +
    pendingLoanActive +
    pendingLoanShares;

  const recentReceipts: ReceiptLite[] = (receipts ?? []).slice(0, 5).map((r) => ({
    id: r.id,
    receipt_number: r.receipt_number,
    status: r.status,
    submitted_at: r.submitted_at,
    total_amount: Number(r.total_amount ?? 0),
  }));

  // Generar datos históricos mensuales de ahorro para la gráfica
  const monthlySavings: { [key: string]: number } = {};
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    monthlySavings[key] = 0;
  }

  for (const it of itemsRes.data ?? []) {
    const targetMonth = it.target_month;
    if (targetMonth) {
      const monthYM = targetMonth.slice(0, 7);
      if (monthlySavings[monthYM] !== undefined) {
        monthlySavings[monthYM] += Number(it.amount ?? 0);
      }
    }
  }

  const savingsData: { month: string; cumulativeSavings: number }[] = [];
  let accum = 0;
  const currentMonthIdx = new Date().getMonth(); // 0 a 11

  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    accum += monthlySavings[key];

    if (m - 1 <= currentMonthIdx) {
      const d = new Date(year, m - 1, 1);
      const label = d.toLocaleDateString('es-CO', { month: 'short' });
      const formattedLabel = label.charAt(0).toUpperCase() + label.slice(1).replace('.', '');
      savingsData.push({
        month: formattedLabel,
        cumulativeSavings: accum,
      });
    }
  }

  // Identificar los préstamos activos que tienen intereses pendientes o vencimientos
  const loansWithInterest = loanDebts.filter((d) => d.interest_owed > 0);
  const totalInterestOwedAllLoans = loansWithInterest.reduce((s, d) => s + d.interest_owed, 0);

  const greeting = firstName ? `Hola, ${firstName}` : 'Hola';
  const needsShareValue = shareValue === null;

  return (
    <div className="flex flex-col gap-7 animate-in fade-in duration-300">
      <AccionistaRealtime userId={uid} />

      {/* Page header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-5">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.025em] leading-[1.15]">
            {greeting}
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1.5">
            Tu resumen al día — todo lo que pasa en tu cuenta.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start md:self-auto">
          <Link href="/dashboard/compras">
            <Button size="md">
              <Plus size={15} strokeWidth={1.75} />
              Nueva compra
            </Button>
          </Link>
        </div>
      </div>

      {/* Onboarding: si no eligió valor de acción, banner prioritario */}
      {needsShareValue && (
        <Card
          padding="md"
          className="border-[var(--color-warn)]/40 bg-[var(--color-warn-soft)]/20"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle
              size={16}
              strokeWidth={2}
              className="text-[var(--color-warn)] mt-0.5 shrink-0"
            />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-[var(--color-warn)]">
                Antes de empezar
              </div>
              <div className="text-[12px] text-[var(--color-text-muted)] mt-0.5">
                Elegí tu valor de acción mensual para poder registrar compras.
              </div>
            </div>
            <Link href="/dashboard/ajustes">
              <Button size="sm" variant="primary">
                Ir a Ajustes
              </Button>
            </Link>
          </div>
        </Card>
      )}

      {/* Widget de Capitalización del Siguiente Año */}
      {nextYearCapitalizationActive && (
        <NextYearCapitalizationWidget
          userId={uid}
          initialCapitalization={initialCapitalization}
          valorAcciones={valorAcciones}
          capitalizaciones={capitalizaciones}
          nextYearSharesPercentage={nextYearSharesPercentage}
          nextYear={year + 1}
        />
      )}

      {/* KPIs principales */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <Kpi
          icon={Coins}
          tone="success"
          label="Mi capital del año"
          value={cop(capitalAportes)}
          hint={
            capitalCount > 0
              ? `${capitalCount} ${capitalCount === 1 ? 'acción' : 'acciones'}`
              : 'Sin aportes aún'
          }
          href="/dashboard/extracto"
        />
        <Kpi
          icon={Landmark}
          tone="brand"
          label="Saldo de préstamos"
          value={cop(loanBalanceTotal)}
          hint={
            loanDebts.length === 0
              ? 'Sin préstamos activos'
              : `${loanDebts.length} ${loanDebts.length === 1 ? 'préstamo' : 'préstamos'}`
          }
          href="/dashboard/prestamos"
        />
        <Kpi
          icon={Wallet}
          tone={interestOwedTotal > 0 ? 'warn' : 'success'}
          label="Intereses por pagar"
          value={cop(interestOwedTotal)}
          hint={
            interestOwedTotal > 0
              ? 'Pagar antes de abonar capital'
              : 'Al día'
          }
          href="/dashboard/compras"
        />
        <Kpi
          icon={TrendingUp}
          tone="brand"
          label="Distribución del año"
          value={cop(utilitiesYearTotal)}
          hint="Acumulada hasta hoy"
          href="/dashboard/extracto"
        />
      </div>

      {/* Tarjeta de Próximo Vencimiento destacada (1 solo préstamo) */}
      {loansWithInterest.length === 1 && (
        <Card
          padding="md"
          className="border-[var(--color-warn)]/30 bg-[var(--color-warn-soft)]/10 flex flex-col md:flex-row md:items-center justify-between gap-4"
        >
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-[10px] bg-[var(--color-warn-soft)] text-[var(--color-warn)] flex items-center justify-center shrink-0 mt-0.5">
              <Calendar size={18} strokeWidth={2} />
            </div>
            <div className="flex-1 min-w-0 text-left">
              <div className="text-[14px] font-bold tracking-tight text-[var(--color-text)]">
                Próximo pago de intereses (Préstamo #{loansWithInterest[0].loan_number}{loansWithInterest[0].disbursement_number ? ` · ${loansWithInterest[0].disbursement_number}` : ''})
              </div>
              <p className="text-[12px] text-[var(--color-text-subtle)] mt-1">
                Tenés intereses pendientes de{' '}
                <span className="font-bold text-[var(--color-warn)]">
                  {cop(loansWithInterest[0].interest_owed)}
                </span>{' '}
                a vencer el{' '}
                <span className="font-semibold text-[var(--color-text)]">
                  {new Date(loansWithInterest[0].next_due_month + 'T00:00:00').toLocaleDateString('es-CO', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </span>
                .
              </p>
            </div>
          </div>
          <Link href="/dashboard/compras" className="shrink-0">
            <Button size="sm" className="w-full md:w-auto">
              Pagar intereses
              <ArrowRight size={14} strokeWidth={2} />
            </Button>
          </Link>
        </Card>
      )}

      {/* Tarjeta de Próximos Vencimientos destacada (Múltiples préstamos) */}
      {loansWithInterest.length > 1 && (
        <Card
          padding="none"
          className="border-[var(--color-warn)]/30 bg-[var(--color-warn-soft)]/10 overflow-hidden"
        >
          <div className="p-4 md:p-5 border-b border-[var(--color-warn)]/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-[10px] bg-[var(--color-warn-soft)] text-[var(--color-warn)] flex items-center justify-center shrink-0">
                <Calendar size={18} strokeWidth={2} />
              </div>
              <div>
                <div className="text-[14px] font-bold tracking-tight text-[var(--color-text)]">
                  Próximos pagos de intereses ({loansWithInterest.length} préstamos activos)
                </div>
                <p className="text-[12px] text-[var(--color-text-subtle)] mt-0.5">
                  Desglose de los intereses pendientes de pago por cada uno de tus créditos:
                </p>
              </div>
            </div>
            <Link href="/dashboard/compras" className="shrink-0">
              <Button size="sm" className="w-full sm:w-auto">
                Pagar intereses
                <ArrowRight size={14} strokeWidth={2} />
              </Button>
            </Link>
          </div>

          <div className="divide-y divide-[var(--color-warn)]/15 bg-[var(--color-surface)]/60">
            {loansWithInterest.map((l) => (
              <div key={l.loan_id} className="flex items-center justify-between px-5 py-3.5 gap-3">
                <div className="flex flex-col min-w-0 text-left">
                  <span className="text-[13px] font-semibold tracking-tight text-[var(--color-text)]">
                    Préstamo #{l.loan_number}{l.disbursement_number ? ` (${l.disbursement_number})` : ''}
                  </span>
                  <span className="text-[11px] text-[var(--color-text-subtle)] mt-0.5">
                    Vence el{' '}
                    {new Date(l.next_due_month + 'T00:00:00').toLocaleDateString('es-CO', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}{' '}
                    · Saldo capital: {cop(l.outstanding_capital)}
                  </span>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-[13px] font-bold tabular text-[var(--color-warn)]">
                    {cop(l.interest_owed)}
                  </span>
                  <div className="text-[10px] text-[var(--color-text-subtle)]">intereses pendientes</div>
                </div>
              </div>
            ))}
          </div>

          <div className="p-3.5 px-5 bg-[var(--color-warn-soft)]/20 border-t border-[var(--color-warn)]/20 flex items-center justify-between">
            <span className="text-[12px] font-semibold text-[var(--color-text-muted)]">
              Total intereses pendientes acumulados
            </span>
            <span className="text-[14px] font-bold tabular text-[var(--color-warn)]">
              {cop(totalInterestOwedAllLoans)}
            </span>
          </div>
        </Card>
      )}

      {/* Distribución de Contenido con Grilla de Dos Columnas */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
        {/* Columna Izquierda: Gráfico de Ahorro + Actividad Reciente */}
        <div className="flex flex-col gap-6">
          {/* Gráfico de Ahorro */}
          <Card>
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-[8px] bg-[var(--color-brand-soft)] text-[var(--color-brand)] flex items-center justify-center">
                <TrendingUp size={15} strokeWidth={2} />
              </div>
              <div className="text-left">
                <h2 className="text-sm font-semibold tracking-tight">Crecimiento de Ahorros ({year})</h2>
                <p className="text-[11px] text-[var(--color-text-subtle)]">
                  Progreso acumulado de tus aportes (acciones y capitalizaciones) mes a mes.
                </p>
              </div>
            </div>
            <div className="w-full">
              <SavingsGrowthChart data={savingsData} />
            </div>
          </Card>

          {/* Actividad reciente */}
          <Card padding="none" className="overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[var(--color-border)] flex items-center gap-3">
              <div className="w-9 h-9 rounded-[10px] bg-[var(--color-brand-soft)] text-[var(--color-brand)] flex items-center justify-center shrink-0">
                <Receipt size={16} strokeWidth={1.75} />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <h2 className="text-[14px] font-semibold tracking-tight">
                  Actividad reciente
                </h2>
                <p className="text-[11px] text-[var(--color-text-subtle)] mt-0.5">
                  Tus últimos recibos enviados.
                </p>
              </div>
              <Link
                href="/dashboard/historial"
                className="text-[11px] font-semibold text-[var(--color-brand)] hover:underline inline-flex items-center gap-1"
              >
                Ver historial <ArrowRight size={12} strokeWidth={2} />
              </Link>
            </div>

            {recentReceipts.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-[13px] text-[var(--color-text-muted)]">
                  Aún no enviaste recibos.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--color-border)]">
                {recentReceipts.map((r) => {
                  const Icon = statusIcon(r.status);
                  const tone = statusTone(r.status);
                  return (
                    <div
                      key={r.id}
                      className="flex items-center gap-3 px-5 py-3"
                    >
                      <div
                        className={`w-8 h-8 rounded-[8px] flex items-center justify-center shrink-0 ${toneBgClass(tone)}`}
                      >
                        <Icon size={14} strokeWidth={2} />
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <div className="text-[13px] font-semibold tracking-tight">
                          {r.receipt_number ?? '—'}
                        </div>
                        <div className="text-[11px] text-[var(--color-text-subtle)]">
                          {formatDateTime(r.submitted_at)}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[13px] font-semibold tabular">
                          {cop(r.total_amount)}
                        </div>
                        <Badge tone={tone} dot>
                          {receiptStatusLabel(r.status)}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Columna Derecha: Préstamos Activos + Tu Bandeja */}
        <div className="flex flex-col gap-6">
          {/* Mis préstamos activos (resumen) */}
          <Card padding="none" className="overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[var(--color-border)] flex items-center gap-3">
              <div className="w-9 h-9 rounded-[10px] bg-[var(--color-brand-soft)] text-[var(--color-brand)] flex items-center justify-center shrink-0">
                <Landmark size={16} strokeWidth={1.75} />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <h2 className="text-[14px] font-semibold tracking-tight">
                  Mis préstamos activos
                </h2>
                <p className="text-[11px] text-[var(--color-text-subtle)] mt-0.5">
                  Saldos e intereses adeudados al día.
                </p>
              </div>
              {loanDebts.length > 0 && (
                <Link
                  href="/dashboard/prestamos"
                  className="text-[11px] font-semibold text-[var(--color-brand)] hover:underline inline-flex items-center gap-1"
                >
                  Ver todos <ArrowRight size={12} strokeWidth={2} />
                </Link>
              )}
            </div>

            {loanDebts.length === 0 ? (
              <div className="px-5 py-10 flex flex-col items-center gap-2 text-center">
                <Landmark
                  size={28}
                  strokeWidth={1.5}
                  className="text-[var(--color-text-subtle)]"
                />
                <p className="text-[13px] font-semibold">
                  No tenés préstamos activos
                </p>
                <p className="text-[11px] text-[var(--color-text-subtle)] max-w-xs">
                  Si necesitás un préstamo del fondo, podés hacer la solicitud.
                </p>
                <Link href="/dashboard/prestamos/nueva" className="mt-2">
                  <Button size="sm" variant="secondary">
                    Solicitar préstamo
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-[var(--color-border)]">
                {loanDebts.map((d) => (
                  <Link
                    key={d.loan_id}
                    href={`/dashboard/prestamos/${d.loan_id}`}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-surface-alt)]/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0 text-left">
                      <div className="text-[13px] font-semibold tracking-tight">
                        {d.disbursement_number ?? 'Préstamo'}
                      </div>
                      <div className="text-[11px] text-[var(--color-text-subtle)] mt-0.5">
                        Pedido {cop(d.requested_amount)} ·{' '}
                        {(d.interest_rate * 100).toFixed(2)}% mensual
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[13px] font-semibold tabular">
                        {cop(d.outstanding_capital)}
                      </div>
                      {d.interest_owed > 0 && (
                        <div className="text-[10px] text-[var(--color-warn)] font-semibold">
                          + {cop(d.interest_owed)} intereses
                        </div>
                      )}
                    </div>
                    <ChevronRight
                      size={14}
                      strokeWidth={1.75}
                      className="text-[var(--color-text-subtle)] shrink-0"
                    />
                  </Link>
                ))}
              </div>
            )}
          </Card>

          {/* Bandeja personal */}
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
                  {totalPending === 0
                    ? 'Estás al día'
                    : `${totalPending} ${totalPending === 1 ? 'pendiente' : 'pendientes'}`}
                </p>
              </div>
            </div>

            {totalPending === 0 ? (
              <div className="px-5 py-10 flex flex-col items-center gap-2 text-center">
                <CheckCircle2
                  size={28}
                  strokeWidth={1.5}
                  className="text-[var(--color-success)]"
                />
                <p className="text-[13px] font-semibold">Sin pendientes</p>
                <p className="text-[11px] text-[var(--color-text-subtle)] max-w-xs">
                  No tenés acciones pendientes. Cuando aparezca algo, se mostrará acá.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--color-border)]">
                {pendingVotes > 0 && (
                  <InboxRow
                    icon={Landmark}
                    label="Préstamos esperando tu voto"
                    count={pendingVotes}
                    href="/dashboard/prestamos/votar"
                  />
                )}
                {pendingLoanAction > 0 && (
                  <InboxRow
                    icon={Landmark}
                    label="Préstamos por revisar o rechazados"
                    count={pendingLoanAction}
                    href="/dashboard/prestamos"
                  />
                )}
                {pendingLoanReady > 0 && (
                  <InboxRow
                    icon={Landmark}
                    label="Préstamos listos para desembolso"
                    count={pendingLoanReady}
                    href="/dashboard/prestamos"
                  />
                )}
                {pendingLoanActive > 0 && (
                  <InboxRow
                    icon={Landmark}
                    label="Préstamos recién desembolsados"
                    count={pendingLoanActive}
                    href="/dashboard/prestamos"
                  />
                )}
                {pendingLoanShares > 0 && (
                  <InboxRow
                    icon={ShoppingCart}
                    label="Acciones por préstamo por pagar"
                    count={pendingLoanShares}
                    href="/dashboard/compras"
                  />
                )}
                {pendingRejected > 0 && (
                  <InboxRow
                    icon={Receipt}
                    label="Recibos por reenviar"
                    count={pendingRejected}
                    href="/dashboard/historial"
                  />
                )}
              </div>
            )}
          </Card>
        </div>
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
  hint,
  href,
}: {
  icon: React.ComponentType<{ size: number; strokeWidth: number }>;
  tone: 'brand' | 'success' | 'danger' | 'warn';
  label: string;
  value: string;
  hint?: string;
  href: string;
}) {
  const toneBg: Record<typeof tone, string> = {
    brand: 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]',
    success: 'bg-[var(--color-success-soft)] text-[var(--color-success)]',
    danger: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
    warn: 'bg-[var(--color-warn-soft)] text(--color-warn)',
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
        {hint && (
          <div className="text-[11px] text-[var(--color-text-muted)] mt-1 text-left">
            {hint}
          </div>
        )}
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

function toneBgClass(tone: 'warn' | 'success' | 'danger') {
  if (tone === 'warn')
    return 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]';
  if (tone === 'success')
    return 'bg-[var(--color-success-soft)] text-[var(--color-success)]';
  return 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]';
}
