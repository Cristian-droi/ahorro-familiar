'use client';

// Dashboard del accionista. Resume el estado de su cuenta:
//   - Mi capital (suma de aportes aprobados del año)
//   - Mis préstamos (saldo total + próximo pago)
//   - Distribución del año (utilidades acumuladas)
//   - Bandeja personal (recibos rechazados, préstamos por votar, etc.)
//   - Actividad reciente (últimos recibos)

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
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
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getProfile } from '@/lib/data/profiles';
import { listReceiptsForUser } from '@/lib/data/receipts';
import {
  getMyActiveLoansDebt,
  getMyUtilitiesByYear,
  countLoansAwaitingMyVote,
  countLoansRequiringActionForUser,
  countLoansReadyForDisbursementForUser,
  countLoansActiveUnseenForUser,
  countMyPendingLoanSharePurchases,
  type ActiveLoanDebt,
} from '@/lib/data/loans';
import { countRejectedReceiptsForUser } from '@/lib/data/receipts';
import {
  cop,
  formatDateTime,
  receiptStatusLabel,
} from '@/lib/format';
import { getBogotaCurrentMonth } from '@/lib/fines';
import type { ReceiptStatus } from '@/types/entities';

type ReceiptLite = {
  id: string;
  receipt_number: string | null;
  status: ReceiptStatus;
  submitted_at: string;
  total_amount: number;
};

export default function AccionistaDashboardPage() {
  const [firstName, setFirstName] = useState<string>('');
  // Necesitamos saber si el accionista ya eligió su valor de acción para
  // mostrarle el banner de onboarding. Undefined = cargando, null = no elegido.
  const [shareValue, setShareValue] = useState<number | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  // Capital (suma de aportes aprobados del año)
  const [capitalAportes, setCapitalAportes] = useState<number>(0);
  const [capitalCount, setCapitalCount] = useState<number>(0);

  // Préstamos
  const [loanDebts, setLoanDebts] = useState<ActiveLoanDebt[]>([]);

  // Utilidades del año
  const [utilitiesYearTotal, setUtilitiesYearTotal] = useState<number>(0);

  // Pendientes
  const [pendingRejected, setPendingRejected] = useState<number>(0);
  const [pendingVotes, setPendingVotes] = useState<number>(0);
  const [pendingLoanAction, setPendingLoanAction] = useState<number>(0);
  const [pendingLoanReady, setPendingLoanReady] = useState<number>(0);
  const [pendingLoanActive, setPendingLoanActive] = useState<number>(0);
  const [pendingLoanShares, setPendingLoanShares] = useState<number>(0);

  // Actividad reciente (últimos recibos)
  const [recentReceipts, setRecentReceipts] = useState<ReceiptLite[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user || cancelled) return;
      const uid = authData.user.id;

      try {
        const profile = await getProfile(supabase, uid);
        if (cancelled) return;
        if (profile?.first_name) setFirstName(profile.first_name);
        setShareValue(profile?.selected_share_value ?? null);
      } catch {
        /* ignore */
      }

      const year = Number(getBogotaCurrentMonth().slice(0, 4));

      try {
        const [
          itemsRes,
          debts,
          utilities,
          rejected,
          votes,
          loanAction,
          loanReady,
          loanActive,
          loanShares,
          receipts,
        ] = await Promise.all([
          // Aportes aprobados del año (acciones + acciones_prestamo + capitalizacion)
          supabase
            .from('receipt_items')
            .select(
              'concept, share_count, amount, target_month, receipts!inner(user_id, status)',
            )
            .eq('receipts.user_id', uid)
            .eq('receipts.status', 'approved')
            .in('concept', ['acciones', 'acciones_prestamo', 'capitalizacion'])
            .gte('target_month', `${year}-01-01`)
            .lt('target_month', `${year + 1}-01-01`),
          getMyActiveLoansDebt(supabase).catch(() => [] as ActiveLoanDebt[]),
          getMyUtilitiesByYear(supabase, year).catch(() => []),
          countRejectedReceiptsForUser(supabase, uid).catch(() => 0),
          countLoansAwaitingMyVote(supabase, uid).catch(() => 0),
          countLoansRequiringActionForUser(supabase, uid).catch(() => 0),
          countLoansReadyForDisbursementForUser(supabase, uid).catch(() => 0),
          countLoansActiveUnseenForUser(supabase, uid).catch(() => 0),
          countMyPendingLoanSharePurchases(supabase).catch(() => 0),
          listReceiptsForUser(supabase, uid).catch(() => []),
        ]);
        if (cancelled) return;

        // Capital del año.
        let cap = 0;
        let cnt = 0;
        for (const it of itemsRes.data ?? []) {
          cap += Number((it as { amount: number }).amount ?? 0);
          if (
            (it as { concept: string }).concept === 'acciones' ||
            (it as { concept: string }).concept === 'acciones_prestamo'
          ) {
            cnt += Number((it as { share_count: number | null }).share_count ?? 0);
          }
        }
        setCapitalAportes(cap);
        setCapitalCount(cnt);

        setLoanDebts(debts);

        const utilTotal = utilities.reduce((s, u) => s + u.distribution, 0);
        setUtilitiesYearTotal(utilTotal);

        setPendingRejected(rejected);
        setPendingVotes(votes);
        setPendingLoanAction(loanAction);
        setPendingLoanReady(loanReady);
        setPendingLoanActive(loanActive);
        setPendingLoanShares(loanShares);

        setRecentReceipts(
          (receipts ?? []).slice(0, 5).map((r) => ({
            id: r.id,
            receipt_number: r.receipt_number,
            status: r.status,
            submitted_at: r.submitted_at,
            total_amount: Number(r.total_amount ?? 0),
          })),
        );
      } catch (err) {
        console.error('Error cargando dashboard accionista:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const greeting = firstName ? `Hola, ${firstName}` : 'Hola';
  const needsShareValue = shareValue === null;

  // Saldo total de préstamos activos.
  const loanBalanceTotal = useMemo(
    () => loanDebts.reduce((s, d) => s + d.outstanding_capital, 0),
    [loanDebts],
  );
  const interestOwedTotal = useMemo(
    () => loanDebts.reduce((s, d) => s + d.interest_owed, 0),
    [loanDebts],
  );

  const totalPending =
    pendingRejected +
    pendingVotes +
    pendingLoanAction +
    pendingLoanReady +
    pendingLoanActive +
    pendingLoanShares;

  return (
    <div className="flex flex-col gap-7 animate-in fade-in duration-300">
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

      {/* KPIs principales */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <Kpi
          icon={Coins}
          tone="success"
          label="Mi capital del año"
          value={loading ? '…' : cop(capitalAportes)}
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
          value={loading ? '…' : cop(loanBalanceTotal)}
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
          value={loading ? '…' : cop(interestOwedTotal)}
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
          value={loading ? '…' : cop(utilitiesYearTotal)}
          hint="Acumulada hasta hoy"
          href="/dashboard/extracto"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
        {/* Mis préstamos activos (resumen) */}
        <Card padding="none" className="overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[var(--color-border)] flex items-center gap-3">
            <div className="w-9 h-9 rounded-[10px] bg-[var(--color-brand-soft)] text-[var(--color-brand)] flex items-center justify-center shrink-0">
              <Landmark size={16} strokeWidth={1.75} />
            </div>
            <div className="flex-1 min-w-0">
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

          {loading ? (
            <div className="px-5 py-6 text-center text-[12px] text-[var(--color-text-subtle)] animate-pulse">
              Cargando…
            </div>
          ) : loanDebts.length === 0 ? (
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
                  <div className="flex-1 min-w-0">
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
            <div className="flex-1 min-w-0">
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

          {loading ? (
            <div className="px-5 py-6 text-center text-[12px] text-[var(--color-text-subtle)] animate-pulse">
              Cargando…
            </div>
          ) : totalPending === 0 ? (
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

      {/* Actividad reciente */}
      <Card padding="none" className="overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[var(--color-border)] flex items-center gap-3">
          <div className="w-9 h-9 rounded-[10px] bg-[var(--color-brand-soft)] text-[var(--color-brand)] flex items-center justify-center shrink-0">
            <Receipt size={16} strokeWidth={1.75} />
          </div>
          <div className="flex-1 min-w-0">
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

        {loading ? (
          <div className="px-5 py-6 text-center text-[12px] text-[var(--color-text-subtle)] animate-pulse">
            Cargando…
          </div>
        ) : recentReceipts.length === 0 ? (
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
                  <div className="flex-1 min-w-0">
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
  icon: typeof Wallet;
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
    </Link>
  );
}

function InboxRow({
  icon: Icon,
  label,
  count,
  href,
}: {
  icon: typeof Wallet;
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
      <div className="flex-1 min-w-0">
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

